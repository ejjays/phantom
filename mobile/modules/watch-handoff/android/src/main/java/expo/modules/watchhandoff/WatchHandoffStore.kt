package expo.modules.watchhandoff

import android.content.Context
import org.json.JSONArray
import java.util.concurrent.CopyOnWriteArraySet

internal object WatchHandoffStore {
    private const val PREFS = "phantom_watch_handoff"
    private const val KEY = "pending"
    private val listeners = CopyOnWriteArraySet<(String) -> Unit>()

    private fun prefs(ctx: Context) =
        ctx.applicationContext.getSharedPreferences(PREFS, Context.MODE_PRIVATE)

    private fun encode(jobs: List<String>): String {
        val arr = JSONArray()
        jobs.forEach { arr.put(it) }
        return arr.toString()
    }

    private fun decode(raw: String?): List<String> = runCatching {
        val arr = JSONArray(raw ?: return emptyList())
        (0 until arr.length()).mapNotNull { arr.optString(it, null) }
    }.getOrDefault(emptyList())

    // Persist the job: phantom-watch can send it while Phantom is still cold
    // starting, before the JS listener (and its 1s poll) is alive. An in-memory
    // queue lost that job on process death.
    @Synchronized
    fun put(ctx: Context, job: String) {
        val p = prefs(ctx)
        val list = decode(p.getString(KEY, null)).toMutableList()
        if (!list.contains(job)) list.add(job)
        p.edit().putString(KEY, encode(list)).apply()
        listeners.forEach { listener -> runCatching { listener(job) } }
    }

    @Synchronized
    fun take(ctx: Context): String? {
        val p = prefs(ctx)
        val list = decode(p.getString(KEY, null))
        val first = list.firstOrNull() ?: return null
        p.edit().putString(KEY, encode(list.drop(1))).apply()
        return first
    }

    @Synchronized
    fun consume(ctx: Context, job: String) {
        val p = prefs(ctx)
        val list = decode(p.getString(KEY, null)).filterNot { it == job }
        p.edit().putString(KEY, encode(list)).apply()
    }

    fun addListener(listener: (String) -> Unit) {
        listeners.add(listener)
    }

    fun removeListener(listener: (String) -> Unit) {
        listeners.remove(listener)
    }
}
