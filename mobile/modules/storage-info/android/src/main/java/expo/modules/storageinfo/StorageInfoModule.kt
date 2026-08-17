package expo.modules.storageinfo

import android.content.Context
import android.os.Environment
import android.os.StatFs
import expo.modules.kotlin.modules.Module
import expo.modules.kotlin.modules.ModuleDefinition
import java.io.File

class StorageInfoModule : Module() {

  private val context: Context
    get() = requireNotNull(appContext.reactContext) { "react context lost" }

  override fun definition() = ModuleDefinition {
    Name("StorageInfo")

    AsyncFunction("internalFreeBytes") {
      stat(Environment.getDataDirectory()).freeBytes
    }

    AsyncFunction("internalTotalBytes") {
      stat(Environment.getDataDirectory()).totalBytes
    }

    // every mounted volume the app can see (sdcard, usb-otg, etc.)
    AsyncFunction("allVolumes") {
      val dirs = mutableListOf<File>()
      dirs.add(Environment.getDataDirectory())
      dirs.add(Environment.getExternalStorageDirectory())
      for (file in context.getExternalFilesDirs(null)) {
        if (file != null) dirs.add(file)
      }
      // dedupe identical paths (emulated primary is often listed twice)
      val out = mutableListOf<Map<String, Long>>()
      val seen = mutableSetOf<String>()
      for (dir in dirs) {
        val abs = dir.absolutePath
        if (!seen.add(abs)) continue
        val s = stat(dir)
        out.add(
          mapOf(
            "path" to abs,
            "free" to s.freeBytes,
            "total" to s.totalBytes
          )
        )
      }
      out
    }
  }

  private fun stat(dir: File): StatFs =
    try {
      StatFs(dir.absolutePath)
    } catch (err: Throwable) {
      throw RuntimeException("StatFs failed for ${dir.absolutePath}: ${err.message}")
    }
}