package com.phantom.muxproto

import android.content.ClipData
import android.content.ClipboardManager
import android.content.Context
import android.os.Bundle
import android.widget.MediaController
import android.widget.Toast
import android.widget.VideoView
import androidx.activity.ComponentActivity
import androidx.activity.compose.setContent
import androidx.compose.foundation.layout.Arrangement
import androidx.compose.foundation.layout.Column
import androidx.compose.foundation.layout.aspectRatio
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
import androidx.compose.ui.viewinterop.AndroidView
import androidx.lifecycle.lifecycleScope
import java.io.File
import kotlinx.coroutines.Dispatchers
import kotlinx.coroutines.launch
import kotlinx.coroutines.withContext

class MainActivity : ComponentActivity() {

    private var logText by mutableStateOf("")
    private var playPath by mutableStateOf<String?>(null)
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
                        Text("MuxProto — mux torture tests")
                        Button(
                            modifier = Modifier.fillMaxWidth(),
                            onClick = { runAll() },
                        ) { Text("Run all tests") }
                        OutlinedButton(
                            modifier = Modifier.fillMaxWidth(),
                            onClick = { copyLog() },
                        ) { Text("Copy log") }
                        playPath?.let { path ->
                            AndroidView(
                                factory = { ctx ->
                                    VideoView(ctx).apply {
                                        setVideoPath(path)
                                        setMediaController(
                                            MediaController(ctx).also { it.setAnchorView(this) },
                                        )
                                        setOnPreparedListener { start() }
                                    }
                                },
                                update = { view ->
                                    if (view.tag != path) {
                                        view.tag = path
                                        view.setVideoPath(path)
                                        view.start()
                                    }
                                },
                                modifier = Modifier
                                    .fillMaxWidth()
                                    .aspectRatio(16f / 9f),
                            )
                        }
                        Text(logText)
                    }
                }
            }
        }
    }

    private fun runAll() {
        FileLog.line("===== all tests =====")
        refreshLog()
        lifecycleScope.launch(Dispatchers.IO) {
            var play: String? = null
            try {
                val av = testMuxAv()
                testRemuxTs()
                play = testKiteRemux(av)
                play = testCloneVp9() ?: play
                play = testWebmVp9() ?: play
                FileLog.line("===== all tests DONE =====")
            } catch (err: Throwable) {
                FileLog.error("all", err)
            }
            val done = play
            withContext(Dispatchers.Main) {
                playPath = done
                refreshLog()
            }
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

    private suspend fun testMuxAv(): String {
        val v = assetToCache("short-v.mp4")
        val a = assetToCache("short-a.m4a")
        val out = File(workDir, "out-av.mp4").also { it.delete() }.absolutePath
        Mux.muxAv(v, a, out)
        return out
    }

    private suspend fun testRemuxTs() {
        val inputs = listOf("seg-0.ts", "seg-1.ts").map(::assetToCache)
        val out = File(workDir, "out-ts.mp4").also { it.delete() }.absolutePath
        Mux.remuxTs(inputs, out)
    }

    private suspend fun testKiteRemux(avPath: String): String {
        val out = File(workDir, "out-kite.mp4").also { it.delete() }.absolutePath
        FileLog.line("kite remux $avPath -> $out")
        io.github.yuroyami.kiteffmpeg.Remuxer.remux(input = avPath, output = out)
        FileLog.line("kite done (${File(out).length()} bytes)")
        verifyOutput(out)
        return out
    }

    private suspend fun testCloneVp9(): String {
        val src = assetToCache("vp9frag-av.mp4")
        val out = File(workDir, "out-vp9clone.mp4").also { it.delete() }.absolutePath
        FileLog.line("clone vp9 $src -> $out")
        CloneRemux.remuxFragmented(src, out)
        verifyOutput(out)
        return out
    }

    private suspend fun testWebmVp9(): String? {
        return try {
            val v = assetToCache("u4k-v.webm")
            val a = assetToCache("u4k-a.webm")
            val out = File(workDir, "out-webm.mp4").also { it.delete() }.absolutePath
            FileLog.line("webm vp9+opus -> $out")
            WebmRemux.remuxWebm(v, a, out)
            verifyOutput(out)
            out
        } catch (err: Throwable) {
            FileLog.error("webm", err)
            null
        }
    }
}
