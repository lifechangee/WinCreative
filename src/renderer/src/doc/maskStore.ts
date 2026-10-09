import { TILE } from '../core/tiles'
import type { GPU, PixFormat, Surface } from '../gl/gpu'
import { TileStore } from './tileStore'
import { tileMemory } from './tileMemory'

/**
 * Layer mask of an infinite layer: its own sparse tile store. A tile that does not exist reads as `fill` (1 = white = visible,
 * 0 = black = hidden); allocated tiles are initialised to that opaque value, so painting on the mask works like on a fixed mask.
 * The mask is attached to a 1x1 placeholder Surface (`layer.mask`) so the structural undo machinery (which tracks Surfaces) needs no changes.
 */
export class MaskTileStore extends TileStore {
  fill: 0 | 1 = 1

  /** mask tiles are paged by the tile memory manager like pixel tiles (scratch folder 'masks'; every store releases its own files) */
  constructor(gpu: GPU, fmt: PixFormat, size = TILE) {
    super(gpu, fmt, size)
    tileMemory.register(this, 'masks')
  }

  override ensure(tx: number, ty: number): Surface {
    const had = this.has(tx, ty)
    const s = super.ensure(tx, ty)
    if (!had) this.paintFill(s)
    return s
  }

  /** Initialise a (tile-sized) surface to the fill value. */
  paintFill(s: Surface): void {
    const gl = this.gpu.gl
    this.gpu.bindTarget(s, null)
    gl.clearColor(this.fill, this.fill, this.fill, 1)
    gl.clear(gl.COLOR_BUFFER_BIT)
    gl.clearColor(0, 0, 0, 0)
  }

  override clone(): MaskTileStore {
    const c = new MaskTileStore(this.gpu, this.fmt, this.size)
    c.fill = this.fill
    for (const k of this.keys()) {
      const src = this.getKey(k) // restores an evicted tile
      if (!src) continue
      const n = this.gpu.surface(this.size, this.size, this.fmt)
      this.gpu.blit(src, { x: 0, y: 0, w: this.size, h: this.size }, n, 0, 0)
      c.map.set(k, n)
    }
    c.version++
    return c
  }
}

/** Placeholder surface that carries an infinite mask (see MaskTileStore). */
export function newInfMask(gpu: GPU, fmt: PixFormat, fill: 0 | 1): Surface {
  const s = gpu.surface(1, 1, 'rgba8', 0)
  const store = new MaskTileStore(gpu, fmt, TILE)
  store.fill = fill
  s.inf = store
  return s
}

/** Deep copy of an infinite mask (duplicate layer). */
export function cloneInfMask(gpu: GPU, src: Surface): Surface {
  const s = gpu.surface(1, 1, 'rgba8', 0)
  s.inf = (src.inf as MaskTileStore).clone()
  return s
}
