import { describe, expect, it } from 'vitest'
import { blobSum } from '../src/renderer/src/core/blobSum'

describe('blobSum (tile blob checksum)', () => {
  const blob = (n: number, seed = 1): Uint8Array => {
    const a = new Uint8Array(n)
    let s = seed
    for (let i = 0; i < n; i++) a[i] = (s = (Math.imul(s, 1664525) + 1013904223) >>> 0) >>> 24
    return a
  }
  it('is deterministic and independent of the view offset', () => {
    const a = blob(1000)
    const big = new Uint8Array(1011)
    big.set(a, 7)
    expect(blobSum(a)).toBe(blobSum(a.slice()))
    expect(blobSum(big.subarray(7, 1007))).toBe(blobSum(a))
  })
  it('detects any single flipped bit, including in the 1-3 byte tail', () => {
    for (const n of [1, 3, 4, 5, 1021, 4096]) {
      const a = blob(n, n)
      const ref = blobSum(a)
      for (let i = 0; i < n; i += Math.max(1, n >> 5)) {
        for (const bit of [0, 3, 7]) {
          a[i] ^= 1 << bit
          expect(blobSum(a)).not.toBe(ref)
          a[i] ^= 1 << bit
        }
      }
      expect(blobSum(a)).toBe(ref)
    }
  })
  it('depends on the length and on byte order', () => {
    expect(blobSum(new Uint8Array(8))).not.toBe(blobSum(new Uint8Array(9)))
    expect(blobSum(Uint8Array.of(1, 2, 3, 4))).not.toBe(blobSum(Uint8Array.of(4, 3, 2, 1)))
  })
  it('returns an unsigned 32-bit value', () => {
    for (let i = 0; i < 50; i++) {
      const v = blobSum(blob(37 + i, i + 1))
      expect(Number.isInteger(v) && v >= 0 && v <= 0xffffffff).toBe(true)
    }
  })
})
