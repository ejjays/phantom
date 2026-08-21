package expo.modules.encodeh264aac

import android.media.MediaCodec
import android.media.MediaCodecInfo
import android.media.MediaExtractor
import android.media.MediaFormat
import android.media.MediaMuxer
import android.view.Surface
import expo.modules.kotlin.modules.Module
import expo.modules.kotlin.modules.ModuleDefinition
import java.nio.ByteBuffer

private const val TIMEOUT_US = 10_000L
private const val MAX_IDLE_POLLS = 20_000

class EncodeModule : Module() {
  override fun definition() = ModuleDefinition {
    Name("EncodeH264Aac")

    AsyncFunction("encode") { src: String, out: String ->
      EncoderPipeline(src, out).run()
    }
  }
}

private class PendingSample(val bytes: ByteArray, val ptsUs: Long, val keyFrame: Boolean)

private class TrackMux {
  var format: MediaFormat? = null
  var muxerTrack = -1
  val pending = ArrayList<PendingSample>()
  var outputEos = false
}

/**
 * Last-resort container fix: decode any input, re-encode h264+aac, mux mp4.
 * No decisions here — callers own error policy; failure is just `false`.
 */
private class EncoderPipeline(private val src: String, private val out: String) {
  private val vTrack = TrackMux()
  private val aTrack = TrackMux().apply { outputEos = true }
  private var aTrackPresent = false

  private var vDecoder: MediaCodec? = null
  private var vEncoder: MediaCodec? = null
  private var vSurface: Surface? = null
  private var aDecoder: MediaCodec? = null
  private var aEncoder: MediaCodec? = null

  private var vInputDone = false
  private var vEosSignaled = false
  private var aDecoderEos = false
  private var aEosQueued = false

  // decoded pcm waiting for encoder input buffers
  private val pcmQueue = ArrayList<PendingSample>()

  private lateinit var muxer: MediaMuxer
  private var muxerStarted = false
  private var direct: ByteBuffer = ByteBuffer.allocateDirect(1 shl 16)

  fun run(): Boolean {
    val videoEx = MediaExtractor()
    val audioEx = MediaExtractor()
    try {
      videoEx.setDataSource(src)
    } catch (t: Throwable) {
      videoEx.release()
      audioEx.release()
      return false
    }

    var videoIn = -1
    var audioIn = -1
    var vInFormat: MediaFormat? = null
    for (i in 0 until videoEx.trackCount) {
      val f = videoEx.getTrackFormat(i)
      when {
        videoIn < 0 && f.getString(MediaFormat.KEY_MIME)?.startsWith("video/") == true -> {
          videoIn = i
          vInFormat = f
        }
        audioIn < 0 && f.getString(MediaFormat.KEY_MIME)?.startsWith("audio/") == true ->
          audioIn = i
      }
    }
    if (videoIn < 0 && audioIn < 0) {
      videoEx.release()
      audioEx.release()
      return false
    }

    var success = false
    try {
      muxer = MediaMuxer(out, MediaMuxer.OutputFormat.MUXER_OUTPUT_MPEG_4)

      if (vInFormat != null) {
        videoEx.selectTrack(videoIn)
        setupVideo(vInFormat)
      }
      if (audioIn >= 0) {
        audioEx.setDataSource(src)
        audioEx.selectTrack(audioIn)
        val aInFormat = audioEx.getTrackFormat(audioIn)
        aDecoder = MediaCodec.createDecoderByType(aInFormat.getString(MediaFormat.KEY_MIME)!!).also {
          it.configure(aInFormat, null, null, 0)
          it.start()
        }
        aTrackPresent = true
        aTrack.outputEos = false
      }

      loop(videoEx)

      if (muxerStarted) {
        muxer.stop()
        success = true
      }
    } catch (t: Throwable) {
      success = false
    } finally {
      releaseCodecs()
      videoEx.release()
      audioEx.release()
      try {
        muxer.release()
      } catch (t: Throwable) {
        success = false
      }
    }
    return success
  }

  private fun setupVideo(inFormat: MediaFormat) {
    val width = inFormat.getInteger(MediaFormat.KEY_WIDTH)
    val height = inFormat.getInteger(MediaFormat.KEY_HEIGHT)
    val fps = if (inFormat.containsKey(MediaFormat.KEY_FRAME_RATE)) {
      inFormat.getInteger(MediaFormat.KEY_FRAME_RATE).coerceIn(1, 120)
    } else {
      30
    }
    val bitRate = (width.toLong() * height * fps / 10).toInt().coerceIn(800_000, 16_000_000)

    val encoder = MediaCodec.createEncoderByType(MediaFormat.MIMETYPE_VIDEO_AVC)
    val encFormat = MediaFormat.createVideoFormat(MediaFormat.MIMETYPE_VIDEO_AVC, width, height).apply {
      setInteger(MediaFormat.KEY_COLOR_FORMAT, MediaCodecInfo.CodecCapabilities.COLOR_FormatSurface)
      setInteger(MediaFormat.KEY_BIT_RATE, bitRate)
      setInteger(MediaFormat.KEY_FRAME_RATE, fps)
      setInteger(MediaFormat.KEY_I_FRAME_INTERVAL, 2)
    }
    encoder.configure(encFormat, null, null, MediaCodec.CONFIGURE_FLAG_ENCODE)
    val surface = encoder.createInputSurface()
    encoder.start()

    val decoder = MediaCodec.createDecoderByType(inFormat.getString(MediaFormat.KEY_MIME)!!)
    decoder.configure(inFormat, surface, null, 0)
    decoder.start()

    vEncoder = encoder
    vSurface = surface
    vDecoder = decoder
  }

  private fun loop(videoEx: MediaExtractor) {
    var idle = 0
    while (!(vTrack.outputEos && aTrack.outputEos)) {
      var acted = false

      if (vDecoder != null && !vTrack.outputEos) {
        if (!vInputDone) {
          vInputDone = feedDecoder(videoEx, vDecoder!!)
          acted = true
        }
        acted = drainVideoDecoder() || acted
      }
      if (aDecoder != null && !aDecoderEos) {
        acted = drainAudioDecoder() || acted
      }
      if (aEncoder != null && (pcmQueue.isNotEmpty() || (aDecoderEos && !aEosQueued))) {
        acted = feedAudioEncoder() || acted
      }
      if (vEncoder != null && !vTrack.outputEos) {
        acted = drainEncoder(vEncoder!!, vTrack) || acted
      }
      if (aEncoder != null && !aTrack.outputEos) {
        acted = drainEncoder(aEncoder!!, aTrack) || acted
      }
      maybeStartMuxer()

      idle = if (acted) 0 else idle + 1
      if (idle > MAX_IDLE_POLLS) throw IllegalStateException("encode stalled")
    }
  }

  private fun feedDecoder(ex: MediaExtractor, decoder: MediaCodec): Boolean {
    val idx = decoder.dequeueInputBuffer(TIMEOUT_US)
    if (idx < 0) return false
    val buf = decoder.getInputBuffer(idx) ?: throw IllegalStateException("no input buffer")
    val size = ex.readSampleData(buf, 0)
    if (size < 0) {
      decoder.queueInputBuffer(idx, 0, 0, 0, MediaCodec.BUFFER_FLAG_END_OF_STREAM)
      return true
    }
    decoder.queueInputBuffer(idx, 0, size, ex.sampleTime, 0)
    ex.advance()
    return false
  }

  private fun drainVideoDecoder(): Boolean {
    val decoder = vDecoder ?: return false
    val info = MediaCodec.BufferInfo()
    while (true) {
      val idx = decoder.dequeueOutputBuffer(info, TIMEOUT_US)
      when {
        idx >= 0 -> {
          decoder.releaseOutputBuffer(idx, true)
          if (info.flags and MediaCodec.BUFFER_FLAG_END_OF_STREAM != 0 && !vEosSignaled) {
            vEosSignaled = true
            vEncoder?.signalEndOfInputStream()
          }
        }
        else -> return false
      }
    }
  }

  private fun drainAudioDecoder(): Boolean {
    val decoder = aDecoder ?: return false
    val info = MediaCodec.BufferInfo()
    var acted = false
    while (true) {
      val idx = decoder.dequeueOutputBuffer(info, TIMEOUT_US)
      when {
        idx == MediaCodec.INFO_OUTPUT_FORMAT_CHANGED -> {
          createAudioEncoder(decoder.outputFormat)
          acted = true
        }
        idx >= 0 -> {
          acted = true
          val buf = decoder.getOutputBuffer(idx)
          if (buf != null && info.size > 0) {
            buf.position(info.offset)
            buf.limit(info.offset + info.size)
            val bytes = ByteArray(info.size)
            buf.get(bytes)
            pcmQueue.add(PendingSample(bytes, info.presentationTimeUs, false))
          }
          val eos = info.flags and MediaCodec.BUFFER_FLAG_END_OF_STREAM != 0
          decoder.releaseOutputBuffer(idx, false)
          if (eos) {
            aDecoderEos = true
            return acted
          }
        }
        else -> return acted
      }
    }
  }

  private fun createAudioEncoder(decoderOut: MediaFormat) {
    val sampleRate = decoderOut.getInteger(MediaFormat.KEY_SAMPLE_RATE)
    val channels = decoderOut.getInteger(MediaFormat.KEY_CHANNEL_COUNT)
    val format = MediaFormat.createAudioFormat(MediaFormat.MIMETYPE_AUDIO_AAC, sampleRate, channels).apply {
      setInteger(MediaFormat.KEY_AAC_PROFILE, MediaCodecInfo.CodecProfileLevel.AACObjectLC)
      setInteger(MediaFormat.KEY_BIT_RATE, if (channels >= 2) 128_000 else 64_000)
      setInteger(MediaFormat.KEY_MAX_INPUT_SIZE, 65_536)
    }
    aEncoder = MediaCodec.createEncoderByType(MediaFormat.MIMETYPE_AUDIO_AAC).also {
      it.configure(format, null, null, MediaCodec.CONFIGURE_FLAG_ENCODE)
      it.start()
    }
  }

  // decoder pcm chunks can exceed encoder input buffers — split across inputs,
  // carrying pts forward by consumed frames
  private fun feedAudioEncoder(): Boolean {
    val encoder = aEncoder ?: return false
    var acted = false
    while (pcmQueue.isNotEmpty()) {
      val idx = encoder.dequeueInputBuffer(TIMEOUT_US)
      if (idx < 0) return acted
      acted = true
      val buf = encoder.getInputBuffer(idx) ?: throw IllegalStateException("no input buffer")
      val capacity = buf.capacity()
      val head = pcmQueue[0]
      val chunk = minOf(capacity, head.bytes.size)
      buf.clear()
      buf.put(head.bytes, 0, chunk)
      encoder.queueInputBuffer(idx, 0, chunk, head.ptsUs, 0)

      val rest = head.bytes.size - chunk
      if (rest <= 0) {
        pcmQueue.removeAt(0)
      } else {
        val bytesPerFrame = 2 * channelsOf(encoder)
        val rate = (bytesPerFrame * sampleRateOf(encoder)).coerceAtLeast(1)
        val chunkDurUs = chunk * 1_000_000L / rate
        pcmQueue[0] = PendingSample(head.bytes.copyOfRange(chunk, head.bytes.size), head.ptsUs + chunkDurUs, false)
      }
    }
    if (aDecoderEos && !aEosQueued) {
      val idx = encoder.dequeueInputBuffer(TIMEOUT_US)
      if (idx < 0) return acted
      acted = true
      encoder.queueInputBuffer(idx, 0, 0, 0, MediaCodec.BUFFER_FLAG_END_OF_STREAM)
      aEosQueued = true
    }
    return acted
  }

  private fun channelsOf(encoder: MediaCodec): Int =
    encoder.outputFormat.getInteger(MediaFormat.KEY_CHANNEL_COUNT)

  private fun sampleRateOf(encoder: MediaCodec): Int =
    encoder.outputFormat.getInteger(MediaFormat.KEY_SAMPLE_RATE)

  private fun drainEncoder(encoder: MediaCodec, track: TrackMux): Boolean {
    val info = MediaCodec.BufferInfo()
    var acted = false
    while (true) {
      val idx = encoder.dequeueOutputBuffer(info, TIMEOUT_US)
      when {
        idx == MediaCodec.INFO_OUTPUT_FORMAT_CHANGED -> {
          track.format = encoder.outputFormat
          acted = true
        }
        idx >= 0 -> {
          acted = true
          val buf = encoder.getOutputBuffer(idx)
          val isConfig = info.flags and MediaCodec.BUFFER_FLAG_CODEC_CONFIG != 0
          if (buf != null && info.size > 0 && !isConfig) {
            buf.position(info.offset)
            buf.limit(info.offset + info.size)
            if (muxerStarted && track.muxerTrack >= 0) {
              muxer.writeSampleData(track.muxerTrack, buf, info)
            } else {
              val bytes = ByteArray(info.size)
              buf.get(bytes)
              track.pending.add(
                PendingSample(bytes, info.presentationTimeUs, info.flags and MediaCodec.BUFFER_FLAG_KEY_FRAME != 0)
              )
            }
          }
          encoder.releaseOutputBuffer(idx, false)
          if (info.flags and MediaCodec.BUFFER_FLAG_END_OF_STREAM != 0) {
            track.outputEos = true
            return acted
          }
        }
        else -> return acted
      }
    }
  }

  private fun maybeStartMuxer() {
    if (muxerStarted) return
    val vReady = vEncoder == null || vTrack.format != null
    val aReady = !aTrackPresent || aEncoder == null || aTrack.format != null
    if (!(vReady && aReady)) return

    if (vTrack.format != null && vTrack.format!!.containsKey(MediaFormat.KEY_ROTATION)) {
      muxer.setOrientationHint(vTrack.format!!.getInteger(MediaFormat.KEY_ROTATION))
    }
    vTrack.format?.let { vTrack.muxerTrack = muxer.addTrack(it) }
    aTrack.format?.let { aTrack.muxerTrack = muxer.addTrack(it) }
    if (vTrack.muxerTrack < 0 && aTrack.muxerTrack < 0) throw IllegalStateException("no encodable tracks")
    muxer.start()
    muxerStarted = true
    flushPending(vTrack)
    flushPending(aTrack)
  }

  private fun flushPending(track: TrackMux) {
    for (sample in track.pending) {
      if (direct.capacity() < sample.bytes.size) {
        direct = ByteBuffer.allocateDirect(sample.bytes.size * 2)
      }
      direct.clear()
      direct.put(sample.bytes)
      direct.flip()
      val flags = if (sample.keyFrame) MediaCodec.BUFFER_FLAG_KEY_FRAME else 0
      val info = MediaCodec.BufferInfo()
      info.set(0, sample.bytes.size, sample.ptsUs, flags)
      muxer.writeSampleData(track.muxerTrack, direct, info)
    }
    track.pending.clear()
  }

  private fun releaseCodecs() {
    listOfNotNull(vDecoder, vEncoder, aDecoder, aEncoder).forEach { codec ->
      try {
        codec.stop()
      } catch (t: Throwable) {
        /* never started */
      }
      try {
        codec.release()
      } catch (t: Throwable) {
        /* already released */
      }
    }
    vSurface?.release()
    vDecoder = null
    vEncoder = null
    vSurface = null
    aDecoder = null
    aEncoder = null
  }
}
