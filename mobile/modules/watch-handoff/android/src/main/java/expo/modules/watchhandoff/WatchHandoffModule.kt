package expo.modules.watchhandoff

import android.content.ClipData
import android.content.ContentValues
import android.content.Context
import android.content.Intent
import android.net.Uri
import android.os.Build
import android.os.Environment
import android.provider.MediaStore
import expo.modules.kotlin.modules.Module
import expo.modules.kotlin.modules.ModuleDefinition

class WatchHandoffModule : Module() {
    private val context: Context
        get() = requireNotNull(appContext.reactContext) { "react context lost" }

    private val listener: (String) -> Unit = { job ->
        sendEvent("onDownloadJob", mapOf("job" to job))
    }

    override fun definition() = ModuleDefinition {
        Name("WatchHandoff")
        Events("onDownloadJob")

        OnCreate {
            WatchHandoffStore.addListener(listener)
        }

        OnDestroy {
            WatchHandoffStore.removeListener(listener)
        }

        AsyncFunction("takePendingJob") {
            WatchHandoffStore.take(context)
        }

        AsyncFunction("peekPendingJob") {
            WatchHandoffStore.peek(context)
        }

        AsyncFunction("consumeJob") { job: String ->
            WatchHandoffStore.consume(context, job)
        }

        AsyncFunction("saveTextToMovies") { fileName: String, mime: String, text: String, folder: String ->
            if (Build.VERSION.SDK_INT < Build.VERSION_CODES.Q) {
                return@AsyncFunction false
            }
            val safeName = fileName
                .replace(Regex("[^A-Za-z0-9._ -]"), "_")
                .take(180)
                .ifBlank { "subtitle.vtt" }
            val safeFolder = folder.trim().trim('/')
                .replace(Regex("[^A-Za-z0-9._-]"), "")
                .take(48)
                .takeUnless { it.isEmpty() || it.startsWith('.') }
                ?: "PhantomWatch"
            val safeMime = mime.takeIf { it.startsWith("text/") } ?: "text/vtt"
            val resolver = context.contentResolver
            val values = ContentValues().apply {
                put(MediaStore.MediaColumns.DISPLAY_NAME, safeName)
                put(MediaStore.MediaColumns.MIME_TYPE, safeMime)
                put(
                    MediaStore.MediaColumns.RELATIVE_PATH,
                    "${Environment.DIRECTORY_MOVIES}/$safeFolder"
                )
                put(MediaStore.MediaColumns.IS_PENDING, 1)
            }
            val collection = MediaStore.Files.getContentUri(MediaStore.VOLUME_EXTERNAL_PRIMARY)
            val uri = resolver.insert(collection, values)
            if (uri == null) {
                return@AsyncFunction false
            }
            try {
                val out = resolver.openOutputStream(uri)
                if (out == null) {
                    resolver.delete(uri, null, null)
                    return@AsyncFunction false
                }
                out.use { it.write(text.toByteArray(Charsets.UTF_8)) }
                values.clear()
                values.put(MediaStore.MediaColumns.IS_PENDING, 0)
                resolver.update(uri, values, null, null)
                true
            } catch (_: Exception) {
                resolver.delete(uri, null, null)
                false
            }
        }

        AsyncFunction("notifyDownloadDone") { p: Map<String, Any?> ->
            val id = p["id"] as? String ?: ""
            val title = p["title"] as? String ?: ""
            val season = (p["season"] as? Number)?.toInt() ?: -1
            val episode = (p["episode"] as? Number)?.toInt() ?: -1
            val poster = p["poster"] as? String ?: ""
            val uri = p["uri"] as? String ?: ""
            // read grant: uri permissions travel in data/ClipData, not extras; mediaStore grants not reliably persistable, phantom watch holds READ_MEDIA_VIDEO to play files
            val flags = Intent.FLAG_GRANT_READ_URI_PERMISSION or
                Intent.FLAG_GRANT_PERSISTABLE_URI_PERMISSION or
                Intent.FLAG_RECEIVER_FOREGROUND
            for (pkg in arrayOf("dev.phantomwatch", "dev.phantomwatch.debug")) {
                val intent = Intent("dev.phantomwatch.action.DOWNLOAD_DONE")
                    .setPackage(pkg)
                    .putExtra("id", id)
                    .putExtra("title", title)
                    .putExtra("season", season)
                    .putExtra("episode", episode)
                    .putExtra("poster", poster)
                    .putExtra("uri", uri)
                    .addFlags(flags)
                if (uri.startsWith("content://")) {
                    val parsed = Uri.parse(uri)
                    intent.data = parsed
                    intent.clipData = ClipData.newRawUri("download", parsed)
                }
                try {
                    context.sendBroadcast(intent)
                } catch (_: Exception) {
                    // receiver not installed, harmless
                }
            }
            Unit
        }
    }
}
