import type { App } from '../../app/app'
import type { Sample } from '../../core/types'
import { strokeHooks } from '../../tools/strokeHooks'
import type { StrokeAdapter, StrokeApi } from '../../tools/strokeHooks'
import { t, tk } from '../../i18n'
import { h } from '../../ui/dom'
import type { GuideManager } from './guideManager'
import { assistCandidates, Pt } from './model'
import type { DragHandler, Overlay } from './overlay'
import { Handle, Shape, dragHandle, perfectShape, recognizeShape, shapeCenter, shapeHandles, shapePoints, similarity } from './shapes'
import { floatPanel, FloatPanel, segRow, sliderRow, toggleRow } from './widgets'

export interface QuickShapeSettings {
  enabled: boolean
  /** hold delay in ms */
  holdMs: number
}
export const quickShapeSettings: QuickShapeSettings = { enabled: true, holdMs: 550 }

const STILL_PX = 3 // screen px of pointer travel that still counts as "holding"

interface ActiveShape {
  shape: Shape
  layerId: string
  toolId: string
  pressure: number
  perfect: boolean
  seq: number
}

const RAD = Math.PI / 180

function shapeSamples(shape: Shape, pressure: number, t0: number): Sample[] {
  const pts = shapePoints(shape, 2)
  return pts.map((p, i) => ({ x: p.x, y: p.y, pressure, tiltX: 0, tiltY: 0, twist: 0, t: t0 + i * 3 }))
}

/** Snap a recognised line to the direction lines of the active guide (Snap to Drawing Guides). */
function snapLineToGuide(shape: Shape, mgr: GuideManager, layerId: string): Shape {
  const g = mgr.state
  if (shape.kind !== 'line' || !g.enabled || !mgr.assistOn(layerId)) return shape
  const cands = assistCandidates(g, shape.a)
  const ang = Math.atan2(shape.b.y - shape.a.y, shape.b.x - shape.a.x)
  let best: { d: number; dir: Pt } | null = null
  for (const c of cands) {
    for (const s of [1, -1]) {
      const a = Math.atan2(c.dir.y * s, c.dir.x * s)
      let d = Math.abs(a - ang)
      if (d > Math.PI) d = 2 * Math.PI - d
      if (!best || d < best.d) best = { d, dir: { x: c.dir.x * s, y: c.dir.y * s } }
    }
  }
  if (!best || best.d > 8 * RAD) return shape
  const l = Math.hypot(shape.b.x - shape.a.x, shape.b.y - shape.a.y)
  return { kind: 'line', a: shape.a, b: { x: shape.a.x + best.dir.x * l, y: shape.a.y + best.dir.y * l } }
}

/**
 * QuickShape: hold still at the end of a stroke and it snaps to a line / arc / ellipse / rectangle / polygon / polyline.
 * While still holding, dragging scales/rotates the shape, Shift (or a second finger) makes it perfect. After release the
 * shape stays editable through handles until the next stroke: each edit undoes the shape stroke and re-stamps it.
 */
export class QuickShape {
  active: ActiveShape | null = null
  private pending: { shape: Shape; pressure: number; perfect: boolean; toolId: string; layerId: string } | null = null
  private current: { setPerfect(v: boolean): void } | null = null
  private shiftDown = false
  private touches = new Set<number>()
  private internal = false
  private lastSeq = -1
  private pill: HTMLElement
  private pillLabel: HTMLElement
  private perfectBtn: HTMLElement

  constructor(
    readonly app: App,
    readonly overlay: Overlay,
    readonly mgr: GuideManager
  ) {
    strokeHooks.register('quickshape', (ctx) => this.makeAdapter(ctx), 10)
    overlay.addPainter((c) => this.paint(c), 30)
    overlay.addInteractor({ pick: (x, y) => this.pick(x, y) }, 0)
    const hook = (): void => {
      this.active = null
      this.updatePill()
      app.doc.events.on('commit', (e) => this.onCommit(e))
      app.doc.events.on('layers', () => {
        if (this.active && app.doc.activeId !== this.active.layerId) this.finish()
      })
    }
    hook()
    app.events.on('doc', hook)
    window.addEventListener('keydown', (e) => {
      if (e.key === 'Shift') this.setConstrain(true, 'key')
    })
    window.addEventListener('keyup', (e) => {
      if (e.key === 'Shift') this.setConstrain(false, 'key')
    })
    window.addEventListener(
      'pointerdown',
      (e) => {
        if (e.pointerType === 'touch') {
          this.touches.add(e.pointerId)
          if (this.touches.size >= 2 && this.current) this.current.setPerfect(true)
        }
      },
      true
    )
    const rel = (e: PointerEvent): void => void this.touches.delete(e.pointerId)
    window.addEventListener('pointerup', rel, true)
    window.addEventListener('pointercancel', rel, true)

    this.perfectBtn = h('button', { class: 'bwf-btn', text: tk('guides.quickshape.perfect'), onclick: () => this.togglePerfect() })
    this.pillLabel = h('span')
    this.pill = h('div', { class: 'bw-qs-pill' }, this.pillLabel, this.perfectBtn, h('button', { class: 'bwf-btn primary', text: tk('core.common.done'), onclick: () => this.finish() }))
    this.pill.style.cssText = 'position:absolute;top:12px;left:50%;transform:translateX(-50%);display:none;align-items:center;gap:8px;padding:6px 10px;background:var(--panel,#2a2a2d);border:1px solid var(--line,#3d3d42);border-radius:999px;box-shadow:0 6px 24px #0008;z-index:5;color:var(--text,#e8e8ea)'
    overlay.stage.append(this.pill)
  }

  private setConstrain(on: boolean, _src: string): void {
    this.shiftDown = on
    if (this.current) this.current.setPerfect(on)
  }

  // ------------------------------------------------------------------ stroke adapter
  private makeAdapter(ctx: { first: Sample; layerId: string; mode: string; toolId: string }): StrokeAdapter | null {
    // a new stroke rasterises (finishes) the previous shape
    this.finish()
    if (!quickShapeSettings.enabled || ctx.mode === 'smudge') return null
    const app = this.app
    const pts: Sample[] = []
    let anchor: Pt = { x: ctx.first.x, y: ctx.first.y }
    let timer = 0
    let api: StrokeApi | null = null
    let shape: Shape | null = null
    let base: Shape | null = null
    let ref: Pt = anchor
    let pressure = 0.7
    let perfect = false
    let last: Sample = ctx.first
    let t0 = 0

    const render = (): void => {
      if (!shape || !api) return
      const out = perfect ? perfectShape(shape) : shape
      api.replace(shapeSamples(out, pressure, t0))
    }
    const fire = (): void => {
      timer = 0
      if (!api || shape) return
      const s = recognizeShape(pts, { minLength: 24 / Math.max(0.05, app.view.zoom) })
      if (!s) return
      shape = snapLineToGuide(s, this.mgr, ctx.layerId)
      base = shape
      ref = { x: last.x, y: last.y }
      let sum = 0
      for (const p of pts) sum += p.pressure
      pressure = Math.max(0.25, sum / pts.length)
      t0 = last.t
      perfect = this.shiftDown || this.touches.size >= 2
      render()
      app.notify(t('guides.quickshape.shapeToast', { shape: this.label(shape) }))
    }
    const arm = (): void => {
      if (timer) clearTimeout(timer)
      timer = window.setTimeout(fire, quickShapeSettings.holdMs)
    }
    const adapter: StrokeAdapter = {
      input: (s, a) => {
        api = a
        last = s
        if (!shape) {
          pts.push(s)
          if (Math.hypot(s.x - anchor.x, s.y - anchor.y) * app.view.zoom > STILL_PX) {
            anchor = { x: s.x, y: s.y }
            arm()
          } else if (!timer) arm()
          return [s]
        }
        // shape mode: dragging reshapes
        if (base) {
          const c = shapeCenter(base)
          if (base.kind === 'line') {
            shape = { kind: 'line', a: base.a, b: { x: s.x, y: s.y } }
          } else {
            const r0 = Math.hypot(ref.x - c.x, ref.y - c.y) || 1
            const r1 = Math.hypot(s.x - c.x, s.y - c.y) || 1
            const dRot = Math.atan2(s.y - c.y, s.x - c.x) - Math.atan2(ref.y - c.y, ref.x - c.x)
            shape = similarity(base, c, Math.max(0.05, r1 / r0), dRot)
          }
          render()
        }
        return []
      },
      end: () => {
        if (timer) clearTimeout(timer)
        timer = 0
        this.current = null
        if (shape) {
          this.pending = { shape: perfect ? perfectShape(shape) : shape, pressure, perfect, toolId: ctx.toolId, layerId: ctx.layerId }
        }
        return []
      },
      cancel: () => {
        if (timer) clearTimeout(timer)
        this.current = null
      }
    }
    this.current = {
      setPerfect: (v) => {
        if (!shape) return
        perfect = v
        render()
      }
    }
    return adapter
  }

  private label(s: Shape): string {
    switch (s.kind) {
      case 'ellipse':
        return Math.abs(s.rx - s.ry) < 0.5 ? t('guides.quickshape.circle') : t('guides.quickshape.ellipse')
      case 'rect':
        return Math.abs(s.w - s.h) < 0.5 ? t('guides.quickshape.square') : t('guides.quickshape.rectangle')
      case 'polygon':
        return s.pts.length === 3 ? t('guides.quickshape.triangle') : t('guides.quickshape.polygon', { n: s.pts.length })
      case 'line':
        return t('guides.quickshape.line')
      case 'arc':
        return t('guides.quickshape.arc')
      case 'polyline':
        return t('guides.quickshape.polyline')
    }
  }

  // ------------------------------------------------------------------ after release: edit handles
  private onCommit(e: { type: string; layerId: string | null; seq: number }): void {
    this.lastSeq = e.seq
    if (this.internal) {
      if (this.active && (e.type === 'stroke' || e.type === 'erase')) this.active.seq = e.seq
      return
    }
    if (this.pending && (e.type === 'stroke' || e.type === 'erase') && e.layerId === this.pending.layerId) {
      this.active = { ...this.pending, seq: e.seq }
      this.pending = null
      this.updatePill()
      this.overlay.redraw()
      return
    }
    if (this.active && e.seq !== this.active.seq) this.finish()
  }

  private updatePill(): void {
    if (!this.pill) return
    const a = this.active
    this.pill.style.display = a ? 'flex' : 'none'
    if (a) {
      this.pillLabel.textContent = t('guides.quickshape.editShape', { shape: this.label(a.shape) })
      this.perfectBtn.classList.toggle('on', a.perfect)
    }
  }

  finish(): void {
    if (!this.active && !this.pending) return
    this.active = null
    this.pending = null
    this.updatePill()
    this.overlay.redraw()
  }

  private togglePerfect(): void {
    const a = this.active
    if (!a) return
    a.perfect = !a.perfect
    this.restamp(a.perfect ? perfectShape(a.shape) : a.shape)
    if (a.perfect) a.shape = perfectShape(a.shape)
    this.updatePill()
  }

  /** Undo the shape stroke and re-stamp it with a new shape through the normal paint pipeline. */
  private restamp(shape: Shape): void {
    const a = this.active
    if (!a) return
    const app = this.app
    const doc = app.doc
    if (a.seq !== this.lastSeq || doc.activeId !== a.layerId) return this.finish()
    const tool = app.tools.get(a.toolId)
    if (!tool) return
    this.internal = true
    try {
      doc.undo()
      const samples = shapeSamples(shape, a.pressure, performance.now())
      const g = this.mgr.makeAdapter(a.layerId, samples[0])
      strokeHooks.oneShot = { channels: g?.channels, bypassSmoothing: true, input: (s) => [s] }
      if (tool.begin(samples[0], app)) {
        tool.move(samples.slice(1), app)
        tool.end(app)
      }
      a.shape = shape
    } finally {
      strokeHooks.oneShot = null
      this.internal = false
    }
    this.overlay.redraw()
  }

  private handles(): Handle[] {
    const a = this.active
    if (!a) return []
    return shapeHandles(a.shape, 40 / Math.max(0.05, this.app.view.zoom))
  }

  private pick(sx: number, sy: number): DragHandler | null {
    const a = this.active
    if (!a) return null
    const ov = this.overlay
    for (const hd of this.handles()) {
      const p = ov.toScreen(hd.p)
      if (Math.hypot(p.x - sx, p.y - sy) > 16) continue
      let raf = 0
      let target: Pt | null = null
      const apply = (): void => {
        raf = 0
        if (!target || !this.active) return
        const cur = this.active
        const next = dragHandle(cur.shape, hd.id, target, cur.perfect || this.shiftDown)
        this.restamp(next)
        // keep dragging the same logical handle even though the shape changed
      }
      return {
        move: (x, y) => {
          target = ov.toDoc(x, y)
          if (!raf) raf = requestAnimationFrame(apply)
        },
        up: () => {
          if (raf) cancelAnimationFrame(raf)
          apply()
          this.updatePill()
        }
      }
    }
    return null
  }

  private paint(c: CanvasRenderingContext2D): void {
    const a = this.active
    if (!a) return
    const ov = this.overlay
    const hs = this.handles()
    // dashed guide line to the rotate handle
    const cen = hs.find((q) => q.id === 'c')
    const rot = hs.find((q) => q.id === 'rot')
    if (cen && rot) {
      const p = ov.toScreen(cen.p)
      const q = ov.toScreen(rot.p)
      c.beginPath()
      c.moveTo(p.x, p.y)
      c.lineTo(q.x, q.y)
      c.strokeStyle = 'rgba(255,255,255,.8)'
      c.setLineDash([4, 4])
      c.stroke()
      c.setLineDash([])
    }
    for (const hd of hs) {
      const p = ov.toScreen(hd.p)
      c.beginPath()
      if (hd.id === 'rot' || hd.id === 'c') c.arc(p.x, p.y, hd.id === 'c' ? 6 : 8, 0, Math.PI * 2)
      else c.rect(p.x - 6, p.y - 6, 12, 12)
      c.fillStyle = hd.id === 'rot' ? '#3b82f6' : '#fff'
      c.fill()
      c.lineWidth = 2
      c.strokeStyle = hd.id === 'rot' ? '#fff' : '#3b82f6'
      c.stroke()
    }
  }
}

export function buildQuickShapePanel(app: App): FloatPanel {
  const panel = floatPanel(tk('guides.quickshape.quickshapeAndStreamline'), 290, { right: 16, top: 60 })
  const b = panel.body
  b.append(toggleRow(tk('guides.quickshape.quickshapeHoldAtEnd'), () => quickShapeSettings.enabled, (v) => (quickShapeSettings.enabled = v)).el)
  b.append(sliderRow(tk('guides.quickshape.holdDelay'), 150, 1500, 10, () => quickShapeSettings.holdMs, (v) => (quickShapeSettings.holdMs = v), (v) => t('guides.quickshape.ms', { n: Math.round(v) })).el)
  b.append(h('div', { class: 'bwf-note', text: tk('guides.quickshape.keepHoldingAfterThe') }))
  b.append(h('div', { class: 'bwf-sec', text: tk('guides.quickshape.streamline') }))
  const st = app.state
  const useBrush = segRow<string>(
    [
      ['brush', tk('guides.quickshape.perBrush')],
      ['custom', tk('guides.quickshape.override')]
    ],
    () => (st.smoothingOverride === null ? 'brush' : 'custom'),
    (v) => {
      st.smoothingOverride = v === 'brush' ? null : Math.max(0, st.preset.streamline)
      sl.update()
    }
  )
  b.append(useBrush.el)
  const sl = sliderRow(
    tk('guides.quickshape.amount'),
    0,
    100,
    1,
    () => Math.round((st.smoothingOverride ?? st.preset.streamline) * 100),
    (v) => {
      st.smoothingOverride = v / 100
      useBrush.update()
    },
    (v) => Math.round(v) + '%'
  )
  b.append(sl.el)
  const open = panel.open
  panel.open = (): void => {
    open()
    useBrush.update()
    sl.update()
  }
  return panel
}
