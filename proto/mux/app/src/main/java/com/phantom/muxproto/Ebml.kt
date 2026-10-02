package com.phantom.muxproto

import java.nio.ByteBuffer
import java.nio.ByteOrder

data class EbmlElem(val id: Long, val dataOff: Long, val dataLen: Long) {
    val end: Long get() = if (dataLen < 0) Long.MAX_VALUE else dataOff + dataLen
}

private fun readVint(data: ByteBuffer, off: Long, keepMarker: Boolean): Pair<Long, Int> {
    val first = data.get(off.toInt()).toInt() and 0xFF
    var mask = 0x80
    var width = 1
    while (width <= 8 && first and mask == 0) {
        mask = mask shr 1
        width += 1
    }
    if (width > 8) error("bad vint")
    var value = (if (keepMarker) first else first and (mask - 1)).toLong()
    for (i in 1 until width) {
        value = (value shl 8) or (data.get(off.toInt() + i).toInt() and 0xFF).toLong()
    }
    return value to width
}

fun ebmlChildren(data: ByteBuffer, start: Long, end: Long): List<EbmlElem> {
    val out = mutableListOf<EbmlElem>()
    var off = start
    while (off + 2 <= end && off < data.limit()) {
        val (id, idW) = readVint(data, off, true)
        val (size, sizeW) = readVint(data, off + idW, false)
        val allOnes = (1L shl (sizeW * 7)) - 1L
        val len = if (size == allOnes) -1L else size
        out.add(EbmlElem(id, off + idW + sizeW, len))
        if (len < 0) break
        off += idW + sizeW + len
    }
    return out
}

fun ebmlBytes(data: ByteBuffer, elem: EbmlElem): ByteArray {
    val out = ByteArray(elem.dataLen.toInt())
    val pos = data.position()
    data.position(elem.dataOff.toInt())
    data.get(out)
    data.position(pos)
    return out
}

fun ebmlUint(data: ByteBuffer, elem: EbmlElem): Long {
    var v = 0L
    val pos = data.position()
    data.position(elem.dataOff.toInt())
    repeat(elem.dataLen.toInt()) { v = (v shl 8) or (data.get().toInt() and 0xFF).toLong() }
    data.position(pos)
    return v
}

fun ebmlFloat(data: ByteBuffer, elem: EbmlElem): Double {
    val pos = data.position()
    data.position(elem.dataOff.toInt())
    val v = if (elem.dataLen == 4L) data.float.toDouble() else data.double
    data.position(pos)
    return v
}

fun ebmlAscii(data: ByteBuffer, elem: EbmlElem): String {
    val raw = ebmlBytes(data, elem)
    val end = raw.indexOf(0)
    return String(if (end >= 0) raw.copyOf(end) else raw, Charsets.US_ASCII)
}
