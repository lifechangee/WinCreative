import type { App } from '../../app/app'
import type { Rect } from '../../core/types'
import { clampToCanvas, intersectRect, unionRect } from '../../core/geometry'
import type { Command } from '../../core/undo'
import type { Surface } from '../../gl/gpu'
import { clipMask } from '../../gl/clipMask'
import { prefs } from '../../input/prefs'
import { t } from '../../i18n'
import { workRect } from '../frame/workRect'
import { blurMask, combinePatch, MaskPatch, maskBounds, SelMode } from './geom'

/** Cropped copy of the mask (or null = no selection). Coordinates are document space (any sign on infinite documents). */
export interface SelSnapshot {
  rect: Rect
  data: Uint8Array
}

export interface SavedSelection {
  name: string
  snap: SelSnapshot
}

/** Largest side (px) of the selection window of an infinite document (CPU 1 byte/px + one RGBA8 texture). */
export const MAX_SEL_WINDOW = 8192

/**
 * Global selection mask service (`app.selection`).
 *
 * The mask is stored twice: `data` (CPU, authoritative, 0..255 coverage) and a GPU texture (`mask`, RGBA8, coverage in .r) that the
 * brush engine / fills / filters sample to clip their output. `mask` is null when nothing is selected. All edits made through this
 * class are undoable.
 *
 * `data` covers the WINDOW `win` (document space): on fixed documents always the whole canvas (so `data` is canvas-sized exactly as
 * before); on infinite documents a movable bounded window that is allocated by the first selection and GROWS (with margin) when the
 * selection is extended, shrinks again when a much smaller selection remains, and is limited to MAX_SEL_WINDOW px per side. Everything
 * outside the window has coverage 0. Shaders map document px into the window with `ClipCtx` (gl/clipMask.ts).
 */
export class SelectionService {
  data: Uint8Array | null = null
  /** document-space rectangle that `data` / the GPU texture cover (only meaningful while `data` is set) */
  win: Rect = { x: 0, y: 0, w: 1, h: 1 }
  private surf: Surface | null = null
  private b: Rect | null = null
  private listeners = new Set<() => void>()
  private saved = new WeakMap<object, SavedSelection[]>()
  private warnAt = 0
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
  private get inf(): boolean {
    return this.app.doc.isInfinite
  }

  // ------------------------------------------------------------------ public read API
  /** GPU coverage texture (covers `window`, .r = 0..1) or null when there is no selection. */
  get mask(): WebGLTexture | null {
    return this.data && this.surf ? this.surf.tex : null
  }
  get surface(): Surface | null {
    return this.data ? this.surf : null
  }
  /** Document rect covered by `data` / `mask` (canvas on fixed documents), null without selection. Outside it the coverage is 0. */
  get window(): Rect | null {
    return this.data ? { ...this.win } : null
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
    const wn = this.win
    if (x < wn.x || y < wn.y || x >= wn.x + wn.w || y >= wn.y + wn.h) return 0
    return this.data[(y - wn.y) * wn.w + (x - wn.x)] / 255
  }
  /** Coverage bytes of an arbitrary document rect (0 outside the window); null when nothing is selected. */
  readRect(rect: Rect): Uint8Array | null {
    if (!this.data) return null
    const out = new Uint8Array(rect.w * rect.h)
    const ov = intersectRect(rect, this.win)
    if (!ov) return out
    for (let y = 0; y < ov.h; y++) {
      const so = (ov.y + y - this.win.y) * this.win.w + (ov.x - this.win.x)
      out.set(this.data.subarray(so, so + ov.w), (ov.y + y - rect.y) * rect.w + (ov.x - rect.x))
    }
    return out
  }
  /**
   * Coverage of document rect `rect` as a NEW rect-sized RGBA8 surface (coverage in .r, row 0 = rect.y); the caller disposes it.
   * null = nothing selected. Works on fixed and infinite documents (0 outside the mask window). Used by adjustments / liquify / clone.
   */
  coverageRegion(rect: Rect): Surface | null {
    const cov = this.readRect(rect)
    if (!cov) return null
    const gpu = this.app.gpu
    const s = gpu.surface(rect.w, rect.h, 'rgba8', 0)
    const CH = 256
    for (let y0 = 0; y0 < rect.h; y0 += CH) {
      const hh = Math.min(CH, rect.h - y0)
      const buf = new Uint8Array(rect.w * hh * 4)
      for (let i = 0, o = y0 * rect.w; i < rect.w * hh; i++, o++) {
        const v = cov[o]
        buf[i * 4] = buf[i * 4 + 1] = buf[i * 4 + 2] = v
        buf[i * 4 + 3] = 255
      }
      gpu.uploadRGBA8(s, 0, y0, rect.w, hh, buf)
    }
    return s
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
    clipMask.win = null
    this.emit()
  }

  private warnLimited(): void {
    const n = Date.now()
    if (n - this.warnAt < 2500) return
    this.warnAt = n
    this.app.notify(t('selectxform.limitedWindow', { n: MAX_SEL_WINDOW }))
  }

  /** Fixed documents: canvas-sized buffers. */
  private ensureFixed(): void {
    const doc = this.app.doc
    this.win = { x: 0, y: 0, w: doc.width, h: doc.height }
    if (!this.surf || this.surf.w !== doc.width || this.surf.h !== doc.height) {
      this.surf?.dispose()
      this.surf = this.app.gpu.surface(doc.width, doc.height, 'rgba8')
      this.data = null
    }
    if (!this.data) {
      this.data = new Uint8Array(doc.width * doc.height)
      this.app.gpu.clear(this.surf)
    }
  }

  /** Drop mask + window (infinite documents also free the texture). */
  private drop(): void {
    this.data = null
    this.b = null
    if (this.inf) {
      this.surf?.dispose()
      this.surf = null
    }
  }

  /** (Re)allocate the window to `nw`, keeping the content of the old one. */
  private realloc(nw: Rect): void {
    const old = this.data ? { data: this.data, win: this.win } : null
    this.surf?.dispose()
    this.surf = this.app.gpu.surface(nw.w, nw.h, 'rgba8')
    this.app.gpu.clear(this.surf)
    this.data = new Uint8Array(nw.w * nw.h)
    this.win = nw
    if (old) {
      const ov = intersectRect(old.win, nw)
      if (ov) {
        for (let y = 0; y < ov.h; y++) {
          const so = (ov.y + y - old.win.y) * old.win.w + (ov.x - old.win.x)
          this.data.set(old.data.subarray(so, so + ov.w), (ov.y + y - nw.y) * nw.w + (ov.x - nw.x))
        }
        this.upload(ov)
      }
    }
  }

  /**
   * Make the window cover `rect` (document space, any position) and return the part of `rect` that lies inside it.
   * Fixed documents: clamps to the canvas. Infinite documents: allocates / grows the window (with a margin so a growing drag does
   * not reallocate every move); the part beyond MAX_SEL_WINDOW px is dropped (toast).
   */
  grant(rect: Rect): Rect | null {
    if (!this.inf) {
      const c = clampToCanvas(rect, this.w, this.h)
      if (c) this.ensureFixed()
      return c
    }
    const x0 = Math.floor(rect.x)
    const y0 = Math.floor(rect.y)
    const x1 = Math.ceil(rect.x + rect.w)
    const y1 = Math.ceil(rect.y + rect.h)
    if (x1 <= x0 || y1 <= y0) return null
    const cur = this.data ? this.win : null
    const M = MAX_SEL_WINDOW
    // the granted range must keep (window U range) within M px
    const axis = (lo: number, hi: number, cLo: number, cHi: number): [number, number] | null => {
      const aLo = cur ? cHi - M : lo
      const aHi = cur ? cLo + M : lo + M
      const l = Math.max(lo, aLo)
      const h = Math.min(hi, aHi, l + M)
      return h > l ? [l, h] : null
    }
    const ax = axis(x0, x1, cur ? cur.x : 0, cur ? cur.x + cur.w : 0)
    const ay = axis(y0, y1, cur ? cur.y : 0, cur ? cur.y + cur.h : 0)
    if (!ax || !ay) return null
    const g: Rect = { x: ax[0], y: ay[0], w: ax[1] - ax[0], h: ay[1] - ay[0] }
    if (g.w < x1 - x0 || g.h < y1 - y0) this.warnLimited()
    if (cur && g.x >= cur.x && g.y >= cur.y && g.x + g.w <= cur.x + cur.w && g.y + g.h <= cur.y + cur.h) return g
    const u = unionRect(cur, g)!
    const pad = (len: number): number => Math.max(0, Math.min(cur ? Math.max(256, len >> 2) : 64, (M - len) >> 1))
    const px = pad(u.w)
    const py = pad(u.h)
    this.realloc({ x: u.x - px, y: u.y - py, w: u.w + 2 * px, h: u.h + 2 * py })
    return g
  }

  /** Infinite: shrink an oversized window around the real bounds (frees memory after a big selection became small). */
  private shrink(): void {
    if (!this.inf || !this.data || !this.b) return
    const wn = this.win
    if (wn.w * wn.h <= 1024 * 1024 || wn.w * wn.h < 6 * this.b.w * this.b.h) return
    this.realloc({ x: this.b.x - 64, y: this.b.y - 64, w: this.b.w + 128, h: this.b.h + 128 })
  }

  private emit(): void {
    clipMask.tex = this.mask
    clipMask.win = this.inf && this.data ? { ...this.win } : null
    for (const l of [...this.listeners]) {
      try {
        l()
      } catch (e) {
        console.error('[selection] listener', e)
      }
    }
    this.app.requestRender()
  }

  /** Copy CPU mask region (document space) to the GPU texture. */
  private upload(r: Rect | null): void {
    if (!this.data || !this.surf || !r) return
    const x = Math.floor(r.x)
    const y = Math.floor(r.y)
    const ov = intersectRect({ x, y, w: Math.ceil(r.x + r.w) - x, h: Math.ceil(r.y + r.h) - y }, this.win)
    if (!ov) return
    const wn = this.win
    const CH = 512
    for (let ys = ov.y; ys < ov.y + ov.h; ys += CH) {
      const hh = Math.min(CH, ov.y + ov.h - ys)
      const buf = new Uint8Array(ov.w * hh * 4)
      for (let yy = 0; yy < hh; yy++) {
        const so = (ys + yy - wn.y) * wn.w + (ov.x - wn.x)
        let o = yy * ov.w * 4
        for (let xx = 0; xx < ov.w; xx++, o += 4) {
          const v = this.data[so + xx]
          buf[o] = buf[o + 1] = buf[o + 2] = v
          buf[o + 3] = 255
        }
      }
      this.app.gpu.uploadRGBA8(this.surf, ov.x - wn.x, ys - wn.y, ov.w, hh, buf)
    }
  }

  /** Recompute bounds; free the mask when it became empty. */
  private finalize(hint?: Rect): void {
    if (!this.data) return
    const wn = this.win
    let lh: Rect | undefined
    if (hint) {
      const ov = intersectRect({ x: Math.floor(hint.x), y: Math.floor(hint.y), w: Math.ceil(hint.w) + 1, h: Math.ceil(hint.h) + 1 }, wn)
      lh = ov ? { x: ov.x - wn.x, y: ov.y - wn.y, w: ov.w, h: ov.h } : undefined
    }
    const lb = maskBounds(this.data, wn.w, wn.h, lh)
    this.b = lb ? { x: lb.x + wn.x, y: lb.y + wn.y, w: lb.w, h: lb.h } : null
    if (!this.b) this.drop()
  }

  private clearArea(r: Rect | null): void {
    if (!r || !this.data) return
    const ov = intersectRect(r, this.win)
    if (!ov) return
    for (let y = 0; y < ov.h; y++) {
      const o = (ov.y + y - this.win.y) * this.win.w + (ov.x - this.win.x)
      this.data.fill(0, o, o + ov.w)
    }
  }

  // ------------------------------------------------------------------ snapshots / undo
  snapshot(): SelSnapshot | null {
    if (!this.data || !this.b) return null
    const r = { ...this.b }
    const out = new Uint8Array(r.w * r.h)
    const wn = this.win
    for (let y = 0; y < r.h; y++) {
      const so = (r.y + y - wn.y) * wn.w + (r.x - wn.x)
      out.set(this.data.subarray(so, so + r.w), y * r.w)
    }
    return { rect: r, data: out }
  }

  /** Replace the mask with a snapshot (no history). */
  restore(s: SelSnapshot | null): void {
    const old = this.b
    if (!s) {
      this.drop()
      this.emit()
      return
    }
    if (!this.grant(s.rect)) return
    this.clearArea(old)
    const d = this.data!
    const wn = this.win
    for (let y = 0; y < s.rect.h; y++) d.set(s.data.subarray(y * s.rect.w, (y + 1) * s.rect.w), (s.rect.y + y - wn.y) * wn.w + (s.rect.x - wn.x))
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

  /**
   * @internal used by LiveEdit. Mask := (replace ? 0 : base) combined with `patch`, recomputed inside the region that may differ from
   * base. `base` is the cropped mask at the start of the edit.
   */
  _apply(base: SelSnapshot | null, patch: MaskPatch | null, mode: SelMode, prevRect: Rect | null): Rect | null {
    if (patch) {
      const g = this.grant(patch.rect)
      patch = g ? cropPatch(patch, g) : null
    }
    // region that may differ from base: everything for replace, else previous + new patch rects
    let region: Rect | null = unionRect(prevRect, patch?.rect ?? null)
    if (mode === 'replace') region = unionRect(region, base?.rect ?? null)
    if (!region) return prevRect
    const g = this.grant(region)
    if (!g) return prevRect
    region = g
    const d = this.data!
    const wn = this.win
    for (let y = region.y; y < region.y + region.h; y++) {
      const o = (y - wn.y) * wn.w + (region.x - wn.x)
      d.fill(0, o, o + region.w)
      if (base && mode !== 'replace' && y >= base.rect.y && y < base.rect.y + base.rect.h) {
        const x0 = Math.max(region.x, base.rect.x)
        const x1 = Math.min(region.x + region.w, base.rect.x + base.rect.w)
        if (x1 > x0) {
          const so = (y - base.rect.y) * base.rect.w + (x0 - base.rect.x)
          d.set(base.data.subarray(so, so + (x1 - x0)), (y - wn.y) * wn.w + (x0 - wn.x))
        }
      }
    }
    if (patch) combinePatch(d, wn.w, shift(patch, -wn.x, -wn.y), mode === 'replace' ? 'add' : mode)
    this.upload(region)
    this.b = unionRect(this.b, region)
    this.emit()
    return region
  }
  /** @internal (feather) blur the base mask by `radius` px */
  _applyBlur(base: SelSnapshot, radius: number): Rect | null {
    const m = radius * 2 + 4
    const area = this.grant({ x: base.rect.x - m, y: base.rect.y - m, w: base.rect.w + 2 * m, h: base.rect.h + 2 * m })
    if (!area) return null
    const d = this.data!
    const wn = this.win
    this.clearArea(area)
    const ov = intersectRect(area, base.rect)
    if (ov) {
      for (let y = 0; y < ov.h; y++) {
        const so = (ov.y + y - base.rect.y) * base.rect.w + (ov.x - base.rect.x)
        d.set(base.data.subarray(so, so + ov.w), (ov.y + y - wn.y) * wn.w + (ov.x - wn.x))
      }
    }
    blurMask(d, wn.w, { x: area.x - wn.x, y: area.y - wn.y, w: area.w, h: area.h }, radius)
    this.upload(area)
    this.b = area
    this.emit()
    return area
  }
  /** @internal */
  _finish(hint: Rect | null): void {
    this.finalize(hint ?? undefined)
    this.shrink()
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

  /** The region "select all" / "invert" operate on: the canvas (fixed) or the work rect = frame, else visible area (infinite). */
  allRect(): Rect {
    return this.inf ? workRect(this.app) : { x: 0, y: 0, w: this.w, h: this.h }
  }

  selectAll(): void {
    const before = this.snapshot()
    if (this.inf) this.drop() // fresh window around the work rect
    const g = this.grant(this.allRect())
    if (!g || !this.data) return
    this.data.fill(0)
    const wn = this.win
    for (let y = 0; y < g.h; y++) {
      const o = (g.y + y - wn.y) * wn.w + (g.x - wn.x)
      this.data.fill(255, o, o + g.w)
    }
    this.b = g
    this.upload(wn)
    this.emit()
    this.record('Select all', before, this.snapshot())
  }

  clear(label = 'Deselect'): void {
    if (!this.data) return
    const before = this.snapshot()
    this.drop()
    this.emit()
    this.record(label, before, null)
  }

  /** Fixed: flips the whole canvas. Infinite: flips inside the work rect (+ the current bounds); everything else stays unselected. */
  invert(): void {
    const before = this.snapshot()
    let r = this.allRect()
    if (this.inf && this.b) r = unionRect(r, this.b)!
    const g = this.grant(r)
    if (!g) return
    const d = this.data!
    const wn = this.win
    for (let y = 0; y < g.h; y++) {
      const o = (g.y + y - wn.y) * wn.w + (g.x - wn.x)
      for (let x = 0; x < g.w; x++) d[o + x] = 255 - d[o + x]
    }
    this.b = unionRect(this.b, g)
    this.upload(g)
    this._finish(null)
    this.record('Invert selection', before, this.snapshot())
  }

  /** Replace the selection with `alphaMask` (full-canvas 0..255; on infinite documents: the nominal 0..width x 0..height frame). */
  setFromFull(full: Uint8Array | null, label: string): void {
    this.setFromRegion({ x: 0, y: 0, w: this.w, h: this.h }, full, label)
  }

  /** Replace the selection with `data` covering document rect `rect` (rect.w * rect.h bytes). null = deselect. Undoable. */
  setFromRegion(rect: Rect, data: Uint8Array | null, label: string): void {
    const before = this.snapshot()
    if (!data) {
      this.drop()
      this.emit()
    } else {
      if (this.inf) this.drop()
      const g = this.grant(rect)
      if (g && this.data) {
        this.data.fill(0)
        const wn = this.win
        for (let y = 0; y < g.h; y++) {
          const so = (g.y + y - rect.y) * rect.w + (g.x - rect.x)
          this.data.set(data.subarray(so, so + g.w), (g.y + y - wn.y) * wn.w + (g.x - wn.x))
        }
        this.upload(wn)
        this.b = g
        this._finish(null)
      }
    }
    this.record(label, before, this.snapshot())
  }

  /** Replace the selection with a patch region content (already positioned). Used by transform. */
  replaceWithRegion(regionRect: Rect | null, region: Uint8Array | null, clearRect: Rect | null): void {
    // clears clearRect then writes region (rect-sized)
    if (!this.data && !(regionRect && region)) return
    this.clearArea(clearRect)
    let g: Rect | null = null
    if (regionRect && region) g = this.grant(regionRect)
    if (!this.data) return
    const d = this.data
    const wn = this.win
    if (g && regionRect && region) {
      for (let y = 0; y < g.h; y++) {
        const so = (g.y + y - regionRect.y) * regionRect.w + (g.x - regionRect.x)
        d.set(region.subarray(so, so + g.w), (g.y + y - wn.y) * wn.w + (g.x - wn.x))
      }
    }
    this.upload(unionRect(clearRect, g))
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

const shift = (p: MaskPatch, dx: number, dy: number): MaskPatch => ({ rect: { x: p.rect.x + dx, y: p.rect.y + dy, w: p.rect.w, h: p.rect.h }, data: p.data })

function cropPatch(p: MaskPatch, g: Rect): MaskPatch {
  const r = p.rect
  if (g.x === r.x && g.y === r.y && g.w === r.w && g.h === r.h) return p
  const out = new Uint8Array(g.w * g.h)
  for (let y = 0; y < g.h; y++) {
    const so = (g.y + y - r.y) * r.w + (g.x - r.x)
    out.set(p.data.subarray(so, so + g.w), y * g.w)
  }
  return { rect: { ...g }, data: out }
}

/** Interactive selection edit with live GPU preview. */
export class LiveEdit {
  private before: SelSnapshot | null
  private last: Rect | null = null
  private touched: Rect | null = null
  private done = false

  constructor(private svc: SelectionService) {
    this.before = svc.snapshot()
    this.touched = this.before ? { ...this.before.rect } : null
  }

  preview(patch: MaskPatch | null, mode: SelMode): void {
    if (this.done) return
    this.last = this.svc._apply(this.before, patch, mode, this.last)
    this.touched = unionRect(this.touched, this.last)
  }

  /** Live feather/blur preview of the base mask. */
  previewBlur(radius: number): void {
    if (this.done || !this.before) return
    this.last = this.svc._applyBlur(this.before, radius) ?? this.last
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
