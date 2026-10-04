import type { Command } from '../core/undo'
import type { Rect } from '../core/types'
import { unionRect } from '../core/geometry'
import type { Surface } from '../gl/gpu'
import type { Document } from './document'
import type { Layer } from './layer'

export const TILE = 256

interface SavedTile {
  x: number
  y: number
  w: number
  h: number
  surf: Surface
}

/**
 * Tile-based "before" snapshot of a layer. Call save(rect) BEFORE modifying pixels inside rect;
 * only tiles not yet saved are copied (GPU->GPU blit, no readback). finish() turns the
 * collected tiles into one undoable command. Undo/redo swap tile contents with the layer.
 */
export class PixelEdit {
  private tiles = new Map<number, SavedTile>()
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

  save(rect: Rect): void {
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

  get hasChanges(): boolean {
    return this.tiles.size > 0
  }

  /** Commit to history. Returns the dirty rect (or null if nothing was saved). */
  finish(): Rect | null {
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

  /** Discard without recording. */
  abort(): void {
    for (const t of this.tiles.values()) t.surf.dispose()
    this.tiles.clear()
  }
}
