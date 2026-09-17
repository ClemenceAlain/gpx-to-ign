import { describe, expect, it } from 'vitest'
import { XorWowRandom } from '../../src/layout/random.js'

/**
 * Reference values printed by `kotlin.random.Random` on the JVM. The page plan depends on
 * the seeded restarts, so a TypeScript generator that merely looks random would silently
 * produce different books from the Kotlin oracle.
 */
describe('XorWowRandom', () => {
  it('matches kotlin.random.Random(0x6A7E1E15) for nextInt', () => {
    const rng = new XorWowRandom(0x6a7e1e15)
    expect([...Array(8)].map(() => rng.nextInt())).toEqual([
      -656746167, -120865691, -1868711141, -619736199, -814663499, -1292023679, 1694341047,
      169765261,
    ])
  })

  it('matches kotlin for nextBoolean', () => {
    const rng = new XorWowRandom(0x6a7e1e15)
    expect([...Array(12)].map(() => rng.nextBoolean())).toEqual([
      true,
      true,
      true,
      true,
      true,
      true,
      false,
      false,
      false,
      true,
      false,
      true,
    ])
  })

  it('matches kotlin for nextInt(until)', () => {
    const rng = new XorWowRandom(0x6a7e1e15)
    expect([...Array(8)].map(() => rng.nextInt(300))).toEqual([264, 2, 77, 48, 98, 8, 223, 30])
  })

  it('matches kotlin for nextDouble(from, until)', () => {
    const rng = new XorWowRandom(20260917)
    const got = [...Array(6)].map(() => rng.nextDouble(0, 260))
    expect(got).toEqual([
      119.59401064828921, 158.0379632329642, 159.0516088066894, 72.92256501511152,
      176.4054954808548, 124.46275540933831,
    ])
  })

  it('is reproducible from the same seed', () => {
    const a = new XorWowRandom(1)
    const b = new XorWowRandom(1)
    expect([...Array(50)].map(() => a.nextInt())).toEqual([...Array(50)].map(() => b.nextInt()))
  })
})
