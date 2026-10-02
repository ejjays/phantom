package com.phantom.muxproto

import java.nio.ByteBuffer

private const val ID_SEGMENT = 0x18538067L
private const val ID_INFO = 0x1549A966L
private const val ID_TIMECODESCALE = 0x2AD7B1L
private const val ID_TRACKS = 0x1654AE6BL
private const val ID_TRACKENTRY = 0xAEL
private const val ID_TRACKNUMBER = 0xD7L
private const val ID_TRACKTYPE = 0x83L
private const val ID_CODECID = 0x86L
private const val ID_CODECPRIVATE = 0x63A2L
private const val ID_DEFAULTDURATION = 0x23E383L
private const val ID_VIDEO = 0xE0L
private const val ID_PIXELWIDTH = 0xB0L
private const val ID_PIXELHEIGHT = 0xBAL
private const val ID_AUDIO = 0xE1L
private const val ID_SAMPLINGFREQ = 0xB5L
private const val ID_CHANNELS = 0x9FL
private const val ID_CLUSTER = 0x1F43B675L
private const val ID_TIMESTAMP = 0xE7L
private const val ID_SIMPLEBLOCK = 0xA3L
private const val ID_BLOCKGROUP = 0xA0L
private const val ID_BLOCK = 0xA1L
private const val ID_BLOCKDURATION = 0x9BL
private const val ID_REFERENCEBLOCK = 0xFBL

data class WebmTrack(
    val number: Long,
    val kind: Int,
    val codecId: String,
    val privateData: ByteArray,
    val defaultDurationNs: Long,
    val width: Int,
    val height: Int,
    val sampleRate: Double,
    val channels: Int,
)

data class WebmSample(
    val trackNumber: Long,
    val ptsNs: Long,
    val durationNs: Long,
    val sync: Boolean,
    val bytes: ByteArray,
)

private fun readVintLen(data: ByteBuffer, off: Int): Pair<Long, Int> {
    val first = data.get(off).toInt() and 0xFF
    var mask = 0x80
    var width = 1
    while (width <= 8 && first and mask == 0) {
        mask = mask shr 1
        width += 1
    }
    if (width > 8) error("bad track vint")
    var value = (first and (mask - 1)).toLong()
    for (i in 1 until width) {
        value = (value shl 8) or (data.get(off + i).toInt() and 0xFF).toLong()
    }
    return value to width
}

private fun readEbmlUint(data: ByteBuffer, off: Int): Pair<Long, Int> {
    val first = data.get(off).toInt() and 0xFF
    var mask = 0x80
    var width = 1
    while (width <= 8 && first and mask == 0) {
        mask = mask shr 1
        width += 1
    }
    if (width > 8) error("bad ebml uint")
    var value = (first and (mask - 1)).toLong()
    for (i in 1 until width) {
        value = (value shl 8) or (data.get(off + i).toInt() and 0xFF).toLong()
    }
    return value to width
}

private fun ebmlBias(width: Int): Long = (1L shl (7 * width - 1)) - 1L

private fun splitLaced(payload: ByteArray, dataOff: Int): List<ByteArray> {
    val lacing = (payload[3].toInt() and 0x06) shr 1
    val buf = ByteBuffer.wrap(payload)
    if (lacing == 0) return listOf(payload.copyOfRange(dataOff, payload.size))
    val count = (payload[dataOff].toInt() and 0xFF) + 1
    var pos = dataOff + 1
    val sizes = mutableListOf<Long>()
    when (lacing) {
        1 -> {
            repeat(count - 1) {
                var s = 0L
                while (true) {
                    val b = buf.get(pos++).toInt() and 0xFF
                    s += b
                    if (b != 0xFF) break
                }
                sizes.add(s)
            }
        }
        3 -> {
            val raw = mutableListOf<Pair<Long, Int>>()
            repeat(count - 1) {
                val (v, w) = readEbmlUint(buf, pos)
                pos += w
                raw.add(v to w)
            }
            sizes.add(raw[0].first)
            for (i in 1 until raw.size) {
                sizes.add(sizes[i - 1] + (raw[i].first - ebmlBias(raw[i].second)))
            }
        }
        2 -> {
            val each = (payload.size - pos).toLong() / count
            repeat(count - 1) { sizes.add(each) }
        }
    }
    val total = (payload.size - pos).toLong()
    sizes.add(total - sizes.sum())
    val out = mutableListOf<ByteArray>()
    var at = pos
    for (s in sizes) {
        require(s >= 0) { "bad lace size" }
        out.add(payload.copyOfRange(at, (at + s).toInt()))
        at += s.toInt()
    }
    return out
}

object WebmDemux {
    fun demux(path: String): Triple<Long, List<WebmTrack>, List<WebmSample>> {
        val raw = java.io.File(path).readBytes()
        val data = ByteBuffer.wrap(raw)
        val top = ebmlChildren(data, 0, raw.size.toLong())
        val seg = top.firstOrNull { it.id == ID_SEGMENT } ?: error("no segment")
        val segEnd = if (seg.dataLen < 0) raw.size.toLong() else seg.end
        var timeScaleNs = 1_000_000L
        val tracks = mutableListOf<WebmTrack>()
        val samples = mutableListOf<WebmSample>()
        for (elem in ebmlChildren(data, seg.dataOff, segEnd)) {
            when (elem.id) {
                ID_INFO -> {
                    for (f in ebmlChildren(data, elem.dataOff, elem.end)) {
                        if (f.id == ID_TIMECODESCALE) timeScaleNs = ebmlUint(data, f)
                    }
                }
                ID_TRACKS -> {
                    for (t in ebmlChildren(data, elem.dataOff, elem.end)) {
                        if (t.id != ID_TRACKENTRY) continue
                        var num = 0L
                        var kind = 0
                        var codec = ""
                        var priv = ByteArray(0)
                        var defDur = 0L
                        var w = 0
                        var h = 0
                        var rate = 0.0
                        var ch = 0
                        for (f in ebmlChildren(data, t.dataOff, t.end)) {
                            when (f.id) {
                                ID_TRACKNUMBER -> num = ebmlUint(data, f)
                                ID_TRACKTYPE -> kind = ebmlUint(data, f).toInt()
                                ID_CODECID -> codec = ebmlAscii(data, f)
                                ID_CODECPRIVATE -> priv = ebmlBytes(data, f)
                                ID_DEFAULTDURATION -> defDur = ebmlUint(data, f)
                                ID_VIDEO -> {
                                    for (v in ebmlChildren(data, f.dataOff, f.end)) {
                                        when (v.id) {
                                            ID_PIXELWIDTH -> w = ebmlUint(data, v).toInt()
                                            ID_PIXELHEIGHT -> h = ebmlUint(data, v).toInt()
                                        }
                                    }
                                }
                                ID_AUDIO -> {
                                    for (a in ebmlChildren(data, f.dataOff, f.end)) {
                                        when (a.id) {
                                            ID_SAMPLINGFREQ -> rate = ebmlFloat(data, a)
                                            ID_CHANNELS -> ch = ebmlUint(data, a).toInt()
                                        }
                                    }
                                }
                            }
                        }
                        tracks.add(WebmTrack(num, kind, codec, priv, defDur, w, h, rate, ch))
                    }
                }
                ID_CLUSTER -> {
                    var clusterTs = 0L
                    val byTrack = tracks.associateBy { it.number }
                    for (c in ebmlChildren(data, elem.dataOff, elem.end)) {
                        when (c.id) {
                            ID_TIMESTAMP -> clusterTs = ebmlUint(data, c)
                            ID_SIMPLEBLOCK, ID_BLOCKGROUP -> {
                                readBlocks(data, c, clusterTs, timeScaleNs, byTrack, samples)
                            }
                        }
                    }
                }
            }
        }
        FileLog.line("webm: timescale=${timeScaleNs}ns tracks=${tracks.size} samples=${samples.size}")
        for (t in tracks) {
            FileLog.line(
                "webm track ${t.number} kind=${t.kind} codec=${t.codecId} " +
                    "defDur=${t.defaultDurationNs}ns ${t.width}x${t.height} ${t.sampleRate}Hz ch${t.channels}",
            )
        }
        return Triple(timeScaleNs, tracks, samples)
    }

    private fun readBlocks(
        data: ByteBuffer,
        elem: EbmlElem,
        clusterTs: Long,
        timeScaleNs: Long,
        byTrack: Map<Long, WebmTrack>,
        samples: MutableList<WebmSample>,
    ) {
        if (elem.id == ID_SIMPLEBLOCK) {
            val payload = ebmlBytes(data, elem)
            var pos = 0
            val (trackNo, w) = readVintLen(ByteBuffer.wrap(payload), pos)
            pos += w
            val relTs = ((payload[pos].toInt() shl 8) or (payload[pos + 1].toInt() and 0xFF)).toShort().toInt()
            pos += 2
            val flags = payload[pos].toInt() and 0xFF
            pos += 1
            val track = byTrack[trackNo] ?: return
            val absNs = (clusterTs + relTs) * timeScaleNs
            val frames = splitLaced(payload, pos)
            val perDur = if (track.defaultDurationNs > 0) track.defaultDurationNs else 0L
            frames.forEachIndexed { idx, frame ->
                samples.add(
                    WebmSample(
                        trackNo, absNs + idx * perDur, perDur,
                        flags and 0x80 != 0, frame,
                    ),
                )
            }
            return
        }
        var block: ByteArray? = null
        var blockDur = 0L
        var ref = 0L
        var hasRef = false
        for (f in ebmlChildren(data, elem.dataOff, elem.end)) {
            when (f.id) {
                ID_BLOCK -> block = ebmlBytes(data, f)
                ID_BLOCKDURATION -> blockDur = ebmlUint(data, f)
                ID_REFERENCEBLOCK -> {
                    val raw = ebmlBytes(data, f)
                    var v = 0L
                    for (b in raw) v = (v shl 8) or (b.toInt() and 0xFF).toLong()
                    val bits = raw.size * 8
                    if (v and (1L shl (bits - 1)) != 0L) v -= (1L shl bits)
                    ref = v
                    hasRef = true
                }
            }
        }
        val payload = block ?: return
        var pos = 0
        val (trackNo, w) = readVintLen(ByteBuffer.wrap(payload), pos)
        pos += w
        val relTs = ((payload[pos].toInt() shl 8) or (payload[pos + 1].toInt() and 0xFF)).toShort().toInt()
        pos += 2
        pos += 1
        val track = byTrack[trackNo] ?: return
        val absNs = (clusterTs + relTs) * timeScaleNs
        val frames = splitLaced(payload, pos)
        val perDur = when {
            blockDur > 0 && frames.isNotEmpty() -> blockDur * timeScaleNs / frames.size
            track.defaultDurationNs > 0 -> track.defaultDurationNs
            else -> 0L
        }
        frames.forEachIndexed { idx, frame ->
            samples.add(
                WebmSample(
                    trackNo, absNs + idx * perDur, perDur,
                    !hasRef || ref >= 0, frame,
                ),
            )
        }
    }
}
