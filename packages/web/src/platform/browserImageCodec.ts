import type { ImageCodec, RgbaImage } from '@gpx-to-ign/core'

/**
 * The browser's own codecs. JPEG encoding happens in native code rather than in JS, which
 * is the whole reason the core takes a codec rather than owning one.
 *
 * `OffscreenCanvas` exists on the main thread and in a worker, so this works in both.
 */
export class BrowserImageCodec implements ImageCodec {
  async decode(bytes: Uint8Array): Promise<RgbaImage> {
    // `slice()` detaches a plain ArrayBuffer: Blob rejects a view onto a SharedArrayBuffer.
    const bitmap = await createImageBitmap(new Blob([bytes.slice().buffer as ArrayBuffer]))
    try {
      const canvas = new OffscreenCanvas(bitmap.width, bitmap.height)
      const context = canvas.getContext('2d', { willReadFrequently: true })
      if (context === null) throw new Error('no 2d context')
      context.drawImage(bitmap, 0, 0)
      const data = context.getImageData(0, 0, bitmap.width, bitmap.height)
      return { width: data.width, height: data.height, data: data.data }
    } finally {
      bitmap.close()
    }
  }

  async encodeJpeg(image: RgbaImage, quality: number): Promise<Uint8Array> {
    const canvas = new OffscreenCanvas(image.width, image.height)
    const context = canvas.getContext('2d')
    if (context === null) throw new Error('no 2d context')
    // A copy onto a plain ArrayBuffer: since TS 5.7 a Uint8ClampedArray may sit on a
    // SharedArrayBuffer, which ImageData will not take. One block is about a megabyte.
    const data = new Uint8ClampedArray(image.data)
    context.putImageData(new ImageData(data, image.width, image.height), 0, 0)
    // convertToBlob takes quality as 0..1. Chroma subsampling is not exposed; the browser
    // uses 4:2:0 below q~90, which is why the presets sit where they do.
    const blob = await canvas.convertToBlob({ type: 'image/jpeg', quality: quality / 100 })
    return new Uint8Array(await blob.arrayBuffer())
  }
}
