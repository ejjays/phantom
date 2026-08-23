package expo.modules.silentupdater

import android.app.NotificationChannel
import android.app.NotificationManager
import android.content.BroadcastReceiver
import android.content.Context
import android.content.Intent
import android.content.pm.PackageInstaller
import androidx.core.app.NotificationCompat

// PackageInstaller commit verdict for the silent path; the process usually
// dies with a successful update, so the notification matters most on failure
class SilentUpdateReceiver : BroadcastReceiver() {
  override fun onReceive(context: Context, intent: Intent) {
    val status = intent.getIntExtra(PackageInstaller.EXTRA_STATUS, -1)
    val message = intent.getStringExtra(PackageInstaller.EXTRA_STATUS_MESSAGE) ?: "no details"
    val nm = context.getSystemService(NotificationManager::class.java)
    nm.createNotificationChannel(
      NotificationChannel("silent-update", "App updates", NotificationManager.IMPORTANCE_DEFAULT)
    )
    val ok = status == PackageInstaller.STATUS_SUCCESS
    nm.notify(
      0x5E1F,
      NotificationCompat.Builder(context, "silent-update")
        .setSmallIcon(android.R.drawable.stat_sys_download_done)
        .setContentTitle(if (ok) "Phantom updated" else "Phantom update failed ($status)")
        .setContentText(if (ok) "Your app is up to date." else message)
        .setAutoCancel(true)
        .build()
    )
  }
}