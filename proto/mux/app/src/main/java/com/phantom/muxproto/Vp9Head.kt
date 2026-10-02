package com.phantom.muxproto

import java.nio.ByteBuffer
import java.nio.ByteOrder

private class BitReader(val data: ByteArray, byteOff: Int) {
    var bitPos = byteOff * 8
    fun f(n: Int): Int {
        var v = 0
        repeat(n) {
            val byte = data[bitPos shr 3].toInt() and 0xFF
            v = (v shl 1) or ((byte shr (7 - (bitPos and 7))) and 1)
            bitPos += 1
        }
        return v
    }
}

data class Vp9Header(
    val profile: Int,
    val bitDepth: Int,
    val chromaX: Int,
    val chromaY: Int,
    val fullRange: Boolean,
    val width: Int,
    val height: Int,
    val colour: Int,
    val transfer: Int,
    val matrix: Int,
)

private data class Vp9LevelRow(val maxRate: Long, val maxPic: Int, val idc: Int)

private val VP9_LEVELS = listOf(
    Vp9LevelRow(829440L, 36864, 0x10),
    Vp9LevelRow(2764800L, 73728, 0x11),
    Vp9LevelRow(4608000L, 122880, 0x20),
    Vp9LevelRow(9216000L, 245760, 0x21),
    Vp9LevelRow(20736000L, 552960, 0x30),
    Vp9LevelRow(36864000L, 983040, 0x31),
    Vp9LevelRow(83558400L, 2228224, 0x40),
    Vp9LevelRow(160432128L, 2228224, 0x41),
    Vp9LevelRow(311951360L, 8912896, 0x50),
    Vp9LevelRow(588251136L, 8912896, 0x51),
    Vp9LevelRow(1176502272L, 8912896, 0x52),
    Vp9LevelRow(1176502272L, 35651584, 0x60),
    Vp9LevelRow(2353004544L, 35651584, 0x61),
    Vp9LevelRow(4706009088L, 35651584, 0x62),
)

fun vp9LevelIdc(width: Int, height: Int, fps: Double): Int {
    if (width <= 0 || height <= 0) return 0
    val pic = width.toLong() * height
    val rate = if (fps > 0) (pic * fps).toLong() else 0L
    for (row in VP9_LEVELS) {
        if ((rate <= 0 || rate <= row.maxRate) && pic <= row.maxPic) return row.idc
    }
    return 0
}

fun parseVp9Keyframe(frame: ByteArray): Vp9Header? {
    return tryHeader(frame, twoBitProfile = false) ?: tryHeader(frame, twoBitProfile = true)
}

private fun tryHeader(frame: ByteArray, twoBitProfile: Boolean): Vp9Header? {
    try {
        val r = BitReader(frame, 0)
        if (r.f(2) != 0b10) return null
        var profile = r.f(1)
        if (twoBitProfile) {
            profile = profile or (r.f(1) shl 1)
        } else if (profile == 1) {
            profile = profile or (r.f(1) shl 1)
        }
        if (r.f(1) == 1) return null
        if (r.f(1) != 0) return null
        r.f(1)
        r.f(1)
        if (r.f(24) != 0x498342) return null
        var bitDepth = 8
        var chromaX = 1
        var chromaY = 1
        var colour = 1
        var transfer = 1
        var matrix = 1
        var fullRange = false
        if (profile == 2 || profile == 3) {
            bitDepth = if (r.f(1) == 1) {
                if (r.f(1) == 1) 12 else 10
            } else {
                8
            }
        }
        val colorSpace = r.f(3)
        if (colorSpace != 7) {
            fullRange = r.f(1) == 1
            if (profile == 1 || profile == 3) {
                chromaX = r.f(1)
                chromaY = r.f(1)
            }
            if (colorSpace == 2) {
                colour = 1
                transfer = 1
                matrix = 1
            }
        } else {
            fullRange = true
            chromaX = 0
            chromaY = 0
        }
        val w = r.f(16) + 1
        val h = r.f(16) + 1
        var dw = w
        var dh = h
        if (r.f(1) == 1) {
            dw = r.f(16) + 1
            dh = r.f(16) + 1
        }
        return Vp9Header(
            profile, bitDepth, chromaX, chromaY, fullRange, dw, dh,
            colour, transfer, matrix,
        )
    } catch (_: Exception) {
        return null
    }
}

fun buildVpcc(header: Vp9Header, fps: Double): ByteArray {
    val w = Writer()
    val chroma = when {
        header.chromaX == 1 && header.chromaY == 1 -> 1
        header.chromaX == 1 -> 2
        else -> 0
    }
    w.fullBox("vpcC", 1, 0) {
        u8(header.profile)
        u8(vp9LevelIdc(header.width, header.height, fps))
        u8((header.bitDepth shl 4) or (chroma shl 1) or (if (header.fullRange) 1 else 0))
        u8(header.colour)
        u8(header.transfer)
        u8(header.matrix)
        u16(0)
    }
    return w.toByteArray()
}

fun buildVp09Entry(width: Int, height: Int, vpcC: ByteArray): ByteArray {
    val w = Writer()
    w.box("vp09") {
        bytes(ByteArray(6))
        u16(1)
        u16(0)
        u16(0)
        u32(0)
        u32(0)
        u32(0)
        u16(width)
        u16(height)
        u32(0x00480000)
        u32(0x00480000)
        u32(0)
        u16(1)
        bytes(ByteArray(32))
        u16(0x0018)
        u16(0xFFFF)
        bytes(vpcC)
    }
    return w.toByteArray()
}

fun buildOpusEntry(channels: Int, sampleRate: Int, opusHead: ByteArray): ByteArray {
    require(opusHead.size >= 19) { "short OpusHead" }
    require(String(opusHead.copyOfRange(0, 8), Charsets.US_ASCII) == "OpusHead") { "bad OpusHead" }
    val head = ByteBuffer.wrap(opusHead).order(ByteOrder.LITTLE_ENDIAN)
    head.position(9)
    val ch = head.get().toInt() and 0xFF
    val preskip = head.short.toInt() and 0xFFFF
    val rate = head.int
    val gain = head.short.toInt()
    val family = head.get().toInt() and 0xFF
    require(family == 0) { "opus mapping family $family" }
    val dops = Writer()
    dops.fullBox("dOps", 0, 0) {
        u8(0)
        u8(if (channels > 0) channels else ch)
        u16(preskip)
        u32((if (sampleRate > 0) sampleRate else rate).toLong())
        u16(gain and 0xFFFF)
        u8(family)
    }
    val w = Writer()
    w.box("Opus") {
        bytes(ByteArray(6))
        u16(1)
        u16(0)
        u16(0)
        u32(0)
        u32(0)
        u32(0)
        u16(if (channels > 0) channels else ch)
        u16(16)
        u16(0)
        u16(0)
        u32(((if (sampleRate > 0) sampleRate else rate).toLong() shl 16))
        bytes(dops.toByteArray())
    }
    return w.toByteArray()
}
