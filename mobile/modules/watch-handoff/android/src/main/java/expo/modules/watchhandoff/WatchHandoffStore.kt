package expo.modules.watchhandoff

import java.util.concurrent.ConcurrentLinkedQueue
import java.util.concurrent.CopyOnWriteArraySet

internal object WatchHandoffStore {
    private val jobs = ConcurrentLinkedQueue<String>()
    private val listeners = CopyOnWriteArraySet<(String) -> Unit>()

    fun put(job: String) {
        jobs.add(job)
        listeners.forEach { listener -> runCatching { listener(job) } }
    }

    fun take(): String? = jobs.poll()

    fun consume(job: String) {
        jobs.remove(job)
    }

    fun addListener(listener: (String) -> Unit) {
        listeners.add(listener)
    }

    fun removeListener(listener: (String) -> Unit) {
        listeners.remove(listener)
    }
}
