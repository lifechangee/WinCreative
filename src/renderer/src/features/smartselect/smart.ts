/**
 * Smart selection controller + pointer tool.
 *
 * A *session* starts with the first click / box / brush stroke. In the AI modes the prompts (points, box) accumulate and every
 * change re-decodes (instant), refines the edge (guided filter, worker) and previews the result through `LiveEdit` of
 * `app.selection`; the whole session becomes ONE undo step when it is committed (Done, a cut-out action, switching tool/mode).
 * The classical Brush mode paints object / background seeds and runs the geodesic segmentation in a worker.
 */
import type { App } from '../../app/app'
import { Emitter } from '../../core/events'
import type { Rect, Sample } from '../../core/types'
import { screenToDoc } from '../../core/viewTransform'
import { t } from '../../i18n'
import type { Tool, ToolHost } from '../../tools/tool'
import { Overlay } from '../selectxform/overlay'
import type { LiveEdit } from '../selectxform/selection'
import type { MaskPatch } from '../selectxform/geom'
import type { BrushStroke } from './brushSeg'
import { SmartEngine } from './engine'
import { resizeRGBA } from './imgops'
import { MODELS } from './manifest'
import {
  encodeGeom,
  encodePrompt,
  fieldBounds,
  flattenOnGrey,
  pickCandidate,
  planEncodeRegion,
  rectContains,
  rectGrow,
  rectInt,
  rectIntersect,
  upsampleField,
  upsampleLogits,
  LOWRES,
  type EncodeGeom,
  type PromptPoint
} from './region'
import { modelOf, ss } from './settings'
import { getSourceImage, limitRect, sourceInfo, visibleDocRect } from './source'

const MAX_WORK_PIXELS = 6_000_000

export interface Busy {
  text: string
  cancellable: boolean
}

interface Candidate {
  logits: Float32Array
  geom: EncodeGeom
}

interface Session {
  live: LiveEdit
  /** selection coverage before the session (for Intersect) */
  base: Uint8Array | null
  /** document rect the `base` bytes cover (the selection window) */
  baseWin: Rect | null
  points: PromptPoint[]
  box: Rect | null
  strokes: BrushStroke[]
  mode: 'ai' | 'brush'
  /** last decoder result (re-refined when Smooth / Feather / Shift change) */
  cand: Candidate | null
  /** last brush field */
  field: { data: Float32Array; w: number; h: number; rect: Rect } | null
  hasResult: boolean
}

export class SmartSelect {
  readonly engine = new SmartEngine()
  readonly events = new Emitter<{ change: void; busy: Busy | null }>()
  readonly tool: SmartTool
  readonly overlay: Overlay
  active = false
  session: Session | null = null
  busy: Busy | null = null
  /** region the user asked to re-encode ("Refine in view") */
  viewRegion: Rect | null = null
  /** latest hover preview */
  preview: Candidate | null = null
  private previewCanvas: HTMLCanvasElement | null = null
  private token = 0
  private chain: Promise<unknown> = Promise.resolve()
  private rerefineTimer = 0
  hoverPos: { x: number; y: number } | null = null
  /** brush stroke being drawn (screen overlay) */
  liveStroke: BrushStroke | null = null
  liveBox: Rect | null = null
  onClosed: (() => void) | null = null

  constructor(readonly app: App) {
    this.tool = new SmartTool(this)
    this.overlay = new Overlay(app)
    this.overlay.add((ctx, s) => this.paintOverlay(ctx, s))
    this.engine.events.on('state', () => this.events.emit('change', undefined))
    this.engine.idleMinutes = ss.idleMinutes
    this.engine.ep = ss.ep
  }

  // ---------------------------------------------------------------- lifecycle
  activate(): void {
    ;(window as any).brushwork_xform?.closeAll?.(true) // close the Selection / Transform bar
    this.active = true
    this.app.setToolOverride(this.tool, { hideBrushCursor: true })
    this.app.canvas.style.cursor = 'crosshair'
    this.viewRegion = null
    this.events.emit('change', undefined)
    this.overlay.invalidate()
    if (ss.mode !== 'brush') void this.prefetch()
  }

  /** Close the tool. commit=true keeps the current result as a normal selection (one undo step). */
  deactivate(commit = true): void {
    if (!this.active) return
    this.finishSession(commit)
    this.active = false
    this.token++
    this.setBusy(null)
    this.preview = null
    this.app.setToolOverride(null)
    this.app.canvas.style.cursor = ''
    // the model stays loaded for `idleMinutes` (quick re-open); the engine's idle timer frees it
    this.overlay.invalidate()
    this.events.emit('change', undefined)
    this.onClosed?.()
  }

  setMode(m: typeof ss.mode): void {
    if (m === ss.mode) return
    this.finishSession(true)
    ss.mode = m
    this.preview = null
    this.viewRegion = null
    this.events.emit('change', undefined)
    this.overlay.invalidate()
    if (this.active && m !== 'brush') void this.prefetch()
  }

  setBusy(text: string | null, cancellable = false): void {
    this.busy = text ? { text, cancellable } : null
    this.events.emit('busy', this.busy)
    this.events.emit('change', undefined)
  }

  cancelBusy(): void {
    this.token++
    this.engine.cancel()
    this.setBusy(null)
    this.preview = null
    this.overlay.invalidate()
  }

  // ---------------------------------------------------------------- session
  private ensureSession(mode: 'ai' | 'brush'): Session {
    if (this.session && this.session.mode === mode) return this.session
    this.finishSession(true)
    const svc = this.app.selection
    this.session = { live: svc.begin(), base: svc.data ? new Uint8Array(svc.data) : null, baseWin: svc.window, points: [], box: null, strokes: [], mode, cand: null, field: null, hasResult: false }
    return this.session
  }

  /** Commit (one undo step) or revert the running session. */
  finishSession(commit: boolean): void {
    const s = this.session
    this.session = null
    window.clearTimeout(this.rerefineTimer)
    if (!s) return
    this.token++
    if (commit && s.hasResult) s.live.commit('Smart selection')
    else s.live.cancel()
    this.liveStroke = null
    this.liveBox = null
    this.events.emit('change', undefined)
    this.overlay.invalidate()
  }

  /** The document was replaced: drop the session without touching the (new) document's selection. */
  abandon(): void {
    this.session = null
    this.liveStroke = null
    this.liveBox = null
    this.token++
    window.clearTimeout(this.rerefineTimer)
    this.setBusy(null)
    this.preview = null
    if (this.active) this.deactivate(false)
  }

  /** Forget the points and start another object (keeps the selection made so far). */
  nextObject(): void {
    this.finishSession(true)
  }

  resetPoints(): void {
    const s = this.session
    if (!s) return
    this.finishSession(false)
  }

  get pointCount(): number {
    return this.session ? this.session.points.length + (this.session.box ? 1 : 0) + this.session.strokes.length : 0
  }

  // ---------------------------------------------------------------- AI prompts
  private model(): typeof MODELS.fast {
    return MODELS[modelOf(ss.mode)]
  }

  private async prefetch(): Promise<void> {
    const my = ++this.token
    await this.enqueue(async () => {
      if (my !== this.token || !this.active || ss.mode === 'brush') return
      try {
        await this.ensureEncoded(my)
      } catch (e) {
        this.handleError(e, my)
      }
    })
  }

  /** queued / running jobs (QA and tests wait for 0) */
  pending = 0
  /** timings of the last prompt (diagnostics / QA): decode, edge refinement, prompt -> selection */
  metrics = { decodeMs: 0, refineMs: 0, totalMs: 0 }

  private enqueue<T>(fn: () => Promise<T>): Promise<T | undefined> {
    this.pending++
    const p = this.chain.then(fn, fn).finally(() => this.pending--) as Promise<T>
    this.chain = p.catch(() => undefined)
    return p.catch(() => undefined)
  }

  private handleError(e: unknown, token: number): void {
    if (token !== this.token) return // cancelled on purpose
    const msg = (e as Error)?.message ?? String(e)
    if (msg === 'cancelled') return
    console.warn('[smartselect]', e)
    this.setBusy(null)
    this.app.notify(t('smartselect.toast.failed', { error: msg }))
  }

  /** Make sure the engine holds the embedding of the current source; resolves the geometry or null when there is nothing to analyse. */
  async ensureEncoded(token: number): Promise<EncodeGeom | null> {
    const model = modelOf(ss.mode)
    const def = MODELS[model]
    const info = sourceInfo(this.app, ss.sample)
    if (!info) {
      this.app.notify(t('smartselect.toast.emptyLayer'))
      return null
    }
    const region = rectInt(planEncodeRegion(info.bounds, this.viewRegion))
    const key = `${model}|${ss.sample}|${info.key}|${region.x},${region.y},${region.w},${region.h}`
    const e = this.engine
    if (e.loadedModel === model && e.encodedKey === key && e.encodedGeom) return e.encodedGeom
    if (e.loadedModel !== model || e.state === 'unloaded' || e.state === 'error') {
      this.setBusy(t('smartselect.busy.loading'), true)
      await e.ensure(model)
      if (token !== this.token) return null
    }
    this.setBusy(t('smartselect.busy.analysing'), true)
    const img = getSourceImage(this.app, region, ss.sample)
    if (!img) {
      this.setBusy(null)
      return null
    }
    const geom = encodeGeom(img.rect, def.family)
    await e.encode(key, geom, img.data)
    this.setBusy(null)
    return token === this.token ? geom : null
  }

  /** Is the embedding of the current source ready (hover previews only run then)? */
  encodedReady(): EncodeGeom | null {
    if (!this.active || ss.mode === 'brush') return null
    const model = modelOf(ss.mode)
    const info = sourceInfo(this.app, ss.sample)
    if (!info) return null
    const region = rectInt(planEncodeRegion(info.bounds, this.viewRegion))
    const key = `${model}|${ss.sample}|${info.key}|${region.x},${region.y},${region.w},${region.h}`
    return this.engine.loadedModel === model && this.engine.encodedKey === key ? this.engine.encodedGeom : null
  }

  addPoint(x: number, y: number, label: 0 | 1): void {
    const s = this.ensureSession('ai')
    s.points.push({ x, y, label })
    this.runAI()
  }

  addBox(r: Rect): void {
    const s = this.ensureSession('ai')
    s.box = r
    this.runAI()
  }

  removePoint(i: number): void {
    const s = this.session
    if (!s) return
    if (i === -1) s.box = null
    else s.points.splice(i, 1)
    if (!s.points.length && !s.box) {
      this.finishSession(false)
      return
    }
    this.runAI()
  }

  /** The sampled source changed (layer / all visible): analyse again. */
  resample(): void {
    this.viewRegion = null
    this.preview = null
    if (this.active && ss.mode !== 'brush') void this.prefetch()
  }

  /** Re-encode what is currently visible (higher detail for small objects). */
  refineInView(): void {
    if (!this.active || ss.mode === 'brush') return
    const info = sourceInfo(this.app, ss.sample)
    if (!info) return
    this.viewRegion = visibleDocRect(this.app)
    const s = this.session
    if (s && s.mode === 'ai' && (s.points.length || s.box)) this.runAI()
    else void this.prefetch()
  }

  runAI(): void {
    const s = this.session
    if (!s) return
    const tStart = performance.now()
    const my = ++this.token
    void this.enqueue(async () => {
      if (my !== this.token || !this.session) return
      try {
        const geom = await this.ensureEncoded(my)
        if (!geom || my !== this.token) return
        const res = await this.decodePrompt(geom, s.points, s.box)
        if (!res || my !== this.token) return
        s.cand = res
        this.preview = res
        this.overlay.invalidate()
        this.setBusy(t('smartselect.busy.refining'), false)
        await this.produce(s, my)
        this.metrics.totalMs = performance.now() - tStart
        if (my === this.token) this.setBusy(null)
      } catch (e) {
        this.handleError(e, my)
      }
    })
  }

  private async decodePrompt(geom: EncodeGeom, points: PromptPoint[], box: Rect | null): Promise<Candidate | null> {
    const def = this.model()
    const p = encodePrompt(geom, { points, box })
    const r = await this.engine.decode(p)
    if (!r) return null
    this.metrics.decodeMs = r.ms
    const positives = points.filter((q) => q.label === 1).length
    const idx = pickCandidate(r.iou, def.family, positives, !!box, ss.level)
    const n = LOWRES * LOWRES
    return { logits: r.logits.subarray(idx * n, (idx + 1) * n), geom }
  }

  /** Hover preview: decode (session prompts + the point under the cursor) and draw it, nothing is selected. */
  hover(x: number, y: number, alt: boolean): void {
    this.hoverPos = { x, y }
    if (!ss.hover || ss.mode === 'brush' || this.busy || !this.active) return
    const geom = this.encodedReady()
    if (!geom || !rectContains(geom.region, x, y)) {
      if (this.preview) {
        this.preview = null
        this.overlay.invalidate()
      }
      return
    }
    const s = this.session
    const pts: PromptPoint[] = [...(s?.points ?? []), { x, y, label: alt || ss.negative ? 0 : 1 }]
    void this.decodePrompt(geom, pts, s?.box ?? null)
      .then((c) => {
        if (c && this.active && !this.busy && this.hoverPos && this.hoverPos.x === x && this.hoverPos.y === y) {
          this.preview = c
          this.previewCanvas = null
          this.overlay.invalidate()
        }
      })
      .catch(() => undefined)
  }

  // ---------------------------------------------------------------- mask production (shared by AI and Brush)
  /** Debounced re-refine after Smooth / Feather / Shift changed. */
  rerefineSoon(): void {
    const s = this.session
    if (!s || !s.hasResult) return
    window.clearTimeout(this.rerefineTimer)
    this.rerefineTimer = window.setTimeout(() => {
      const my = ++this.token
      void this.enqueue(async () => {
        if (my !== this.token || this.session !== s) return
        try {
          await this.produce(s, my)
        } catch (e) {
          this.handleError(e, my)
        }
      })
    }, 140)
  }

  private async produce(s: Session, token: number): Promise<void> {
    const app = this.app
    const doc = app.doc
    const docRect: Rect = limitRect(app)
    let fieldFn: (rect: Rect, step: number) => { data: Float32Array; w: number; h: number }
    let region: Rect
    let cellDoc: number
    if (s.mode === 'ai') {
      const c = s.cand
      if (!c) return
      region = rectIntersect(c.geom.region, docRect) ?? docRect
      const coarseStep = Math.max(1, Math.ceil(Math.max(region.w, region.h) / 512))
      const coarse = upsampleLogits(c.logits, c.geom, region, coarseStep)
      const b = fieldBounds(coarse.data, coarse.w, coarse.h, region, coarseStep)
      if (!b) return this.applyPatch(s, null)
      cellDoc = 4 / Math.min(c.geom.sx, c.geom.sy)
      s.field = null
      fieldFn = (rect, step) => upsampleLogits(c.logits, c.geom, rect, step)
      region = rectGrow(b, Math.ceil(cellDoc * 2.4 + 6))
    } else {
      const f = s.field
      if (!f) return
      const coarseStep = Math.max(1, Math.ceil(Math.max(f.rect.w, f.rect.h) / 512))
      const coarse = upsampleField(f.data, f.w, f.h, f.rect, f.rect, coarseStep)
      const b = fieldBounds(coarse.data, coarse.w, coarse.h, f.rect, coarseStep)
      if (!b) return this.applyPatch(s, null)
      cellDoc = f.rect.w / f.w
      fieldFn = (rect, step) => upsampleField(f.data, f.w, f.h, f.rect, rect, step)
      region = rectGrow(b, Math.ceil(cellDoc * 2.4 + 6))
    }
    const work = rectIntersect(rectInt(region), docRect)
    if (!work) return this.applyPatch(s, null)
    const step = Math.max(1, Math.ceil(Math.sqrt((work.w * work.h) / MAX_WORK_PIXELS)))
    const field = fieldFn(work, step)
    const src = getSourceImage(app, work, ss.sample)
    if (!src) return
    let guide: Uint8ClampedArray = new Uint8ClampedArray(src.data)
    flattenOnGrey(guide)
    if (step > 1) guide = resizeRGBA(guide, work.w, work.h, field.w, field.h)
    const res = await this.engine.refine(field.data, guide, field.w, field.h, { cellPx: cellDoc / step, smooth: ss.smooth, feather: ss.feather / step, shift: ss.shift / step, snap: true }, work.w, work.h)
    this.metrics.refineMs = res.ms
    if (token !== this.token) return
    this.applyPatch(s, { rect: work, data: res.alpha })
  }

  private applyPatch(s: Session, patch: MaskPatch | null): void {
    let p = patch
    if (p && ss.combine === 'intersect') {
      const bw = s.baseWin
      const out = new Uint8Array(p.data.length)
      for (let y = 0; y < p.rect.h; y++)
        for (let x = 0; x < p.rect.w; x++) {
          let b = 255 // nothing selected before: the object itself
          if (s.base && bw) {
            const bx = p.rect.x + x - bw.x
            const by = p.rect.y + y - bw.y
            b = bx >= 0 && by >= 0 && bx < bw.w && by < bw.h ? s.base[by * bw.w + bx] : 0
          }
          out[y * p.rect.w + x] = Math.min(b, p.data[y * p.rect.w + x])
        }
      p = { rect: p.rect, data: out }
      s.live.preview(p, 'replace')
    } else if (!p && ss.combine === 'intersect') s.live.preview(null, 'replace')
    else s.live.preview(p, ss.combine as 'replace' | 'add' | 'subtract')
    s.hasResult = true
    this.preview = null
    this.events.emit('change', undefined)
    this.overlay.invalidate()
  }

  // ---------------------------------------------------------------- brush mode
  async brushStrokeDone(stroke: BrushStroke): Promise<void> {
    const s = this.ensureSession('brush')
    s.strokes.push(stroke)
    const my = ++this.token
    await this.enqueue(async () => {
      if (my !== this.token || this.session !== s) return
      try {
        const info = sourceInfo(this.app, ss.sample)
        if (!info) {
          this.app.notify(t('smartselect.toast.emptyLayer'))
          return
        }
        // working window around all strokes (docs space)
        let bb: Rect | null = null
        for (const st of s.strokes)
          st.pts.forEach((p, i) => {
            const r = st.radii[i] ?? st.radii[0]
            const q = { x: p.x - r, y: p.y - r, w: 2 * r, h: 2 * r }
            bb = bb ? unionR(bb, q) : q
          })
        if (!bb) return
        const bbR: Rect = bb
        const margin = Math.max(bbR.w, bbR.h) * 1.0 + 48
        const win = rectIntersect(rectInt(rectGrow(bbR, margin)), info.bounds)
        const dr = rectIntersect(win ?? info.bounds, limitRect(this.app))
        if (!dr) return
        this.setBusy(t('smartselect.busy.growing'), true)
        const img = getSourceImage(this.app, dr, ss.sample)
        if (!img) return
        const px = new Uint8ClampedArray(img.data)
        flattenOnGrey(px)
        const k = Math.min(1, 720 / Math.max(img.rect.w, img.rect.h))
        const gw = Math.max(8, Math.round(img.rect.w * k))
        const gh = Math.max(8, Math.round(img.rect.h * k))
        const small = resizeRGBA(px, img.rect.w, img.rect.h, gw, gh)
        const strokes: BrushStroke[] = s.strokes.map((st) => ({ label: st.label, pts: st.pts.map((p) => ({ x: (p.x - img.rect.x) * k, y: (p.y - img.rect.y) * k })), radii: st.radii.map((r) => r * k) }))
        const r = await this.engine.brush(small, gw, gh, strokes, { ...(ss.brushOpts ?? {}), autoBackground: !s.strokes.some((st) => st.label === 0) })
        if (my !== this.token || this.session !== s) return
        s.field = { data: r.field, w: gw, h: gh, rect: img.rect }
        this.liveStroke = null
        this.setBusy(t('smartselect.busy.refining'), false)
        await this.produce(s, my)
        if (my === this.token) this.setBusy(null)
      } catch (e) {
        this.handleError(e, my)
      }
    })
  }

  undoLastStroke(): void {
    const s = this.session
    if (!s || s.mode !== 'brush') return
    s.strokes.pop()
    if (!s.strokes.length) return this.finishSession(false)
    const last = s.strokes[s.strokes.length - 1]
    s.strokes.pop()
    void this.brushStrokeDone(last)
  }

  // ---------------------------------------------------------------- overlay
  private paintOverlay(ctx: CanvasRenderingContext2D, toScreen: (p: { x: number; y: number }) => { x: number; y: number }): void {
    if (!this.active) return
    const cand = this.preview
    if (cand) {
      if (!this.previewCanvas || (this.previewCanvas as any).__src !== cand.logits) {
        const c = document.createElement('canvas')
        c.width = c.height = LOWRES
        const cx = c.getContext('2d')!
        const img = cx.createImageData(LOWRES, LOWRES)
        for (let i = 0; i < LOWRES * LOWRES; i++) {
          const v = cand.logits[i]
          if (v > 0) {
            img.data[i * 4] = 40
            img.data[i * 4 + 1] = 150
            img.data[i * 4 + 2] = 255
            img.data[i * 4 + 3] = v > 1.5 ? 120 : 70
          }
        }
        cx.putImageData(img, 0, 0)
        ;(c as any).__src = cand.logits
        this.previewCanvas = c
      }
      const g = cand.geom
      const p0 = toScreen({ x: g.region.x, y: g.region.y })
      const p1 = toScreen({ x: g.region.x + 4 / g.sx, y: g.region.y })
      const p2 = toScreen({ x: g.region.x, y: g.region.y + 4 / g.sy })
      ctx.save()
      ctx.setTransform(1, 0, 0, 1, 0, 0)
      const dpr = window.devicePixelRatio || 1
      ctx.setTransform(dpr * (p1.x - p0.x), dpr * (p1.y - p0.y), dpr * (p2.x - p0.x), dpr * (p2.y - p0.y), dpr * p0.x, dpr * p0.y)
      ctx.imageSmoothingEnabled = true
      ctx.drawImage(this.previewCanvas, 0, 0)
      ctx.restore()
    }
    const s = this.session
    if (s) {
      s.points.forEach((p, i) => this.marker(ctx, toScreen(p), p.label === 1, i))
      if (s.box) this.boxPath(ctx, s.box, toScreen, '#4c9bff')
      for (const st of s.strokes) this.strokePath(ctx, st, toScreen)
    }
    if (this.liveStroke) this.strokePath(ctx, this.liveStroke, toScreen)
    if (this.liveBox) this.boxPath(ctx, this.liveBox, toScreen, '#fff')
    // brush cursor
    if (ss.mode === 'brush' && this.hoverPos) {
      const q = toScreen(this.hoverPos)
      ctx.beginPath()
      ctx.arc(q.x, q.y, ss.brushSize / 2, 0, Math.PI * 2)
      ctx.lineWidth = 3
      ctx.strokeStyle = 'rgba(0,0,0,.55)'
      ctx.stroke()
      ctx.lineWidth = 1.2
      ctx.strokeStyle = ss.negative ? '#ff6b6b' : '#fff'
      ctx.stroke()
    }
  }

  private marker(ctx: CanvasRenderingContext2D, q: { x: number; y: number }, pos: boolean, _i: number): void {
    ctx.beginPath()
    ctx.arc(q.x, q.y, 8, 0, Math.PI * 2)
    ctx.fillStyle = pos ? 'rgba(46,190,96,.95)' : 'rgba(235,70,70,.95)'
    ctx.fill()
    ctx.lineWidth = 2
    ctx.strokeStyle = '#fff'
    ctx.stroke()
    ctx.beginPath()
    ctx.moveTo(q.x - 4, q.y)
    ctx.lineTo(q.x + 4, q.y)
    if (pos) {
      ctx.moveTo(q.x, q.y - 4)
      ctx.lineTo(q.x, q.y + 4)
    }
    ctx.lineWidth = 2
    ctx.strokeStyle = '#fff'
    ctx.stroke()
  }

  private boxPath(ctx: CanvasRenderingContext2D, r: Rect, toScreen: (p: { x: number; y: number }) => { x: number; y: number }, col: string): void {
    const a = toScreen({ x: r.x, y: r.y })
    const b = toScreen({ x: r.x + r.w, y: r.y })
    const c = toScreen({ x: r.x + r.w, y: r.y + r.h })
    const d = toScreen({ x: r.x, y: r.y + r.h })
    ctx.beginPath()
    ctx.moveTo(a.x, a.y)
    for (const p of [b, c, d]) ctx.lineTo(p.x, p.y)
    ctx.closePath()
    ctx.lineWidth = 3
    ctx.strokeStyle = 'rgba(0,0,0,.6)'
    ctx.stroke()
    ctx.setLineDash([6, 4])
    ctx.lineWidth = 1.5
    ctx.strokeStyle = col
    ctx.stroke()
  }

  private strokePath(ctx: CanvasRenderingContext2D, st: BrushStroke, toScreen: (p: { x: number; y: number }) => { x: number; y: number }): void {
    ctx.save()
    ctx.lineCap = 'round'
    ctx.lineJoin = 'round'
    const col = st.label ? 'rgba(46,190,96,.45)' : 'rgba(235,70,70,.45)'
    for (let i = 0; i < st.pts.length; i++) {
      const q = toScreen(st.pts[i])
      const r = (st.radii[i] ?? st.radii[0]) * this.app.view.zoom
      ctx.beginPath()
      if (i) {
        const p = toScreen(st.pts[i - 1])
        ctx.moveTo(p.x, p.y)
        ctx.lineTo(q.x, q.y)
      } else ctx.moveTo(q.x, q.y)
      ctx.lineWidth = Math.max(2, r * 2)
      ctx.strokeStyle = col
      ctx.stroke()
    }
    ctx.restore()
  }

  /** Index of the prompt marker under a screen position (px), -1 for the box, null for none. */
  markerAt(doc: { x: number; y: number }): number | null {
    const s = this.session
    if (!s) return null
    const z = this.app.view.zoom
    for (let i = s.points.length - 1; i >= 0; i--) if (Math.hypot(s.points[i].x - doc.x, s.points[i].y - doc.y) * z < 11) return i
    return null
  }
}

const unionR = (a: Rect, b: Rect): Rect => {
  const x0 = Math.min(a.x, b.x)
  const y0 = Math.min(a.y, b.y)
  return { x: x0, y: y0, w: Math.max(a.x + a.w, b.x + b.w) - x0, h: Math.max(a.y + a.h, b.y + b.h) - y0 }
}

// ------------------------------------------------------------------------------------------------ pointer tool
export class SmartTool implements Tool {
  readonly id = 'smartselect'
  private start: Sample | null = null
  private moved = false
  private neg = false
  private consumed = false
  private stroke: BrushStroke | null = null
  /** Alt currently held (the app's Alt-eyedropper is suppressed while the tool is open) */
  alt = false
  private eraser = false
  private rightClick = false

  constructor(private c: SmartSelect) {
    const c0 = c.app.canvas
    // remember how the pointer went down (pen eraser end / right button) before the tool is called
    c0.addEventListener(
      'pointerdown',
      (e) => {
        this.eraser = e.pointerType === 'pen' && ((e.buttons & 32) !== 0 || e.button === 5)
        this.rightClick = e.button === 2
        this.alt = this.alt || e.altKey
      },
      true
    )
    c0.addEventListener('contextmenu', (e) => {
      if (this.c.active) e.preventDefault()
    })
    // the app maps the right mouse button to an action, so the tool takes it before the input layer: right click = remove area
    let rightDown: { id: number } | null = null
    window.addEventListener(
      'pointerdown',
      (e) => {
        if (!this.c.active || e.button !== 2 || e.pointerType !== 'mouse' || e.target !== c0) return
        e.stopImmediatePropagation()
        e.preventDefault()
        rightDown = { id: e.pointerId }
      },
      true
    )
    window.addEventListener(
      'pointerup',
      (e) => {
        if (!rightDown || e.pointerId !== rightDown.id || e.button !== 2) return
        rightDown = null
        e.stopImmediatePropagation()
        if (!this.c.active || ss.mode === 'brush') return
        const r = c0.getBoundingClientRect()
        const { w, h } = this.c.app.cssSize()
        const p = screenToDoc(this.c.app.view, e.clientX - r.left, e.clientY - r.top, w, h)
        const hit = this.c.markerAt(p)
        if (hit !== null) this.c.removePoint(hit)
        else this.c.addPoint(p.x, p.y, 0)
      },
      true
    )
    // Alt = momentary "remove area". The app binds Alt to the eyedropper; the tool takes the key while it is open.
    window.addEventListener(
      'keydown',
      (e) => {
        if (!this.c.active || e.key !== 'Alt') return
        this.alt = true
        e.preventDefault()
        e.stopImmediatePropagation()
      },
      true
    )
    window.addEventListener(
      'keyup',
      (e) => {
        if (!this.c.active || e.key !== 'Alt') return
        this.alt = false
        e.stopImmediatePropagation()
      },
      true
    )
    window.addEventListener('blur', () => (this.alt = false))
    c0.addEventListener('pointermove', (e) => {
      if (!this.c.active || e.buttons) return
      const r = c0.getBoundingClientRect()
      const { w, h } = c.app.cssSize()
      const p = screenToDoc(c.app.view, e.clientX - r.left, e.clientY - r.top, w, h)
      c.hover(p.x, p.y, this.alt || e.altKey)
      if (ss.mode === 'brush') c.overlay.invalidate()
    })
    c0.addEventListener('pointerleave', () => {
      if (this.c.active) {
        c.hoverPos = null
        if (c.preview && !c.session) c.preview = null
        c.overlay.invalidate()
      }
    })
  }

  private get negative(): boolean {
    return this.alt || this.eraser || this.rightClick || ss.negative
  }

  begin(s: Sample, _host: ToolHost): boolean {
    void _host
    this.start = s
    this.moved = false
    this.consumed = false
    this.neg = this.negative
    if (ss.mode === 'brush') {
      const z = this.c.app.view.zoom
      const base = ss.brushSize / 2 / z
      this.stroke = { pts: [{ x: s.x, y: s.y }], radii: [this.radius(base, s)], label: this.neg ? 0 : 1 }
      this.c.liveStroke = this.stroke
      this.c.overlay.invalidate()
      return true
    }
    // click on an existing marker removes it
    const hit = this.c.markerAt({ x: s.x, y: s.y })
    if (hit !== null) {
      this.consumed = true
      this.c.removePoint(hit)
    }
    return true
  }

  private radius(base: number, s: Sample): number {
    if (s.pointerType === 'pen') return Math.max(0.5, base * (0.3 + 0.7 * Math.min(1, s.pressure)))
    return base
  }

  move(samples: Sample[], _host: ToolHost): void {
    void _host
    const s0 = this.start
    if (!s0 || this.consumed) return
    const z = this.c.app.view.zoom
    for (const s of samples) {
      if (ss.mode === 'brush' && this.stroke) {
        const last = this.stroke.pts[this.stroke.pts.length - 1]
        if (Math.hypot(s.x - last.x, s.y - last.y) * z < 2) continue
        this.stroke.pts.push({ x: s.x, y: s.y })
        this.stroke.radii.push(this.radius(ss.brushSize / 2 / z, s))
        continue
      }
      if (Math.hypot(s.x - s0.x, s.y - s0.y) * z > 6) this.moved = true
      if (this.moved) this.c.liveBox = { x: Math.min(s0.x, s.x), y: Math.min(s0.y, s.y), w: Math.abs(s.x - s0.x), h: Math.abs(s.y - s0.y) }
    }
    this.c.overlay.invalidate()
  }

  end(_host: ToolHost): void {
    void _host
    const s0 = this.start
    this.start = null
    this.eraser = false
    this.rightClick = false
    if (!s0 || this.consumed) return
    if (ss.mode === 'brush') {
      const st = this.stroke
      this.stroke = null
      if (st) void this.c.brushStrokeDone(st)
      return
    }
    const box = this.c.liveBox
    this.c.liveBox = null
    if (this.moved && box && box.w > 2 && box.h > 2) this.c.addBox(box)
    else this.c.addPoint(s0.x, s0.y, this.neg ? 0 : 1)
  }

  cancel(_host: ToolHost): void {
    void _host
    this.start = null
    this.stroke = null
    this.c.liveBox = null
    this.c.liveStroke = null
    this.c.overlay.invalidate()
  }
}
