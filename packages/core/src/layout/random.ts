/**
 * `kotlin.random.Random`'s XorWow generator, reproduced exactly.
 *
 * The page plan is chosen by seeded randomised restarts, and a plan must be reproducible:
 * a resumed job replans and has to land on the identical tile set. Matching Kotlin bit for
 * bit additionally keeps the old implementation usable as an oracle for the port.
 *
 * Every operation is deliberately 32-bit. `| 0` and `>>>` are what keep it there.
 */
export class XorWowRandom {
  private x: number
  private y: number
  private z: number
  private w: number
  private v: number
  private addend: number

  /** `Random(seed: Long)` splits the seed into two ints; a 32-bit seed leaves the high half 0. */
  constructor(seed: number, seedHigh = 0) {
    const seed1 = seed | 0
    const seed2 = seedHigh | 0
    this.x = seed1
    this.y = seed2
    this.z = 0
    this.w = 0
    this.v = ~seed1
    this.addend = ((seed1 << 10) ^ (seed2 >>> 4)) | 0
    if ((this.x | this.y | this.z | this.w | this.v) === 0) {
      throw new Error('XorWow needs a non-zero state')
    }
    // Kotlin discards the first 64 values to wash out a weak seed.
    for (let i = 0; i < 64; i++) this.nextInt()
  }

  nextInt(until?: number): number {
    if (until === undefined) return this.rawInt()
    if (until <= 0) throw new Error(`random bound ${until} must be positive`)
    // A power of two needs no rejection: the top bits are already uniform.
    if ((until & -until) === until) return this.nextBits(31 - Math.clz32(until))
    let value: number
    let bits: number
    do {
      bits = this.rawInt() >>> 1
      value = bits % until
    } while (((bits - value + (until - 1)) | 0) < 0)
    return value
  }

  nextBoolean(): boolean {
    return this.nextBits(1) !== 0
  }

  /** Uniform in [0, 1), built from 53 bits exactly as Kotlin does. */
  nextDouble(from?: number, until?: number): number {
    const raw = (this.nextBits(26) * 2 ** 27 + this.nextBits(27)) / 2 ** 53
    if (from === undefined || until === undefined) return raw
    const value = from + raw * (until - from)
    // Kotlin clamps a rounding overshoot back below the exclusive bound.
    return value >= until ? until - Number.EPSILON * Math.abs(until) : value
  }

  private nextBits(bitCount: number): number {
    return (this.rawInt() >>> (32 - bitCount)) & (-bitCount >> 31)
  }

  private rawInt(): number {
    let t = this.x
    t ^= t >>> 2
    this.x = this.y
    this.y = this.z
    this.z = this.w
    const v0 = this.v
    this.w = v0
    t = (t ^ (t << 1) ^ v0 ^ (v0 << 4)) | 0
    this.v = t
    this.addend = (this.addend + 362437) | 0
    return (t + this.addend) | 0
  }
}
