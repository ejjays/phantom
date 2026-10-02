package com.phantom.muxproto

import android.content.ClipData
import android.content.ClipboardManager
import android.content.Context
import android.os.Bundle
import android.widget.Toast
import androidx.activity.ComponentActivity
import androidx.activity.compose.setContent
import androidx.compose.foundation.layout.Arrangement
import androidx.compose.foundation.layout.Column
import androidx.compose.foundation.layout.fillMaxSize
import androidx.compose.foundation.layout.fillMaxWidth
import androidx.compose.foundation.layout.padding
import androidx.compose.foundation.rememberScrollState
import androidx.compose.foundation.verticalScroll
import androidx.compose.material3.Button
import androidx.compose.material3.MaterialTheme
import androidx.compose.material3.OutlinedButton
import androidx.compose.material3.Surface
import androidx.compose.material3.Text
import androidx.compose.runtime.getValue
import androidx.compose.runtime.mutableStateOf
import androidx.compose.runtime.setValue
import androidx.compose.ui.Modifier
import androidx.compose.ui.unit.dp
import androidx.lifecycle.lifecycleScope
import java.io.File
import kotlinx.coroutines.Dispatchers
import kotlinx.coroutines.launch
import kotlinx.coroutines.withContext

class MainActivity : ComponentActivity() {

    private var logText by mutableStateOf("")
    private lateinit var workDir: File

    override fun onCreate(savedInstanceState: Bundle?) {
        super.onCreate(savedInstanceState)
        workDir = File(cacheDir, "proto").also { it.mkdirs() }
        FileLog.init(workDir)
        refreshLog()

        setContent {
            MaterialTheme {
                Surface(modifier = Modifier.fillMaxSize()) {
                    Column(
                        modifier = Modifier
                            .fillMaxSize()
                            .padding(16.dp)
                            .verticalScroll(rememberScrollState()),
                        verticalArrangement = Arrangement.spacedBy(12.dp),
                    ) {
                        Text("MuxProto — MediaMuxer torture tests")
                        Button(
                            modifier = Modifier.fillMaxWidth(),
                            onClick = { runTest("mux-av", ::testMuxAv) },
                        ) { Text("1. Mux separate A/V -> MP4") }
                        Button(
                            modifier = Modifier.fillMaxWidth(),
                            onClick = { runTest("remux-ts", ::testRemuxTs) },
                        ) { Text("2. Remux TS segments -> MP4") }
                        OutlinedButton(
                            modifier = Modifier.fillMaxWidth(),
                            onClick = { copyLog() },
                        ) { Text("Copy log") }
                        Text(logText)
                    }
                }
            }
        }
    }

    private fun runTest(name: String, block: suspend () -> Unit) {
        FileLog.line("===== $name =====")
        refreshLog()
        lifecycleScope.launch(Dispatchers.IO) {
            try {
                block()
                FileLog.line("===== $name DONE =====")
            } catch (err: Throwable) {
                FileLog.error(name, err)
            }
            withContext(Dispatchers.Main) { refreshLog() }
        }
    }

    private fun refreshLog() {
        logText = FileLog.snapshot()
    }

    private fun copyLog() {
        val cm = getSystemService(Context.CLIPBOARD_SERVICE) as ClipboardManager
        cm.setPrimaryClip(ClipData.newPlainText("muxproto", FileLog.snapshot()))
        Toast.makeText(this, "log copied", Toast.LENGTH_SHORT).show()
    }

    private fun assetToCache(name: String): String {
        val out = File(workDir, name)
        if (!out.exists()) {
            assets.open(name).use { input ->
                out.outputStream().use { input.copyTo(it) }
            }
            FileLog.line("asset $name -> ${out.length()} bytes")
        }
        return out.absolutePath
    }

    private suspend fun testMuxAv() {
        val v = assetToCache("test-v.mp4")
        val a = assetToCache("test-a.m4a")
        val out = File(workDir, "out-av.mp4").also { it.delete() }.absolutePath
        Mux.muxAv(v, a, out)
    }

    private suspend fun testRemuxTs() {
        val inputs = listOf("seg-0.ts", "seg-1.ts").map(::assetToCache)
        val out = File(workDir, "out-ts.mp4").also { it.delete() }.absolutePath
        Mux.remuxTs(inputs, out)
    }
}
