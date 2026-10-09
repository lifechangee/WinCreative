import type { Rect } from '../core/types'
import { TILE, TileKey, boundsOfKeys, tileKey, tileKeyX, tileKeyY, tileRect, unionBounds } from '../core/tiles'
import { FS_VERT, GPU, PixFormat, Surface } from '../gl/gpu'
import { decodeSync, scratch, uploadPremult } from '../io/tileIo'
import { blobSum } from '../core/blobSum'

/** Logical clock of the LRU (advanced once per presented frame by TileMemory.tick). */
export const tileClock = { n: 1 }
/** Counters of the memory tiers (CPU tier = compressed blobs in RAM; disk tier = scratch files). */
export const memCounters = { cpuBytes: 0, diskBytes: 0, syncRestores: 0, restores: 0, evictions: 0, spills: 0, corrupt: 0, recoveredCopies: 0 }

/** Saved (PNG) form of a tile: in RAM (png), on the scratch disk (disk) or both while a spill is in flight. Exclusively owned by one holder. */
export interface Saved {
  uid: number
  rev: number
  png: Uint8Array | null
  disk: string | null
  size: number
  /** blobSum of the bytes (null = not computed yet: blobs viewed zero-copy out of a loaded .bwk, whose zip CRC was verified at write time) */
  sum: number | null
}
/** A saved tile blob no longer matches its checksum and no intact second copy exists. */
export class BlobCorruptError extends Error {
  constructor(readonly docId: string) {
    super('tile blob checksum mismatch')
    this.name = 'BlobCorruptError'
  }
}
/** Called (once per event) when a corrupt blob was met; the app tells the user. Set by the application. */
export const blobHooks: { onCorrupt: ((docId: string) => void) | null } = { onCorrupt: null }
let scratchSeq = 0
export const scratchName = (): string => 't' + ++scratchSeq + '.png'
export function newSaved(png: Uint8Array, uid = -1, rev = -1, hash = true): Saved {
  memCounters.cpuBytes += png.length
  return { uid, rev, png, disk: null, size: png.length, sum: hash ? blobSum(png) : null }
}
export function savedRelease(doc: string, sv: Saved): void {
  if (sv.png) memCounters.cpuBytes -= sv.png.length
  if (sv.disk) {
    memCounters.diskBytes -= sv.size
    void scratch().remove(doc, sv.disk)
    sv.disk = null
  }
  sv.png = null
}
const intact = (sv: Saved, b: Uint8Array | null): b is Uint8Array => !!b && b.length === sv.size && (sv.sum === null || blobSum(b) === sv.sum)
/** Verify the bytes of `sv` read from `b` (RAM) or the scratch file; falls back to the other copy when both exist. Throws BlobCorruptError otherwise. */
export function checkedBlob(doc: string, sv: Saved, ram: Uint8Array | null, disk: Uint8Array | null): Uint8Array {
  if (intact(sv, ram)) return ram
  if (intact(sv, disk)) {
    if (ram) memCounters.recoveredCopies++
    return disk
  }
  if (!ram && !disk) throw new Error('tile blob is gone')
  memCounters.corrupt++
  console.error('[tile-memory] tile blob failed its checksum (doc ' + doc + ')')
  window.brushwork?.diag('tile blob checksum mismatch doc=' + doc)
  blobHooks.onCorrupt?.(doc)
  throw new BlobCorruptError(doc)
}
export function savedBytes(doc: string, sv: Saved): Uint8Array {
  const ram = sv.png
  // a scratch file is read only when there is no RAM copy, or the RAM copy is damaged and a file copy exists (spill in flight)
  if (ram && intact(sv, ram)) return ram
  return checkedBlob(doc, sv, ram, sv.disk ? scratch().getSync(doc, sv.disk) : null)
}
/** async variant for the prefetch path (decode off-thread) */
export async function savedBytesAsync(doc: string, sv: Saved): Promise<Uint8Array | null> {
  const ram = sv.png
  if (ram && intact(sv, ram)) return ram
  return checkedBlob(doc, sv, ram, sv.disk ? await scratch().get(doc, sv.disk) : null)
}

/**
 * Sparse pixel storage of one infinite-canvas layer, in three tiers:
 *   resident (`map`)  GPU surfaces of TILE x TILE
 *   clean   (`clean`) resident tiles that also have a valid saved PNG (evicting them is free; a save reuses the PNG)
 *   cold    (`cold`)  evicted tiles: only the saved PNG, in RAM or on the scratch disk
 * Every accessor (get/ensure/take...) transparently restores a cold tile synchronously; TileMemory.prefetch restores them asynchronously.
 * A missing tile is transparent. `version` changes whenever the SET of tiles changes (alloc / free / swap) - not on eviction / restore.
 */
export class TileStore {
  readonly map = new Map<TileKey, Surface>()
  readonly cold = new Map<TileKey, Saved>()
  readonly clean = new Map<TileKey, Saved>()
  readonly stamp = new Map<TileKey, number>()
  docId = 'doc'
  version = 0
  disposed = false
  /** set by TileMemory.register */
  onDispose: (() => void) | null = null

  constructor(
    readonly gpu: GPU,
    readonly fmt: PixFormat,
    readonly size = TILE
  ) {}

  /** tiles in every tier */
  get count(): number {
    return this.map.size + this.cold.size
  }
  get residentCount(): number {
    return this.map.size
  }
  get coldCount(): number {
    return this.cold.size
  }
  /** GPU bytes held by the resident tiles */
  get bytes(): number {
    return this.map.size * this.tileBytes
  }
  get tileBytes(): number {
    return this.size * this.size * (this.fmt === 'rgba16f' ? 8 : 4)
  }
  *keys(): IterableIterator<TileKey> {
    yield* this.map.keys()
    yield* this.cold.keys()
  }
  getKey(key: TileKey): Surface | undefined {
    const s = this.map.get(key)
    if (s) {
      this.stamp.set(key, tileClock.n)
      return s
    }
    return this.cold.has(key) ? this.restoreSync(key) : undefined
  }
  get(tx: number, ty: number): Surface | undefined {
    return this.getKey(tileKey(tx, ty))
  }
  /** resident surface only: never restores, never touches the LRU */
  peekKey(key: TileKey): Surface | undefined {
    return this.map.get(key)
  }
  hasKey(key: TileKey): boolean {
    return this.map.has(key) || this.cold.has(key)
  }
  isCold(key: TileKey): boolean {
    return this.cold.has(key)
  }
  has(tx: number, ty: number): boolean {
    return this.hasKey(tileKey(tx, ty))
  }
  touch(key: TileKey): void {
    if (this.map.has(key)) this.stamp.set(key, tileClock.n)
  }

  /** The tile at (tx,ty); allocated (transparent) when missing, restored when evicted. */
  ensure(tx: number, ty: number): Surface {
    const k = tileKey(tx, ty)
    let s = this.map.get(k)
    if (!s) {
      if (this.cold.has(k)) return this.restoreSync(k)
      s = this.gpu.surface(this.size, this.size, this.fmt)
      this.map.set(k, s)
      this.version++
    }
    this.stamp.set(k, tileClock.n)
    return s
  }
  ensureKey(key: TileKey): Surface {
    return this.ensure(tileKeyX(key), tileKeyY(key))
  }

  // ------------------------------------------------------------------ tiers
  private discard(sv: Saved | undefined): void {
    if (sv) savedRelease(this.docId, sv)
  }
  private validClean(key: TileKey): Saved | undefined {
    const sv = this.clean.get(key)
    const s = this.map.get(key)
    if (sv && (!s || sv.uid !== s.uid || sv.rev !== s.rev)) {
      this.clean.delete(key)
      this.discard(sv)
      return undefined
    }
    return sv
  }
  /** resident and unchanged since its saved form was made */
  isClean(key: TileKey): boolean {
    return !!this.validClean(key)
  }
  /** valid saved form of a tile (cold or clean-resident) */
  savedOf(key: TileKey): Saved | undefined {
    return this.cold.get(key) ?? this.validClean(key)
  }
  /** Record the PNG encoded from `surf` at revision `rev`. Ignored when the tile changed meanwhile. */
  attach(key: TileKey, surf: Surface, rev: number, png: Uint8Array): boolean {
    if (this.map.get(key) !== surf || surf.rev !== rev) return false
    this.discard(this.clean.get(key))
    this.clean.set(key, newSaved(png, surf.uid, rev))
    return true
  }
  /** Drop the saved form of a clean resident tile (RAM pressure); it is regenerated when needed. */
  dropClean(key: TileKey): void {
    this.discard(this.clean.get(key))
    this.clean.delete(key)
  }
  /** Free the GPU surface of a clean resident tile; it stays addressable as a cold tile. */
  evictClean(key: TileKey): boolean {
    const sv = this.validClean(key)
    const s = this.map.get(key)
    if (!sv || !s) return false
    this.map.delete(key)
    this.clean.delete(key)
    this.stamp.delete(key)
    this.cold.set(key, sv)
    s.dispose()
    memCounters.evictions++
    return true
  }
  /** Install a saved form as an evicted tile (lazy load, undo of a removal) - no decode. */
  putCold(key: TileKey, sv: Saved): void {
    this.removeAny(key)
    this.cold.set(key, sv)
    this.version++
  }
  private removeAny(key: TileKey): void {
    const s = this.map.get(key)
    if (s) {
      this.map.delete(key)
      s.dispose()
    }
    this.discard(this.clean.get(key))
    this.clean.delete(key)
    this.discard(this.cold.get(key))
    this.cold.delete(key)
    this.stamp.delete(key)
  }
  private makeResident(key: TileKey, sv: Saved, rgba: Uint8Array): Surface {
    const s = this.gpu.surface(this.size, this.size, this.fmt, 0) // allocate BEFORE binding the upload texture
    uploadPremult(this.gpu, s, rgba)
    this.cold.delete(key)
    this.map.set(key, s)
    sv.uid = s.uid
    sv.rev = s.rev
    this.clean.set(key, sv)
    this.stamp.set(key, tileClock.n)
    memCounters.restores++
    return s
  }
  /** Synchronous restore (main-thread decode); the panning path uses TileMemory.prefetch instead. */
  restoreSync(key: TileKey): Surface {
    const sv = this.cold.get(key)!
    let d: ReturnType<typeof decodeSync> = null
    try {
      d = decodeSync(savedBytes(this.docId, sv))
    } catch (e) {
      if (!(e instanceof BlobCorruptError)) throw e
    }
    if (!d || d.w !== this.size || d.h !== this.size) {
      // damaged blob with no intact copy: the tile comes back empty (the user was told through blobHooks) instead of failing every operation that touches it
      memCounters.corrupt++
      this.removeAny(key)
      const s = this.gpu.surface(this.size, this.size, this.fmt)
      this.map.set(key, s)
      this.stamp.set(key, tileClock.n)
      this.version++
      return s
    }
    memCounters.syncRestores++
    return this.makeResident(key, sv, d.rgba)
  }
  /** Async restore completion (decoded off-thread). false when the tile changed meanwhile. */
  restoreWith(key: TileKey, sv: Saved, rgba: Uint8Array): boolean {
    if (this.disposed || this.cold.get(key) !== sv) return false
    this.makeResident(key, sv, rgba)
    return true
  }

  /** Remove a tile WITHOUT disposing it (undo machinery owns the surface afterwards). An evicted tile is restored first. */
  take(key: TileKey): Surface | null {
    let s = this.map.get(key)
    if (!s) {
      if (!this.cold.has(key)) return null
      s = this.restoreSync(key)
    }
    this.map.delete(key)
    this.discard(this.clean.get(key))
    this.clean.delete(key)
    this.stamp.delete(key)
    this.version++
    return s
  }
  /** Remove a tile in whatever form it has WITHOUT decoding: a surface (resident) or its saved blob (evicted). */
  takeAny(key: TileKey): { surf: Surface | null; saved: Saved | null } {
    const sv = this.cold.get(key)
    if (sv) {
      this.cold.delete(key)
      this.version++
      return { surf: null, saved: sv }
    }
    return { surf: this.take(key), saved: null }
  }
  /** Insert a surface as the tile (replaces and disposes nothing: the caller manages the old one via take()). */
  put(key: TileKey, s: Surface): void {
    this.discard(this.clean.get(key))
    this.clean.delete(key)
    this.map.set(key, s)
    this.stamp.set(key, tileClock.n)
    this.version++
  }
  free(key: TileKey): void {
    if (!this.hasKey(key)) return
    this.removeAny(key)
    this.version++
  }

  /** Bounding rect at tile granularity, or null when empty. */
  bounds(): Rect | null {
    return boundsOfKeys(this.keys(), this.size)
  }
  tileRectOf(key: TileKey): Rect {
    return tileRect(tileKeyX(key), tileKeyY(key), this.size)
  }

  /** Upload straight RGBA8 pixels (size x size) into tile (tx,ty). */
  upload(tx: number, ty: number, data: Uint8ClampedArray | Uint8Array): void {
    const k = tileKey(tx, ty)
    if (this.cold.has(k)) this.removeAny(k) // fully overwritten: no need to decode the old pixels
    const s = this.ensure(tx, ty)
    this.gpu.uploadRGBA8(s, 0, 0, this.size, this.size, data)
  }

  clone(): TileStore {
    const c = new TileStore(this.gpu, this.fmt, this.size)
    c.docId = this.docId
    for (const [k, s] of this.map) {
      const n = this.gpu.surface(this.size, this.size, this.fmt)
      this.gpu.blit(s, { x: 0, y: 0, w: this.size, h: this.size }, n, 0, 0)
      c.map.set(k, n)
    }
    for (const [k, sv] of this.cold) c.cold.set(k, newSaved(savedBytes(this.docId, sv).slice()))
    c.version++
    return c
  }

  /** Keys (among `keys`) of tiles whose alpha is zero everywhere. Evicted tiles are non-empty by construction (empty tiles are freed first). */
  emptyAmong(keys: Iterable<TileKey>): TileKey[] {
    const out: TileKey[] = []
    for (const k of keys) {
      const s = this.map.get(k)
      if (s && isTransparent(this.gpu, s)) out.push(k)
    }
    return out
  }

  /** Tight pixel bounds of the content (resident tiles read back, cached per revision; evicted tiles count whole). */
  tightBounds(maxTiles = 400): Rect | null {
    if (this.count > maxTiles) return this.bounds()
    let out: Rect | null = null
    for (const [k, s] of this.map) {
      const b = tileTight(this.gpu, s)
      if (!b) continue
      const o = this.tileRectOf(k)
      out = unionBounds(out, { x: o.x + b.x, y: o.y + b.y, w: b.w, h: b.h })
    }
    for (const k of this.cold.keys()) out = unionBounds(out, this.tileRectOf(k))
    return out
  }

  /** Free every resident tile whose alpha is zero everywhere. Returns the freed keys. */
  prune(keys: Iterable<TileKey> = this.map.keys()): TileKey[] {
    const freed: TileKey[] = []
    for (const k of [...keys]) {
      const s = this.map.get(k) // evicted tiles are non-empty by construction
      if (!s || nonEmptyAt.get(s) === s.rev) continue // already known to hold pixels at this revision
      if (isTransparent(this.gpu, s)) {
        this.free(k)
        freed.push(k)
      } else nonEmptyAt.set(s, s.rev)
    }
    return freed
  }

  dispose(): void {
    this.disposed = true
    this.onDispose?.()
    for (const s of this.map.values()) s.dispose()
    this.map.clear()
    for (const sv of this.clean.values()) this.discard(sv)
    for (const sv of this.cold.values()) this.discard(sv)
    this.clean.clear()
    this.cold.clear()
    this.stamp.clear()
    this.version++
  }
}

const nonEmptyAt = new WeakMap<Surface, number>()

const MAXA_FS = `#version 300 es
precision highp float;
uniform sampler2D uSrc;
out vec4 o;
void main(){
  ivec2 b = ivec2(gl_FragCoord.xy) * 8;
  float m = 0.0;
  for (int j = 0; j < 8; j++) for (int i = 0; i < 8; i++) m = max(m, texelFetch(uSrc, b + ivec2(i, j), 0).a);
  o = vec4(m);
}`

const tightCache = new WeakMap<Surface, { rev: number; b: Rect | null }>()
function tileTight(gpu: GPU, s: Surface): Rect | null {
  const c = tightCache.get(s)
  if (c && c.rev === s.rev) return c.b
  const px = gpu.readRGBA8(s, { x: 0, y: 0, w: s.w, h: s.h })
  let x0 = s.w
  let y0 = s.h
  let x1 = -1
  let y1 = -1
  for (let y = 0; y < s.h; y++) {
    for (let x = 0; x < s.w; x++) {
      if (px[(y * s.w + x) * 4 + 3] === 0) continue
      if (x < x0) x0 = x
      if (x > x1) x1 = x
      if (y < y0) y0 = y
      y1 = y
    }
  }
  const b = x1 < 0 ? null : { x: x0, y: y0, w: x1 - x0 + 1, h: y1 - y0 + 1 }
  tightCache.set(s, { rev: s.rev, b })
  return b
}

const chains = new WeakMap<GPU, Surface[]>()

/** True when no pixel of the (square, power-of-8 sized) surface has alpha > 0. Exact for RGBA8; RGBA16F alpha below 1/510 counts as 0. */
export function isTransparent(gpu: GPU, s: Surface): boolean {
  const gl = gpu.gl
  let c = chains.get(gpu)
  if (!c) chains.set(gpu, (c = []))
  const p = gpu.program('tile-maxa', FS_VERT, MAXA_FS).use()
  p.i('uSrc', 0)
  gl.disable(gl.BLEND)
  let src = s
  let n = 0
  let w = s.w
  while (w > 1) {
    w = Math.max(1, Math.ceil(w / 8))
    const dst = (c[n] ??= gpu.surface(Math.max(1, w), Math.max(1, w), 'rgba8', 0))
    if (dst.w !== w) {
      dst.dispose()
      c[n] = gpu.surface(w, w, 'rgba8', 0)
    }
    gpu.bindTex(0, src.tex)
    gpu.bindTarget(c[n], null)
    gpu.fullscreen()
    src = c[n]
    n++
  }
  const px = new Uint8Array(4)
  gl.bindFramebuffer(gl.FRAMEBUFFER, src.fbo)
  gl.readPixels(0, 0, 1, 1, gl.RGBA, gl.UNSIGNED_BYTE, px)
  return px[3] === 0
}
