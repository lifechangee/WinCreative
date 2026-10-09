import { regionPieces, tileKey } from '../core/tiles'
import type { Rect } from '../core/types'
import type { Document } from './document'
import type { Layer } from './layer'

/**
 * Replace `rect` of an infinite layer with straight-alpha RGBA8 `data` WITHOUT an undo step (the caller owns history, e.g. text layers
 * re-render from their data on undo). Allocates tiles on demand and frees tiles that end up fully transparent.
 */
export function putRegionPixels(doc: Document, layer: Layer, rect: Rect, data: Uint8ClampedArray | Uint8Array): void {
  const store = layer.tiles
  if (!store) throw new Error('putRegionPixels: not an infinite layer')
  const gpu = doc.gpu
  const tmp = gpu.surface(rect.w, rect.h, store.fmt, 0)
  gpu.uploadRGBA8(tmp, 0, 0, rect.w, rect.h, data)
  for (const p of regionPieces(rect)) {
    const dst = store.ensure(p.tx, p.ty)
    gpu.blit(tmp, { x: p.dx, y: p.dy, w: p.w, h: p.h }, dst, p.sx, p.sy)
  }
  tmp.dispose()
  store.prune(regionPieces(rect).map((p) => tileKey(p.tx, p.ty)))
}
