package expo.modules.silentupdater

import android.content.BroadcastReceiver
import android.content.Context
import android.content.Intent

// PackageInstaller commit result; the app process usually dies with the
// update as the install replaces it, so nothing actionable arrives here
class SilentUpdateReceiver : BroadcastReceiver() {
  override fun onReceive(context: Context, intent: Intent) = Unit
}