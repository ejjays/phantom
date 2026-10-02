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

    AsyncFunction("concatFiles") { inputs: List<String>, outPath: String ->
      concatFiles(inputs, outPath)
    }

    AsyncFunction("remuxWebm") { videoPath: String?, audioPath: String?, outPath: String ->
      remuxWebm(videoPath, audioPath, outPath)
    }

    AsyncFunction("cloneFragmentedMp4") { inPath: String, outPath: String ->
      cloneFragmentedMp4(inPath, outPath)
    }
  }

  private fun concatFiles(inputs: List<String>, outPath: String): Map<String, Any> {
    val out = java.io.File(outPath)
    if (out.exists()) out.delete()
    var bytes = 0L
    java.io.FileOutputStream(out).use { writer ->
      val buf = ByteArray(64 * 1024)
      for (path in inputs) {
        java.io.FileInputStream(path).use { reader ->
          while (true) {
            val n = reader.read(buf)
            if (n < 0) break
            writer.write(buf, 0, n)
            bytes += n
          }
        }
      }
    }
    return mapOf("bytes" to bytes)
  }

  private fun remuxWebm(
    videoPath: String?,
    audioPath: String?,
    outPath: String
  ): Map<String, Any> {
    if (videoPath == null && audioPath == null) {
      throw CodedException("ERR_NO_INPUTS", "need a video and/or audio path", null)
    }
    WebmRemux.remuxWebm(videoPath, audioPath, outPath)
    return mapOf("bytes" to java.io.File(outPath).length())
  }

  private fun cloneFragmentedMp4(inPath: String, outPath: String): Map<String, Any> {
    CloneRemux.remuxFragmented(inPath, outPath)
    return mapOf("bytes" to java.io.File(outPath).length())
  }

  private fun muxableVideo(mime: String): Boolean =
    mime == "video/avc" || mime == "video/hevc"

  private fun muxableAudio(mime: String): Boolean = mime == "audio/mp4a-latm"

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
    val maxSize = try {
      ext.getTrackFormat(track).getInteger(MediaFormat.KEY_MAX_INPUT_SIZE)
    } catch (_: Exception) {
      BUF_SIZE
    }
    val buf = ByteBuffer.allocate(maxOf(maxSize, BUF_SIZE))
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
      val vMime = vFormat.getString(MediaFormat.KEY_MIME) ?: "?"
      val aMime = aFormat.getString(MediaFormat.KEY_MIME) ?: "?"
      if (!muxableVideo(vMime) || !muxableAudio(aMime)) {
        throw CodedException(
          "ERR_UNSUPPORTED_CODEC",
          "mp4 muxer needs avc/hevc+aac, got $vMime+$aMime",
          null,
        )
      }
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
            val isVideo = mime.startsWith("video/")
            val isAudio = mime.startsWith("audio/")
            if (!isVideo && !isAudio) continue
            if (isVideo && !muxableVideo(mime) || isAudio && !muxableAudio(mime)) {
              throw CodedException(
                "ERR_UNSUPPORTED_CODEC",
                "mp4 muxer cannot hold $mime",
                null,
              )
            }
            val key = if (isVideo) 0 else 1
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
            val isVideo = mime.startsWith("video/")
            val isAudio = mime.startsWith("audio/")
            if (!isVideo && !isAudio) continue
            if (isVideo && !muxableVideo(mime) || isAudio && !muxableAudio(mime)) {
              throw CodedException(
                "ERR_UNSUPPORTED_CODEC",
                "mp4 muxer cannot hold $mime",
                null,
              )
            }
            val key = if (isVideo) 0 else 1
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
