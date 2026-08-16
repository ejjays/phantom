package expo.modules.silentupdater

import android.app.PendingIntent
import android.content.ContentValues
import android.content.Context
import android.content.Intent
import android.content.pm.PackageInstaller
import android.net.Uri
import android.os.Build
import android.os.Environment
import android.provider.MediaStore
import android.provider.Settings
import androidx.core.content.FileProvider
import expo.modules.kotlin.exception.CodedException
import expo.modules.kotlin.modules.Module
import expo.modules.kotlin.modules.ModuleDefinition
import java.io.File
import java.io.InputStream
import java.io.OutputStream
import java.security.MessageDigest

class SilentUpdaterModule : Module() {

  private val context: Context
    get() = requireNotNull(appContext.reactContext) { "react context lost" }

  override fun definition() = ModuleDefinition {
    Name("SilentUpdater")

    AsyncFunction("hasInstallPermission") {
      context.packageManager.canRequestPackageInstalls()
    }

    AsyncFunction("openInstallPermissionSettings") {
      val intent = Intent(
        Settings.ACTION_MANAGE_UNKNOWN_APP_SOURCES,
        Uri.parse("package:${context.packageName}")
      ).addFlags(Intent.FLAG_ACTIVITY_NEW_TASK)
      context.startActivity(intent)
    }

    AsyncFunction("installApk") { path: String ->
      install(path)
    }

    AsyncFunction("installViaSystem") { path: String ->
      installViaSystem(path)
    }

    AsyncFunction("saveToDownloads") { sourcePath: String, name: String ->
      saveToDownloads(sourcePath, name)
    }

    AsyncFunction("hashFile") { path: String ->
      hashFile(path)
    }
  }

  // native sha-256 of the downloaded apk; js-thread hashing of ~100mb froze
  // the ui for the whole digest
  private fun hashFile(path: String): String {
    val file = File(path)
    if (!file.exists()) {
      throw CodedException("apk file missing: $path")
    }
    val digest = MessageDigest.getInstance("SHA-256")
    file.inputStream().use { input ->
      val buffer = ByteArray(1 shl 20)
      while (true) {
        val read = input.read(buffer)
        if (read < 0) break
        digest.update(buffer, 0, read)
      }
    }
    return digest.digest().joinToString("") { "%02x".format(it) }
  }

  // mediator downloads collection: the same public folder browsers use, so
  // the installer stages it without oem quirks and without any picker
  private fun saveToDownloads(sourcePath: String, name: String): String {
    if (Build.VERSION.SDK_INT < Build.VERSION_CODES.Q) {
      throw CodedException("mediastore downloads needs api 29+")
    }
    val source = File(sourcePath)
    if (!source.exists()) {
      throw CodedException("apk file missing: $sourcePath")
    }
    val values = ContentValues().apply {
      put(MediaStore.Downloads.DISPLAY_NAME, name)
      put(MediaStore.Downloads.MIME_TYPE, "application/vnd.android.package-archive")
      put(MediaStore.Downloads.RELATIVE_PATH, Environment.DIRECTORY_DOWNLOADS)
    }
    val resolver = context.contentResolver
    val uri = resolver.insert(MediaStore.Downloads.EXTERNAL_CONTENT_URI, values)
      ?: throw CodedException("mediastore insert failed")
    try {
      val output = resolver.openOutputStream(uri)
        ?: throw CodedException("mediastore open failed")
      output.use { out ->
        source.inputStream().use { input -> input.copyTo(out) }
      }
    } catch (err: Throwable) {
      resolver.delete(uri, null, null)
      if (err is CodedException) throw err
      throw CodedException("mediastore write failed: ${err.message}")
    }
    return uri.toString()
  }

  // visible installer path; the only flow oem roms never block
  private fun installViaSystem(path: String): String {
    val uri = if (path.startsWith("content://")) {
      Uri.parse(path)
    } else {
      val file = File(path)
      if (!file.exists()) {
        throw CodedException("apk file missing: $path")
      }
      FileProvider.getUriForFile(
        context,
        "${context.packageName}.updatefileprovider",
        file
      )
    }
    val intent = Intent(Intent.ACTION_VIEW).apply {
      setDataAndType(uri, "application/vnd.android.package-archive")
      addFlags(Intent.FLAG_GRANT_READ_URI_PERMISSION or Intent.FLAG_ACTIVITY_NEW_TASK)
    }
    context.startActivity(intent)
    return "started"
  }

  private fun install(path: String): String {
    val file = File(path)
    if (!file.exists()) {
      throw CodedException("apk file missing: $path")
    }
    if (!context.packageManager.canRequestPackageInstalls()) {
      throw CodedException("install permission not granted")
    }
    // result is surfaced via SilentUpdateReceiver; the confirm dialog is
    // skipped entirely when the install permission is granted
    val sender = PendingIntent.getBroadcast(
      context,
      0x5E1F,
      Intent(context, SilentUpdateReceiver::class.java),
      PendingIntent.FLAG_UPDATE_CURRENT or PendingIntent.FLAG_MUTABLE
    ).intentSender

    val params = PackageInstaller.SessionParams(
      PackageInstaller.SessionParams.MODE_FULL_INSTALL
    )
    params.setAppPackageName(context.packageName)

    val installer = context.packageManager.packageInstaller
    val sessionId = installer.createSession(params)
    val session = installer.openSession(sessionId)
    try {
      val buffer = ByteArray(DEFAULT_BUFFER_SIZE)
      val input: InputStream = file.inputStream()
      try {
        val output: OutputStream = session.openWrite("phantom.apk", 0, file.length())
        try {
          while (true) {
            val read = input.read(buffer)
            if (read < 0) break
            output.write(buffer, 0, read)
          }
        } finally {
          output.close()
        }
      } finally {
        input.close()
      }
      session.commit(sender)
    } catch (err: Throwable) {
      session.abandon()
      if (err is CodedException) throw err
      throw CodedException("install failed: ${err.message}")
    }
    return "started"
  }
}