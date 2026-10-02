package expo.modules.mediamux

import android.media.MediaCodec
import android.media.MediaExtractor
import android.media.MediaFormat
import android.media.MediaMuxer
import expo.modules.kotlin.exception.CodedException
import expo.modules.kotlin.modules.Module
import expo.modules.kotlin.modules.ModuleDefinition
import java.nio.ByteBuffer

private const val BUF_SIZE = 256 * 1024

class MediaMuxModule : Module() {
  override fun definition() = ModuleDefinition {
    Name("MediaMux")

    AsyncFunction("muxAv") { videoPath: String, audioPath: String, outPath: String ->
      muxAv(videoPath, audioPath, outPath)
    }

    AsyncFunction("remuxParts") { inputs: List<String>, outPath: String ->
      remuxParts(inputs, outPath)
    }
  }

  private fun pickTrack(ext: MediaExtractor, prefix: String): Pair<Int, MediaFormat>? {
    for (i in 0 until ext.trackCount) {
      val format = ext.getTrackFormat(i)
      val mime = format.getString(MediaFormat.KEY_MIME) ?: continue
      if (mime.startsWith(prefix)) return i to format
    }
    return null
  }

  private fun copyTrack(
    ext: MediaExtractor,
    track: Int,
    muxer: MediaMuxer,
    muxTrack: Int,
    offsetUs: Long,
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
      info.presentationTimeUs = ext.sampleTime + offsetUs
      info.flags = ext.sampleFlags
      maxPts = maxOf(maxPts, info.presentationTimeUs)
      buf.position(0)
      muxer.writeSampleData(muxTrack, buf, info)
      samples += 1
      ext.advance()
    }
    return maxPts to samples
  }

  private fun frameGapUs(format: MediaFormat): Long {
    val mime = format.getString(MediaFormat.KEY_MIME) ?: return 40000L
    if (!mime.startsWith("audio/")) return 40000L
    val rate = try {
      format.getInteger(MediaFormat.KEY_SAMPLE_RATE)
    } catch (_: Exception) {
      44100
    }
    return 1_000_000L * 1024 / rate
  }

  private fun result(outPath: String, videoSamples: Int, audioSamples: Int): Map<String, Any> =
    mapOf(
      "bytes" to java.io.File(outPath).length(),
      "videoSamples" to videoSamples,
      "audioSamples" to audioSamples,
    )

  private fun muxAv(videoPath: String, audioPath: String, outPath: String): Map<String, Any> {
    val vExt = MediaExtractor().also { it.setDataSource(videoPath) }
    val aExt = MediaExtractor().also { it.setDataSource(audioPath) }
    try {
      val (vTrack, vFormat) = pickTrack(vExt, "video/")
        ?: throw CodedException("ERR_NO_VIDEO_TRACK", "no video track", null)
      val (aTrack, aFormat) = pickTrack(aExt, "audio/")
        ?: throw CodedException("ERR_NO_AUDIO_TRACK", "no audio track", null)
      val muxer = MediaMuxer(outPath, MediaMuxer.OutputFormat.MUXER_OUTPUT_MPEG_4)
      try {
        val mv = muxer.addTrack(vFormat)
        val ma = muxer.addTrack(aFormat)
        muxer.start()
        val (_, vn) = copyTrack(vExt, vTrack, muxer, mv, 0L)
        val (_, an) = copyTrack(aExt, aTrack, muxer, ma, 0L)
        muxer.stop()
        return result(outPath, vn, an)
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
  }

  private fun remuxParts(inputs: List<String>, outPath: String): Map<String, Any> {
    require(inputs.isNotEmpty()) { "no inputs" }
    val muxer = MediaMuxer(outPath, MediaMuxer.OutputFormat.MUXER_OUTPUT_MPEG_4)
    val muxTracks = mutableMapOf<Int, Int>()
    val offsets = mutableMapOf<Int, Long>()
    var videoSamples = 0
    var audioSamples = 0
    try {
      MediaExtractor().also { it.setDataSource(inputs[0]) }.let { first ->
        try {
          for (i in 0 until first.trackCount) {
            val format = first.getTrackFormat(i)
            val mime = format.getString(MediaFormat.KEY_MIME) ?: continue
            if (!mime.startsWith("video/") && !mime.startsWith("audio/")) continue
            val key = if (mime.startsWith("video/")) 0 else 1
            if (!muxTracks.containsKey(key)) {
              muxTracks[key] = muxer.addTrack(format)
              offsets[key] = 0L
            }
          }
        } finally {
          first.release()
        }
      }
      if (muxTracks.isEmpty()) throw CodedException("ERR_NO_TRACKS", "no a/v tracks", null)
      muxer.start()
      for (path in inputs) {
        val ext = MediaExtractor().also { it.setDataSource(path) }
        try {
          for (i in 0 until ext.trackCount) {
            val format = ext.getTrackFormat(i)
            val mime = format.getString(MediaFormat.KEY_MIME) ?: continue
            if (!mime.startsWith("video/") && !mime.startsWith("audio/")) continue
            val key = if (mime.startsWith("video/")) 0 else 1
            val muxTrack = muxTracks[key] ?: continue
            val (maxPts, n) = copyTrack(ext, i, muxer, muxTrack, offsets[key] ?: 0L)
            if (n > 0) {
              offsets[key] = maxPts + frameGapUs(format)
              if (key == 0) videoSamples += n else audioSamples += n
            }
          }
        } finally {
          ext.release()
        }
      }
      muxer.stop()
      return result(outPath, videoSamples, audioSamples)
    } finally {
      try {
        muxer.release()
      } catch (_: Exception) {
      }
    }
  }
}
