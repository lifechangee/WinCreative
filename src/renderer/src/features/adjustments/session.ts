import type { App } from '../../app/app'
import { unionRect } from '../../core/geometry'
import { regionPieces, tileKey } from '../../core/tiles'
import type { Rect, Sample } from '../../core/types'
import type { Layer } from '../../doc/layer'
import { FX } from '../../gl/filters'
import { frameEnabled, frameRect, workRect } from '../frame/workRect'
import type { Surface } from '../../gl/gpu'
import { CloneTool } from './clone'
import { defaultParams, getAdjustment } from './defs'
import { adjName, paramLabel } from './labels'
import { LiquifyTool } from './liquify'
import { defaultCurves, GRADIENT_LIBRARY } from './math'
import { MaskPencil } from './pencil'
import type { AdjDef, Extra, Params, PencilTool, ToolCtx } from './types'

export interface SelectionMask {
  tex: Surface | WebGLTexture
  /** which channel holds coverage */
  channel: 'a' | 'r'
}

let selectionProvider: (() => SelectionMask | null) | null = null
/** Hook for the selection feature: return the active selection's coverage texture (or null when nothing is selected). */
export const setSelectionMaskProvider = (fn: (() => SelectionMask | null) | null): void => void (selectionProvider = fn)

/** Selection coverage for a doc-space rect on an INFINITE canvas, supplied by features/selectxform (`app.selection.coverageRegion(rect)`: a new rect-sized surface with coverage in .r, or null = no selection). */
function infCoverage(app: App, rect: Rect): (SelectionMask & { dispose(): void }) | null {
  const sel = (app as unknown as { selection?: { coverageRegion?: (r: Rect) => Surface | null; readRect?: (r: Rect) => Uint8Array | null } }).selection
  const s = sel?.coverageRegion?.(rect) ?? null
  const fr = frameEnabled(app.doc) ? frameRect(app.doc) : null
  const inside = !!fr && rect.x >= fr.x && rect.y >= fr.y && rect.x + rect.w <= fr.x + fr.w && rect.y + rect.h <= fr.y + fr.h
  if (fr && !inside) {
    // frame ON: the result is limited to frame x selection (this path runs over EVERY tile of the layer, so the frame is baked into the coverage here)
    const cov = s ? (sel?.readRect?.(rect) ?? null) : null
    const buf = new Uint8Array(rect.w * rect.h * 4)
    for (let y = 0; y < rect.h; y++) {
      const dy = rect.y + y
      const rowIn = dy >= fr.y && dy < fr.y + fr.h
      for (let x = 0; x < rect.w; x++) {
        const dx = rect.x + x
        const v = rowIn && dx >= fr.x && dx < fr.x + fr.w ? (cov ? cov[y * rect.w + x] : 255) : 0
        const i = (y * rect.w + x) * 4
        buf[i] = v
        buf[i + 3] = 255
      }
    }
    s?.dispose()
    const m = app.gpu.surface(rect.w, rect.h, 'rgba8', 0)
    app.gpu.uploadRGBA8(m, 0, 0, rect.w, rect.h, buf)
    return { tex: m, channel: 'r', dispose: () => m.dispose() }
  }
  return s ? { tex: s, channel: 'r', dispose: () => s.dispose() } : null
}

export function getSelectionMask(app: App): SelectionMask | null {
  if (selectionProvider) return selectionProvider()
  // The selection feature exposes app.selection.mask: RGBA8 texture, coverage in .r (null = nothing selected).
  const sel = (app as unknown as { selection?: { mask?: WebGLTexture | null } }).selection
  return sel?.mask ? { tex: sel.mask, channel: 'r' } : null
}

export type Mode = 'layer' | 'pencil'

/** result = lerp(orig, adj, pencil coverage x selection), honouring alpha lock; written into `target` (never one of the inputs). */
function blendPass(fx: FX, orig: Surface, adj: Surface, cov: Surface | null, sel: SelectionMask | null, lock: boolean, target: Surface, r: Rect): void {
  fx.pass(
    'combine',
    `uniform float uHasM, uHasS, uSelA, uLock;
           vec4 fx(){ vec4 o0 = texture(uT0, vUv), a = texture(uT1, vUv); float m = 1.0;
             if (uHasM > 0.5) m *= texture(uT2, vUv).a;
             if (uHasS > 0.5) { vec4 s = texture(uT3, vUv); m *= uSelA > 0.5 ? s.a : s.r; }
             vec4 r = mix(o0, a, m);
             if (uLock > 0.5) { float k = r.a > 1e-5 ? o0.a / r.a : 0.0; r = vec4(r.rgb * k, o0.a); }
             return r; }`,
    target,
    { tex: [orig, adj, cov, sel?.tex], u: { uHasM: cov ? 1 : 0, uHasS: sel ? 1 : 0, uSelA: sel?.channel === 'a' ? 1 : 0, uLock: lock ? 1 : 0 }, rect: r }
  )
}

const MAX_WORK = 6144
const MAX_PAD = 768
const isect = (a: Rect, b: Rect): Rect | null => {
  const x0 = Math.max(a.x, b.x), y0 = Math.max(a.y, b.y), x1 = Math.min(a.x + a.w, b.x + b.w), y1 = Math.min(a.y + a.h, b.y + b.h)
  return x1 > x0 && y1 > y0 ? { x: x0, y: y0, w: x1 - x0, h: y1 - y0 } : null
}

interface UndoEntry {
  kind: 'param' | 'tool'
  params?: string
  extra?: string
}

const cloneJson = <T>(v: T): T => JSON.parse(JSON.stringify(v))

export function defaultExtra(): Extra {
  return { curves: defaultCurves(), curveChannel: 'master', stops: cloneJson(GRADIENT_LIBRARY[2].stops), disp: null, cloneAcc: null }
}

/**
 * One live adjustment on the active layer. The layer surface itself shows the preview (original pixels are kept
 * in `orig`); Apply restores `orig`, records a tile-snapshot undo step via doc.beginPixelEdit and re-renders the
 * final result. Cancel simply restores `orig`.
 */
export class AdjustmentSession {
  readonly def: AdjDef
  params: Params
  extra: Extra = defaultExtra()
  mode: Mode = 'layer'
  preview = true
  activeKey: string
  readonly layer: Layer
  /** surface the preview is shown on: the layer itself (fixed canvas) or a temporary copy of `rect` (infinite canvas) */
  readonly work: Surface
  /** infinite canvas: the working surface covers `rect` (doc space, padded); only `inner` (the work rect) is written back */
  readonly inf: boolean
  readonly rect: Rect
  readonly inner: Rect
  readonly fx: FX
  readonly orig: Surface
  readonly adj: Surface
  tool: PencilTool | null = null
  /** UI refresh hook */
  onChange: () => void = () => {}
  /** clone source crosshair hook (doc coords) */
  onMarker: (x: number, y: number, visible: boolean) => void = () => {}
  private undoStack: UndoEntry[] = []
  private lastTouch = 0
  private raf = 0
  private adjDirty = true
  private combineRect: Rect | null = null
  private combineAll = true
  private closed = false
  private drag: { key: string; start: number; x0: number } | null = null
  private quiet = false
  private touched = new Set<number>()
  private selInf: (SelectionMask & { dispose(): void }) | null | undefined

  constructor(
    readonly app: App,
    id: string,
    presetParams?: Params
  ) {
    const def = getAdjustment(id)
    if (!def) throw new Error('Unknown adjustment ' + id)
    this.def = def
    const doc = app.doc
    this.layer = doc.activeLayer
    this.params = { ...defaultParams(def), ...presetParams }
    this.activeKey = def.main ?? def.params.find((p) => (p.kind ?? 'slider') === 'slider')?.key ?? ''
    this.inf = doc.isInfinite && !!this.layer.tiles
    let refDim: number | undefined
    if (this.inf) {
      const max = Math.min(MAX_WORK, app.gpu.maxTexture)
      let inner = workRect(app)
      if (inner.w > max || inner.h > max) inner = { x: inner.x + Math.floor((inner.w - Math.min(inner.w, max)) / 2), y: inner.y + Math.floor((inner.h - Math.min(inner.h, max)) / 2), w: Math.min(inner.w, max), h: Math.min(inner.h, max) }
      refDim = Math.max(inner.w, inner.h)
      const pad = Math.min(MAX_PAD, Math.ceil((def.pad ?? 0) * refDim), Math.floor((Math.min(MAX_WORK + 2 * MAX_PAD, app.gpu.maxTexture) - refDim) / 2))
      if (def.pad || def.local) {
        // nothing to do outside the painted content: shrink the work rect to it (+ blur reach)
        const b = this.layer.tiles!.bounds()
        const clip = b ? isect(inner, { x: b.x - pad, y: b.y - pad, w: b.w + 2 * pad, h: b.h + 2 * pad }) : null
        if (clip) inner = clip
      }
      this.inner = inner
      this.rect = { x: inner.x - pad, y: inner.y - pad, w: inner.w + 2 * pad, h: inner.h + 2 * pad }
      this.work = doc.readRegion(this.layer, this.rect)
    } else {
      this.rect = this.inner = { x: 0, y: 0, w: doc.width, h: doc.height }
      this.work = this.layer.surface
    }
    const W = this.rect.w
    const H = this.rect.h
    this.fx = new FX(app.gpu, W, H, doc.format, refDim)
    this.orig = app.gpu.surface(W, H, doc.format)
    this.adj = app.gpu.surface(W, H, doc.format)
    app.gpu.blit(this.work, { x: 0, y: 0, w: W, h: H }, this.orig, 0, 0)
    if (def.modes && def.modes.length === 1) this.mode = def.modes[0]
    if (this.mode === 'pencil') this.ensureTool()
    this.invalidate()
    this.flush()
  }

  // ------------------------------------------------------------------ tools
  private ensureTool(): void {
    if (this.tool) return
    const ctx: ToolCtx = {
      app: this.app,
      fx: this.fx,
      layer: this.layer,
      target: this.work,
      extra: this.extra,
      orig: this.orig,
      params: () => this.params,
      invalidate: (r) => this.invalidate(r),
      combine: (r) => this.requestCombine(r),
      changed: (r) => this.show(r),
      sourceMarker: (x, y, v) => this.onMarker(x + this.rect.x, y + this.rect.y, v)
    }
    if (this.def.custom === 'liquify') this.tool = new LiquifyTool(ctx)
    else if (this.def.custom === 'clone') this.tool = new CloneTool(ctx)
    else this.tool = new MaskPencil(ctx)
  }

  get canPencil(): boolean {
    return !this.def.modes || this.def.modes.includes('pencil')
  }
  get canLayer(): boolean {
    return !this.def.modes || this.def.modes.includes('layer')
  }

  setMode(m: Mode): void {
    if (m === this.mode || (m === 'pencil' && !this.canPencil) || (m === 'layer' && !this.canLayer)) return
    this.mode = m
    if (m === 'pencil') this.ensureTool()
    this.invalidate()
    this.onChange()
  }

  // ------------------------------------------------------------------ params
  /** Undo bookkeeping: snapshot before the first change of a burst. */
  private checkpoint(force = false): void {
    const now = performance.now()
    if (force || now - this.lastTouch > 500) this.undoStack.push({ kind: 'param', params: JSON.stringify(this.params), extra: JSON.stringify({ c: this.extra.curves, s: this.extra.stops, ch: this.extra.curveChannel }) })
    if (this.undoStack.length > 60) this.undoStack.shift()
    this.lastTouch = now
  }

  setParam(key: string, value: number, key2?: string, value2?: number): void {
    const d = this.def.params.find((p) => p.key === key)
    if (d && d.kind !== 'color') value = Math.min(d.max, Math.max(d.min, value))
    if (this.params[key] === value && (key2 === undefined || this.params[key2] === value2)) return
    this.checkpoint()
    this.params[key] = value
    if (key2 !== undefined && value2 !== undefined) this.params[key2] = value2
    if (d && (d.kind ?? 'slider') === 'slider') this.activeKey = key
    this.invalidate()
    this.onChange()
  }

  /** Called by editors (curves / gradient) after mutating `extra`. */
  extraChanged(commit = false): void {
    this.checkpoint(commit)
    this.invalidate()
    this.onChange()
  }

  /** Force a fresh undo step boundary (start of an editor drag). */
  beginEdit(): void {
    this.checkpoint(true)
  }

  get mainParam(): { key: string; label: string; unit: string; min: number; max: number; value: number } | null {
    if (this.def.noDrag) return null
    const d = this.def.params.find((p) => p.key === this.activeKey && (p.kind ?? 'slider') === 'slider')
    if (!d) return null
    return { key: d.key, label: paramLabel(this.def, d), unit: d.unit ?? '', min: d.min, max: d.max, value: this.params[d.key] }
  }

  // ------------------------------------------------------------------ layer-mode drag ("slide to adjust")
  dragBegin(clientX: number): void {
    const m = this.mainParam
    if (!m) return
    this.drag = { key: m.key, start: m.value, x0: clientX }
    this.checkpoint(true)
    this.lastTouch = performance.now() + 1e9 // keep the whole drag inside one undo step
  }
  dragMove(clientX: number): void {
    if (!this.drag) return
    const d = this.def.params.find((p) => p.key === this.drag!.key)!
    const w = Math.max(200, this.app.cssSize().w * 0.75)
    const v = this.drag.start + ((clientX - this.drag.x0) / w) * (d.max - d.min)
    this.params[d.key] = Math.min(d.max, Math.max(d.min, Math.round(v * (d.step && d.step < 1 ? 1 / d.step : 1)) / (d.step && d.step < 1 ? 1 / d.step : 1)))
    this.invalidate()
    this.onChange()
  }
  dragEnd(): void {
    this.drag = null
    this.lastTouch = performance.now()
  }

  // ------------------------------------------------------------------ pencil strokes
  /** document coordinates -> working-surface coordinates */
  private local(s: Sample): Sample {
    return this.rect.x === 0 && this.rect.y === 0 ? s : { ...s, x: s.x - this.rect.x, y: s.y - this.rect.y }
  }
  /** Clone: set the source point (doc coordinates). */
  setCloneSource(x: number, y: number): void {
    ;(this.tool as CloneTool | null)?.setSource(x - this.rect.x, y - this.rect.y)
  }
  toolBegin(s: Sample): boolean {
    this.ensureTool()
    return this.tool!.begin(this.local(s))
  }
  toolMove(ss: Sample[]): void {
    this.tool?.move(ss.map((s) => this.local(s)))
  }

  /** What limits this adjustment on an infinite canvas: the frame, the visible area, or (pixel-local, Layer mode) preview in the view while Apply covers the whole layer. */
  get limit(): 'frame' | 'view' | 'viewAll' | null {
    if (!this.inf) return null
    if (this.def.local && this.mode === 'layer') return 'viewAll'
    return frameRect(this.app.doc) ? 'frame' : 'view'
  }
  toolEnd(): void {
    if (!this.tool) return
    const ok = this.tool.end()
    if (ok) this.undoStack.push({ kind: 'tool' })
    this.onChange()
  }
  toolCancel(): void {
    this.tool?.cancel()
  }

  // ------------------------------------------------------------------ session undo / reset
  get canUndo(): boolean {
    return this.undoStack.length > 0
  }
  undo(): boolean {
    const e = this.undoStack.pop()
    if (!e) return false
    if (e.kind === 'tool') this.tool?.undo()
    else {
      this.params = JSON.parse(e.params!)
      const x = JSON.parse(e.extra!)
      this.extra.curves = x.c
      this.extra.stops = x.s
      this.extra.curveChannel = x.ch
      this.invalidate()
    }
    this.onChange()
    return true
  }

  reset(): void {
    this.checkpoint(true)
    this.params = { ...defaultParams(this.def) }
    this.extra.curves = defaultCurves()
    this.extra.stops = cloneJson(GRADIENT_LIBRARY[2].stops)
    if (this.tool?.dirty()) {
      this.tool.reset()
      this.undoStack.push({ kind: 'tool' })
    }
    this.invalidate()
    this.onChange()
  }

  setPreview(on: boolean): void {
    this.preview = on
    this.invalidate()
    this.onChange()
  }

  // ------------------------------------------------------------------ rendering
  invalidate(_rect?: Rect | null): void {
    this.adjDirty = true
    this.combineAll = true
    this.schedule()
  }
  private requestCombine(rect: Rect | null): void {
    if (rect && !this.combineAll) this.combineRect = unionRect(this.combineRect, rect)
    else this.combineAll = true
    this.schedule()
  }
  private schedule(): void {
    if (!this.raf && !this.closed) this.raf = requestAnimationFrame(() => this.flush())
  }

  /** Render pending work now. */
  flush(): void {
    if (this.raf) cancelAnimationFrame(this.raf)
    this.raf = 0
    if (this.closed) return
    if (this.adjDirty && this.usesAdjOutput) {
      this.def.render(this.fx, this.orig, this.adj, this.params, this.extra)
      this.adjDirty = false
    }
    if (this.combineAll) this.combine(null)
    else if (this.combineRect) this.combine(this.combineRect)
    this.combineAll = false
    this.combineRect = null
  }

  /** Clone paints straight into the layer while stroking; every other adjustment is orig -> adj -> layer. */
  private get usesAdjOutput(): boolean {
    return true
  }

  private infSel(): (SelectionMask & { dispose(): void }) | null {
    if (this.selInf === undefined) this.selInf = infCoverage(this.app, this.rect)
    return this.selInf
  }

  private combine(rect: Rect | null): void {
    const gpu = this.app.gpu
    const surf = this.work
    const full = { x: 0, y: 0, w: surf.w, h: surf.h }
    const r = rect ?? full
    if (!this.preview) {
      gpu.blit(this.orig, r, surf, r.x, r.y)
    } else {
      const cov = this.mode === 'pencil' ? this.tool?.coverage?.() ?? null : null
      const sel = this.inf ? this.infSel() : getSelectionMask(this.app)
      const lock = this.layer.alphaLock
      if (!cov && !sel && !lock) gpu.blit(this.adj, r, surf, r.x, r.y)
      else blendPass(this.fx, this.orig, this.adj, cov, sel, lock, surf, r)
    }
    this.show(r)
  }

  /** `r` (working-surface coordinates) of `work` changed: make it visible. */
  private show(r: Rect): void {
    if (!this.inf) return void this.app.doc.events.emit('change', { rect: r })
    if (this.quiet) return
    this.putTiles(this.work, r)
  }

  /** Copy the inner part of `r` of `src` (working-surface coordinates) straight into the layer's tiles (preview; no undo). */
  private putTiles(src: Surface, r: Rect): void {
    const ir = isect(r, { x: this.inner.x - this.rect.x, y: this.inner.y - this.rect.y, w: this.inner.w, h: this.inner.h })
    if (!ir) return
    const store = this.layer.tiles!
    const gpu = this.app.gpu
    for (const p of regionPieces({ x: ir.x + this.rect.x, y: ir.y + this.rect.y, w: ir.w, h: ir.h })) {
      const dst = store.ensure(p.tx, p.ty)
      gpu.blit(src, { x: ir.x + p.dx, y: ir.y + p.dy, w: p.w, h: p.h }, dst, p.sx, p.sy)
      this.touched.add(tileKey(p.tx, p.ty))
    }
    this.app.doc.events.emit('change', { rect: { x: ir.x + this.rect.x, y: ir.y + this.rect.y, w: ir.w, h: ir.h } })
  }

  // ------------------------------------------------------------------ finish
  /** true when applying would change pixels */
  get hasEffect(): boolean {
    if (this.def.custom === 'liquify' || this.def.custom === 'clone') return !!this.tool?.dirty()
    if (this.mode === 'pencil') return !!this.tool?.dirty()
    return true
  }

  /** Commit as ONE undo step (doc.beginPixelEdit / writeRegion) + a 'filter' commit event. Returns false if nothing changed. */
  apply(): boolean {
    if (this.closed) return false
    this.tool?.cancel()
    const doc = this.app.doc
    const gpu = this.app.gpu
    let ok = false
    if (this.hasEffect && !this.layer.locked && doc.layers.includes(this.layer)) {
      this.preview = true
      if (this.def.custom === 'clone') this.adjDirty = true // clone paints into `cloneAcc`: the adjustment output must be re-read
      this.flush()
      const full = { x: 0, y: 0, w: this.work.w, h: this.work.h }
      const custom = this.def.custom === 'liquify' || this.def.custom === 'clone'
      const rect = this.mode === 'layer' && !custom ? full : this.tool?.bounds() ?? full
      if (this.inf) ok = this.applyInf(rect, custom)
      else {
        // restore the original pixels so the undo snapshot is the true "before"
        gpu.blit(this.orig, full, this.layer.surface, 0, 0)
        const edit = doc.beginPixelEdit(this.layer, adjName(this.def))
        edit.save(rect)
        if (this.adjDirty) {
          this.def.render(this.fx, this.orig, this.adj, this.params, this.extra)
          this.adjDirty = false
        }
        this.combine(rect)
        const dirty = edit.finish()
        doc.emitCommit('filter', this.layer.id, dirty, adjName(this.def))
        ok = true
      }
    } else this.restore()
    this.close()
    return ok
  }

  private applyInf(rect: Rect, custom: boolean): boolean {
    const doc = this.app.doc
    const gpu = this.app.gpu
    const label = adjName(this.def)
    this.restoreTiles() // tiles are back to the true "before"
    if (this.def.local && this.mode === 'layer' && !custom) return this.applyAllTiles(label)
    if (this.adjDirty) {
      this.def.render(this.fx, this.orig, this.adj, this.params, this.extra)
      this.adjDirty = false
    }
    this.quiet = true
    this.combine(rect)
    this.quiet = false
    const inner = { x: this.inner.x - this.rect.x, y: this.inner.y - this.rect.y, w: this.inner.w, h: this.inner.h }
    const piece = isect(rect, inner) ?? inner
    const tmp = gpu.surface(piece.w, piece.h, this.work.fmt, 0)
    gpu.blit(this.work, piece, tmp, 0, 0)
    const dirty = doc.writeRegion(this.layer, { x: piece.x + this.rect.x, y: piece.y + this.rect.y, w: piece.w, h: piece.h }, tmp, { undoLabel: label, type: 'filter' })
    tmp.dispose()
    return !!dirty
  }

  /** Pixel-local colour adjustment over EVERY tile of the layer (no region limit), one undo step. */
  private applyAllTiles(label: string): boolean {
    const doc = this.app.doc
    const gpu = this.app.gpu
    const store = this.layer.tiles!
    const keys = [...store.keys()]
    if (!keys.length) return false
    const S = store.size
    const fx = new FX(gpu, S, S, store.fmt)
    const out = gpu.surface(S, S, store.fmt, 0)
    const res = gpu.surface(S, S, store.fmt, 0)
    const edit = doc.beginPixelEdit(this.layer, label)
    const full = { x: 0, y: 0, w: S, h: S }
    for (const key of keys) {
      const tile = store.getKey(key)
      if (!tile) continue
      edit.saveKey(key)
      const sel = infCoverage(this.app, store.tileRectOf(key))
      this.def.render(fx, tile, out, this.params, this.extra)
      blendPass(fx, tile, out, null, sel, this.layer.alphaLock, res, full)
      gpu.blit(res, full, tile, 0, 0)
      sel?.dispose()
    }
    fx.dispose()
    out.dispose()
    res.dispose()
    const dirty = edit.finish()
    doc.emitCommit('filter', this.layer.id, dirty, label)
    return !!dirty
  }

  cancel(): void {
    if (this.closed) return
    this.tool?.cancel()
    this.restore()
    this.close()
  }

  /** infinite: put the original pixels of the work rect back into the tiles and free tiles the preview allocated */
  private restoreTiles(): void {
    this.putTiles(this.orig, { x: 0, y: 0, w: this.orig.w, h: this.orig.h })
    this.layer.tiles?.prune([...this.touched])
    this.touched.clear()
    this.app.doc.events.emit('change', { rect: this.inner })
  }

  private restore(): void {
    const doc = this.app.doc
    if (!doc.layers.includes(this.layer)) return
    if (this.inf) return this.restoreTiles()
    this.app.gpu.blit(this.orig, { x: 0, y: 0, w: doc.width, h: doc.height }, this.layer.surface, 0, 0)
    doc.events.emit('change', { rect: null })
  }

  get isClosed(): boolean {
    return this.closed
  }

  private close(): void {
    this.closed = true
    if (this.raf) cancelAnimationFrame(this.raf)
    this.tool?.dispose()
    this.tool = null
    this.selInf?.dispose()
    this.selInf = undefined
    if (this.inf) this.work.dispose()
    this.fx.dispose()
    this.orig.dispose()
    this.adj.dispose()
    this.onChange()
  }
}

/** Non-interactive helper (scripts / tests): apply an adjustment with parameters to the active layer. */
export function runAdjustment(app: App, id: string, params: Params = {}, extra?: Partial<Extra>): boolean {
  const s = new AdjustmentSession(app, id, params)
  if (extra) Object.assign(s.extra, extra)
  s.invalidate()
  return s.apply()
}
