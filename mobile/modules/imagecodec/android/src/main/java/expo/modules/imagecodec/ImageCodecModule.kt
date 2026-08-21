package expo.modules.imagecodec

import android.graphics.Bitmap
import android.graphics.BitmapFactory
import android.os.Build
import expo.modules.kotlin.modules.Module
import expo.modules.kotlin.modules.ModuleDefinition
import java.io.FileOutputStream

class ImageCodecModule : Module() {
  override fun definition() = ModuleDefinition {
    Name("ImageCodec")

    AsyncFunction("toWebp") { src: String, out: String, quality: Int, maxEdge: Int ->
      val bounds = BitmapFactory.Options().apply { inJustDecodeBounds = true }
      BitmapFactory.decodeFile(src, bounds)
      val decodeOpts = BitmapFactory.Options().apply {
        inSampleSize = sampleSize(bounds.outWidth, bounds.outHeight, maxEdge)
      }
      val decoded = BitmapFactory.decodeFile(src, decodeOpts)
        ?: return@AsyncFunction false
      val scaled = scaleDown(decoded, maxEdge)
      try {
        FileOutputStream(out).use { stream ->
          scaled.compress(webpFormat(), quality, stream)
        }
      } finally {
        if (scaled !== decoded) decoded.recycle()
        scaled.recycle()
      }
      true
    }

    AsyncFunction("toJpg") { src: String, out: String, quality: Int ->
      val bitmap = BitmapFactory.decodeFile(src) ?: return@AsyncFunction false
      try {
        FileOutputStream(out).use { stream ->
          bitmap.compress(Bitmap.CompressFormat.JPEG, quality, stream)
        }
      } finally {
        bitmap.recycle()
      }
      true
    }
  }

  // largest power-of-2 subsample that keeps longest edge >= maxEdge;
  // exact fit happens in scaleDown after a cheap decode
  private fun sampleSize(width: Int, height: Int, maxEdge: Int): Int {
    if (width <= 0 || height <= 0) return 1
    var sample = 1
    while (maxOf(width, height) / (sample * 2) >= maxEdge) sample *= 2
    return sample
  }

  private fun scaleDown(bitmap: Bitmap, maxEdge: Int): Bitmap {
    val longest = maxOf(bitmap.width, bitmap.height)
    if (longest <= maxEdge) return bitmap
    val scale = maxEdge.toFloat() / longest
    val width = (bitmap.width * scale).toInt().coerceAtLeast(1)
    val height = (bitmap.height * scale).toInt().coerceAtLeast(1)
    return Bitmap.createScaledBitmap(bitmap, width, height, true)
  }

  private fun webpFormat(): Bitmap.CompressFormat =
    if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.R) {
      Bitmap.CompressFormat.WEBP_LOSSY
    } else {
      Bitmap.CompressFormat.WEBP
    }
}
