package expo.modules.vpndetector

import android.content.Context
import android.net.ConnectivityManager
import android.net.NetworkCapabilities
import expo.modules.kotlin.modules.Module
import expo.modules.kotlin.modules.ModuleDefinition

class VpnDetectorModule : Module() {

  private val context: Context
    get() = requireNotNull(appContext.reactContext) { "react context lost" }

  override fun definition() = ModuleDefinition {
    Name("VpnDetector")

    AsyncFunction("isVpnActive") {
      val cm = context.getSystemService(Context.CONNECTIVITY_SERVICE) as ConnectivityManager
      val active = cm.activeNetwork ?: return@AsyncFunction false
      val caps = cm.getNetworkCapabilities(active) ?: return@AsyncFunction false
      caps.hasTransport(NetworkCapabilities.TRANSPORT_VPN)
    }
  }
}