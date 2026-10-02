package expo.modules.mediamux
import android.util.Log

import java.io.File
import java.io.RandomAccessFile
import java.nio.ByteBuffer
import java.nio.ByteOrder
import java.nio.channels.FileChannel

private fun u32At(buf: ByteArray, off: Int): Long =
    ((buf[off].toLong() and 0xFF) shl 24) or
        ((buf[off + 1].toLong() and 0xFF) shl 16) or
        ((buf[off + 2].toLong() and 0xFF) shl 8) or
        (buf[off + 3].toLong() and 0xFF)

private fun fullHeader(bb: ByteBuffer): Pair<Int, Int> {
    val ver = bb.get().toInt() and 0xFF
    val flags = ((bb.get().toInt() and 0xFF) shl 16) or
        ((bb.get().toInt() and 0xFF) shl 8) or
        (bb.get().toInt() and 0xFF)
    return ver to flags
}

fun patchDuration(body: ByteArray, duration: Long) {
    val ver = body[0].toInt()
    val off = if (ver == 0) 16 else 24
    val bb = ByteBuffer.wrap(body).order(ByteOrder.BIG_ENDIAN)
    if (ver == 0) bb.putInt(off, (duration and 0xFFFFFFFFL).toInt())
    else bb.putLong(off, duration)
}

fun buildStts(durations: List<Long>): ByteArray {
    val w = Writer()
    w.fullBox("stts", 0, 0) {
        if (durations.isEmpty()) {
            u32(0)
            return@fullBox
        }
        val runs = mutableListOf<Pair<Long, Long>>()
        var cur = durations[0]
        var n = 1L
        for (d in durations.drop(1)) {
            if (d == cur) n += 1
            else {
                runs.add(n to cur)
                cur = d
                n = 1
            }
        }
        runs.add(n to cur)
        u32(runs.size.toLong())
        for ((count, delta) in runs) {
            u32(count)
            u32(delta)
        }
    }
    return w.toByteArray()
}

fun buildStsc(total: Int): ByteArray {
    val w = Writer()
    w.fullBox("stsc", 0, 0) {
        u32(1)
        u32(1)
        u32(total.toLong())
        u32(1)
    }
    return w.toByteArray()
}

fun buildStsz(sizes: List<Int>): ByteArray {
    val w = Writer()
    w.fullBox("stsz", 0, 0) {
        u32(0)
        u32(sizes.size.toLong())
        for (s in sizes) u32(s.toLong())
    }
    return w.toByteArray()
}

fun buildStco(offsets: List<Long>): ByteArray {
    val w = Writer()
    w.fullBox("stco", 0, 0) {
        u32(offsets.size.toLong())
        for (o in offsets) u32(o)
    }
    return w.toByteArray()
}

fun buildStss(syncs: List<Int>): ByteArray? {
    if (syncs.isEmpty()) return null
    val w = Writer()
    w.fullBox("stss", 0, 0) {
        u32(syncs.size.toLong())
        for (s in syncs) u32(s.toLong())
    }
    return w.toByteArray()
}

fun buildCtts(offsets: List<Long>): ByteArray? {
    if (offsets.all { it == 0L }) return null
    val negative = offsets.any { it < 0 }
    val w = Writer()
    w.fullBox("ctts", if (negative) 1 else 0, 0) {
        val runs = mutableListOf<Pair<Long, Long>>()
        var cur = offsets[0]
        var n = 1L
        for (o in offsets.drop(1)) {
            if (o == cur) n += 1
            else {
                runs.add(n to cur)
                cur = o
                n = 1
            }
        }
        runs.add(n to cur)
        u32(runs.size.toLong())
        for ((count, off) in runs) {
            u32(count)
            if (negative) u32(off and 0xFFFFFFFFL) else u32(off)
        }
    }
    return w.toByteArray()
}

private data class Trex(val trackId: Int, val duration: Long, val size: Int, val flags: Long)

private fun walkTrex(data: ByteBuffer, moov: Box): Map<Int, Trex> {
    val out = mutableMapOf<Int, Trex>()
    for (child in children(data, moov)) {
        if (child.type != "mvex") continue
        for (t in children(data, child)) {
            if (t.type != "trex") continue
            val body = slice(data, t.start + t.headerSize, t.bodySize)
            val bb = ByteBuffer.wrap(body).order(ByteOrder.BIG_ENDIAN)
            bb.position(4)
            val id = bb.int
            out[id] = Trex(id, bb.int.toLong() and 0xFFFFFFFFL, bb.int, bb.int.toLong() and 0xFFFFFFFFL)
        }
    }
    return out
}

object CloneRemux {
    fun remuxFragmented(inPath: String, outPath: String) {
        val src = File(inPath).readBytes()
        val data = ByteBuffer.wrap(src).order(ByteOrder.BIG_ENDIAN)
        var ftyp: ByteArray? = null
        var moovBox: Box? = null
        val moofs = mutableListOf<Box>()
        var off = 0L
        while (off + 8 <= src.size) {
            val box = readBox(data, off)
            if (box.size < 8) break
            when (box.type) {
                "ftyp" -> ftyp = slice(data, box.start, box.size)
                "moov" -> moovBox = box
                "moof" -> moofs.add(box)
            }
            off = box.end
        }
        val moov = moovBox ?: error("no moov")
        val (mvhdScale, mvhdBody, tracks) = parseMoov(data, moov)
        Log.d("MediaMux", "clone: tracks=${tracks.size}")
        require(tracks.isNotEmpty()) { "no tracks with stsd" }
        val trex = walkTrex(data, moov)
        val byId = tracks.associateBy { it.trackId }

        for (moof in moofs) {
            for (traf in children(data, moof)) {
                if (traf.type != "traf") continue
                var trackId = 0
                var baseOff = moof.start
                var defDur = 0L
                var defSize = 0
                var defFlags = 0L
                for (tf in children(data, traf)) {
                    if (tf.type == "tfhd") {
                        val body = slice(data, tf.start + tf.headerSize, tf.bodySize)
                        val bb = ByteBuffer.wrap(body).order(ByteOrder.BIG_ENDIAN)
                        val (_, flags) = fullHeader(bb)
                        trackId = bb.int
                        var p = 8
                        if (flags and 0x1 != 0) {
                            baseOff = bb.getLong(p)
                            p += 8
                        }
                        if (flags and 0x2 != 0) p += 4
                        if (flags and 0x8 != 0) {
                            defDur = bb.int.toLong() and 0xFFFFFFFFL
                            p += 4
                        }
                        if (flags and 0x10 != 0) {
                            defSize = bb.int
                            p += 4
                        }
                        if (flags and 0x20 != 0) {
                            defFlags = bb.int.toLong() and 0xFFFFFFFFL
                        }
                    }
                }
                val trexEntry = trex[trackId]
                if (defDur == 0L) defDur = trexEntry?.duration ?: 0L
                if (defSize == 0) defSize = trexEntry?.size ?: 0
                if (defFlags == 0L) defFlags = trexEntry?.flags ?: 0L
                val track = byId[trackId] ?: continue
                for (tf in children(data, traf)) {
                    if (tf.type != "trun") continue
                    val body = slice(data, tf.start + tf.headerSize, tf.bodySize)
                    val bb = ByteBuffer.wrap(body).order(ByteOrder.BIG_ENDIAN)
                    val (_, flags) = fullHeader(bb)
                    val count = bb.int
                    var p = 8
                    var dataOff = 0L
                    if (flags and 0x1 != 0) {
                        dataOff = bb.int.toLong()
                        p += 4
                    }
                    var firstFlags = defFlags
                    var firstFlagsSet = false
                    if (flags and 0x4 != 0) {
                        firstFlags = bb.int.toLong() and 0xFFFFFFFFL
                        p += 4
                        firstFlagsSet = true
                    }
                    val sampleBase = baseOff + dataOff
                    var sampleOff = sampleBase
                    for (s in 0 until count) {
                        var dur = defDur
                        var size = defSize
                        var sflags = if (s == 0 && firstFlagsSet) firstFlags else defFlags
                        var cto = 0L
                        if (flags and 0x100 != 0) {
                            dur = bb.int.toLong() and 0xFFFFFFFFL
                            p += 4
                        }
                        if (flags and 0x200 != 0) {
                            size = bb.int
                            p += 4
                        }
                        if (flags and 0x400 != 0) {
                            sflags = bb.int.toLong() and 0xFFFFFFFFL
                            p += 4
                        }
                        if (flags and 0x800 != 0) {
                            cto = bb.int.toLong()
                            if (cto and 0x80000000L != 0L) cto -= 0x100000000L
                            p += 4
                        }
                        if (size <= 0) error("zero-size sample")
                        track.samples.add(
                            Sample(sampleOff, size, dur, sflags and 0x00010000L == 0L, cto),
                        )
                        sampleOff += size
                    }
                }
            }
        }

        val ftypBytes = ftyp
        var totalSamples = 0
        for (t in tracks) totalSamples += t.samples.size
        Log.d("MediaMux", "clone: ${tracks.size} tracks, $totalSamples samples")

        fun buildMoov(chunkOffsets: List<Long>): ByteArray {
            val moovW = Writer()
            moovW.box("moov") {
                val mvhdPatched = mvhdBody.copyOf()
                var movieDur = 0L
                for (t in tracks) {
                    val trackDur = t.samples.sumOf { it.duration }
                    movieDur = maxOf(movieDur, trackDur * mvhdScale / t.timescale)
                }
                patchDuration(mvhdPatched, movieDur)
                val wv = Writer()
                wv.fullBox("mvhd", mvhdPatched[0].toInt(), 0) {
                    bytes(mvhdPatched.copyOfRange(4, mvhdPatched.size))
                }
                bytes(wv.toByteArray())
                for ((ti, t) in tracks.withIndex()) {
                    val trackDur = t.samples.sumOf { it.duration }
                    val mdhdPatched = t.mdhdBody.copyOf()
                    patchDuration(mdhdPatched, trackDur)
                    val tkhdPatched = t.tkhd.copyOf()
                    patchTkhdDuration(tkhdPatched, trackDur * mvhdScale / t.timescale)
                    box("trak") {
                        bytes(tkhdPatched)
                        if (t.elst != null) {
                            box("edts") { bytes(t.elst) }
                        }
                        box("mdia") {
                            val w2 = Writer()
                            w2.fullBox("mdhd", mdhdPatched[0].toInt(), 0) {
                                bytes(mdhdPatched.copyOfRange(4, mdhdPatched.size))
                            }
                            bytes(w2.toByteArray())
                            bytes(t.hdlr)
                            box("minf") {
                                if (t.mediaHeader.isNotEmpty()) bytes(t.mediaHeader)
                                if (t.dinf.isNotEmpty()) bytes(t.dinf)
                                box("stbl") {
                                    bytes(t.stsd)
                                    val durations = t.samples.map { it.duration }
                                    val sizes = t.samples.map { it.size }
                                    bytes(buildStts(durations))
                                    bytes(buildStsc(t.samples.size))
                                    bytes(buildStsz(sizes))
                                    if (t.isVideo) {
                                        val syncs = t.samples.mapIndexedNotNull { idx, s ->
                                            if (s.sync) idx + 1 else null
                                        }
                                        val stss = buildStss(syncs)
                                        if (stss != null) bytes(stss)
                                    }
                                    val ctts = buildCtts(t.samples.map { it.cto })
                                    if (ctts != null) bytes(ctts)
                                    bytes(buildStco(listOf(chunkOffsets[ti])))
                                }
                            }
                        }
                    }
                }
            }
            return moovW.toByteArray()
        }

        val pass1 = buildMoov(tracks.map { 0L })
        var cursor = (ftypBytes?.size?.toLong() ?: 0L) + pass1.size + 8
        val chunkOffsets = tracks.map { t ->
            val at = cursor
            cursor += t.samples.sumOf { it.size.toLong() }
            at
        }
        val moovBytes = buildMoov(chunkOffsets)
        require(moovBytes.size == pass1.size) { "moov size moved" }

        var mdatBytes = 0L
        java.io.FileOutputStream(outPath).use { fos ->
            if (ftypBytes != null) {
                fos.write(ftypBytes)
                mdatBytes += ftypBytes.size
            }
            fos.write(moovBytes)
            mdatBytes += moovBytes.size
            val mdatSizePos = mdatBytes
            fos.write(ByteArray(8))
            mdatBytes += 8
            val raf = java.io.RandomAccessFile(inPath, "r")
            try {
                val buf = ByteArray(64 * 1024)
                for (t in tracks) {
                    for (s in t.samples) {
                        var left = s.size.toLong()
                        raf.seek(s.fileOffset)
                        while (left > 0) {
                            val n = raf.read(buf, 0, minOf(buf.size.toLong(), left).toInt())
                            if (n < 0) error("short read")
                            fos.write(buf, 0, n)
                            left -= n
                        }
                        mdatBytes += s.size
                    }
                }
            } finally {
                raf.close()
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

        for (t in tracks) {
            val trackDur = t.samples.sumOf { it.duration }
            Log.d("MediaMux", "clone: track ${t.trackId} dur=${trackDur}us n=${t.samples.size}")
        }
        Log.d("MediaMux", "clone: moov=${moovBytes.size} mdat=${mdatBytes - (ftypBytes?.size ?: 0) - moovBytes.size}")
        Log.d("MediaMux", "clone -> $outPath (${java.io.File(outPath).length()} bytes)")
    }

    private fun patchTkhdDuration(tkhd: ByteArray, duration: Long) {
        val ver = tkhd[8].toInt()
        val bb = ByteBuffer.wrap(tkhd).order(ByteOrder.BIG_ENDIAN)
        if (ver == 0) bb.putInt(8 + 20, (duration and 0xFFFFFFFFL).toInt())
        else bb.putLong(8 + 28, duration)
    }
}
