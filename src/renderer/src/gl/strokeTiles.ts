import { TILE, TileKey, tileKeyX, tileKeyY } from '../core/tiles'
import type { GPU, PixFormat, Surface } from './gpu'

/** Read access to the tiles of a live stroke buffer (the compositor binds the tile of the tile it is composing). */
export interface TileSource {
  get(key: TileKey): Surface | undefined
  readonly map: ReadonlyMap<TileKey, Surface>
}

/** Recycles TILE x TILE stroke-buffer surfaces between strokes (allocating GL objects per stroke would hitch). */
export class SurfacePool {
  private free: Surface[] = []
  constructor(
    private gpu: GPU,
    private fmt: PixFormat,
    private cap = 64
  ) {}
  take(): Surface {
    return this.free.pop() ?? this.gpu.surface(TILE, TILE, this.fmt, 0)
  }
  /** Return a surface (cleared here). */
  give(s: Surface): void {
    if (this.free.length >= this.cap) return s.dispose()
    this.gpu.clear(s)
    this.free.push(s)
  }
  dispose(): void {
    for (const s of this.free) s.dispose()
    this.free = []
  }
}

/**
 * Sparse per-stroke buffer: the infinite-canvas counterpart of the full-canvas stroke surfaces A / B / C of the brush engine.
 * A tile exists only where a dab touched it. Rendering into a tile happens with the dab coordinates made tile-relative, so a stroke
 * can be any size and sit at any coordinate.
 */
export class StrokeTiles implements TileSource {
  readonly map = new Map<TileKey, Surface>()
  constructor(private pool: SurfacePool) {}
  get(key: TileKey): Surface | undefined {
    return this.map.get(key)
  }
  ensure(key: TileKey): Surface {
    let s = this.map.get(key)
    if (!s) this.map.set(key, (s = this.pool.take()))
    return s
  }
  origin(key: TileKey): { x: number; y: number } {
    return { x: tileKeyX(key) * TILE, y: tileKeyY(key) * TILE }
  }
  /** Release every tile back to the pool (cleared). */
  clear(): void {
    for (const s of this.map.values()) this.pool.give(s)
    this.map.clear()
  }
}
