package expo.modules.framegrab

import android.graphics.Bitmap
import android.media.MediaMetadataRetriever
import expo.modules.kotlin.modules.Module
import expo.modules.kotlin.modules.ModuleDefinition
import java.io.FileOutputStream

class FrameGrabModule : Module() {
  override fun definition() = ModuleDefinition {
    Name("FrameGrab")

    AsyncFunction("extract") { src: String, out: String, seekMs: Long ->
      val retriever = MediaMetadataRetriever()
      try {
        retriever.setDataSource(src)
        val frame = retriever.getFrameAtTime(
          seekMs * 1000,
          MediaMetadataRetriever.OPTION_CLOSEST_SYNC
        ) ?: return@AsyncFunction false
        FileOutputStream(out).use { stream ->
          frame.compress(Bitmap.CompressFormat.JPEG, JPEG_QUALITY, stream)
        }
        true
      } finally {
        retriever.release()
      }
    }
  }

  private companion object {
    const val JPEG_QUALITY = 90
  }
}
