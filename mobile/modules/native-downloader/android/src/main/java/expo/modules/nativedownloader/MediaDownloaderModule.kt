package expo.modules.nativedownloader

import android.content.Context
import expo.modules.kotlin.exception.CodedException
import expo.modules.kotlin.modules.Module
import expo.modules.kotlin.modules.ModuleDefinition
import java.io.File
import java.io.IOException
import java.io.RandomAccessFile
import java.net.InetAddress
import java.net.InetSocketAddress
import java.net.Socket
import java.util.concurrent.TimeUnit
import java.util.concurrent.atomic.AtomicBoolean
import java.util.concurrent.atomic.AtomicInteger
import java.util.concurrent.atomic.AtomicLong
import javax.net.SocketFactory
import okhttp3.Call
import okhttp3.Callback
import okhttp3.ConnectionPool
import okhttp3.OkHttpClient
import okhttp3.Request
import okhttp3.Response
import okhttp3.ResponseBody

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
    // 1MB recv buffer: default sockets capped single-stream ~1.2MB/s vs
    // curl's 2.6; bigger buffers + pooled conns close that gap
    OkHttpClient.Builder()
      .connectTimeout(30, TimeUnit.SECONDS)
      .readTimeout(60, TimeUnit.SECONDS)
      .writeTimeout(60, TimeUnit.SECONDS)
      .connectionPool(ConnectionPool(16, 5, TimeUnit.MINUTES))
      .socketFactory(tunedSockets)
      .retryOnConnectionFailure(true)
      .build()
  }

  // buffer size must be set before connect() for the kernel to honor it
  private val tunedSockets = object : SocketFactory() {
    override fun createSocket(): Socket = Socket().apply {
      receiveBufferSize = 1024 * 1024
      sendBufferSize = 256 * 1024
      tcpNoDelay = true
    }

    override fun createSocket(host: String, port: Int): Socket =
      createSocket().apply { connect(InetSocketAddress(host, port)) }

    override fun createSocket(host: String, port: Int, localHost: InetAddress, localPort: Int): Socket =
      createSocket().apply {
        bind(InetSocketAddress(localHost, localPort))
        connect(InetSocketAddress(host, port))
      }

    override fun createSocket(host: InetAddress, port: Int): Socket =
      createSocket().apply { connect(InetSocketAddress(host, port)) }

    override fun createSocket(host: InetAddress, port: Int, localHost: InetAddress, localPort: Int): Socket =
      createSocket().apply {
        bind(InetSocketAddress(localHost, localPort))
        connect(InetSocketAddress(host, port))
      }
  }

  private class JobState(
    var calls: MutableList<Call> = mutableListOf(),
    var bytes: AtomicLong = AtomicLong(0),
    var finalSize: Long = 0,
    var lastEmitAt: Long = 0
  )

  private val jobs = mutableMapOf<String, JobState>()

  override fun definition() = ModuleDefinition {
    Name("MediaDownloader")

    Events("onDownloadProgress", "onDownloadDone")

    AsyncFunction("startDownload") { jobId: String, url: String, destPath: String, headers: Map<String, String>, resumeBytes: Long, parallel: Int ->
      // previous run of the same job dies before this one starts
      jobs.remove(jobId)?.calls?.forEach { it.cancel() }
      val job = JobState()
      jobs[jobId] = job
      try {
        start(jobId, job, url, destPath, headers, resumeBytes, parallel)
      } catch (err: Throwable) {
        fail(jobId, job, err.message ?: "download start failed")
      }
    }

    AsyncFunction("cancelDownload") { jobId: String ->
      jobs.remove(jobId)?.calls?.forEach { it.cancel() }
    }

    AsyncFunction("cancelAll") {
      jobs.values.forEach { job -> job.calls.forEach { it.cancel() } }
      jobs.clear()
    }
  }

  private fun start(
    jobId: String,
    job: JobState,
    url: String,
    destPath: String,
    headers: Map<String, String>,
    resumeBytes: Long,
    parallel: Int
  ) {
    val dest = File(destPath)
    dest.parentFile?.let { parent ->
      if (!parent.exists() && !parent.mkdirs()) {
        throw CodedException("cannot create download dir: $parent")
      }
    }

    // only map host headers through; anything else is not trusted
    val allowed = setOf("user-agent", "accept", "referer", "cookie", "origin", "range")
    val baseBuilder = Request.Builder().url(url)
    headers.forEach { (name, value) ->
      if (allowed.contains(name.lowercase())) baseBuilder.header(name, value)
    }

    // probe size with a 1-byte range: googlevideo throttles range-less
    // full GETs to playback speed, so parallel regions are the primary
    // path and a plain stream only runs when the server refuses ranges
    val probeCall = client.newCall(baseBuilder.newBuilder().header("Range", "bytes=0-0").build())
    job.calls.add(probeCall)
    probeCall.enqueue(object : Callback {
      override fun onFailure(call: Call, e: IOException) {
        if (call.isCanceled()) return
        fail(jobId, job, e.message ?: "network error")
      }

      override fun onResponse(call: Call, response: Response) {
        response.use { resp ->
          if (!resp.isSuccessful) {
            fail(jobId, job, "download HTTP ${resp.code}", resp.code)
            return
          }
          val length = parseContentLength(resp.headers["Content-Range"])
          val n = if (parallel > 1) parallel.coerceIn(2, 8) else 1
          if (length <= 0 || n <= 1 || length - resumeBytes < n * 256 * 1024) {
            singleStream(jobId, job, baseBuilder, dest, resumeBytes)
            return
          }
          parallelRegions(jobId, job, baseBuilder, dest, length, resumeBytes, n)
        }
      }
    })
  }

  private fun parallelRegions(
    jobId: String,
    job: JobState,
    baseBuilder: Request.Builder,
    dest: File,
    length: Long,
    resumeBytes: Long,
    n: Int
  ) {
    // resume: keep the on-disk prefix, region-split only the remaining bytes
    val step = (length - resumeBytes) / n
    if (resumeBytes == 0L) dest.delete()
    RandomAccessFile(dest.path, "rw").use { it.setLength(length) }
    job.finalSize = length

    val pending = AtomicInteger(n)
    val done = AtomicBoolean(false)
    for (i in 0 until n) {
      val start = resumeBytes + i * step
      val end = if (i == n - 1) length - 1 else start + step - 1
      val regionCall = client.newCall(
        baseBuilder.newBuilder().header("Range", "bytes=$start-$end").build()
      )
      job.calls.add(regionCall)
      regionCall.enqueue(object : Callback {
        override fun onFailure(call: Call, e: IOException) {
          if (call.isCanceled()) return
          if (done.compareAndSet(false, true)) {
            fail(jobId, job, e.message ?: "network error")
          }
        }

        override fun onResponse(call: Call, response: Response) {
          response.use { resp ->
            // 200 means the cdn ignored the range: the whole body would
            // land at this region's offset and corrupt the file
            if (resp.code != 206) {
              if (done.compareAndSet(false, true)) {
                fail(jobId, job, "cdn ignored range ${resp.code}", resp.code)
              }
              return
            }
            try {
              val body: ResponseBody = resp.body ?: throw IOException("empty body")
              writeRegion(dest.path, start, body, job, jobId)
            } catch (err: Throwable) {
              if (done.compareAndSet(false, true)) {
                fail(jobId, job, err.message ?: "download failed")
              }
              return
            }
            if (pending.decrementAndGet() == 0 && done.compareAndSet(false, true)) {
              finish(jobId, job, cancelled = false)
            }
          }
        }
      })
    }
  }

  private fun singleStream(
    jobId: String,
    job: JobState,
    baseBuilder: Request.Builder,
    dest: File,
    resumeBytes: Long
  ) {
    val builder = baseBuilder.newBuilder()
    if (resumeBytes > 0) builder.header("Range", "bytes=$resumeBytes-")
    val call = client.newCall(builder.build())
    job.calls.add(call)
    call.enqueue(object : Callback {
      override fun onFailure(call: Call, e: IOException) {
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
            job.finalSize = if (added >= 0) {
              if (resume > 0) resume + added else added
            } else {
              -1
            }
            emitProgress(jobId, job)
            val sink = java.io.FileOutputStream(dest, resume > 0)
            val src = resp.body?.byteStream() ?: throw IOException("empty body")
            sink.use { out ->
              src.use { input ->
                val buf = ByteArray(256 * 1024)
                while (true) {
                  val read = input.read(buf)
                  if (read == -1) break
                  out.write(buf, 0, read)
                  job.bytes.addAndGet(read.toLong())
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

  private fun writeRegion(destPath: String, start: Long, body: ResponseBody, job: JobState, jobId: String) {
    RandomAccessFile(destPath, "rw").use { raf ->
      raf.seek(start)
      val buf = ByteArray(256 * 1024)
      body.byteStream().use { input ->
        while (true) {
          val read = input.read(buf)
          if (read == -1) break
          raf.write(buf, 0, read)
          job.bytes.addAndGet(read.toLong())
          val now = System.currentTimeMillis()
          if (now - job.lastEmitAt >= 40) {
            job.lastEmitAt = now
            emitProgress(jobId, job)
          }
        }
      }
    }
  }

  private fun parseContentLength(contentRange: String?): Long {
    if (contentRange == null) return 0
    val slash = contentRange.lastIndexOf('/')
    if (slash >= 0) {
      return contentRange.substring(slash + 1).toLongOrNull() ?: 0
    }
    return 0
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
        "bytes" to job.bytes.get(),
        "total" to job.finalSize
      )
    )
  }

  // fields must match what src/MediaDownloader.ts reads (error, httpCode)
  private fun fail(jobId: String, job: JobState, message: String, httpCode: Int = 0) {
    val removed = jobs.remove(jobId)
    if (removed == null || removed !== job) return
    job.calls.forEach { it.cancel() }
    sendEvent(
      "onDownloadDone",
      mapOf(
        "jobId" to jobId,
        "state" to MediaDownloadState.failed.name,
        "bytes" to job.bytes.get(),
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
        "bytes" to job.bytes.get(),
        "total" to job.finalSize
      )
    )
  }
}