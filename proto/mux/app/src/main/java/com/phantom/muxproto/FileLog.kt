package com.phantom.muxproto

import android.util.Log
import java.io.File
import java.text.SimpleDateFormat
import java.util.Date
import java.util.Locale

object FileLog {
    private const val TAG = "MuxProto"
    private val buffer = StringBuilder()
    private var file: File? = null
    private val timeFmt = SimpleDateFormat("HH:mm:ss.SSS", Locale.US)

    @Synchronized
    fun init(dir: File) {
        file = File(dir, "muxproto-log.txt").also {
            if (it.exists()) it.appendText("\n===== new run ${Date()} =====\n")
            else it.writeText("===== run ${Date()} =====\n")
        }
    }

    @Synchronized
    fun line(msg: String) {
        val stamped = "[${timeFmt.format(Date())}] $msg"
        buffer.appendLine(stamped)
        Log.d(TAG, msg)
        try {
            file?.appendText("$stamped\n")
        } catch (_: Exception) {
        }
    }

    @Synchronized
    fun snapshot(): String = buffer.toString()

    @Synchronized
    fun error(where: String, err: Throwable) {
        line("FAIL $where: ${err.message}")
        err.stackTrace.take(12).forEach { line("    at $it") }
        err.cause?.let { line("caused by: ${it.message}") }
    }
}
