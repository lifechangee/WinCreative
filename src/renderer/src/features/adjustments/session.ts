import type { App } from '../../app/app'
import { unionRect } from '../../core/geometry'
import type { Rect, Sample } from '../../core/types'
import type { Layer } from '../../doc/layer'
import { FX } from '../../gl/filters'
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

export function getSelectionMask(app: App): SelectionMask | null {
  if (selectionProvider) return selectionProvider()
  // The selection feature exposes app.selection.mask: RGBA8 texture, coverage in .r (null = nothing selected).
  const sel = (app as unknown as { selection?: { mask?: WebGLTexture | null } }).selection
  return sel?.mask ? { tex: sel.mask, channel: 'r' } : null
}

export type Mode = 'layer' | 'pencil'

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
    this.fx = new FX(app.gpu, doc.width, doc.height, doc.format)
    this.orig = app.gpu.surface(doc.width, doc.height, doc.format)
    this.adj = app.gpu.surface(doc.width, doc.height, doc.format)
    app.gpu.blit(this.layer.surface, { x: 0, y: 0, w: doc.width, h: doc.height }, this.orig, 0, 0)
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
      extra: this.extra,
      orig: this.orig,
      params: () => this.params,
      invalidate: (r) => this.invalidate(r),
      combine: (r) => this.requestCombine(r),
      sourceMarker: (x, y, v) => this.onMarker(x, y, v)
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
  toolBegin(s: Sample): boolean {
    this.ensureTool()
    return this.tool!.begin(s)
  }
  toolMove(ss: Sample[]): void {
    this.tool?.move(ss)
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

  private combine(rect: Rect | null): void {
    const gpu = this.app.gpu
    const layerSurf = this.layer.surface
    const full = { x: 0, y: 0, w: layerSurf.w, h: layerSurf.h }
    const r = rect ?? full
    if (!this.preview) {
      gpu.blit(this.orig, r, layerSurf, r.x, r.y)
    } else {
      const cov = this.mode === 'pencil' ? this.tool?.coverage?.() ?? null : null
      const sel = getSelectionMask(this.app)
      const lock = this.layer.alphaLock
      if (!cov && !sel && !lock) gpu.blit(this.adj, r, layerSurf, r.x, r.y)
      else
        this.fx.pass(
          'combine',
          `uniform float uHasM, uHasS, uSelA, uLock;
           vec4 fx(){ vec4 o0 = texture(uT0, vUv), a = texture(uT1, vUv); float m = 1.0;
             if (uHasM > 0.5) m *= texture(uT2, vUv).a;
             if (uHasS > 0.5) { vec4 s = texture(uT3, vUv); m *= uSelA > 0.5 ? s.a : s.r; }
             vec4 r = mix(o0, a, m);
             if (uLock > 0.5) { float k = r.a > 1e-5 ? o0.a / r.a : 0.0; r = vec4(r.rgb * k, o0.a); }
             return r; }`,
          layerSurf,
          { tex: [this.orig, this.adj, cov, sel?.tex], u: { uHasM: cov ? 1 : 0, uHasS: sel ? 1 : 0, uSelA: sel?.channel === 'a' ? 1 : 0, uLock: lock ? 1 : 0 }, rect: r }
        )
    }
    this.app.doc.events.emit('change', { rect: r })
  }

  // ------------------------------------------------------------------ finish
  /** true when applying would change pixels */
  get hasEffect(): boolean {
    if (this.def.custom === 'liquify' || this.def.custom === 'clone') return !!this.tool?.dirty()
    if (this.mode === 'pencil') return !!this.tool?.dirty()
    return true
  }

  /** Commit as ONE undo step (doc.beginPixelEdit) + a 'filter' commit event. Returns false if nothing changed. */
  apply(): boolean {
    if (this.closed) return false
    this.tool?.cancel()
    const doc = this.app.doc
    const gpu = this.app.gpu
    let ok = false
    if (this.hasEffect && !this.layer.locked && doc.layers.includes(this.layer)) {
      this.preview = true
      this.flush()
      const full = { x: 0, y: 0, w: doc.width, h: doc.height }
      const rect = this.mode === 'layer' && !(this.def.custom === 'liquify' || this.def.custom === 'clone') ? full : this.tool?.bounds() ?? full
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
    } else this.restore()
    this.close()
    return ok
  }

  cancel(): void {
    if (this.closed) return
    this.tool?.cancel()
    this.restore()
    this.close()
  }

  private restore(): void {
    const doc = this.app.doc
    if (!doc.layers.includes(this.layer)) return
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
