package io.gpxtoign.cli

import io.gpxtoign.core.render.ArgbImage
import io.gpxtoign.core.render.ImageCodec
import java.awt.image.BufferedImage
import java.io.ByteArrayInputStream
import java.io.ByteArrayOutputStream
import javax.imageio.IIOImage
import javax.imageio.ImageIO
import javax.imageio.ImageWriteParam

/** Desktop codec, so the whole pipeline can be exercised without a phone. */
class AwtImageCodec : ImageCodec {

    override fun decode(bytes: ByteArray): ArgbImage {
        val image = ImageIO.read(ByteArrayInputStream(bytes))
            ?: error("unsupported image payload of ${bytes.size} bytes")
        val pixels = IntArray(image.width * image.height)
        image.getRGB(0, 0, image.width, image.height, pixels, 0, image.width)
        return ArgbImage(image.width, image.height, pixels)
    }

    override fun encodeJpeg(image: ArgbImage, quality: Int): ByteArray {
        val buffered = BufferedImage(image.width, image.height, BufferedImage.TYPE_INT_RGB)
        buffered.setRGB(0, 0, image.width, image.height, image.pixels, 0, image.width)
        val writer = ImageIO.getImageWritersByFormatName("jpeg").next()
        val out = ByteArrayOutputStream()
        ImageIO.createImageOutputStream(out).use { stream ->
            writer.output = stream
            val params = writer.defaultWriteParam.apply {
                compressionMode = ImageWriteParam.MODE_EXPLICIT
                compressionQuality = quality / 100f
            }
            writer.write(null, IIOImage(buffered, null, null), params)
        }
        writer.dispose()
        return out.toByteArray()
    }
}
