import { createCanvas, loadImage } from '@napi-rs/canvas'
import type { ImageCodec, RgbaImage } from '@gpx-to-ign/core'

/**
 * The same canvas API the browser seam uses, backed by Skia.
 *
 * `@napi-rs/canvas` ships prebuilt binaries, so installing the CLI never compiles anything.
 * Unlike the browser's `convertToBlob`, this encoder does not force chroma subsampling, so
 * CLI output is slightly larger and slightly sharper than the web app's.
 */
export class NodeImageCodec implements ImageCodec {
  async decode(bytes: Uint8Array): Promise<RgbaImage> {
    const image = await loadImage(Buffer.from(bytes))
    const canvas = createCanvas(image.width, image.height)
    const context = canvas.getContext('2d')
    context.drawImage(image, 0, 0)
    const data = context.getImageData(0, 0, image.width, image.height)
    return {
      width: data.width,
      height: data.height,
      data: new Uint8ClampedArray(data.data.buffer, data.data.byteOffset, data.data.length),
    }
  }

  async encodeJpeg(image: RgbaImage, quality: number): Promise<Uint8Array> {
    const canvas = createCanvas(image.width, image.height)
    const context = canvas.getContext('2d')
    const target = context.createImageData(image.width, image.height)
    target.data.set(image.data)
    context.putImageData(target, 0, 0)
    return new Uint8Array(canvas.toBuffer('image/jpeg', quality))
  }
}
