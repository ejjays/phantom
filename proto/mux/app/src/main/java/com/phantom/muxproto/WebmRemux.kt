package com.phantom.muxproto

private data class FlatSample(val bytes: ByteArray, val durationUs: Long, val sync: Boolean)

private data class FlatTrack(
    val isVideo: Boolean,
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

private fun buildMvhd(scale: Long, duration: Long): ByteArray {
    val w = Writer()
    w.fullBox("mvhd", 0, 0) {
        u32(0)
        u32(0)
        u32(scale)
        u32(duration)
        u32(0x00010000)
        u16(0)
        u16(0)
        u32(0)
        u32(0)
        u32(0)
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
        u32(2)
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
                bytes(buildMvhd(mvhdScale, movieDurMs))
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

        val out = Writer()
        out.bytes(buildFtyp())
        val pass1 = buildMoov(tracks.map { 0L })
        var cursor = 0L + pass1.size + 8 + buildFtyp().size
        val chunkOffsets = tracks.map { t ->
            val at = cursor
            cursor += t.samples.sumOf { it.bytes.size.toLong() }
            at
        }
        val moovBytes = buildMoov(chunkOffsets)
        require(moovBytes.size == pass1.size) { "moov size moved" }
        out.bytes(moovBytes)
        val mdatW = Writer()
        for (t in tracks) {
            for (s in t.samples) mdatW.bytes(s.bytes)
        }
        val mdatPayload = mdatW.toByteArray()
        out.u32(mdatPayload.size + 8L)
        out.fourcc("mdat")
        out.bytes(mdatPayload)
        FileLog.line("webm: moov=${moovBytes.size} mdat=${mdatPayload.size}")
        java.io.File(outPath).writeBytes(out.toByteArray())
        FileLog.line("webm -> $outPath (${java.io.File(outPath).length()} bytes)")
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
        var key = mine.firstOrNull { it.sync }?.bytes ?: error("no keyframe")
        val header = parseVp9Keyframe(key) ?: error("bad vp9 header")
        val fps = if (vt.defaultDurationNs > 0) 1e9 / vt.defaultDurationNs else 30.0
        val stsdEntry = buildVp09Entry(header.width, header.height, buildVpcc(header, fps))
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
        FileLog.line(
            "webm video ${vt.codecId} ${header.width}x${header.height} " +
                "profile=${header.profile} frames=${flat.size} fps=${"%.1f".format(fps)}",
        )
        return FlatTrack(
            true, 1000000L, stsdW.toByteArray(), header.width, header.height,
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
        val stsdEntry = buildOpusEntry(ch, rate, at.privateData)
        val stsdW = Writer()
        stsdW.fullBox("stsd", 0, 0) {
            u32(1)
            bytes(stsdEntry)
        }
        val durations = mine.mapIndexed { idx, s ->
            if (idx + 1 < mine.size) (mine[idx + 1].ptsNs - s.ptsNs) * rate / 1_000_000_000L
            else if (at.defaultDurationNs > 0) at.defaultDurationNs * rate / 1_000_000_000L
            else (rate / 50).toLong()
        }
        val flat = mine.map {
            FlatSample(it.bytes, 0L, true)
        }
        FileLog.line("webm audio opus ${rate}Hz ch$ch packets=${flat.size}")
        return FlatTrack(
            false, rate.toLong(), stsdW.toByteArray(), 0, 0,
            flat.mapIndexed { idx, s -> s.copy(durationUs = durations[idx]) },
        )
    }
}
