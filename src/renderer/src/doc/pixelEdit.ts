import type { Command } from '../core/undo'
import type { Rect } from '../core/types'
import { unionRect } from '../core/geometry'
import { TileKey, intRect, tileCount, tileKey, tilesIn } from '../core/tiles'
import type { Surface } from '../gl/gpu'
import type { Document } from './document'
import { SnapEntry } from './tileMemory'
import type { Layer } from './layer'

export const TILE = 256

interface SavedTile {
  x: number
  y: number
  w: number
  h: number
  surf: Surface
}

/** Hard cap on tiles one infinite-canvas edit may touch (guards against a runaway rect). */
const MAX_EDIT_TILES = 6000

/**
 * Tile-based "before" snapshot of a layer. Call save(rect) BEFORE modifying pixels inside rect;
 * only tiles not yet saved are copied (GPU->GPU blit, no readback). finish() turns the
 * collected tiles into one undoable command. Undo/redo swap tile contents with the layer.
 *
 * Infinite canvas (layer.tiles): the snapshot unit is the layer's own 512 px tile. A tile that did not exist yet is saved as
 * `null` ("absent"), so allocation and freeing of tiles are undone / redone exactly like pixel changes, and undo / redo swap
 * surface objects between the store and the snapshot (no GPU copy at all).
 */
export class PixelEdit {
  private tiles = new Map<number, SavedTile>()
  private itiles = new Map<TileKey, SnapEntry>()
  dirty: Rect | null = null

  constructor(
    private doc: Document,
    private layer: Layer,
    private label: string
  ) {
    this.onMask = layer.editingMask && !!layer.mask
  }

  /** which of the layer's surfaces this edit targets (fixed at construction: pixels or mask) */
  private onMask: boolean
  private get target(): Surface {
    const l = this.layer
    return this.onMask ? (l.mask ?? l.pixels) : l.pixels
  }
  private get store(): NonNullable<Layer['tiles']> | null {
    return this.onMask ? this.layer.maskTiles : this.layer.tiles
  }

  save(rect: Rect): void {
    if (this.store) return this.saveInf(rect)
    const gpu = this.doc.gpu
    const W = this.target.w
    const H = this.target.h
    const x0 = Math.max(0, Math.floor(rect.x))
    const y0 = Math.max(0, Math.floor(rect.y))
    const x1 = Math.min(W, Math.ceil(rect.x + rect.w))
    const y1 = Math.min(H, Math.ceil(rect.y + rect.h))
    if (x1 <= x0 || y1 <= y0) return
    this.dirty = unionRect(this.dirty, { x: x0, y: y0, w: x1 - x0, h: y1 - y0 })
    const cols = Math.ceil(W / TILE)
    for (let ty = Math.floor(y0 / TILE); ty <= Math.floor((y1 - 1) / TILE); ty++) {
      for (let tx = Math.floor(x0 / TILE); tx <= Math.floor((x1 - 1) / TILE); tx++) {
        const key = ty * cols + tx
        if (this.tiles.has(key)) continue
        const x = tx * TILE
        const y = ty * TILE
        const w = Math.min(TILE, W - x)
        const h = Math.min(TILE, H - y)
        const surf = gpu.surface(w, h, this.target.fmt, 0)
        gpu.blit(this.target, { x, y, w, h }, surf, 0, 0)
        this.tiles.set(key, { x, y, w, h, surf })
      }
    }
  }

  // ------------------------------------------------------------------ infinite canvas
  private saveInf(rect: Rect): void {
    const r = intRect(rect)
    if (r.w <= 0 || r.h <= 0) return
    if (tileCount(r) > MAX_EDIT_TILES) throw new RangeError('Edit region too large for an infinite canvas')
    this.dirty = unionRect(this.dirty, r)
    for (const { tx, ty } of tilesIn(r)) this.saveKey(tileKey(tx, ty))
  }

  /** true for edits of an infinite layer */
  get tiled(): boolean {
    return !!this.store
  }

  /** Remove tile `key` from the layer as part of this edit (undoable). Cheaper than saveKey + free: the surface itself becomes the snapshot. */
  removeKey(key: TileKey): void {
    const store = this.store!
    this.dirty = unionRect(this.dirty, store.tileRectOf(key))
    if (this.itiles.has(key)) store.free(key)
    else this.itiles.set(key, SnapEntry.takeFrom(store, key))
  }

  /** Snapshot one tile (no-op when already saved). */
  saveKey(key: TileKey): void {
    const store = this.store!
    if (this.itiles.has(key)) return
    this.dirty = unionRect(this.dirty, store.tileRectOf(key))
    this.itiles.set(key, SnapEntry.capture(this.doc.gpu, store, key))
  }

  /** The pre-edit pixels of tile `key`: a surface, null when the tile did not exist, undefined when it was never saved. */
  snapshot(key: TileKey): Surface | null | undefined {
    const e = this.itiles.get(key)
    return e ? e.surface(this.doc.gpu) : undefined
  }

  /** Keys of every tile saved so far (infinite layers). */
  savedKeys(): TileKey[] {
    return [...this.itiles.keys()]
  }

  get hasChanges(): boolean {
    return this.tiles.size > 0 || this.itiles.size > 0
  }

  /** Commit to history. Returns the dirty rect (or null if nothing was saved). */
  finish(): Rect | null {
    if (this.itiles.size) return this.finishInf()
    if (!this.tiles.size) return null
    const doc = this.doc
    const layer = this.layer
    const tiles = [...this.tiles.values()]
    const bytes = tiles.reduce((a, t) => a + t.surf.bytes, 0)
    const dirty = this.dirty
    const swap = (): void => {
      const gpu = doc.gpu
      if (!doc.layers.includes(layer)) return
      const target = this.target
      for (const t of tiles) {
        gpu.blit(target, { x: t.x, y: t.y, w: t.w, h: t.h }, doc.tileScratch, 0, 0)
        gpu.blit(t.surf, { x: 0, y: 0, w: t.w, h: t.h }, target, t.x, t.y)
        gpu.blit(doc.tileScratch, { x: 0, y: 0, w: t.w, h: t.h }, t.surf, 0, 0)
      }
      doc.events.emit('change', { rect: dirty })
    }
    const cmd: Command = {
      label: this.label,
      layerId: layer.id,
      dirtyRect: dirty,
      bytes,
      undo: swap,
      redo: swap,
      dispose: () => tiles.forEach((t) => t.surf.dispose())
    }
    doc.pushCommand(cmd)
    this.tiles.clear()
    return dirty
  }

  private finishInf(): Rect | null {
    const doc = this.doc
    const layer = this.layer
    const store = this.store!
    const entries = [...this.itiles.entries()]
    const dirty = this.dirty
    const bytes = entries.reduce((a, [, e]) => a + e.bytes, 0) + entries.length * 64
    const swap = (): void => {
      if (!doc.layers.includes(layer)) return
      let idx = 0
      for (const [key, e] of entries) {
        const cur = SnapEntry.takeFrom(store, key)
        e.giveTo(store, key)
        entries[idx][1] = cur
        idx++
      }
      const rects = entries.map(([k]) => store.tileRectOf(k))
      let r: Rect | null = null
      for (const t of rects) r = unionRect(r, t)
      doc.events.emit('change', { rect: r })
    }
    const cmd: Command = {
      label: this.label,
      layerId: layer.id,
      dirtyRect: dirty,
      bytes,
      undo: swap,
      redo: swap,
      dispose: () => entries.forEach(([, e]) => e.dispose())
    }
    doc.pushCommand(cmd)
    this.itiles.clear()
    return dirty
  }

  /** Discard without recording. */
  abort(): void {
    for (const t of this.tiles.values()) t.surf.dispose()
    this.tiles.clear()
    for (const e of this.itiles.values()) e.dispose()
    this.itiles.clear()
  }
}
