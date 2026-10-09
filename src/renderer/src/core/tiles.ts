import type { Rect } from './types'

/**
 * Pure tile math of the infinite canvas (no DOM / GL). Document coordinates are unbounded signed integers; the plane is cut
 * into square tiles of TILE px: tile (tx,ty) covers x in [tx*TILE, (tx+1)*TILE), y likewise. Floor division is used everywhere,
 * so negative coordinates need no special casing.
 */

/** Edge length of a pixel tile (px). 512 keeps GPU object counts low (2000 tiles = 2 Gpx of canvas) while a stroke touches few tiles. */
export const TILE = 512
/** Border (px) around the interior of a composite tile that carries the neighbours' edge pixels (seam-free filtering). */
export const GUTTER = 2

export type TileKey = number
export interface TileCoord {
  tx: number
  ty: number
}

const OFF = 2 ** 24
const SPAN = 2 ** 25
/** Largest |tile index| representable by tileKey (about +-8.6e9 px with 512-px tiles). */
export const MAX_TILE_INDEX = OFF - 1

/** Pack signed tile coordinates into one safe integer (Map key). */
export function tileKey(tx: number, ty: number): TileKey {
  return (tx + OFF) * SPAN + (ty + OFF)
}
export function tileKeyX(key: TileKey): number {
  return Math.floor(key / SPAN) - OFF
}
export function tileKeyY(key: TileKey): number {
  return (key % SPAN) - OFF
}

export const tileOf = (v: number, size = TILE): number => Math.floor(v / size)

export function tileRect(tx: number, ty: number, size = TILE): Rect {
  return { x: tx * size, y: ty * size, w: size, h: size }
}

/** Integer rect covering a float rect (floor of the origin, ceil of the far edge). Unbounded. */
export function intRect(r: Rect): Rect {
  const x0 = Math.floor(r.x)
  const y0 = Math.floor(r.y)
  return { x: x0, y: y0, w: Math.max(0, Math.ceil(r.x + r.w) - x0), h: Math.max(0, Math.ceil(r.y + r.h) - y0) }
}

/** Inclusive tile index range covered by a rect, or null for an empty rect. */
export function tileRange(r: Rect, size = TILE): { tx0: number; ty0: number; tx1: number; ty1: number } | null {
  if (!(r.w > 0 && r.h > 0)) return null
  const x1 = Math.ceil(r.x + r.w) - 1
  const y1 = Math.ceil(r.y + r.h) - 1
  return { tx0: tileOf(Math.floor(r.x), size), ty0: tileOf(Math.floor(r.y), size), tx1: tileOf(x1, size), ty1: tileOf(y1, size) }
}

export function tileCount(r: Rect, size = TILE): number {
  const g = tileRange(r, size)
  return g ? (g.tx1 - g.tx0 + 1) * (g.ty1 - g.ty0 + 1) : 0
}

/** All tile coordinates a rect touches (row-major). Callers must bound the rect (see tileCount). */
export function tilesIn(r: Rect, size = TILE): TileCoord[] {
  const g = tileRange(r, size)
  const out: TileCoord[] = []
  if (!g) return out
  for (let ty = g.ty0; ty <= g.ty1; ty++) for (let tx = g.tx0; tx <= g.tx1; tx++) out.push({ tx, ty })
  return out
}

/**
 * Copy plan between a region (rect, integer) and the tiles it overlaps: for every tile one item with the tile-local source
 * rectangle (sx,sy,w,h) and the offset (dx,dy) of that piece inside the region. Used to assemble tiles into one texture
 * (readRegion) and to scatter a texture back (writeRegion).
 */
export interface RegionPiece {
  tx: number
  ty: number
  /** tile-local origin of the piece */
  sx: number
  sy: number
  /** offset inside the region */
  dx: number
  dy: number
  w: number
  h: number
}
export function regionPieces(rect: Rect, size = TILE): RegionPiece[] {
  const r = intRect(rect)
  const out: RegionPiece[] = []
  for (const { tx, ty } of tilesIn(r, size)) {
    const x0 = Math.max(r.x, tx * size)
    const y0 = Math.max(r.y, ty * size)
    const x1 = Math.min(r.x + r.w, (tx + 1) * size)
    const y1 = Math.min(r.y + r.h, (ty + 1) * size)
    out.push({ tx, ty, sx: x0 - tx * size, sy: y0 - ty * size, dx: x0 - r.x, dy: y0 - r.y, w: x1 - x0, h: y1 - y0 })
  }
  return out
}

export function unionBounds(a: Rect | null, b: Rect | null): Rect | null {
  if (!a) return b ? { ...b } : null
  if (!b) return { ...a }
  const x0 = Math.min(a.x, b.x)
  const y0 = Math.min(a.y, b.y)
  return { x: x0, y: y0, w: Math.max(a.x + a.w, b.x + b.w) - x0, h: Math.max(a.y + a.h, b.y + b.h) - y0 }
}

/** Bounding rect (tile granularity) of a set of tile keys. */
export function boundsOfKeys(keys: Iterable<TileKey>, size = TILE): Rect | null {
  let x0 = Infinity
  let y0 = Infinity
  let x1 = -Infinity
  let y1 = -Infinity
  for (const k of keys) {
    const tx = tileKeyX(k)
    const ty = tileKeyY(k)
    if (tx < x0) x0 = tx
    if (ty < y0) y0 = ty
    if (tx > x1) x1 = tx
    if (ty > y1) y1 = ty
  }
  if (x0 === Infinity) return null
  return { x: x0 * size, y: y0 * size, w: (x1 - x0 + 1) * size, h: (y1 - y0 + 1) * size }
}

// ------------------------------------------------------------------ display pyramid
/**
 * Pyramid level for a device zoom Z (device px per doc px). Level k shows 2^k doc px per texel; k is chosen so that the residual
 * minification Z*2^k stays in (0.5, 1], which the display shader resolves with at most 2x2 taps (no shimmer).
 */
export function levelForZoom(z: number, maxLevel = 12): number {
  if (!(z > 0) || z >= 1) return 0
  return Math.max(0, Math.min(maxLevel, Math.floor(Math.log2(1 / z) + 1e-9)))
}

/** Key of the level-`level` tile that contains level-0 tile (tx,ty). */
export function ancestorOf(tx: number, ty: number, level: number): TileCoord {
  return { tx: tx >> level, ty: ty >> level }
}

/** Doc-space size of a level-k tile. */
export const levelSpan = (level: number, size = TILE): number => size * 2 ** level

// ------------------------------------------------------------------ memory
export interface TileBudget {
  /** bytes above which the user is warned (first level) */
  warn: number
  /** bytes above which a second, stronger warning is shown */
  hard: number
}
export const TILE_BUDGET: TileBudget = { warn: 1.5 * 1024 ** 3, hard: 3 * 1024 ** 3 }

export function tileBytes(fmt: 'rgba8' | 'rgba16f', size = TILE): number {
  return size * size * (fmt === 'rgba16f' ? 8 : 4)
}

/** 0 = fine, 1 = warn, 2 = hard warning, from the bytes held by all pixel tiles. */
export function budgetLevel(bytes: number, b: TileBudget = TILE_BUDGET): 0 | 1 | 2 {
  return bytes >= b.hard ? 2 : bytes >= b.warn ? 1 : 0
}
