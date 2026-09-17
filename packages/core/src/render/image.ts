/**
 * A plain 8-bit RGBA raster, so the compositing code stays free of platform types.
 *
 * The byte order is the browser's: `createImageBitmap` into an `OffscreenCanvas` and
 * `getImageData` hand back exactly this layout, so the browser codec copies nothing.
 */
export interface RgbaImage {
  readonly width: number
  readonly height: number
  readonly data: Uint8ClampedArray
}

export type Rgba = readonly [number, number, number, number]

export const WHITE: Rgba = [255, 255, 255, 255]

/** An opaque white raster — the colour a missing tile prints as. */
export function blank(width: number, height: number): RgbaImage {
  return { width, height, data: new Uint8ClampedArray(width * height * 4).fill(255) }
}

export function filled(width: number, height: number, colour: Rgba): RgbaImage {
  const data = new Uint8ClampedArray(width * height * 4)
  for (let i = 0; i < data.length; i += 4) {
    data[i] = colour[0]
    data[i + 1] = colour[1]
    data[i + 2] = colour[2]
    data[i + 3] = colour[3]
  }
  return { width, height, data }
}

export function pixelAt(image: RgbaImage, x: number, y: number): [number, number, number, number] {
  const at = (y * image.width + x) * 4
  return [image.data[at]!, image.data[at + 1]!, image.data[at + 2]!, image.data[at + 3]!]
}

/**
 * Decodes downloaded tiles and encodes finished blocks. Implemented per platform: the browser
 * with `OffscreenCanvas.convertToBlob`, Node with `@napi-rs/canvas`. Async because both are.
 */
export interface ImageCodec {
  decode(bytes: Uint8Array): Promise<RgbaImage>
  encodeJpeg(image: RgbaImage, quality: number): Promise<Uint8Array>
}
