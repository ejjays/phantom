package expo.modules.silentupdater

import android.app.PendingIntent
import android.content.Context
import android.content.Intent
import android.content.pm.PackageInstaller
import android.net.Uri
import android.provider.Settings
import expo.modules.kotlin.exception.CodedException
import expo.modules.kotlin.modules.Module
import expo.modules.kotlin.modules.ModuleDefinition
import java.io.File

class SilentUpdaterModule : Module() {

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
      PendingIntent.FLAG_UPDATE_CURRENT or PendingIntent.FLAG_IMMUTABLE
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
      file.inputStream().use { input ->
        session.openWrite("phantom.apk", 0, file.length()).use { output ->
          while (true) {
            val read = input.read(buffer)
            if (read < 0) break
            output.write(buffer, 0, read)
          }
          output.fsync()
        }
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