/**
 * Pure helpers of the .bwk v2 infinite-canvas layout (no GL / DOM; unit-tested).
 *
 *   manifest.json   version 2, `kind: 'infinite'`, `infinite: {tileSize, view?, grid?}`, per layer `tiles: [[tx,ty], ...]`
 *   layers/<id>/<tx>_<ty>.png   one straight-alpha PNG per non-empty tile (tileSize x tileSize)
 *
 * Fixed documents keep writing version 1 byte-for-byte as before; readers accept 1 and 2.
 */
import { TILE, MAX_TILE_INDEX } from '../core/tiles'

export const BWK_VERSION_FIXED = 1
export const BWK_VERSION_INFINITE = 2

export const tileFileName = (layerId: string, tx: number, ty: number): string => `layers/${layerId}/${tx}_${ty}.png`

export function parseTileFileName(name: string): { layerId: string; tx: number; ty: number } | null {
  const m = /^layers\/(.+)\/(-?\d+)_(-?\d+)\.png$/.exec(name)
  if (!m) return null
  const tx = Number(m[2])
  const ty = Number(m[3])
  if (!Number.isSafeInteger(tx) || !Number.isSafeInteger(ty) || Math.abs(tx) > MAX_TILE_INDEX || Math.abs(ty) > MAX_TILE_INDEX) return null
  return { layerId: m[1], tx, ty }
}

export interface InfiniteMeta {
  tileSize: number
  view?: { cx: number; cy: number; zoom: number }
  grid?: boolean
}

/** Validate the `infinite` block of a v2 manifest; null when the manifest is a fixed document. */
export function parseInfiniteMeta(m: { kind?: unknown; infinite?: unknown }): InfiniteMeta | null {
  if (m.kind !== 'infinite') return null
  const i = (m.infinite ?? {}) as { tileSize?: unknown; view?: { cx?: unknown; cy?: unknown; zoom?: unknown }; grid?: unknown }
  const tileSize = Number(i.tileSize ?? TILE)
  if (tileSize !== TILE) throw new Error('Unsupported tile size ' + tileSize)
  const v = i.view
  const view =
    v && Number.isFinite(Number(v.cx)) && Number.isFinite(Number(v.cy)) && Number(v.zoom) > 0
      ? { cx: Number(v.cx), cy: Number(v.cy), zoom: Number(v.zoom) }
      : undefined
  return { tileSize, ...(view ? { view } : {}), ...(i.grid ? { grid: true } : {}) }
}

/** Validate a layer's tile list; malformed or out-of-range entries are dropped, duplicates removed. */
export function parseLayerTiles(l: { tiles?: unknown }): [number, number][] {
  if (!Array.isArray(l.tiles)) return []
  const seen = new Set<string>()
  const out: [number, number][] = []
  for (const e of l.tiles) {
    if (!Array.isArray(e) || e.length !== 2) continue
    const tx = Number(e[0])
    const ty = Number(e[1])
    if (!Number.isSafeInteger(tx) || !Number.isSafeInteger(ty) || Math.abs(tx) > MAX_TILE_INDEX || Math.abs(ty) > MAX_TILE_INDEX) continue
    const k = tx + ',' + ty
    if (seen.has(k)) continue
    seen.add(k)
    out.push([tx, ty])
  }
  return out
}
