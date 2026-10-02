package expo.modules.mediamux

import java.nio.ByteBuffer
import java.nio.ByteOrder

private fun textDataItem(atom: String, text: String): ByteArray {
    val w = Writer()
    w.fullBox(atom, 0, 0) {
        val d = Writer()
        d.fullBox("data", 1, 0) {
            u32(0)
            bytes(text.toByteArray(Charsets.UTF_8))
        }
        bytes(d.toByteArray())
    }
    return w.toByteArray()
}

private fun coverDataItem(bytes: ByteArray): ByteArray {
    val kind =
      if (bytes.size >= 3 && bytes[0] == 0xFF.toByte() && bytes[1] == 0xD8.toByte()) 13
      else 14
    val w = Writer()
    w.fullBox("covr", 0, 0) {
        val d = Writer()
        d.fullBox("data", kind, 0) {
            u32(0)
            bytes(bytes)
        }
        bytes(d.toByteArray())
    }
    return w.toByteArray()
}

private fun buildIlst(
    title: String?,
    artist: String?,
    album: String?,
    cover: ByteArray?
): ByteArray? {
    val items = mutableListOf<ByteArray>()
    if (!title.isNullOrEmpty()) items.add(textDataItem("©nam", title))
    if (!artist.isNullOrEmpty()) items.add(textDataItem("©ART", artist))
    if (!album.isNullOrEmpty()) items.add(textDataItem("©alb", album))
    if (cover != null && cover.isNotEmpty()) items.add(coverDataItem(cover))
    if (items.isEmpty()) return null
    val w = Writer()
    w.box("ilst") {
        for (item in items) bytes(item)
    }
    return w.toByteArray()
}

private fun buildMeta(ilst: ByteArray): ByteArray {
    val w = Writer()
    w.fullBox("meta", 0, 0) {
        val h = Writer()
        h.fullBox("hdlr", 0, 0) {
            u32(0)
            fourcc("mdirappl")
            u32(0)
            u32(0)
            u32(0)
        }
        bytes(h.toByteArray())
        bytes(ilst)
    }
    return w.toByteArray()
}

private fun shiftChunkOffsets(moov: ByteArray, delta: Long): ByteArray {
    if (delta == 0L) return moov
    val mutable = moov.copyOf()
    val view = ByteBuffer.wrap(mutable).order(ByteOrder.BIG_ENDIAN)
    fun walk2(base: Long, end: Long) {
        var off = base
        while (off + 8 <= end) {
            view.position(off.toInt())
            var size = view.int.toLong() and 0xFFFFFFFFL
            val typeBytes = ByteArray(4)
            view.get(typeBytes)
            var header = 8
            if (size == 1L) {
                size = view.long
                header = 16
            }
            if (size < 8 || off + size > end) break
            val type = String(typeBytes, Charsets.US_ASCII)
            if (type == "stco") {
                view.position((off + header + 4).toInt())
                val count = view.int
                for (i in 0 until count) {
                    val p = off + header + 8 + i * 4
                    view.position(p.toInt())
                    val v = view.int.toLong() and 0xFFFFFFFFL
                    view.position(p.toInt())
                    view.putInt((v + delta).toInt())
                }
            } else if (type == "co64") {
                view.position((off + header + 4).toInt())
                val count = view.int
                for (i in 0 until count) {
                    val p = off + header + 8 + i * 8
                    view.position(p.toInt())
                    val v = view.long
                    view.position(p.toInt())
                    view.putLong(v + delta)
                }
            } else if (type in setOf("trak", "mdia", "minf", "stbl", "moov")) {
                walk2(off + header, off + size)
            }
            off += size
        }
    }
    walk2(0, mutable.size.toLong())
    return mutable
}

object TagAudio {
    fun tagFile(
        inPath: String,
        outPath: String,
        title: String?,
        artist: String?,
        album: String?,
        coverPath: String?
    ) {
        val cover =
          if (!coverPath.isNullOrEmpty()) {
            val file = java.io.File(coverPath)
            if (file.exists()) file.readBytes() else null
          } else {
            null
          }
        val ilst = buildIlst(title, artist, album, cover) ?: error("nothing to tag")
        val src = java.io.File(inPath).readBytes()
        val data = ByteBuffer.wrap(src).order(ByteOrder.BIG_ENDIAN)
        var moovAt = -1L
        var moovSize = 0L
        var moovHeader = 8
        var off = 0L
        while (off + 8 <= src.size) {
            data.position(off.toInt())
            var size = data.int.toLong() and 0xFFFFFFFFL
            val typeBytes = ByteArray(4)
            data.get(typeBytes)
            var header = 8
            if (size == 1L) {
                size = data.long
                header = 16
            }
            if (size < 8) break
            if (String(typeBytes, Charsets.US_ASCII) == "moov") {
                moovAt = off
                moovSize = size
                moovHeader = header
                break
            }
            off += size
        }
        if (moovAt < 0) error("no moov")
        val moovBody = src.copyOfRange(
            (moovAt + moovHeader).toInt(),
            (moovAt + moovSize).toInt()
        )
        val rebuilt = rebuildMoovWithIlst(moovBody, ilst)
        val delta = rebuilt.size.toLong() - (moovSize - moovHeader)
        val patched = shiftChunkOffsets(rebuilt, delta)
        java.io.FileOutputStream(outPath).use { fos ->
            fos.write(src, 0, moovAt.toInt())
            val sizeBytes =
              ByteBuffer.allocate(8).order(ByteOrder.BIG_ENDIAN).putLong(patched.size + 8L).array()
            fos.write(sizeBytes.copyOfRange(4, 8))
            fos.write("moov".toByteArray(Charsets.US_ASCII))
            fos.write(patched)
            fos.write(src, (moovAt + moovSize).toInt(), (src.size - moovAt - moovSize).toInt())
        }
    }

    private fun rebuildMoovWithIlst(moovBody: ByteArray, ilst: ByteArray): ByteArray {
        val data = ByteBuffer.wrap(moovBody).order(ByteOrder.BIG_ENDIAN)
        val w = Writer()
        var off = 0L
        var swapped = false
        while (off + 8 <= moovBody.size) {
            data.position(off.toInt())
            var size = data.int.toLong() and 0xFFFFFFFFL
            val typeBytes = ByteArray(4)
            data.get(typeBytes)
            var header = 8
            if (size == 1L) {
                size = data.long
                header = 16
            }
            if (size < 8 || off + size > moovBody.size) break
            val type = String(typeBytes, Charsets.US_ASCII)
            if (type == "udta") {
                val inner = rebuildUdtaWithIlst(
                    moovBody.copyOfRange(
                        (off + header).toInt(),
                        (off + size).toInt()
                    ),
                    ilst
                )
                val uw = Writer()
                uw.box("udta") { bytes(inner) }
                w.bytes(uw.toByteArray())
                swapped = true
            } else {
                w.bytes(moovBody.copyOfRange(off.toInt(), (off + size).toInt()))
            }
            off += size
        }
        if (!swapped) {
            val uw = Writer()
            uw.box("udta") { bytes(buildMeta(ilst)) }
            w.bytes(uw.toByteArray())
        }
        return w.toByteArray()
    }

    private fun rebuildUdtaWithIlst(udtaBody: ByteArray, ilst: ByteArray): ByteArray {
        val data = ByteBuffer.wrap(udtaBody).order(ByteOrder.BIG_ENDIAN)
        val w = Writer()
        var off = 0L
        var swapped = false
        while (off + 8 <= udtaBody.size) {
            data.position(off.toInt())
            var size = data.int.toLong() and 0xFFFFFFFFL
            val typeBytes = ByteArray(4)
            data.get(typeBytes)
            var header = 8
            if (size == 1L) {
                size = data.long
                header = 16
            }
            if (size < 8 || off + size > udtaBody.size) break
            val type = String(typeBytes, Charsets.US_ASCII)
            if (type == "meta") {
                val mw = Writer()
                mw.fullBox("meta", 0, 0) {
                    val inner = udtaBody.copyOfRange(
                        (off + header + 4).toInt(),
                        (off + size).toInt()
                    )
                    val idata = ByteBuffer.wrap(inner).order(ByteOrder.BIG_ENDIAN)
                    var io = 0L
                    var metaSwapped = false
                    while (io + 8 <= inner.size) {
                        idata.position(io.toInt())
                        var isize = idata.int.toLong() and 0xFFFFFFFFL
                        val itypeBytes = ByteArray(4)
                        idata.get(itypeBytes)
                        var iheader = 8
                        if (isize == 1L) {
                            isize = idata.long
                            iheader = 16
                        }
                        if (isize < 8 || io + isize > inner.size) break
                        if (String(itypeBytes, Charsets.US_ASCII) == "ilst") {
                            bytes(ilst)
                            metaSwapped = true
                        } else {
                            bytes(inner.copyOfRange(io.toInt(), (io + isize).toInt()))
                        }
                        io += isize
                    }
                    if (!metaSwapped) bytes(ilst)
                }
                w.bytes(mw.toByteArray())
                swapped = true
            } else {
                w.bytes(udtaBody.copyOfRange(off.toInt(), (off + size).toInt()))
            }
            off += size
        }
        if (!swapped) {
            w.bytes(buildMeta(ilst))
        }
        return w.toByteArray()
    }
}
