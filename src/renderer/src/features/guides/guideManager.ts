import type { App } from '../../app/app'
import { Emitter } from '../../core/events'
import type { Document } from '../../doc/document'
import type { Sample } from '../../core/types'
import { strokeHooks } from '../../tools/strokeHooks'
import type { StrokeAdapter, StrokeChannel } from '../../tools/strokeHooks'
import { viewportRect, workRect } from '../frame/workRect'
import { GuideState, Pt, applyXform, infiniteAnchor, pickLine, projectOnLine, assistCandidates, defaultGuide, familyDirs, normalizeGuide, symmetryAxes, symmetryTransforms } from './model'
import type { DragHandler, Overlay } from './overlay'

export interface GuideEvents {
  /** guide state changed (or document swapped) */
  change: void
  /** edit mode toggled */
  edit: boolean
}

const RAD = Math.PI / 180

/** Owns the per-document guide state, draws it on the overlay, lets the user drag its handles and feeds the stroke pipeline. */
export class GuideManager {
  readonly events = new Emitter<GuideEvents>()
  private states = new WeakMap<Document, GuideState>()
  editing = false
  /** selected vanishing point while editing */
  selVp = 0

  constructor(
    readonly app: App,
    readonly overlay: Overlay
  ) {
    app.events.on('doc', () => this.events.emit('change', undefined))
    overlay.addPainter((c) => this.draw(c), 10)
    overlay.addInteractor({ pick: (x, y) => this.pick(x, y) }, 10)
    strokeHooks.register('guides', (ctx) => this.makeAdapter(ctx.layerId, ctx.first), 0)
    this.events.on('change', () => overlay.redraw())
    this.events.on('edit', () => overlay.redraw())
  }

  // ------------------------------------------------------------------ state
  get state(): GuideState {
    let s = this.states.get(this.app.doc)
    if (!s) {
      s = defaultGuide(this.app.doc.width, this.app.doc.height)
      this.states.set(this.app.doc, s)
    }
    return s
  }
  exportState(doc: Document): GuideState {
    return this.states.get(doc) ?? defaultGuide(doc.width, doc.height)
  }
  setFor(doc: Document, raw: unknown): void {
    this.states.set(doc, normalizeGuide(raw, doc.width, doc.height))
    if (doc === this.app.doc) this.events.emit('change', undefined)
  }
  /** Rectangle a new guide is centred in on an infinite canvas: the frame, else the visible area. */
  anchorBox(): { x: number; y: number; w: number; h: number } {
    return workRect(this.app)
  }
  /** Infinite canvas: put the symmetry centre / vanishing points / grid origin at the anchor (frame or view centre). */
  placeAtAnchor(): void {
    const g = this.state
    const a = infiniteAnchor(this.anchorBox())
    const box = this.anchorBox()
    g.symCenter = a.centre
    g.gridOrigin = a.centre
    g.vps = [a.vp, { x: a.vp.x - box.w * 0.4, y: a.vp.y }, { x: a.vp.x, y: Math.round(box.y + box.h * 1.6) }].slice(0, Math.max(1, g.vps.length))
    g.placed = true
  }
  /** Patch the guide; notifies listeners. */
  set(patch: Partial<GuideState>): void {
    const g = this.state
    Object.assign(g, patch)
    if (this.app.doc.isInfinite && !g.placed && g.enabled) this.placeAtAnchor()
    this.events.emit('change', undefined)
  }
  setEditing(on: boolean): void {
    if (this.editing === on) return
    this.editing = on
    this.events.emit('edit', on)
  }
  /** Drawing Assist is the per-layer `drawingAssist` flag (saved with the layer props). */
  assistOn(layerId: string): boolean {
    return !!this.app.doc.getLayer(layerId)?.drawingAssist
  }
  setAssist(layerId: string, on: boolean): void {
    this.app.doc.setLayerProps(layerId, { drawingAssist: on })
    this.events.emit('change', undefined)
  }
  /** vanishing-point count for perspective: 1, 2 or 3 */
  setVpCount(n: 1 | 2 | 3): void {
    const g = this.state
    const box = this.app.doc.isInfinite ? this.anchorBox() : { x: 0, y: 0, w: this.app.doc.width, h: this.app.doc.height }
    const w = box.w
    const h = box.h
    const ox = box.x
    const oy = box.y
    const defaults: Pt[] = [
      { x: ox + w * 0.5, y: oy + h * 0.4 },
      { x: ox + w * 0.1, y: oy + h * 0.4 },
      { x: ox + w * 0.5, y: oy + h * 1.6 }
    ]
    if (n === 1) g.vps = [g.vps[0] ?? defaults[0]]
    else if (n === 2) g.vps = [g.vps[0] ?? { x: ox + w * 0.9, y: oy + h * 0.4 }, g.vps[1] ?? { x: ox + w * 0.1 - 0, y: (g.vps[0] ?? defaults[0]).y }]
    else g.vps = [g.vps[0] ?? defaults[0], g.vps[1] ?? defaults[1], g.vps[2] ?? defaults[2]]
    if (n === 2 && g.vps.length === 2 && g.vps[1].x === g.vps[0].x) g.vps[1] = { x: ox + w * 0.1, y: g.vps[0].y }
    this.selVp = Math.min(this.selVp, g.vps.length - 1)
    this.events.emit('change', undefined)
  }

  // ------------------------------------------------------------------ stroke hook
  makeAdapter(layerId: string, first: Sample): StrokeAdapter | null {
    const g = this.state
    if (!g.enabled || !this.assistOn(layerId)) return null
    const c = { ...g.symCenter }
    const xf = g.type === 'symmetry' ? symmetryTransforms(g) : []
    const lines = assistCandidates(g, first)
    if (!xf.length && !lines.length) return null
    const channels: StrokeChannel[] | undefined = xf.length
      ? xf.map((x) => ({
          sample: (s: Sample): Sample => {
            if (!x.reflect && !x.theta) return s
            const p = applyXform(x, c, s)
            return { ...s, x: p.x, y: p.y }
          }
        }))
      : undefined
    const start = { x: first.x, y: first.y }
    let line: ReturnType<typeof pickLine> = null
    const startSample: Sample = first
    const app = this.app
    return {
      channels,
      input: (s) => {
        if (!lines.length) return [s]
        if (!line) {
          const thr = 8 / Math.max(0.02, app.view.zoom)
          if (Math.hypot(s.x - start.x, s.y - start.y) < thr) {
            return []
          }
          line = pickLine(lines, { x: s.x - start.x, y: s.y - start.y })!
          const o = projectOnLine(line, start)
          const p = projectOnLine(line, s)
          return [{ ...startSample, x: o.x, y: o.y }, { ...s, x: p.x, y: p.y }]
        }
        const p = projectOnLine(line, s)
        return [{ ...s, x: p.x, y: p.y }]
      },
      end: () => (lines.length && !line ? [startSample] : [])
    }
  }

  // ------------------------------------------------------------------ drawing
  private stroke(): string {
    const g = this.state
    return `hsla(${g.hue}, 100%, 62%, ${g.opacity})`
  }

  /** Document-space bounding box of the visible viewport, plus padding. */
  private visibleDoc(): Pt[] {
    const ov = this.overlay
    return [ov.toDoc(0, 0), ov.toDoc(ov.w, 0), ov.toDoc(ov.w, ov.h), ov.toDoc(0, ov.h)]
  }

  private line(c: CanvasRenderingContext2D, a: Pt, b: Pt): void {
    const p = this.overlay.toScreen(a)
    const q = this.overlay.toScreen(b)
    c.moveTo(p.x, p.y)
    c.lineTo(q.x, q.y)
  }

  /** Parallel lines with direction `dir`, spaced `size` doc px apart (through the doc origin). */
  private family(c: CanvasRenderingContext2D, dir: Pt, size: number): void {
    const corners = this.visibleDoc()
    const n = { x: -dir.y, y: dir.x }
    const org = this.state.gridOrigin
    const o0 = org.x * n.x + org.y * n.y
    let n0 = Infinity
    let n1 = -Infinity
    let d0 = Infinity
    let d1 = -Infinity
    for (const p of corners) {
      const a = p.x * n.x + p.y * n.y
      const b = p.x * dir.x + p.y * dir.y
      n0 = Math.min(n0, a)
      n1 = Math.max(n1, a)
      d0 = Math.min(d0, b)
      d1 = Math.max(d1, b)
    }
    let step = size
    const zoom = this.app.view.zoom
    while (step * zoom < 5) step *= 2 // never draw an unreadable mesh
    const k0 = Math.floor((n0 - o0) / step)
    const k1 = Math.ceil((n1 - o0) / step)
    if (k1 - k0 > 1500) return
    for (let k = k0; k <= k1; k++) {
      const o = k * step + o0
      this.line(c, { x: n.x * o + dir.x * d0, y: n.y * o + dir.y * d0 }, { x: n.x * o + dir.x * d1, y: n.y * o + dir.y * d1 })
    }
  }

  private draw(c: CanvasRenderingContext2D): void {
    const g = this.state
    if (!g.enabled && !this.editing) return
    c.strokeStyle = this.stroke()
    c.lineWidth = g.thickness
    c.lineCap = 'round'
    c.beginPath()
    if (g.type === 'grid' || g.type === 'iso') {
      for (const d of familyDirs(g)) this.family(c, d, g.gridSize)
      c.stroke()
    } else if (g.type === 'perspective') this.drawPerspective(c, g)
    else this.drawSymmetry(c, g)
    if (this.editing) this.drawHandles(c, g)
  }

  private reach(from: Pt): number {
    let r = 0
    for (const p of this.visibleDoc()) r = Math.max(r, Math.hypot(p.x - from.x, p.y - from.y))
    return r + 50
  }

  private drawPerspective(c: CanvasRenderingContext2D, g: GuideState): void {
    const stepDeg = Math.min(30, Math.max(2.5, g.gridSize / 8))
    const n = Math.round(360 / stepDeg)
    for (const v of g.vps) {
      const R = this.reach(v)
      for (let i = 0; i < n; i++) {
        const a = (i / n) * Math.PI * 2
        this.line(c, v, { x: v.x + Math.cos(a) * R, y: v.y + Math.sin(a) * R })
      }
    }
    c.stroke()
    // horizon
    c.beginPath()
    c.lineWidth = g.thickness * 2
    if (g.vps.length >= 2) {
      const a = g.vps[0]
      const b = g.vps[1]
      const l = Math.hypot(b.x - a.x, b.y - a.y) || 1
      const R = this.reach(a) + this.reach(b)
      const d = { x: (b.x - a.x) / l, y: (b.y - a.y) / l }
      this.line(c, { x: a.x - d.x * R, y: a.y - d.y * R }, { x: a.x + d.x * R, y: a.y + d.y * R })
    } else {
      const a = g.vps[0]
      const R = this.reach(a)
      this.line(c, { x: a.x - R, y: a.y }, { x: a.x + R, y: a.y })
    }
    c.stroke()
  }

  private drawSymmetry(c: CanvasRenderingContext2D, g: GuideState): void {
    const ctr = g.symCenter
    const R = this.reach(ctr)
    c.lineWidth = g.thickness * 1.5
    if (g.symKind === 'radial') {
      for (const a of symmetryAxes(g)) this.line(c, ctr, { x: ctr.x + Math.cos(a) * R, y: ctr.y + Math.sin(a) * R })
    } else {
      for (const a of symmetryAxes(g)) this.line(c, { x: ctr.x - Math.cos(a) * R, y: ctr.y - Math.sin(a) * R }, { x: ctr.x + Math.cos(a) * R, y: ctr.y + Math.sin(a) * R })
    }
    c.stroke()
  }

  // ------------------------------------------------------------------ handles
  private symHandle(g: GuideState): Pt {
    const cs = this.overlay.toScreen(g.symCenter)
    let a = g.symAngle * RAD - Math.PI / 2 + this.app.view.rot
    if (this.app.view.mirror) a = Math.PI - a
    return { x: cs.x + Math.cos(a) * 90, y: cs.y + Math.sin(a) * 90 }
  }

  private dot(c: CanvasRenderingContext2D, p: Pt, r: number, fill: boolean, label?: string): void {
    c.beginPath()
    c.arc(p.x, p.y, r, 0, Math.PI * 2)
    c.fillStyle = fill ? 'rgba(255,255,255,.95)' : 'rgba(20,20,24,.6)'
    c.fill()
    c.lineWidth = 2
    c.strokeStyle = fill ? `hsl(${this.state.hue},100%,50%)` : '#fff'
    c.stroke()
    if (label) {
      c.fillStyle = '#111'
      c.font = '600 11px "Segoe UI", sans-serif'
      c.textAlign = 'center'
      c.textBaseline = 'middle'
      c.fillText(label, p.x, p.y + 0.5)
    }
  }

  private drawHandles(c: CanvasRenderingContext2D, g: GuideState): void {
    if (g.type === 'perspective') {
      g.vps.forEach((v, i) => this.dot(c, this.overlay.toScreen(v), i === this.selVp ? 13 : 10, true, String(i + 1)))
    } else if (g.type === 'symmetry') {
      const cs = this.overlay.toScreen(g.symCenter)
      const hs = this.symHandle(g)
      c.beginPath()
      c.moveTo(cs.x, cs.y)
      c.lineTo(hs.x, hs.y)
      c.strokeStyle = '#fff'
      c.lineWidth = 1.5
      c.setLineDash([4, 4])
      c.stroke()
      c.setLineDash([])
      this.dot(c, cs, 11, true)
      this.dot(c, hs, 9, false)
    }
  }

  private lastTap = { t: 0, i: -1 }
  private pick(sx: number, sy: number): DragHandler | null {
    if (!this.editing) return null
    const g = this.state
    const ov = this.overlay
    const near = (p: Pt, r: number): boolean => Math.hypot(p.x - sx, p.y - sy) <= r
    if (g.type === 'perspective') {
      for (let i = 0; i < g.vps.length; i++) {
        if (near(ov.toScreen(g.vps[i]), 18)) {
          this.selVp = i
          this.events.emit('change', undefined)
          let moved = 0
          return {
            move: (x, y) => {
              const d = ov.toDoc(x, y)
              moved += 1
              g.vps[i] = d
              this.events.emit('change', undefined)
            },
            up: () => {
              const now = performance.now()
              if (moved < 3 && this.lastTap.i === i && now - this.lastTap.t < 400 && g.vps.length > 1) this.deleteVp(i)
              this.lastTap = { t: now, i }
            }
          }
        }
      }
      // drag the horizon line = translate every vanishing point
      const a = ov.toScreen(g.vps[0])
      const b = g.vps.length >= 2 ? ov.toScreen(g.vps[1]) : { x: a.x + 1, y: a.y + Math.tan(-this.app.view.rot) * (this.app.view.mirror ? -1 : 1) }
      const dx = b.x - a.x
      const dy = b.y - a.y
      const l = Math.hypot(dx, dy) || 1
      const dist = Math.abs((sx - a.x) * dy - (sy - a.y) * dx) / l
      if (dist < 8) {
        let last = ov.toDoc(sx, sy)
        return {
          move: (x, y) => {
            const d = ov.toDoc(x, y)
            const ddx = d.x - last.x
            const ddy = d.y - last.y
            last = d
            g.vps = g.vps.map((v) => ({ x: v.x + ddx, y: v.y + ddy }))
            this.events.emit('change', undefined)
          }
        }
      }
      // tap on empty canvas adds a vanishing point
      const start = { x: sx, y: sy }
      let moved = false
      return {
        move: (x, y) => void (moved = moved || Math.hypot(x - start.x, y - start.y) > 5),
        up: () => {
          if (moved || g.vps.length >= 3) return
          g.vps = [...g.vps, ov.toDoc(start.x, start.y)]
          this.selVp = g.vps.length - 1
          this.events.emit('change', undefined)
        }
      }
    }
    if (g.type === 'symmetry') {
      if (near(this.symHandle(g), 16)) {
        return {
          move: (x, y) => {
            const d = ov.toDoc(x, y)
            let a = (Math.atan2(d.y - g.symCenter.y, d.x - g.symCenter.x) + Math.PI / 2) / RAD
            a = ((((a + 180) % 360) + 360) % 360) - 180
            if (Math.abs(a) < 3) a = 0 // sticky at the upright axis
            g.symAngle = a
            this.events.emit('change', undefined)
          }
        }
      }
      if (near(ov.toScreen(g.symCenter), 20)) {
        const off = { x: 0, y: 0 }
        const p0 = ov.toDoc(sx, sy)
        off.x = g.symCenter.x - p0.x
        off.y = g.symCenter.y - p0.y
        return {
          move: (x, y) => {
            const d = ov.toDoc(x, y)
            g.symCenter = { x: d.x + off.x, y: d.y + off.y }
            // magnet to the canvas centre lines (infinite canvas: the frame / doc origin lines)
            const inf = this.app.doc.isInfinite
            const box = inf ? this.anchorBox() : { x: 0, y: 0, w: this.app.doc.width, h: this.app.doc.height }
            const W = box.x + box.w / 2
            const H = box.y + box.h / 2
            if (Math.abs(g.symCenter.x - W) < 6 / this.app.view.zoom) g.symCenter.x = W
            if (Math.abs(g.symCenter.y - H) < 6 / this.app.view.zoom) g.symCenter.y = H
            g.placed = true
            this.events.emit('change', undefined)
          }
        }
      }
    }
    return null
  }

  deleteVp(i: number): void {
    const g = this.state
    if (g.vps.length <= 1) return
    g.vps = g.vps.filter((_, j) => j !== i)
    this.selVp = Math.min(this.selVp, g.vps.length - 1)
    this.events.emit('change', undefined)
  }
}
