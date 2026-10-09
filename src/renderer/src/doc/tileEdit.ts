import { intRect, TILE, TileKey, tileKey, tileKeyX, tileKeyY, tilesIn } from '../core/tiles'
import type { Rect } from '../core/types'
import { unionRect } from '../core/geometry'
import type { Surface } from '../gl/gpu'
import type { Document } from './document'
import type { Layer } from './layer'
import type { PixelEdit } from './pixelEdit'

export interface TileSpan {
  key: TileKey
  tx: number
  ty: number
  /** document-space origin of the tile */
  ox: number
  oy: number
  surf: Surface
}

/**
 * A long-lived edit of an infinite layer for interactive tools (transform, ColorDrop): tiles are snapshotted (and allocated) the
 * first time they are touched, the tool re-renders its preview straight into the tiles, `restore(rect)` puts the original pixels back
 * before every re-render, `commit()` frees tiles that ended up empty and pushes ONE undo step, `cancel()` leaves no trace.
 */
export class LiveTileEdit {
  readonly edit: PixelEdit
  private readonly keys = new Set<TileKey>()
  private touched: Rect | null = null

  constructor(
    readonly doc: Document,
    readonly layer: Layer,
    label: string
  ) {
    this.edit = doc.beginPixelEdit(layer, label)
  }

  private get store(): NonNullable<Layer['tiles']> {
    return this.layer.tiles!
  }

  /** Snapshot + allocate every tile under `rect` (all allocation happens here, BEFORE any texture is bound for a draw). */
  prepare(rect: Rect, existingOnly = false): TileSpan[] {
    const r = intRect(rect)
    const store = this.store
    const tiles = tilesIn(r).filter((c) => !existingOnly || store.has(c.tx, c.ty))
    for (const { tx, ty } of tiles) {
      const k = tileKey(tx, ty)
      this.edit.saveKey(k)
      this.keys.add(k)
    }
    const out: TileSpan[] = []
    for (const { tx, ty } of tiles) out.push({ key: tileKey(tx, ty), tx, ty, ox: tx * TILE, oy: ty * TILE, surf: store.ensure(tx, ty) })
    this.touched = unionRect(this.touched, r)
    return out
  }

  /** Put the tiles under `rect` back to their pre-edit content (tiles that did not exist become empty). */
  restore(rect: Rect | null): void {
    if (!rect) return
    const gpu = this.doc.gpu
    const store = this.store
    for (const { tx, ty } of tilesIn(intRect(rect))) {
      const k = tileKey(tx, ty)
      if (!this.keys.has(k)) continue
      const cur = store.getKey(k)
      if (!cur) continue
      const snap = this.edit.snapshot(k)
      if (snap) gpu.blit(snap, { x: 0, y: 0, w: TILE, h: TILE }, cur, 0, 0)
      else gpu.clear(cur)
    }
  }

  get bounds(): Rect | null {
    return this.touched
  }

  /** Free empty tiles and push the undo step. Returns the dirty rect (null = nothing changed). */
  commit(): Rect | null {
    const store = this.store
    for (const k of store.emptyAmong(this.edit.savedKeys())) this.edit.removeKey(k)
    return this.edit.finish()
  }

  /** Restore everything and forget the edit. */
  cancel(): void {
    const gpu = this.doc.gpu
    const store = this.store
    for (const k of this.edit.savedKeys()) {
      const snap = this.edit.snapshot(k)
      if (snap) {
        const cur = store.ensure(tileKeyX(k), tileKeyY(k))
        gpu.blit(snap, { x: 0, y: 0, w: TILE, h: TILE }, cur, 0, 0)
      } else store.free(k)
    }
    this.edit.abort()
  }
}
