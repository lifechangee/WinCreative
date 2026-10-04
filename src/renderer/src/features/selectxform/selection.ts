import type { App } from '../../app/app'
import type { Rect } from '../../core/types'
import { unionRect } from '../../core/geometry'
import type { Command } from '../../core/undo'
import type { Surface } from '../../gl/gpu'
import { clipMask } from '../../gl/clipMask'
import { prefs } from '../../input/prefs'
import { blurMask, combinePatch, expandClamp, MaskPatch, maskBounds, SelMode } from './geom'

/** Cropped copy of the mask (or null = no selection). */
export interface SelSnapshot {
  rect: Rect
  data: Uint8Array
}

export interface SavedSelection {
  name: string
  snap: SelSnapshot
}

/**
 * Global selection mask service (`app.selection`).
 *
 * The mask is stored twice: `data` (CPU, authoritative, 0..255 coverage, doc-sized) and a GPU texture
 * (`mask`, RGBA8, coverage in .r) that the brush engine / fills / filters sample to clip their output.
 * `mask` is null when nothing is selected. All edits made through this class are undoable.
 */
export class SelectionService {
  data: Uint8Array | null = null
  private surf: Surface | null = null
  private b: Rect | null = null
  private listeners = new Set<() => void>()
  private saved = new WeakMap<object, SavedSelection[]>()
  /** overlay tint strength for the area outside the selection (0..1), see Selection panel */
  get maskVisibility(): number {
    return prefs.v.selectionMaskVisibility
  }
  set maskVisibility(v: number) {
    prefs.v.selectionMaskVisibility = Math.min(1, Math.max(0, v))
  }
  /** which channel of `mask` holds coverage (for consumers that ask) */
  readonly maskChannel = 'r' as const

  constructor(readonly app: App) {}

  get w(): number {
    return this.app.doc.width
  }
  get h(): number {
    return this.app.doc.height
  }

  // ------------------------------------------------------------------ public read API
  /** GPU coverage texture (doc-sized, .r = 0..1) or null when there is no selection. */
  get mask(): WebGLTexture | null {
    return this.data && this.surf ? this.surf.tex : null
  }
  get surface(): Surface | null {
    return this.data ? this.surf : null
  }
  hasSelection(): boolean {
    return this.data !== null
  }
  /** Tight document-space bounding box of the selected pixels, or null. */
  bounds(): Rect | null {
    return this.data && this.b ? { ...this.b } : null
  }
  /** Subscribe to selection changes (edit, undo/redo, clear, document switch). Returns unsubscribe. */
  onChange(cb: () => void): () => void {
    this.listeners.add(cb)
    return () => void this.listeners.delete(cb)
  }
  /** Coverage 0..1 of the mask at a document pixel (1 when nothing is selected). */
  coverageAt(x: number, y: number): number {
    if (!this.data) return 1
    x = Math.floor(x)
    y = Math.floor(y)
    if (x < 0 || y < 0 || x >= this.w || y >= this.h) return 0
    return this.data[y * this.w + x] / 255
  }
  setMaskVisibility(v: number): void {
    // single source of truth: Preferences > Selection mask visibility (also drives the --selection-mask CSS var)
    prefs.set('selectionMaskVisibility', Math.min(1, Math.max(0, v)))
    this.app.requestRender()
  }

  // ------------------------------------------------------------------ lifecycle
  /** Drop everything (document replaced). */
  reset(): void {
    this.data = null
    this.b = null
    this.surf?.dispose()
    this.surf = null
    clipMask.tex = null
    this.emit()
  }

  private ensure(): void {
    if (!this.surf || this.surf.w !== this.w || this.surf.h !== this.h) {
      this.surf?.dispose()
      this.surf = this.app.gpu.surface(this.w, this.h, 'rgba8')
    }
    if (!this.data) {
      this.data = new Uint8Array(this.w * this.h)
      this.app.gpu.clear(this.surf)
    }
  }

  private emit(): void {
    clipMask.tex = this.mask
    for (const l of [...this.listeners]) {
      try {
        l()
      } catch (e) {
        console.error('[selection] listener', e)
      }
    }
    this.app.requestRender()
  }

  /** Copy CPU mask region to the GPU texture. */
  private upload(r: Rect | null): void {
    if (!this.data || !this.surf || !r) return
    const x0 = Math.max(0, Math.floor(r.x))
    const y0 = Math.max(0, Math.floor(r.y))
    const x1 = Math.min(this.w, Math.ceil(r.x + r.w))
    const y1 = Math.min(this.h, Math.ceil(r.y + r.h))
    const rw = x1 - x0
    const rh = y1 - y0
    if (rw <= 0 || rh <= 0) return
    const CH = 512
    for (let ys = y0; ys < y1; ys += CH) {
      const hh = Math.min(CH, y1 - ys)
      const buf = new Uint8Array(rw * hh * 4)
      for (let y = 0; y < hh; y++) {
        const so = (ys + y) * this.w + x0
        let o = y * rw * 4
        for (let x = 0; x < rw; x++, o += 4) {
          const v = this.data[so + x]
          buf[o] = buf[o + 1] = buf[o + 2] = v
          buf[o + 3] = 255
        }
      }
      this.app.gpu.uploadRGBA8(this.surf, x0, ys, rw, hh, buf)
    }
  }

  /** Recompute bounds; free the mask when it became empty. */
  private finalize(hint?: Rect): void {
    if (!this.data) return
    this.b = maskBounds(this.data, this.w, this.h, hint)
    if (!this.b) {
      this.data = null
      this.b = null
    }
  }

  // ------------------------------------------------------------------ snapshots / undo
  snapshot(): SelSnapshot | null {
    if (!this.data || !this.b) return null
    const r = { ...this.b }
    const out = new Uint8Array(r.w * r.h)
    for (let y = 0; y < r.h; y++) out.set(this.data.subarray((r.y + y) * this.w + r.x, (r.y + y) * this.w + r.x + r.w), y * r.w)
    return { rect: r, data: out }
  }

  /** Replace the mask with a snapshot (no history). */
  restore(s: SelSnapshot | null): void {
    const old = this.b
    if (!s) {
      if (this.data) {
        this.data = null
        this.b = null
      }
      this.emit()
      return
    }
    this.ensure()
    const d = this.data!
    if (old) for (let y = 0; y < old.h; y++) d.fill(0, (old.y + y) * this.w + old.x, (old.y + y) * this.w + old.x + old.w)
    for (let y = 0; y < s.rect.h; y++) d.set(s.data.subarray(y * s.rect.w, (y + 1) * s.rect.w), (s.rect.y + y) * this.w + s.rect.x)
    this.b = { ...s.rect }
    this.upload(unionRect(old, s.rect))
    this.emit()
  }

  private snapBytes(s: SelSnapshot | null): number {
    return s ? s.data.length : 0
  }

  /** Build an undo command that flips between two snapshots. */
  command(label: string, before: SelSnapshot | null, after: SelSnapshot | null): Command {
    return {
      label,
      layerId: null,
      dirtyRect: null,
      bytes: this.snapBytes(before) + this.snapBytes(after),
      undo: () => this.restore(before),
      redo: () => this.restore(after)
    }
  }

  private record(label: string, before: SelSnapshot | null, after: SelSnapshot | null): void {
    const doc = this.app.doc
    doc.history.push(this.command(label, before, after))
    doc.emitCommit('selection', null, null, label)
  }

  // ------------------------------------------------------------------ live (preview) edits
  /** Start an interactive edit: preview() repeatedly, then commit() (one undo step) or cancel(). */
  begin(): LiveEdit {
    return new LiveEdit(this)
  }

  /** @internal used by LiveEdit */
  _internals(): { data: Uint8Array | null; b: Rect | null } {
    return { data: this.data, b: this.b }
  }
  /** @internal */
  _apply(base: Uint8Array | null, baseB: Rect | null, patch: MaskPatch | null, mode: SelMode, prevRect: Rect | null): Rect | null {
    this.ensure()
    const d = this.data!
    const w = this.w
    // region that may differ from base: everything for replace, else previous + new patch rects
    let region: Rect | null = unionRect(prevRect, patch?.rect ?? null)
    if (mode === 'replace') region = unionRect(region, baseB)
    if (!region) return prevRect
    region = expandClamp(region, 0, w, this.h)
    for (let y = region.y; y < region.y + region.h; y++) {
      const o = y * w + region.x
      if (base) d.set(base.subarray(o, o + region.w), o)
      else d.fill(0, o, o + region.w)
    }
    if (mode === 'replace') {
      // base is discarded entirely for replace: clear the union region
      for (let y = region.y; y < region.y + region.h; y++) d.fill(0, y * w + region.x, y * w + region.x + region.w)
    }
    if (patch) combinePatch(d, w, patch, mode === 'replace' ? 'add' : mode)
    this.upload(region)
    this.b = unionRect(this.b, region)
    this.emit()
    return region
  }
  /** @internal (feather etc.) apply fn to a fresh copy of base inside `area` */
  _applyBlur(base: Uint8Array, baseB: Rect, radius: number): Rect {
    this.ensure()
    const d = this.data!
    const w = this.w
    const area = expandClamp(baseB, radius * 2 + 4, w, this.h)
    for (let y = area.y; y < area.y + area.h; y++) {
      const o = y * w + area.x
      d.set(base.subarray(o, o + area.w), o)
    }
    blurMask(d, w, area, radius)
    this.upload(area)
    this.b = area
    this.emit()
    return area
  }
  /** @internal */
  _finish(hint: Rect | null): void {
    this.finalize(hint ?? undefined)
    // bounds are exact now; GPU texture already holds identical data
    this.emit()
  }

  // ------------------------------------------------------------------ convenient undoable operations
  /** Apply a rasterised shape with a set mode. Undoable. Returns false if nothing changed. */
  applyPatch(patch: MaskPatch | null, mode: SelMode, label = 'Selection'): boolean {
    const e = this.begin()
    e.preview(patch, mode)
    return e.commit(label)
  }

  selectAll(): void {
    const before = this.snapshot()
    this.ensure()
    this.data!.fill(255)
    this.b = { x: 0, y: 0, w: this.w, h: this.h }
    this.upload(this.b)
    this.emit()
    this.record('Select all', before, this.snapshot())
  }

  clear(label = 'Deselect'): void {
    if (!this.data) return
    const before = this.snapshot()
    this.data = null
    this.b = null
    this.emit()
    this.record(label, before, null)
  }

  invert(): void {
    const before = this.snapshot()
    this.ensure()
    const d = this.data!
    for (let i = 0; i < d.length; i++) d[i] = 255 - d[i]
    this.b = { x: 0, y: 0, w: this.w, h: this.h }
    this.upload(this.b)
    this._finish(null)
    this.record('Invert selection', before, this.snapshot())
  }

  /** Replace the selection with `alphaMask` (full-canvas 0..255). Takes ownership of the array. */
  setFromFull(full: Uint8Array | null, label: string): void {
    const before = this.snapshot()
    if (!full) {
      this.data = null
      this.b = null
      this.emit()
    } else {
      const old = this.b
      this.ensure()
      this.data!.set(full)
      this.upload({ x: 0, y: 0, w: this.w, h: this.h })
      this.b = old
      this._finish(null)
    }
    this.record(label, before, this.snapshot())
  }

  /** Replace the selection with a patch region content (already positioned). Used by transform. */
  replaceWithRegion(regionRect: Rect | null, region: Uint8Array | null, clearRect: Rect | null): void {
    // clears clearRect then writes region (rect-sized)
    this.ensure()
    const d = this.data!
    const w = this.w
    if (clearRect) for (let y = 0; y < clearRect.h; y++) d.fill(0, (clearRect.y + y) * w + clearRect.x, (clearRect.y + y) * w + clearRect.x + clearRect.w)
    if (regionRect && region) {
      for (let y = 0; y < regionRect.h; y++) d.set(region.subarray(y * regionRect.w, (y + 1) * regionRect.w), (regionRect.y + y) * w + regionRect.x)
    }
    this.upload(unionRect(clearRect, regionRect))
    this._finish(null)
  }

  // ------------------------------------------------------------------ save / load
  /** persistence hooks (see index.ts bwk extension) */
  savedFor(doc: object): SavedSelection[] {
    return this.saved.get(doc) ?? []
  }
  setSavedFor(doc: object, list: SavedSelection[]): void {
    this.saved.set(doc, list)
  }
  savedList(): SavedSelection[] {
    const doc = this.app.doc
    let l = this.saved.get(doc)
    if (!l) this.saved.set(doc, (l = []))
    return l
  }
  saveCurrent(name: string): boolean {
    const s = this.snapshot()
    if (!s) return false
    const l = this.savedList()
    const i = l.findIndex((x) => x.name === name)
    if (i >= 0) l[i] = { name, snap: s }
    else l.push({ name, snap: s })
    return true
  }
  load(name: string, mode: SelMode = 'replace'): boolean {
    const s = this.savedList().find((x) => x.name === name)
    if (!s) return false
    const full = new Uint8Array(s.snap.rect.w * s.snap.rect.h)
    full.set(s.snap.data)
    const patch: MaskPatch = { rect: { ...s.snap.rect }, data: full }
    return this.applyPatch(patch, mode, 'Load selection')
  }
  deleteSaved(name: string): void {
    const l = this.savedList()
    const i = l.findIndex((x) => x.name === name)
    if (i >= 0) l.splice(i, 1)
  }
}

/** Interactive selection edit with live GPU preview. */
export class LiveEdit {
  private before: SelSnapshot | null
  private base: Uint8Array | null
  private baseB: Rect | null
  private last: Rect | null = null
  private touched: Rect | null = null
  private done = false

  constructor(private svc: SelectionService) {
    this.before = svc.snapshot()
    const { data, b } = svc._internals()
    this.base = data ? new Uint8Array(data) : null
    this.baseB = b ? { ...b } : null
    this.touched = this.baseB
  }

  preview(patch: MaskPatch | null, mode: SelMode): void {
    if (this.done) return
    this.last = this.svc._apply(this.base, this.baseB, patch, mode, this.last)
    this.touched = unionRect(this.touched, this.last)
  }

  /** Live feather/blur preview of the base mask. */
  previewBlur(radius: number): void {
    if (this.done || !this.base || !this.baseB) return
    this.last = this.svc._applyBlur(this.base, this.baseB, radius)
    this.touched = unionRect(this.touched, this.last)
  }

  /** Finish: one undo step. Returns false when nothing changed. */
  commit(label: string): boolean {
    if (this.done) return false
    this.done = true
    this.svc._finish(this.touched)
    const after = this.svc.snapshot()
    const same = snapEqual(this.before, after)
    if (same) return false
    const doc = this.svc.app.doc
    doc.history.push(this.svc.command(label, this.before, after))
    doc.emitCommit('selection', null, null, label)
    return true
  }

  cancel(): void {
    if (this.done) return
    this.done = true
    this.svc.restore(this.before)
  }
}

function snapEqual(a: SelSnapshot | null, b: SelSnapshot | null): boolean {
  if (!a || !b) return a === b
  if (a.rect.x !== b.rect.x || a.rect.y !== b.rect.y || a.rect.w !== b.rect.w || a.rect.h !== b.rect.h) return false
  for (let i = 0; i < a.data.length; i++) if (a.data[i] !== b.data[i]) return false
  return true
}

declare module '../../app/app' {
  interface App {
    /** Global selection mask service (features/selectxform). */
    selection: SelectionService
  }
}
