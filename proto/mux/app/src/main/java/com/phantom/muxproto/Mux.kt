package com.phantom.muxproto

import android.media.MediaCodec
import android.media.MediaExtractor
import android.media.MediaFormat
import android.media.MediaMuxer
import java.nio.ByteBuffer

private const val BUF_SIZE = 256 * 1024

private data class TrackDump(
    val mime: String,
    val durationUs: Long,
    val sampleRate: Int,
    val channelCount: Int,
)

private fun dumpTrack(format: MediaFormat): TrackDump = TrackDump(
    mime = format.getString(MediaFormat.KEY_MIME) ?: "?",
    durationUs = try {
        format.getLong(MediaFormat.KEY_DURATION)
    } catch (_: Exception) {
        -1L
    },
    sampleRate = try {
        format.getInteger(MediaFormat.KEY_SAMPLE_RATE)
    } catch (_: Exception) {
        -1
    },
    channelCount = try {
        format.getInteger(MediaFormat.KEY_CHANNEL_COUNT)
    } catch (_: Exception) {
        -1
    },
)

private fun pickTrack(ext: MediaExtractor, mimePrefix: String): Pair<Int, MediaFormat>? {
    for (i in 0 until ext.trackCount) {
        val format = ext.getTrackFormat(i)
        val mime = format.getString(MediaFormat.KEY_MIME) ?: continue
        if (mime.startsWith(mimePrefix)) return i to format
    }
    return null
}

private fun copyTrack(
    ext: MediaExtractor,
    track: Int,
    muxer: MediaMuxer,
    muxTrack: Int,
    startOffsetUs: Long,
    label: String,
): Pair<Long, Int> {
    ext.selectTrack(track)
    val buf = ByteBuffer.allocate(BUF_SIZE)
    val info = MediaCodec.BufferInfo()
    var samples = 0
    var maxPts = 0L
    while (true) {
        info.offset = 0
        val n = ext.readSampleData(buf, 0)
        if (n < 0) break
        info.size = n
        info.presentationTimeUs = ext.sampleTime + startOffsetUs
        info.flags = ext.sampleFlags
        maxPts = maxOf(maxPts, info.presentationTimeUs)
        buf.position(0)
        muxer.writeSampleData(muxTrack, buf, info)
        samples += 1
        ext.advance()
    }
    FileLog.line("$label: $samples samples, maxPts=${maxPts}us")
    return maxPts to samples
}

fun verifyOutput(path: String) {
    val ext = MediaExtractor().also { it.setDataSource(path) }
    try {
        for (i in 0 until ext.trackCount) {
            val format = ext.getTrackFormat(i)
            val mime = format.getString(MediaFormat.KEY_MIME) ?: "?"
            ext.selectTrack(i)
            var n = 0
            val buf = ByteBuffer.allocate(64 * 1024)
            while (ext.readSampleData(buf, 0) >= 0) {
                n += 1
                ext.advance()
            }
            ext.unselectTrack(i)
            FileLog.line("verify $mime: $n samples")
        }
    } finally {
        ext.release()
    }
}

object Mux {
    fun muxAv(videoPath: String, audioPath: String, outPath: String) {
        val vExt = MediaExtractor().also { it.setDataSource(videoPath) }
        val aExt = MediaExtractor().also { it.setDataSource(audioPath) }
        try {
            val (vTrack, vFormat) = pickTrack(vExt, "video/") ?: error("no video track")
            val (aTrack, aFormat) = pickTrack(aExt, "audio/") ?: error("no audio track")
            FileLog.line("video: ${dumpTrack(vFormat)}")
            FileLog.line("audio: ${dumpTrack(aFormat)}")
            val muxer = MediaMuxer(outPath, MediaMuxer.OutputFormat.MUXER_OUTPUT_MPEG_4)
            try {
                val mv = muxer.addTrack(vFormat)
                val ma = muxer.addTrack(aFormat)
                muxer.start()
                copyTrack(vExt, vTrack, muxer, mv, 0L, "video")
                copyTrack(aExt, aTrack, muxer, ma, 0L, "audio")
                muxer.stop()
            } finally {
                try {
                    muxer.release()
                } catch (_: Exception) {
                }
            }
        } finally {
            vExt.release()
            aExt.release()
        }
        FileLog.line("muxed -> $outPath (${java.io.File(outPath).length()} bytes)")
        verifyOutput(outPath)
    }

    fun remuxTs(inputs: List<String>, outPath: String) {
        require(inputs.isNotEmpty()) { "no inputs" }
        val muxer = MediaMuxer(outPath, MediaMuxer.OutputFormat.MUXER_OUTPUT_MPEG_4)
        val muxTracks = mutableMapOf<Int, Int>()
        val offsets = mutableMapOf<Int, Long>()
        try {
            val first = MediaExtractor().also { it.setDataSource(inputs[0]) }
            try {
                FileLog.line("file[0] tracks=${first.trackCount}")
                for (i in 0 until first.trackCount) {
                    val format = first.getTrackFormat(i)
                    val mime = format.getString(MediaFormat.KEY_MIME) ?: continue
                    if (!mime.startsWith("video/") && !mime.startsWith("audio/")) continue
                    val key = if (mime.startsWith("video/")) 0 else 1
                    if (!muxTracks.containsKey(key)) {
                        muxTracks[key] = muxer.addTrack(format)
                        offsets[key] = 0L
                        FileLog.line("addTrack[$key] $mime ${dumpTrack(format)}")
                    }
                }
            } finally {
                first.release()
            }
            require(muxTracks.isNotEmpty()) { "no a/v tracks in first file" }
            muxer.start()
            FileLog.line("muxer started")
            for ((fileIdx, path) in inputs.withIndex()) {
                val ext = MediaExtractor().also { it.setDataSource(path) }
                try {
                    for (i in 0 until ext.trackCount) {
                        val format = ext.getTrackFormat(i)
                        val mime = format.getString(MediaFormat.KEY_MIME) ?: continue
                        if (!mime.startsWith("video/") && !mime.startsWith("audio/")) continue
                        val key = if (mime.startsWith("video/")) 0 else 1
                        val muxTrack = muxTracks[key] ?: continue
                        val off = offsets[key] ?: 0L
                        val (maxPts, n) = copyTrack(ext, i, muxer, muxTrack, off, "file[$fileIdx] $mime")
                        if (n > 0) offsets[key] = maxPts + frameGapUs(format)
                    }
                } finally {
                    ext.release()
                }
            }
            muxer.stop()
        } finally {
            try {
                muxer.release()
            } catch (_: Exception) {
            }
        }
        FileLog.line("remuxed ${inputs.size} ts -> $outPath (${java.io.File(outPath).length()} bytes)")
        verifyOutput(outPath)
    }

    private fun frameGapUs(format: MediaFormat): Long {
        val mime = format.getString(MediaFormat.KEY_MIME) ?: return 40000L
        if (mime.startsWith("audio/")) {
            val rate = try {
                format.getInteger(MediaFormat.KEY_SAMPLE_RATE)
            } catch (_: Exception) {
                44100
            }
            return 1_000_000L * 1024 / rate
        }
        return 40000L
    }
}
