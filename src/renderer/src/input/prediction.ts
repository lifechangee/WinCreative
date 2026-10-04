import type { App } from '../app/app'
import { isBlendingMode } from '../core/brush'
import { docToScreen } from '../core/viewTransform'
import { smoothExtension } from './predictionMath'

/** Point in css px relative to the canvas top-left. */
export interface PredPt {
  x: number
  y: number
  p: number
}

/**
 * Display-only stroke prediction. The pointer layer hands us `PointerEvent.getPredictedEvents()` of the stroke's pointer;
 * the segment from the last real sample to the predicted tip is drawn on a transparent 2D canvas stacked above the GL
 * canvas, in the brush colour/size. It is never stamped into the stroke buffer, never committed, never journaled and is
 * wiped on the next event / stroke end, so a wrong guess costs nothing but a few pixels for one frame.
 */
class PredictionOverlay {
  private cv: HTMLCanvasElement | null = null
  private ctx: CanvasRenderingContext2D | null = null
  private app: App | null = null
  private dirty = false
  /** bounding box of the last drawing (css px): only that is cleared next time */
  private box: { x0: number; y0: number; x1: number; y1: number } | null = null
  /** an overlay is currently visible */
  active = false
  /** predicted points drawn by the last update (tests / diagnostics) */
  lastCount = 0
  /** furthest predicted point drawn by the last update, css px relative to the canvas */
  lastTip: { x: number; y: number } | null = null
  /** smoothed extension vector + previous raw pointer (for the motion direction) */
  private ext: { x: number; y: number } | null = null
  private lastFrom: { x: number; y: number } | null = null

  install(app: App): void {
    this.app = app
    const cv = document.createElement('canvas')
    cv.style.cssText = 'position:absolute;inset:0;width:100%;height:100%;pointer-events:none;display:block;will-change:transform'
    cv.setAttribute('aria-hidden', 'true')
    app.canvas.after(cv)
    this.cv = cv
    this.ctx = cv.getContext('2d', { desynchronized: true })
    app.events.on('resize', (s) => {
      cv.width = s.pw
      cv.height = s.ph
      this.box = null
    })
  }

  /** Can the current tool show a faithful overlay? (plain paint brush only: no erase / smudge / wet mix / blend modes) */
  private supported(): boolean {
    const a = this.app
    if (!a || a.state.effectiveTool !== 'brush') return false
    const b = a.state.preset
    return !isBlendingMode(b.render.mode) && b.render.blendMode === 'normal' && !b.render.luminance
  }

  update(from: PredPt, pts: PredPt[] | null): void {
    const a = this.app
    const cv = this.cv
    const ctx = this.ctx
    if (!a || !cv || !ctx) return
    if (!pts || !pts.length || !this.supported()) return this.clear()
    const dpr = window.devicePixelRatio || 1
    const css = a.cssSize() // cached by the app: no layout query per pointer event
    const w = a.canvas.width
    const h = a.canvas.height
    if (cv.width !== w || cv.height !== h) {
      cv.width = w
      cv.height = h
      this.box = null
    }
    ctx.setTransform(dpr, 0, 0, dpr, 0, 0)
    if (this.box) {
      ctx.clearRect(this.box.x0, this.box.y0, this.box.x1 - this.box.x0, this.box.y1 - this.box.y0)
      if (this.box.x0 < 1 && this.box.y0 < 1) this.keepAlive(ctx)
    }
    const rgb = a.state.rgb
    const col = `rgb(${Math.round(rgb[0] * 255)},${Math.round(rgb[1] * 255)},${Math.round(rgb[2] * 255)})`
    const size = a.state.settings.size * a.view.zoom
    ctx.globalAlpha = Math.min(1, Math.max(0.05, a.state.settings.opacity)) * 0.9
    ctx.strokeStyle = col
    ctx.fillStyle = col
    ctx.lineCap = 'round'
    ctx.lineJoin = 'round'
    // Anchor at the PAINTED tip (smoothing makes it lag the pointer) and extend it by the predicted motion: the overlay
    // then continues the painted stroke seamlessly instead of jumping ahead to the raw pointer.
    const tipDoc = a.strokeTip
    let ox = 0
    let oy = 0
    if (tipDoc) {
      const s = docToScreen(a.view, tipDoc.x, tipDoc.y, css.w, css.h)
      ox = s.x - from.x
      oy = s.y - from.y
    }
    const px = from.x + ox
    const py = from.y + oy
    // One short, damped, smoothed extension (never backtracks, never overshoots) instead of the raw predicted polyline.
    const last = pts[pts.length - 1]
    const motion = this.lastFrom ? { x: from.x - this.lastFrom.x, y: from.y - this.lastFrom.y } : null
    this.lastFrom = { x: from.x, y: from.y }
    const ext = smoothExtension(this.ext, { x: last.x - from.x, y: last.y - from.y }, motion)
    this.ext = ext
    const qx = px + ext.x
    const qy = py + ext.y
    const lw = Math.max(1, size * (0.4 + 0.6 * Math.min(1, last.p || from.p)))
    ctx.lineWidth = lw
    ctx.beginPath()
    ctx.moveTo(px, py)
    ctx.lineTo(qx, qy)
    ctx.stroke()
    const x0 = Math.min(px, qx)
    const y0 = Math.min(py, qy)
    const x1 = Math.max(px, qx)
    const y1 = Math.max(py, qy)
    const pad = lw / 2 + 2
    this.box = { x0: Math.max(0, x0 - pad), y0: Math.max(0, y0 - pad), x1: Math.min(css.w, x1 + pad), y1: Math.min(css.h, y1 + pad) }
    this.active = true
    this.dirty = true
    this.lastCount = pts.length
    this.lastTip = { x: qx, y: qy }
  }

  /** First draw on a 2D canvas initialises its GPU raster context (~60 ms): pay that at start-up, not on the first stroke. */
  warm(): void {
    const cv = this.cv
    const ctx = this.ctx
    if (!cv || !ctx) return
    const css = this.app?.cssSize() ?? { w: 64, h: 64 }
    const dpr = window.devicePixelRatio || 1
    cv.width = this.app?.canvas.width ?? Math.round(css.w * dpr)
    cv.height = this.app?.canvas.height ?? Math.round(css.h * dpr)
    ctx.setTransform(dpr, 0, 0, dpr, 0, 0)
    ctx.lineCap = 'round'
    ctx.lineJoin = 'round'
    ctx.strokeStyle = '#888'
    // a few widths / alphas: Skia builds a different stroking pipeline for hairline, thin and fat round-capped lines
    for (const [w, a] of [[1, 1], [3, 0.9], [24, 0.5], [90, 0.9], [200, 0.3]] as [number, number][]) {
      ctx.lineWidth = w
      ctx.globalAlpha = a
      ctx.beginPath()
      ctx.moveTo(10, 10)
      ctx.lineTo(60, 40)
      ctx.lineTo(90, 30)
      ctx.stroke()
    }
    ctx.getImageData(0, 0, 1, 1) // forces the first raster flush
    ctx.setTransform(1, 0, 0, 1, 0, 0)
    ctx.clearRect(0, 0, cv.width, cv.height)
    this.keepAlive(ctx)
    this.dirty = false
  }

  /**
   * An always-present, invisible pixel (alpha 1/255 black): a completely empty canvas is demoted by the browser and the FIRST
   * real stroke then pays for layer + texture creation (a 60 ms main-thread stall). Keeping it non-empty avoids that.
   */
  private keepAlive(ctx: CanvasRenderingContext2D): void {
    ctx.globalAlpha = 1
    ctx.fillStyle = 'rgba(0,0,0,0.004)'
    ctx.fillRect(0, 0, 1, 1)
  }

  clear(): void {
    this.active = false
    this.lastTip = null
    this.ext = null
    this.lastFrom = null
    if (!this.dirty || !this.cv || !this.ctx) return
    this.dirty = false
    this.box = null
    this.ctx.setTransform(1, 0, 0, 1, 0, 0)
    this.ctx.clearRect(0, 0, this.cv.width, this.cv.height)
    this.keepAlive(this.ctx)
  }
}

export const predictionOverlay = new PredictionOverlay()
