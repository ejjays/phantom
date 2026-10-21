package expo.modules.watchhandoff

import android.app.Activity
import android.content.Intent
import android.os.Bundle

class WatchDownloadActivity : Activity() {
    override fun onCreate(savedInstanceState: Bundle?) {
        super.onCreate(savedInstanceState)
        val incoming = intent
        if (incoming?.action != "com.phantom.app.action.DOWNLOAD_JOB") {
            finish()
            return
        }
        val job = incoming.getStringExtra("job")
        if (job.isNullOrBlank() || job.length > 262_144) {
            finish()
            return
        }
        WatchHandoffStore.put(job)

        val launch = packageManager.getLaunchIntentForPackage(packageName)?.apply {
            addFlags(
                Intent.FLAG_ACTIVITY_NEW_TASK or
                    Intent.FLAG_ACTIVITY_CLEAR_TOP or
                    Intent.FLAG_ACTIVITY_SINGLE_TOP
            )
        }
        if (launch != null) {
            try {
                startActivity(launch)
            } catch (_: Exception) {
                // job stays queued for the next launch
            }
        }
        finish()
    }
}
