package io.gpxtoign.app

import android.graphics.Bitmap
import android.graphics.BitmapFactory
import io.gpxtoign.core.render.ArgbImage
import io.gpxtoign.core.render.ImageCodec
import java.io.ByteArrayOutputStream

/** Bridges the pure-Kotlin rendering code to Android's own PNG and JPEG codecs. */
class AndroidImageCodec : ImageCodec {

    override fun decode(bytes: ByteArray): ArgbImage {
        val options = BitmapFactory.Options().apply { inPreferredConfig = Bitmap.Config.ARGB_8888 }
        val bitmap = BitmapFactory.decodeByteArray(bytes, 0, bytes.size, options)
            ?: error("unsupported image payload of ${bytes.size} bytes")
        val pixels = IntArray(bitmap.width * bitmap.height)
        bitmap.getPixels(pixels, 0, bitmap.width, 0, 0, bitmap.width, bitmap.height)
        val image = ArgbImage(bitmap.width, bitmap.height, pixels)
        bitmap.recycle()
        return image
    }

    override fun encodeJpeg(image: ArgbImage, quality: Int): ByteArray {
        val bitmap = Bitmap.createBitmap(image.pixels, image.width, image.height, Bitmap.Config.ARGB_8888)
        val out = ByteArrayOutputStream()
        bitmap.compress(Bitmap.CompressFormat.JPEG, quality, out)
        bitmap.recycle()
        return out.toByteArray()
    }
}
