package io.gpxtoign.core.render

/** A plain 32-bit ARGB raster, so the compositing code stays free of platform types. */
class ArgbImage(val width: Int, val height: Int, val pixels: IntArray) {
    init {
        require(pixels.size == width * height) { "pixel buffer does not match $width x $height" }
    }

    constructor(width: Int, height: Int, fill: Int = WHITE) :
        this(width, height, IntArray(width * height) { fill })

    operator fun get(x: Int, y: Int): Int = pixels[y * width + x]

    operator fun set(x: Int, y: Int, value: Int) {
        pixels[y * width + x] = value
    }

    companion object {
        const val WHITE = 0xFFFFFFFF.toInt()
    }
}

/** Decodes downloaded tiles and encodes finished blocks. Implemented per platform. */
interface ImageCodec {
    fun decode(bytes: ByteArray): ArgbImage
    fun encodeJpeg(image: ArgbImage, quality: Int): ByteArray
}
