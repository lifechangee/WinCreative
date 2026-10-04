import { describe, expect, it } from 'vitest'
import { rleDecode, rleEncode } from '../src/renderer/src/features/selectxform/rle'

describe('selection mask RLE', () => {
  it('round-trips masks with long runs and noise', () => {
    const d = new Uint8Array(5000)
    d.fill(255, 100, 900)
    for (let i = 1200; i < 1300; i++) d[i] = (i * 7) & 255
    const enc = rleEncode(d)
    expect(enc.length).toBeLessThan(d.length / 4)
    expect(Array.from(rleDecode(enc, d.length))).toEqual(Array.from(d))
  })
})
