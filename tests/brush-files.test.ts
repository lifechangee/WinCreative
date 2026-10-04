import { describe, expect, it } from 'vitest'
import { parseAbr, unpackBits } from '../src/renderer/src/features/brushes/abr'
import { parseBplist, unarchive } from '../src/renderer/src/features/brushes/bplist'
import { mapProcreate } from '../src/renderer/src/features/brushes/procreate'
import { borderMean, fixTipPolarity, rgbaToGray, squareGray } from '../src/renderer/src/features/brushes/brushFile'
import { normalizeBrush } from '../src/renderer/src/core/brush'
import { registerDefaultPresets, listBrushPresets, getBrushPreset } from '../src/renderer/src/brush/presets'
import { BrushLibrary, RECENT_ID, FAVORITES_ID } from '../src/renderer/src/features/brushes/library'
import { DEFAULT_SETS } from '../src/renderer/src/brush/defaults'

// ---------------------------------------------------------------- tiny bplist00 writer (test helper)
type V = string | number | boolean | V[] | { [k: string]: V } | { UID: number }
function writeBplist(root: V): Uint8Array {
  const objs: V[] = []
  const idx = new Map<string, number>()
  const add = (v: V): number => {
    const key = JSON.stringify(v)
    if (idx.has(key) && (typeof v === 'string' || typeof v === 'number')) return idx.get(key)!
    const i = objs.length
    objs.push(v)
    idx.set(key, i)
    return i
  }
  // flatten: children first is not required, refs are indices
  const refs = new Map<V, number[]>()
  const walk = (v: V): number => {
    const i = add(v)
    if (Array.isArray(v)) refs.set(v, v.map(walk))
    else if (v && typeof v === 'object' && !('UID' in v)) {
      const ks = Object.keys(v)
      refs.set(v, [...ks.map((k) => walk(k)), ...ks.map((k) => walk((v as Record<string, V>)[k]))])
    }
    return i
  }
  const top = walk(root)
  const bytes: number[] = [...Buffer.from('bplist00')]
  const offsets: number[] = []
  const lenMarker = (hi: number, n: number): void => {
    if (n < 15) bytes.push((hi << 4) | n)
    else bytes.push((hi << 4) | 15, 0x11, n)
  }
  for (const v of objs) {
    offsets.push(bytes.length)
    if (typeof v === 'string') {
      lenMarker(5, v.length)
      bytes.push(...Buffer.from(v, 'ascii'))
    } else if (typeof v === 'number') {
      if (Number.isInteger(v) && v >= 0 && v < 256) bytes.push(0x10, v)
      else {
        const b = Buffer.alloc(8)
        b.writeDoubleBE(v)
        bytes.push(0x23, ...b)
      }
    } else if (typeof v === 'boolean') bytes.push(v ? 0x09 : 0x08)
    else if (Array.isArray(v)) {
      lenMarker(0xa, v.length)
      bytes.push(...refs.get(v)!)
    } else if ('UID' in v) bytes.push(0x80, (v as { UID: number }).UID)
    else {
      lenMarker(0xd, Object.keys(v).length)
      bytes.push(...refs.get(v)!)
    }
  }
  const tableOff = bytes.length
  bytes.push(...offsets.map((o) => o & 255))
  const trailer = Buffer.alloc(32)
  trailer[6] = 1
  trailer[7] = 1
  trailer.writeBigUInt64BE(BigInt(objs.length), 8)
  trailer.writeBigUInt64BE(BigInt(top), 16)
  trailer.writeBigUInt64BE(BigInt(tableOff), 24)
  return new Uint8Array([...bytes, ...trailer])
}

describe('bplist', () => {
  it('parses dicts, arrays, strings, ints, reals, bools', () => {
    const v = parseBplist(writeBplist({ name: 'Ink', list: [1, 2, 3], spacing: 0.25, on: true })) as Record<string, unknown>
    expect(v.name).toBe('Ink')
    expect(v.list).toEqual([1, 2, 3])
    expect(v.spacing).toBe(0.25)
    expect(v.on).toBe(true)
  })
  it('rejects garbage', () => {
    expect(() => parseBplist(new Uint8Array(64))).toThrow()
  })
  it('resolves NSKeyedArchiver graphs', () => {
    const archive = {
      $archiver: 'NSKeyedArchiver',
      $objects: ['$null', { plotSpacing: { UID: 2 }, name: { UID: 3 }, $class: { UID: 4 } }, 0.35, 'Test Brush', { $classname: 'SilicaBrush' }],
      $top: { root: { UID: 1 } }
    }
    const obj = unarchive(parseBplist(writeBplist(archive as unknown as V))) as Record<string, unknown>
    expect(obj.name).toBe('Test Brush')
    expect(obj.plotSpacing).toBe(0.35)
    expect(obj.$class).toBeUndefined()
  })
})

describe('procreate mapping', () => {
  it('maps known keys with clamping and keeps defaults otherwise', () => {
    const r = mapProcreate({ name: 'Charcoal', plotSpacing: 0.12, dynamicsPressureSize: 0.8, textureDepth: 0.6, maxSize: 200, shapeScatter: 0.5, bundledShapePath: 'x/Shape.png', unknownKey: 3 }, 'id1')
    const b = normalizeBrush(r.input)
    expect(b.name).toBe('Charcoal')
    expect(b.spacing).toBe(0.12)
    expect(b.dynamics.pressureSize).toBe(0.8)
    expect(b.grain.depth).toBe(0.6)
    expect(b.props.maxSize).toBe(200)
    expect(b.dynamics.angleJitter).toBe(90)
    expect(r.shapeFile).toBe('Shape.png')
    expect(b.flow).toBe(1)
  })
  it('never produces out-of-range values', () => {
    const b = normalizeBrush(mapProcreate({ plotSpacing: 99, textureDepth: -4, shapeCount: 999 }, 'x').input)
    expect(b.spacing).toBeLessThanOrEqual(4)
    expect(b.grain.depth).toBe(0)
    expect(b.shape.count).toBe(16)
  })
})

// ---------------------------------------------------------------- abr
function packBitsRow(row: number[]): number[] {
  const out: number[] = []
  for (let i = 0; i < row.length; i += 128) {
    const chunk = row.slice(i, i + 128)
    out.push(chunk.length - 1, ...chunk)
  }
  return out
}
const i32 = (v: number): number[] => [(v >>> 24) & 255, (v >>> 16) & 255, (v >>> 8) & 255, v & 255]
const i16 = (v: number): number[] => [(v >> 8) & 255, v & 255]

function abrV6(w: number, h: number, pix: number[], compressed: boolean): Uint8Array {
  const id = 'abcdefgh'
  const body: number[] = [id.length, ...Buffer.from(id), ...new Array(10).fill(0), ...i32(0), ...i32(0), ...i32(h), ...i32(w), ...i16(8), compressed ? 1 : 0]
  if (compressed) {
    const rows: number[][] = []
    for (let y = 0; y < h; y++) rows.push(packBitsRow(pix.slice(y * w, (y + 1) * w)))
    for (const r of rows) body.push(...i16(r.length))
    for (const r of rows) body.push(...r)
  } else body.push(...pix)
  while (body.length % 4) body.push(0)
  const samp = [...i32(body.length), ...body]
  return new Uint8Array([...i16(6), ...i16(1), ...Buffer.from('8BIM'), ...Buffer.from('samp'), ...i32(samp.length), ...samp])
}

describe('abr', () => {
  it('unpacks PackBits', () => {
    expect(Array.from(unpackBits(new Uint8Array([2, 1, 2, 3, 0xfe, 9]), 6))).toEqual([1, 2, 3, 9, 9, 9])
  })
  it('reads a v6 sampled tip (raw and RLE)', () => {
    const pix = Array.from({ length: 16 }, (_, i) => i * 16)
    for (const c of [false, true]) {
      const tips = parseAbr(abrV6(4, 4, pix, c))
      expect(tips.length).toBe(1)
      expect(tips[0].width).toBe(4)
      expect(Array.from(tips[0].data)).toEqual(pix)
    }
  })
  it('rejects unsupported versions and survives truncation', () => {
    expect(() => parseAbr(new Uint8Array([0, 3, 0, 0]))).toThrow()
    const full = abrV6(4, 4, new Array(16).fill(255), false)
    expect(() => parseAbr(full.slice(0, 30))).not.toThrow()
  })
})

describe('texture conversion', () => {
  it('resamples to a square power of two', () => {
    const r = squareGray(new Uint8Array(50 * 30).fill(200), 50, 30)
    expect(r.size).toBe(64)
    expect(r.data[10]).toBe(200)
  })
  it('detects dark-on-light tips and inverts them', () => {
    const w = 8
    const rgba = new Uint8Array(w * w * 4).fill(255)
    for (let y = 3; y < 5; y++) for (let x = 3; x < 5; x++) for (let k = 0; k < 3; k++) rgba[(y * w + x) * 4 + k] = 0
    const g = rgbaToGray(rgba, w, w, 'tip')
    expect(g[4 * w + 4]).toBe(255)
    expect(g[0]).toBe(0)
    expect(borderMean(fixTipPolarity(new Uint8Array(w * w).fill(255), w, w), w, w)).toBe(0)
  })
  it('uses alpha when a tip has transparency and keeps raw luminance for own files', () => {
    const rgba = new Uint8Array([0, 0, 0, 0, 0, 0, 0, 255, 0, 0, 0, 128, 0, 0, 0, 0])
    expect(Array.from(rgbaToGray(rgba, 2, 2, 'tip'))).toEqual([0, 255, 128, 0])
    const raw = new Uint8Array([10, 10, 10, 255, 200, 200, 200, 255, 0, 0, 0, 255, 255, 255, 255, 255])
    expect(Array.from(rgbaToGray(raw, 2, 2, 'tip', true))).toEqual([10, 200, 0, 255])
  })
})

describe('library', () => {
  registerDefaultPresets()
  it('ships at least 40 brushes in many sets', () => {
    expect(listBrushPresets().length).toBeGreaterThanOrEqual(40)
    expect(DEFAULT_SETS.length).toBeGreaterThanOrEqual(14)
    for (const s of ['Sketching', 'Inking', 'Drawing', 'Painting', 'Artistic', 'Airbrushing', 'Textures', 'Charcoals', 'Calligraphy']) expect(DEFAULT_SETS.some((d) => d.name === s)).toBe(true)
    for (const id of ['soft-airbrush', 'hard-round', 'pencil-6b', 'ink-pen', 'watercolor-wet', 'chalk', 'smudge-soft', 'smudge-bristle', 'eraser-hard', 'eraser-soft']) expect(getBrushPreset(id)).toBeTruthy()
  })
  const mk = (): BrushLibrary => {
    const l = new BrushLibrary()
    l.persist = false
    return l
  }
  it('set operations', () => {
    const l = mk()
    const s = l.addSet('Mine')
    expect(l.sets[0].id).toBe(s.id)
    l.renameSet(s.id, 'Renamed')
    expect(l.set(s.id)!.name).toBe('Renamed')
    const b = l.newBrush(s.id)
    expect(l.brushesOf(s.id)[0].id).toBe(b.id)
    const dup = l.duplicateSet(s.id)!
    expect(dup.brushIds.length).toBe(1)
    expect(dup.brushIds[0]).not.toBe(b.id)
    l.moveSet(dup.id, 5)
    expect(l.sets.indexOf(dup)).toBe(5)
    l.deleteSet(s.id)
    expect(l.set(s.id)).toBeUndefined()
  })
  it('brush operations: duplicate, reorder, move, favorite, delete, recent', () => {
    const l = mk()
    const set = l.set('set-inking')!
    const first = set.brushIds[0]
    const second = set.brushIds[1]
    l.moveBrush(first, 'set-inking', 'set-inking', 3)
    expect(set.brushIds.indexOf(first)).toBe(2)
    l.moveBrush(second, 'set-inking', 'set-drawing', 0)
    expect(l.set('set-drawing')!.brushIds[0]).toBe(second)
    expect(set.brushIds.includes(second)).toBe(false)
    const dup = l.duplicateBrush(first)!
    expect(set.brushIds[set.brushIds.indexOf(first) + 1]).toBe(dup.id)
    expect(dup.name).toContain('copy')
    l.toggleFavorite(first)
    expect(l.brushesOf(FAVORITES_ID).map((b) => b.id)).toEqual([first])
    l.markUsed(dup.id)
    l.markUsed(first)
    expect(l.brushesOf(RECENT_ID).map((b) => b.id)).toEqual([first, dup.id])
    l.deleteBrush(dup.id)
    expect(getBrushPreset(dup.id)).toBeUndefined()
    expect(l.brushesOf(RECENT_ID).map((b) => b.id)).toEqual([first])
    expect(l.search('pen').length).toBeGreaterThan(0)
  })
  it('reset defaults restores deleted and modified shipped brushes', () => {
    const l = mk()
    const b = getBrushPreset('ink-pen')!
    l.updateBrush({ ...b, spacing: 0.9 })
    expect(getBrushPreset('ink-pen')!.spacing).toBe(0.9)
    l.deleteBrush('ink-technical')
    expect(getBrushPreset('ink-technical')).toBeUndefined()
    l.resetDefaults()
    expect(getBrushPreset('ink-pen')!.spacing).toBeCloseTo(0.04)
    expect(getBrushPreset('ink-technical')).toBeTruthy()
    expect(l.set('set-inking')!.brushIds).toContain('ink-technical')
  })
})
