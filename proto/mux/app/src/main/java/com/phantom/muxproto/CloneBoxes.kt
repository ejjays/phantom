package com.phantom.muxproto

import java.nio.ByteBuffer
import java.nio.ByteOrder

class Box(
    val type: String,
    val start: Long,
    val headerSize: Int,
    val size: Long,
) {
    val end: Long get() = start + size
    val bodySize: Long get() = size - headerSize
}

fun readBox(data: ByteBuffer, base: Long): Box {
    data.position(base.toInt())
    var size = data.int.toLong() and 0xFFFFFFFFL
    val typeBytes = ByteArray(4)
    data.get(typeBytes)
    val type = String(typeBytes, Charsets.US_ASCII)
    var header = 8
    if (size == 1L) {
        size = data.long
        header = 16
    } else if (size == 0L) {
        size = (data.limit() - base).toLong()
    }
    return Box(type, base, header, size)
}

fun children(data: ByteBuffer, box: Box): List<Box> {
    val out = mutableListOf<Box>()
    var off = box.start + box.headerSize
    while (off + 8 <= box.end) {
        val child = readBox(data, off)
        if (child.size < 8 || child.end > box.end) break
        out.add(child)
        off = child.end
    }
    return out
}

fun slice(data: ByteBuffer, start: Long, len: Long): ByteArray {
    val out = ByteArray(len.toInt())
    val pos = data.position()
    data.position(start.toInt())
    data.get(out)
    data.position(pos)
    return out
}

class Writer {
    val buf = mutableListOf<Byte>()
    fun u8(v: Int) { buf.add(v.toByte()) }
    fun u16(v: Int) { buf.add((v shr 8).toByte()); buf.add(v.toByte()) }
    fun u24(v: Int) { buf.add((v shr 16).toByte()); buf.add((v shr 8).toByte()); buf.add(v.toByte()) }
    fun u32(v: Long) {
        buf.add((v shr 24).toByte()); buf.add((v shr 16).toByte())
        buf.add((v shr 8).toByte()); buf.add(v.toByte())
    }
    fun u64(v: Long) {
        u32(v shr 32); u32(v and 0xFFFFFFFFL)
    }
    fun fourcc(s: String) { s.toByteArray(Charsets.US_ASCII).forEach { buf.add(it) } }
    fun bytes(b: ByteArray) { b.forEach { buf.add(it) } }
    fun box(type: String, body: Writer.() -> Unit): Int {
        val start = buf.size
        u32(0L)
        fourcc(type)
        body()
        val size = buf.size - start
        buf[start] = (size shr 24).toByte()
        buf[start + 1] = (size shr 16).toByte()
        buf[start + 2] = (size shr 8).toByte()
        buf[start + 3] = size.toByte()
        return size
    }
    fun fullBox(type: String, version: Int, flags: Int, body: Writer.() -> Unit) {
        box(type) { u8(version); u24(flags); body() }
    }
    fun toByteArray(): ByteArray = buf.toByteArray()
}

data class Sample(val fileOffset: Long, val size: Int, val duration: Long, val sync: Boolean, val cto: Long)

data class TrackPieces(
    val trackId: Int,
    val isVideo: Boolean,
    val timescale: Long,
    val tkhd: ByteArray,
    val hdlr: ByteArray,
    val mediaHeader: ByteArray,
    val dinf: ByteArray,
    val stsd: ByteArray,
    val mdhdBody: ByteArray,
    val elst: ByteArray?,
    val samples: MutableList<Sample> = mutableListOf(),
)

fun parseMoov(data: ByteBuffer, moov: Box): Triple<Long, ByteArray, List<TrackPieces>> {
    var mvhdScale = 1000L
    var mvhdVer = 0
    var mvhdBody = ByteArray(0)
    val tracks = mutableListOf<TrackPieces>()
    for (child in children(data, moov)) {
        when (child.type) {
            "mvhd" -> {
                mvhdBody = slice(data, child.start + child.headerSize, child.bodySize)
                val bb = ByteBuffer.wrap(mvhdBody).order(ByteOrder.BIG_ENDIAN)
                mvhdVer = bb.get().toInt()
                bb.position(bb.position() + 3)
                if (mvhdVer == 0) {
                    bb.position(bb.position() + 8)
                    mvhdScale = bb.int.toLong() and 0xFFFFFFFFL
                } else {
                    bb.position(bb.position() + 16)
                    mvhdScale = bb.int.toLong() and 0xFFFFFFFFL
                }
            }
            "trak" -> {
                var trackId = 0
                var tkhd = ByteArray(0)
                var timescale = 0L
                var mdhdBody = ByteArray(0)
                var hdlr = ByteArray(0)
                var handler = ""
                var mediaHeader = ByteArray(0)
                var dinf = ByteArray(0)
                var stsd: ByteArray? = null
                var elst: ByteArray? = null
                for (t in children(data, child)) {
                    when (t.type) {
                        "tkhd" -> {
                            tkhd = slice(data, t.start, t.size)
                            val bb = ByteBuffer.wrap(tkhd).order(ByteOrder.BIG_ENDIAN)
                            bb.position(t.headerSize + 4)
                            trackId = bb.int
                        }
                        "edts" -> {
                            for (e in children(data, t)) {
                                if (e.type == "elst") elst = slice(data, e.start, e.size)
                            }
                        }
                        "mdia" -> {
                            for (m in children(data, t)) {
                                when (m.type) {
                                    "mdhd" -> {
                                        mdhdBody = slice(data, m.start + m.headerSize, m.bodySize)
                                        val bb = ByteBuffer.wrap(mdhdBody).order(ByteOrder.BIG_ENDIAN)
                                        val ver = bb.get().toInt()
                                        bb.position(bb.position() + 3)
                                        if (ver == 0) {
                                            bb.position(bb.position() + 8)
                                            timescale = bb.int.toLong() and 0xFFFFFFFFL
                                        } else {
                                            bb.position(bb.position() + 16)
                                            timescale = bb.int.toLong() and 0xFFFFFFFFL
                                        }
                                    }
                                    "hdlr" -> {
                                        hdlr = slice(data, m.start, m.size)
                                        val bb = ByteBuffer.wrap(hdlr).order(ByteOrder.BIG_ENDIAN)
                                        bb.position(m.headerSize + 8)
                                        val h = ByteArray(4)
                                        bb.get(h)
                                        handler = String(h, Charsets.US_ASCII)
                                    }
                                    "minf" -> {
                                        for (f in children(data, m)) {
                                            when (f.type) {
                                                "vmhd", "smhd", "hmhd", "nmhd" ->
                                                    mediaHeader = slice(data, f.start, f.size)
                                                "dinf" -> dinf = slice(data, f.start, f.size)
                                            }
                                        }
                                    }
                                }
                            }
                        }
                    }
                }
                if (stsd == null) {
                    for (t in children(data, child)) {
                        if (t.type != "mdia") continue
                        for (m in children(data, t)) {
                            if (m.type != "minf") continue
                            for (f in children(data, m)) {
                                if (f.type != "stbl") continue
                                for (s in children(data, f)) {
                                    if (s.type == "stsd") stsd = slice(data, s.start, s.size)
                                }
                            }
                        }
                    }
                }
                if (trackId != 0 && stsd != null && timescale > 0) {
                    tracks.add(
                        TrackPieces(
                            trackId, handler == "vide", timescale, tkhd, hdlr,
                            mediaHeader, dinf, stsd, mdhdBody, elst,
                        ),
                    )
                }
            }
        }
    }
    return Triple(mvhdScale, mvhdBody, tracks)
}
