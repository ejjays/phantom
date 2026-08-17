package expo.modules.nativedownloader

import android.content.Context
import expo.modules.kotlin.exception.CodedException
import expo.modules.kotlin.modules.Module
import expo.modules.kotlin.modules.ModuleDefinition
import java.io.File
import java.io.FileOutputStream
import java.io.IOException
import okhttp3.Call
import okhttp3.Callback
import okhttp3.OkHttpClient
import okhttp3.Request
import okhttp3.Response

/** download job terminal states */
enum class MediaDownloadState {
  done,
  failed,
  cancelled,
}

class MediaDownloaderModule : Module() {

  private val context: Context
    get() = requireNotNull(appContext.reactContext) { "react context lost" }

  private val client: OkHttpClient by lazy {
    OkHttpClient.Builder().build()
  }

  private class JobState(
    var call: Call?,
    var bytes: Long = 0,
    var finalSize: Long = 0,
    var lastEmitAt: Long = 0
  )

  private val jobs = mutableMapOf<String, JobState>()

  override fun definition() = ModuleDefinition {
    Name("MediaDownloader")

    Events("onDownloadProgress", "onDownloadDone")

    AsyncFunction("startDownload") { jobId: String, url: String, destPath: String, headers: Map<String, String>, resumeBytes: Long ->
      // previous run of the same job dies before this one starts
      jobs.remove(jobId)?.call?.cancel()
      val job = JobState(call = null)
      jobs[jobId] = job
      try {
        start(jobId, job, url, destPath, headers, resumeBytes)
      } catch (err: Throwable) {
        fail(jobId, job, err.message ?: "download start failed")
      }
    }

    AsyncFunction("cancelDownload") { jobId: String ->
      jobs.remove(jobId)?.call?.cancel()
    }

    AsyncFunction("cancelAll") {
      jobs.values.forEach { it.call?.cancel() }
      jobs.clear()
    }
  }

  private fun start(
    jobId: String,
    job: JobState,
    url: String,
    destPath: String,
    headers: Map<String, String>,
    resumeBytes: Long
  ) {
    val dest = File(destPath)
    dest.parentFile?.let { parent ->
      if (!parent.exists() && !parent.mkdirs()) {
        throw CodedException("cannot create download dir: $parent")
      }
    }

    // only map host headers through; anything else (e.g. synthetic auth
    // headers the extractors never set) is not trusted
    val allowed = setOf("user-agent", "referer", "cookie", "range")
    val builder = Request.Builder().url(url)
    headers.forEach { (name, value) ->
      if (allowed.contains(name.lowercase())) builder.header(name, value)
    }
    builder.header("Range", if (resumeBytes > 0) "bytes=$resumeBytes-" else "bytes=0-")

    // single streaming connection; one round trip, no per-chunk js hop
    val call = client.newCall(builder.build())
    job.call = call

    call.enqueue(object : Callback {
      override fun onFailure(call: Call, e: IOException) {
        // cancel() is the only reason a failed call should look finished;
        // anything else is a network error and must fail the job
        if (call.isCanceled()) {
          finish(jobId, job, cancelled = true)
        } else {
          fail(jobId, job, e.message ?: "network error")
        }
      }

      override fun onResponse(call: Call, response: Response) {
        response.use { resp ->
          if (!resp.isSuccessful) {
            fail(jobId, job, "download HTTP ${resp.code}", resp.code)
            return
          }
          try {
            // server ignored the range (200) or range is stale (416):
            // restart from scratch so the prefix never corrupts the file
            var resume = resumeBytes
            if (resume > 0 && (resp.code == 200 || resp.code == 416)) {
              dest.delete()
              resume = 0
            }
            val added = resp.body?.contentLength() ?: -1
            // total is known even when the server omits content-length
            job.finalSize = if (added >= 0) {
              if (resume > 0) resume + added else added
            } else {
              -1
            }
            emitProgress(jobId, job)
            // okio 3 (bundled with okhttp) removed File.sink()/appendSink();
            // plain java streams keep the same 64kb contiguous writes
            val sink = FileOutputStream(dest, resume > 0)
            val src = resp.body?.byteStream() ?: throw IOException("empty body")
            sink.use { out ->
              src.use { input ->
                val buf = ByteArray(64 * 1024)
                // 64kb direct writes: in-order contiguity resume relies on
                while (true) {
                  val read = input.read(buf)
                  if (read == -1) break
                  out.write(buf, 0, read)
                  job.bytes += read
                  val now = System.currentTimeMillis()
                  if (now - job.lastEmitAt >= 40) {
                    job.lastEmitAt = now
                    emitProgress(jobId, job)
                  }
                }
              }
            }
            finish(jobId, job, call.isCanceled())
          } catch (err: Throwable) {
            fail(jobId, job, err.message ?: "download failed")
          }
        }
      }
    })
  }

  // terminal states race cancel vs completion; whoever removes the job
  // from the map first reports it
  private fun finish(jobId: String, job: JobState, cancelled: Boolean) {
    val removed = jobs.remove(jobId)
    if (removed == null || removed !== job) return
    sendEvent(
      "onDownloadDone",
      mapOf(
        "jobId" to jobId,
        "state" to if (cancelled) MediaDownloadState.cancelled.name else MediaDownloadState.done.name,
        "bytes" to job.bytes,
        "total" to job.finalSize
      )
    )
  }

  // fields must match what src/MediaDownloader.ts reads (error, httpCode)
  private fun fail(jobId: String, job: JobState, message: String, httpCode: Int = 0) {
    val removed = jobs.remove(jobId)
    if (removed == null || removed !== job) return
    sendEvent(
      "onDownloadDone",
      mapOf(
        "jobId" to jobId,
        "state" to MediaDownloadState.failed.name,
        "bytes" to job.bytes,
        "total" to job.finalSize,
        "error" to message,
        "httpCode" to httpCode
      )
    )
  }

  private fun emitProgress(jobId: String, job: JobState) {
    sendEvent(
      "onDownloadProgress",
      mapOf(
        "jobId" to jobId,
        "bytes" to job.bytes,
        "total" to job.finalSize
      )
    )
  }
}