package expo.modules.mediamux
import android.util.Log

import java.nio.ByteBuffer
import java.nio.ByteOrder

private data class FlatSample(val bytes: ByteArray, val durationUs: Long, val sync: Boolean)

private data class FlatTrack(
    val isVideo: Boolean,
    val isOpus: Boolean,
    val timescale: Long,
    val stsd: ByteArray,
    val width: Int,
    val height: Int,
    val samples: List<FlatSample>,
)

private fun buildTkhd(trackId: Int, duration: Long, width: Int, height: Int, isAudio: Boolean): ByteArray {
    val w = Writer()
    w.fullBox("tkhd", 0, 0x7) {
        u32(0)
        u32(0)
        u32(trackId.toLong())
        u32(0)
        u32(duration)
        u32(0)
        u32(0)
        u16(0)
        u16(0)
        u16(if (isAudio) 0x0100 else 0)
        u16(0)
        u32(0x00010000)
        u32(0)
        u32(0)
        u32(0)
        u32(0x00010000)
        u32(0)
        u32(0)
        u32(0)
        u32(0x40000000)
        u32(width.toLong() shl 16)
        u32(height.toLong() shl 16)
    }
    return w.toByteArray()
}

private fun buildHdlr(handler: String, name: String): ByteArray {
    val w = Writer()
    w.fullBox("hdlr", 0, 0) {
        u32(0)
        fourcc(handler)
        u32(0)
        u32(0)
        u32(0)
        bytes(name.toByteArray(Charsets.US_ASCII))
        u8(0)
    }
    return w.toByteArray()
}

private fun buildMinf(isVideo: Boolean, dinfDref: ByteArray, stbl: ByteArray): ByteArray {
    val w = Writer()
    w.box("minf") {
        if (isVideo) {
            val v = Writer()
            v.fullBox("vmhd", 0, 1) {
                u16(0)
                u16(0)
                u16(0)
                u16(0)
            }
            bytes(v.toByteArray())
        } else {
            val s = Writer()
            s.fullBox("smhd", 0, 0) {
                u16(0)
                u16(0)
            }
            bytes(s.toByteArray())
        }
        bytes(dinfDref)
        bytes(stbl)
    }
    return w.toByteArray()
}

private fun buildDinf(): ByteArray {
    val w = Writer()
    w.box("dinf") {
        val d = Writer()
        d.fullBox("dref", 0, 0) {
            u32(1)
            val u = Writer()
            u.fullBox("url ", 0, 1) {}
            bytes(u.toByteArray())
        }
        bytes(d.toByteArray())
    }
    return w.toByteArray()
}

private fun buildMdhd(timescale: Long, duration: Long): ByteArray {
    val w = Writer()
    w.fullBox("mdhd", 0, 0) {
        u32(0)
        u32(0)
        u32(timescale)
        u32(duration)
        u16(0x55C4)
        u16(0)
    }
    return w.toByteArray()
}

private fun buildSgpdRoll(): ByteArray {
    val w = Writer()
    w.fullBox("sgpd", 1, 0) {
        fourcc("roll")
        u32(2)
        u32(1)
        u16(0xFFFC)
    }
    return w.toByteArray()
}

private fun buildSbgpRoll(sampleCount: Int): ByteArray {
    val w = Writer()
    w.fullBox("sbgp", 0, 0) {
        fourcc("roll")
        u32(1)
        u32(sampleCount.toLong())
        u32(1)
    }
    return w.toByteArray()
}

private fun buildMvhd(scale: Long, duration: Long, nextId: Int): ByteArray {
    val w = Writer()
    w.fullBox("mvhd", 0, 0) {
        u32(0)
        u32(0)
        u32(scale)
        u32(duration)
        u32(0x00010000)
        u16(0x0100)
        u16(0)
        u32(0)
        u32(0)
        u32(0)
        u32(0x00010000)
        u32(0)
        u32(0)
        u32(0)
        u32(0x00010000)
        u32(0)
        u32(0)
        u32(0)
        u32(0x40000000)
        u32(0)
        u32(0)
        u32(0)
        u32(0)
        u32(0)
        u32(0)
        u32(nextId.toLong())
    }
    return w.toByteArray()
}

private fun buildFtyp(): ByteArray {
    val w = Writer()
    w.box("ftyp") {
        fourcc("isom")
        u32(512)
        fourcc("isom")
        fourcc("iso2")
        fourcc("mp41")
    }
    return w.toByteArray()
}

object WebmRemux {
    fun remuxWebm(videoPath: String?, audioPath: String?, outPath: String) {
        val tracks = mutableListOf<FlatTrack>()
        if (videoPath != null) tracks.add(readVideoTrack(videoPath))
        if (audioPath != null) tracks.add(readAudioTrack(audioPath))
        require(tracks.isNotEmpty()) { "no usable tracks" }

        val mvhdScale = 1000L
        var movieDurMs = 0L
        for (t in tracks) {
            movieDurMs = maxOf(movieDurMs, t.samples.sumOf { it.durationUs } / 1000)
        }

        fun buildMoov(chunkOffsets: List<Long>): ByteArray {
            val moovW = Writer()
            moovW.box("moov") {
                bytes(buildMvhd(mvhdScale, movieDurMs, tracks.size + 1))
                for ((ti, t) in tracks.withIndex()) {
                    val trackDur = t.samples.sumOf { it.durationUs } * t.timescale / 1_000_000L
                    box("trak") {
                        bytes(buildTkhd(ti + 1, trackDur * mvhdScale / t.timescale, t.width, t.height, !t.isVideo))
                        box("mdia") {
                            bytes(buildMdhd(t.timescale, trackDur))
                            bytes(buildHdlr(if (t.isVideo) "vide" else "soun", if (t.isVideo) "VideoHandler" else "SoundHandler"))
                            bytes(
                                buildMinf(
                                    t.isVideo, buildDinf(),
                                    run {
                                        val stblW = Writer()
                                        stblW.box("stbl") {
                                            bytes(t.stsd)
                                            bytes(buildStts(t.samples.map { it.durationUs * t.timescale / 1_000_000L }))
                                            bytes(buildStsc(t.samples.size))
                                            bytes(buildStsz(t.samples.map { it.bytes.size }))
                                            if (t.isVideo) {
                                                val syncs = t.samples.mapIndexedNotNull { idx, s ->
                                                    if (s.sync) idx + 1 else null
                                                }
                                                val stss = buildStss(syncs)
                                                if (stss != null) bytes(stss)
                                            }
                                            bytes(buildStco(listOf(chunkOffsets[ti])))
                                    if (!t.isVideo && t.isOpus) {
                                        bytes(buildSgpdRoll())
                                        bytes(buildSbgpRoll(t.samples.size))
                                    }
                                        }
                                        stblW.toByteArray()
                                    },
                                ),
                            )
                        }
                    }
                }
            }
            return moovW.toByteArray()
        }

        val ftypBytes = buildFtyp()
        val outHead = Writer()
        outHead.bytes(ftypBytes)
        val pass1 = buildMoov(tracks.map { 0L })
        var cursor = 0L + pass1.size + 8 + ftypBytes.size
        val chunkOffsets = tracks.map { t ->
            val at = cursor
            cursor += t.samples.sumOf { it.bytes.size.toLong() }
            at
        }
        val moovBytes = buildMoov(chunkOffsets)
        require(moovBytes.size == pass1.size) { "moov size moved" }
        var mdatBytes = 0L
        java.io.FileOutputStream(outPath).use { fos ->
            fos.write(ftypBytes)
            mdatBytes += ftypBytes.size
            fos.write(moovBytes)
            mdatBytes += moovBytes.size
            val mdatSizePos = mdatBytes
            fos.write(ByteArray(8))
            mdatBytes += 8
            for (t in tracks) {
                for (s in t.samples) {
                    fos.write(s.bytes)
                    mdatBytes += s.bytes.size
                }
            }
            fos.flush()
            java.io.RandomAccessFile(outPath, "rw").use { fix ->
                fix.seek(mdatSizePos)
                val bb = ByteBuffer.allocate(8).order(ByteOrder.BIG_ENDIAN)
                bb.putInt((mdatBytes - mdatSizePos).toInt())
                bb.put("mdat".toByteArray(Charsets.US_ASCII))
                fix.write(bb.array())
            }
        }
        Log.d("MediaMux", "webm: moov=${moovBytes.size} mdat=${mdatBytes - ftypBytes.size - moovBytes.size}")
        Log.d("MediaMux", "webm -> $outPath (${java.io.File(outPath).length()} bytes)")
    }

    private fun reorderCheck(samples: List<WebmSample>): Boolean {
        var last = Long.MIN_VALUE
        for (s in samples) {
            if (s.ptsNs < last) return false
            last = s.ptsNs
        }
        return true
    }

    private fun readVideoTrack(path: String): FlatTrack {
        val (scaleNs, tracks, samples) = WebmDemux.demux(path)
        val vt = tracks.firstOrNull { it.kind == 1 && it.codecId.startsWith("V_VP") }
            ?: error("no vp video track")
        val fileOrder = samples.filter { it.trackNumber == vt.number }
        require(fileOrder.isNotEmpty()) { "no video samples" }
        if (!reorderCheck(fileOrder)) error("needs decode reorder")
        val mine = fileOrder.sortedBy { it.ptsNs }
        var key = mine.firstOrNull { it.sync }?.bytes
        var header = key?.let { parseVp9Keyframe(it) }
        var tried = 1
        for (s in mine) {
            if (header != null || tried >= 20) break
            if (!s.sync) continue
            tried += 1
            header = parseVp9Keyframe(s.bytes)
        }
        val good = header ?: error("bad vp9 header")
        Log.d("MediaMux", "webm: keyframe parsed after $tried tries")
        val fps = if (vt.defaultDurationNs > 0) 1e9 / vt.defaultDurationNs else 30.0
        val stsdEntry = buildVp09Entry(good.width, good.height, buildVpcc(good, fps))
        val stsdW = Writer()
        stsdW.fullBox("stsd", 0, 0) {
            u32(1)
            bytes(stsdEntry)
        }
        val flat = mine.map {
            FlatSample(
                it.bytes,
                0L,
                it.sync,
            )
        }
        val durations = mine.mapIndexed { idx, s ->
            if (idx + 1 < mine.size) (mine[idx + 1].ptsNs - s.ptsNs) * 1000L / scaleNs
            else if (vt.defaultDurationNs > 0) vt.defaultDurationNs * 1000L / scaleNs
            else (1e6 / fps).toLong()
        }
        Log.d("MediaMux", "webm video ${vt.codecId} ${good.width}x${good.height} " + "profile=${good.profile} frames=${flat.size} fps=${"%.1f".format(fps)}")
        return FlatTrack(
            true, false, 1000000L, stsdW.toByteArray(), good.width, good.height,
            flat.mapIndexed { idx, s -> s.copy(durationUs = durations[idx]) },
        )
    }

    private fun readAudioTrack(path: String): FlatTrack {
        val (scaleNs, tracks, samples) = WebmDemux.demux(path)
        val at = tracks.firstOrNull { it.kind == 2 && it.codecId.startsWith("A_OPUS") }
            ?: error("no opus audio track")
        val fileOrder = samples.filter { it.trackNumber == at.number }
        require(fileOrder.isNotEmpty()) { "no audio samples" }
        if (!reorderCheck(fileOrder)) error("needs decode reorder")
        val mine = fileOrder.sortedBy { it.ptsNs }
        val rate = if (at.sampleRate > 0) at.sampleRate.toInt() else 48000
        val ch = if (at.channels > 0) at.channels else 2
        require(at.privateData.size >= 19) { "short OpusHead" }
        val durations = mine.mapIndexed { idx, s ->
            if (idx + 1 < mine.size) (mine[idx + 1].ptsNs - s.ptsNs) * 1000L / scaleNs
            else if (at.defaultDurationNs > 0) at.defaultDurationNs * 1000L / scaleNs
            else 20_000L
        }
        val totalBytes = mine.sumOf { it.bytes.size.toLong() }
        val totalUs = durations.sum()
        val avgBitrate = if (totalUs > 0) (totalBytes * 8_000_000L / totalUs).toInt() else 0
        val stsdEntry = buildOpusEntry(ch, rate, at.privateData, avgBitrate)
        val stsdW = Writer()
        stsdW.fullBox("stsd", 0, 0) {
            u32(1)
            bytes(stsdEntry)
        }
        val flat = mine.map {
            FlatSample(it.bytes, 0L, true)
        }
        Log.d("MediaMux", "webm audio opus ${rate}Hz ch$ch packets=${flat.size} avgBps=$avgBitrate")
        val dbg = mine.take(5).map { it.ptsNs }
        Log.d("MediaMux", "webm audio pts0=${dbg} defDur=${at.defaultDurationNs}")
        return FlatTrack(
            false, true, rate.toLong(), stsdW.toByteArray(), 0, 0,
            flat.mapIndexed { idx, s -> s.copy(durationUs = durations[idx]) },
        )
    }
}
