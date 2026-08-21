package expo.modules.mediacopy

import expo.modules.kotlin.modules.Module
import expo.modules.kotlin.modules.ModuleDefinition
import java.io.RandomAccessFile

class MediaCopyModule : Module() {
  override fun definition() = ModuleDefinition {
    Name("MediaCopy")

    // ranges = flat [dstOffset, srcOffset, length] triplets; kernel-level
    // transferTo so bytes never cross the js bridge
    AsyncFunction("copyRanges") { src: String, dst: String, ranges: LongArray ->
      RandomAccessFile(src, "r").use { reader ->
        RandomAccessFile(dst, "rw").use { writer ->
          val source = reader.channel
          val target = writer.channel
          var i = 0
          while (i + 2 < ranges.size) {
            val dstOffset = ranges[i]
            val srcOffset = ranges[i + 1]
            val length = ranges[i + 2]
            var done = 0L
            while (done < length) {
              target.position(dstOffset + done)
              val moved = source.transferTo(srcOffset + done, length - done, target)
              if (moved <= 0) throw IllegalStateException("short transfer at $srcOffset")
              done += moved
            }
            i += 3
          }
        }
      }
      true
    }
  }
}
