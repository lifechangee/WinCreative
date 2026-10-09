import { describe, expect, it } from 'vitest'
import {
  GUTTER,
  TILE,
  TILE_BUDGET,
  ancestorOf,
  boundsOfKeys,
  budgetLevel,
  intRect,
  levelForZoom,
  levelSpan,
  regionPieces,
  tileBytes,
  tileCount,
  tileKey,
  tileKeyX,
  tileKeyY,
  tileOf,
  tileRange,
  tileRect,
  tilesIn,
  unionBounds
} from '../src/renderer/src/core/tiles'
import { validateManifest } from '../src/renderer/src/io/bwk'
import { BWK_VERSION_INFINITE, parseInfiniteMeta, parseLayerTiles, parseTileFileName, tileFileName } from '../src/renderer/src/io/bwkInfinite'

describe('tile math', () => {
  it('floor division works for negative coordinates', () => {
    expect(tileOf(0)).toBe(0)
    expect(tileOf(511.99)).toBe(0)
    expect(tileOf(512)).toBe(1)
    expect(tileOf(-0.01)).toBe(-1)
    expect(tileOf(-512)).toBe(-1)
    expect(tileOf(-513)).toBe(-2)
    expect(tileOf(-50000)).toBe(-98)
  })
  it('tileKey round-trips signed tile indices, also far away', () => {
    for (const [x, y] of [[0, 0], [-1, -1], [1, -1], [-1, 1], [98, -98], [-1000000, 777777], [16777215, -16777215], [-16777215, 16777215]]) {
      const k = tileKey(x, y)
      expect(Number.isSafeInteger(k)).toBe(true)
      expect([tileKeyX(k), tileKeyY(k)]).toEqual([x, y])
    }
  })
  it('tileKeys are unique', () => {
    const s = new Set<number>()
    for (let x = -20; x <= 20; x++) for (let y = -20; y <= 20; y++) s.add(tileKey(x, y))
    expect(s.size).toBe(41 * 41)
  })
  it('tileRect / intRect / tileRange', () => {
    expect(tileRect(-1, 2)).toEqual({ x: -512, y: 1024, w: 512, h: 512 })
    expect(intRect({ x: -0.5, y: 10.2, w: 3, h: 1 })).toEqual({ x: -1, y: 10, w: 4, h: 2 })
    expect(tileRange({ x: 0, y: 0, w: 512, h: 512 })).toEqual({ tx0: 0, ty0: 0, tx1: 0, ty1: 0 })
    expect(tileRange({ x: 0, y: 0, w: 512.5, h: 1 })).toEqual({ tx0: 0, ty0: 0, tx1: 1, ty1: 0 })
    expect(tileRange({ x: -1, y: -1, w: 2, h: 2 })).toEqual({ tx0: -1, ty0: -1, tx1: 0, ty1: 0 })
    expect(tileRange({ x: 5, y: 5, w: 0, h: 5 })).toBeNull()
    expect(tileCount({ x: -1, y: -1, w: 2, h: 2 })).toBe(4)
    expect(tilesIn({ x: -1, y: -1, w: 2, h: 2 }).map((t) => [t.tx, t.ty])).toEqual([[-1, -1], [0, -1], [-1, 0], [0, 0]])
  })
})

describe('region assembly', () => {
  it('pieces tile the rect exactly (no gaps, no overlap)', () => {
    for (const r of [{ x: -700, y: -3, w: 1500, h: 900 }, { x: 5, y: 5, w: 10, h: 10 }, { x: -512, y: -512, w: 1024, h: 1024 }, { x: 511, y: 511, w: 2, h: 2 }]) {
      const pcs = regionPieces(r)
      let area = 0
      const seen = new Set<string>()
      for (const p of pcs) {
        area += p.w * p.h
        expect(p.sx).toBeGreaterThanOrEqual(0)
        expect(p.sy).toBeGreaterThanOrEqual(0)
        expect(p.sx + p.w).toBeLessThanOrEqual(TILE)
        expect(p.sy + p.h).toBeLessThanOrEqual(TILE)
        // the piece's absolute position equals the tile origin + local offset = region origin + dest offset
        expect(p.tx * TILE + p.sx).toBe(Math.floor(r.x) + p.dx)
        expect(p.ty * TILE + p.sy).toBe(Math.floor(r.y) + p.dy)
        for (let y = p.dy; y < p.dy + p.h; y += Math.max(1, p.h - 1)) for (let x = p.dx; x < p.dx + p.w; x += Math.max(1, p.w - 1)) {
          const k = x + ',' + y
          expect(seen.has(k)).toBe(false)
          seen.add(k)
        }
      }
      expect(area).toBe(intRect(r).w * intRect(r).h)
    }
  })
  it('a region inside one tile is one piece starting at the right offset', () => {
    const p = regionPieces({ x: 600, y: 700, w: 50, h: 20 })
    expect(p).toEqual([{ tx: 1, ty: 1, sx: 88, sy: 188, dx: 0, dy: 0, w: 50, h: 20 }])
  })
})

describe('bounds', () => {
  it('boundsOfKeys is the tile-granular union', () => {
    expect(boundsOfKeys([])).toBeNull()
    expect(boundsOfKeys([tileKey(0, 0)])).toEqual({ x: 0, y: 0, w: 512, h: 512 })
    expect(boundsOfKeys([tileKey(-2, 3), tileKey(1, -1)])).toEqual({ x: -1024, y: -512, w: 4 * 512, h: 5 * 512 })
  })
  it('unionBounds', () => {
    expect(unionBounds(null, null)).toBeNull()
    expect(unionBounds({ x: 0, y: 0, w: 10, h: 10 }, null)).toEqual({ x: 0, y: 0, w: 10, h: 10 })
    expect(unionBounds({ x: 0, y: 0, w: 10, h: 10 }, { x: -5, y: 20, w: 1, h: 1 })).toEqual({ x: -5, y: 0, w: 15, h: 21 })
  })
})

describe('display pyramid', () => {
  it('level keeps the residual minification in (0.5, 1]', () => {
    expect(levelForZoom(2)).toBe(0)
    expect(levelForZoom(1)).toBe(0)
    expect(levelForZoom(0.75)).toBe(0)
    for (const z of [0.5, 0.3, 0.25, 0.1, 0.05, 0.02, 0.0123]) {
      const k = levelForZoom(z)
      const resid = z * 2 ** k
      expect(resid).toBeGreaterThan(0.5)
      expect(resid).toBeLessThanOrEqual(1.0000001)
    }
    expect(levelForZoom(0.02)).toBe(5)
    expect(levelForZoom(1e-9, 7)).toBe(7)
  })
  it('ancestors use floor semantics for negative tiles', () => {
    expect(ancestorOf(0, 0, 3)).toEqual({ tx: 0, ty: 0 })
    expect(ancestorOf(-1, -1, 1)).toEqual({ tx: -1, ty: -1 })
    expect(ancestorOf(-2, -3, 1)).toEqual({ tx: -1, ty: -2 })
    expect(ancestorOf(7, 8, 3)).toEqual({ tx: 0, ty: 1 })
    expect(levelSpan(3)).toBe(4096)
    expect(GUTTER).toBeGreaterThanOrEqual(2)
  })
})

describe('memory budget', () => {
  it('levels', () => {
    expect(tileBytes('rgba8')).toBe(512 * 512 * 4)
    expect(tileBytes('rgba16f')).toBe(512 * 512 * 8)
    expect(budgetLevel(0)).toBe(0)
    expect(budgetLevel(TILE_BUDGET.warn)).toBe(1)
    expect(budgetLevel(TILE_BUDGET.hard + 1)).toBe(2)
  })
})

describe('.bwk v2 (infinite) manifest', () => {
  const base = { format: 'brushwork', version: 2, kind: 'infinite', width: 4096, height: 4096, infinite: { tileSize: 512, view: { cx: -12.5, cy: 300, zoom: 0.5 }, grid: true } }
  const layer = (o: object = {}) => ({ id: 'a', file: '', name: 'x', tiles: [[0, 0], [-3, 4], [-3, 4], [1.5, 2], ['x', 1], [1, 2, 3], [99999999999, 0]], ...o })
  it('parses kind, view, grid and a cleaned tile list', () => {
    const m = validateManifest({ ...base, layers: [layer(), { id: 'g', file: '', isGroup: true, name: 'grp' }] })
    expect(m.version).toBe(BWK_VERSION_INFINITE)
    expect(m.kind).toBe('infinite')
    expect(m.infinite).toEqual({ tileSize: 512, view: { cx: -12.5, cy: 300, zoom: 0.5 }, grid: true })
    expect(m.layers[0].tiles).toEqual([[0, 0], [-3, 4]])
    expect(m.layers[1].tiles).toBeUndefined()
  })
  it('old fixed files (version 1, no kind) still validate unchanged', () => {
    const m = validateManifest({ format: 'brushwork', version: 1, width: 10, height: 10, layers: [{ id: 'a', file: 'layers/a.png' }] })
    expect(m.version).toBe(1)
    expect(m.kind).toBeUndefined()
    expect(m.layers[0].tiles).toBeUndefined()
  })
  it('a version 2 file without kind is a fixed document', () => {
    const m = validateManifest({ format: 'brushwork', version: 2, width: 10, height: 10, layers: [{ id: 'a', file: 'layers/a.png' }] })
    expect(m.kind).toBeUndefined()
  })
  it('rejects unknown versions and wrong tile sizes', () => {
    expect(() => validateManifest({ ...base, version: 3, layers: [layer()] })).toThrow()
    expect(() => validateManifest({ ...base, infinite: { tileSize: 256 }, layers: [layer()] })).toThrow()
  })
  it('tile file names round-trip, also negative', () => {
    expect(tileFileName('L1_ab', -3, 4)).toBe('layers/L1_ab/-3_4.png')
    expect(parseTileFileName('layers/L1_ab/-3_4.png')).toEqual({ layerId: 'L1_ab', tx: -3, ty: 4 })
    expect(parseTileFileName('layers/x.png')).toBeNull()
    expect(parseTileFileName('layers/a/1_b.png')).toBeNull()
    expect(parseInfiniteMeta({ kind: 'fixed' })).toBeNull()
    expect(parseLayerTiles({})).toEqual([])
  })
})
