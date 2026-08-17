package expo.modules.wakelock

import android.content.Context
import android.net.wifi.WifiManager
import android.os.PowerManager
import expo.modules.kotlin.modules.Module
import expo.modules.kotlin.modules.ModuleDefinition

class WakeLockModule : Module() {

  private val context: Context
    get() = requireNotNull(appContext.reactContext) { "react context lost" }

  private var cpuLock: PowerManager.WakeLock? = null
  private var wifiLock: WifiManager.WifiLock? = null

  override fun definition() = ModuleDefinition {
    Name("WakeLock")

    AsyncFunction("acquireCpuLock") { tag: String ->
      if (cpuLock == null) {
        val pm = context.getSystemService(Context.POWER_SERVICE) as PowerManager
        cpuLock = pm.newWakeLock(PowerManager.PARTIAL_WAKE_LOCK, tag).apply {
          setReferenceCounted(false)
          acquire()
        }
      }
    }

    AsyncFunction("releaseCpuLock") {
      cpuLock?.takeIf { it.isHeld }?.release()
      cpuLock = null
    }

    AsyncFunction("acquireWifiLock") { tag: String ->
      if (wifiLock == null) {
        val wm =
          context.applicationContext.getSystemService(Context.WIFI_SERVICE) as WifiManager
        wifiLock = wm.createWifiLock(WifiManager.WIFI_MODE_FULL_HIGH_PERF, tag).apply {
          setReferenceCounted(false)
          acquire()
        }
      }
    }

    AsyncFunction("releaseWifiLock") {
      wifiLock?.takeIf { it.isHeld }?.release()
      wifiLock = null
    }

    AsyncFunction("lockState") {
      mapOf("cpu" to (cpuLock?.isHeld == true), "wifi" to (wifiLock?.isHeld == true))
    }

    // never leak a lock if the JS context dies mid-download
    OnDestroy {
      cpuLock?.takeIf { it.isHeld }?.release()
      wifiLock?.takeIf { it.isHeld }?.release()
    }
  }
}