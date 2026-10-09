import { describe, expect, it } from 'vitest'
import { zipSync } from 'fflate'
import { bytesToEvict, deriveBudget, pickVictims, priorityOf } from '../src/renderer/src/doc/tileBudget'
import { decodePng, premultiplyInPlace, unpremultiply } from '../src/renderer/src/io/pngDecode'
import { PngStream } from '../src/renderer/src/io/pngStream'
import { indexZip, readEntry } from '../src/renderer/src/io/zipIndex'
import { parseInfiniteMeta } from '../src/renderer/src/io/bwkInfinite'

const MB = 1048576

describe('tile budget math', () => {
  it('derives device budgets within the documented clamps', () => {
    const big = deriveBudget({ deviceMemoryGB: 8 })
    expect(big.gpu).toBeGreaterThanOrEqual(384 * MB)
    expect(big.gpu).toBeLessThanOrEqual(1280 * MB)
    expect(deriveBudget({ deviceMemoryGB: 2 }).gpu).toBe(384 * MB)
    expect(deriveBudget({ deviceMemoryGB: 8, maxTexture: 4096 }).gpu).toBeLessThanOrEqual(512 * MB)
    expect(deriveBudget({}).gpu).toBeGreaterThan(0)
  })
  it('Prefs override wins and 0 means automatic', () => {
    expect(deriveBudget({ deviceMemoryGB: 8 }, { gpuMB: 100, cpuMB: 50 })).toEqual({ gpu: 100 * MB, cpu: 50 * MB })
    expect(deriveBudget({ deviceMemoryGB: 8 }, { gpuMB: 0 }).gpu).toBe(deriveBudget({ deviceMemoryGB: 8 }).gpu)
  })
  it('evicts only above budget, down to 90 %', () => {
    expect(bytesToEvict(90, 100)).toBe(0)
    expect(bytesToEvict(100, 100)).toBe(0)
    expect(bytesToEvict(120, 100)).toBe(30)
  })
})

describe('LRU victim selection', () => {
  const c = (id: number, stamp: number, bytes = 10): { id: number; stamp: number; bytes: number } => ({ id, stamp, bytes })
  it('takes the oldest first and never touches pinned (recent) tiles', () => {
    const v = pickVictims([c(1, 50), c(2, 10), c(3, 30), c(4, 99), c(5, 98)], 25, 90)
    expect(v.map((x) => x.id)).toEqual([2, 3, 1])
  })
  it('returns nothing when no space is needed or everything is pinned', () => {
    expect(pickVictims([c(1, 1)], 0, 100)).toEqual([])
    expect(pickVictims([c(1, 95), c(2, 96)], 100, 90)).toEqual([])
  })
  it('old undo snapshots (biased stamps) go before equally old tiles', () => {
    const v = pickVictims([c(1, 100), c(2, 100 - 600)], 10, 1000)
    expect(v[0].id).toBe(2)
  })
  it('restore priority is distance from the view centre', () => {
    expect(priorityOf(0, 0, 0, 0)).toBe(0)
    expect(priorityOf(3, 4, 0, 0)).toBe(5)
  })
})

describe('PNG blobs of evicted tiles', () => {
  const tile = (w: number, h: number): Uint8Array => {
    const p = new Uint8Array(w * h * 4)
    for (let i = 0; i < w * h; i++) {
      p[i * 4] = (i * 7) & 255
      p[i * 4 + 1] = (i >> 3) & 255
      p[i * 4 + 2] = 90
      p[i * 4 + 3] = i % 5 === 0 ? 0 : (i * 31) & 255 | 1
    }
    return p
  }
  it('PngStream -> decodePng is lossless', () => {
    const src = tile(64, 64)
    const s = new PngStream(64, 64, 2)
    s.push(src)
    const d = decodePng(s.finish())!
    expect(d.w).toBe(64)
    // fully transparent pixels carry no colour
    for (let i = 0; i < src.length; i += 4) if (src[i + 3]) for (let c = 0; c < 4; c++) expect(d.rgba[i + c]).toBe(src[i + c])
  })
  it('premultiplied -> straight -> premultiplied is bit exact for every (colour, alpha) pair', () => {
    for (let a = 1; a <= 255; a++) {
      const p = new Uint8Array(4 * 256)
      for (let c = 0; c <= a; c++) {
        p[c * 4] = c
        p[c * 4 + 1] = Math.min(a, c + 1)
        p[c * 4 + 2] = a
        p[c * 4 + 3] = a
      }
      const back = premultiplyInPlace(unpremultiply(p))
      for (let i = 0; i < (a + 1) * 4; i++) expect(back[i]).toBe(p[i])
    }
  })
  it('rejects non-PNG data', () => {
    expect(decodePng(new Uint8Array(100))).toBeNull()
  })
})

describe('zip index (lazy open)', () => {
  it('slices stored entries without unzipping the archive', () => {
    const files = { 'manifest.json': new Uint8Array([1, 2, 3]), 'layers/a/0_0.png': new Uint8Array(500).fill(7), 'layers/a/-1_2.png': new Uint8Array(40).fill(9) }
    const z = zipSync(Object.fromEntries(Object.entries(files).map(([k, v]) => [k, [v, { level: 0 }]])) as never)
    const idx = indexZip(z)
    expect([...idx.keys()].sort()).toEqual(Object.keys(files).sort())
    for (const [k, v] of Object.entries(files)) expect([...readEntry(z, idx.get(k)!)]).toEqual([...v])
  })
  it('inflates deflated entries', () => {
    const data = new Uint8Array(5000).fill(3)
    const z = zipSync({ 'a.bin': data })
    expect(readEntry(z, indexZip(z).get('a.bin')!).length).toBe(5000)
  })
})

describe('manifest', () => {
  it('keeps the tile size self-describing', () => {
    expect(parseInfiniteMeta({ kind: 'infinite', infinite: { tileSize: 512 } })?.tileSize).toBe(512)
    expect(() => parseInfiniteMeta({ kind: 'infinite', infinite: { tileSize: 256 } })).toThrow()
  })
})
