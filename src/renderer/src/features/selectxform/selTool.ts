import type { App } from '../../app/app'
import type { Sample } from '../../core/types'
import { t } from '../../i18n'
import type { Tool, ToolHost } from '../../tools/tool'
import { ellipsePolygon, floodFill, MaskPatch, Pt, rasterizePolygon, rectPolygon, SelMode, softenPatch, uniformBox } from './geom'
import type { LiveEdit } from './selection'

export type SelShape = 'auto' | 'free' | 'rect' | 'ellipse'

export const selSettings = {
  shape: 'rect' as SelShape,
  mode: 'replace' as SelMode,
  uniform: false,
  threshold: 0.2,
  /** Automatic: sample the active layer or the whole flattened canvas ("Reference") */
  source: 'layer' as 'layer' | 'reference'
}

/** Drag-to-select tool: Automatic (magic wand), Freehand/polygon, Rectangle, Ellipse. */
export class SelectionTool implements Tool {
  readonly id = 'selection'
  private live: LiveEdit | null = null
  private start: Sample | null = null
  private moved = false
  private shiftDown = false
  // freehand
  private pts: Pt[] = []
  private freeMoved = false
  // automatic
  private pixels: Uint8ClampedArray | null = null
  private thrNow = 0.2
  private wandRaf = 0
  onChange: (() => void) | null = null

  constructor(private app: App) {
    window.addEventListener('keydown', (e) => (this.shiftDown = e.shiftKey))
    window.addEventListener('keyup', (e) => (this.shiftDown = e.shiftKey))
  }

  private get zoom(): number {
    return this.app.view.zoom
  }

  begin(s: Sample, _host: ToolHost): boolean {
    void _host
    this.start = s
    this.moved = false
    const shape = selSettings.shape
    if (shape === 'free') {
      if (!this.live) this.live = this.app.selection.begin()
      this.freeMoved = false
      return true
    }
    this.live = this.app.selection.begin()
    if (shape === 'auto') {
      const { doc, compositor } = this.app
      this.pixels = selSettings.source === 'reference' ? compositor.readFlattened(true) : this.app.gpu.readRGBA8(doc.activeLayer.surface, { x: 0, y: 0, w: doc.width, h: doc.height })
      this.thrNow = selSettings.threshold
      this.runWand()
    }
    return true
  }

  move(samples: Sample[], _host: ToolHost): void {
    void _host
    const s0 = this.start
    if (!s0) return
    for (const s of samples) {
      const dScreen = Math.hypot(s.x - s0.x, s.y - s0.y) * this.zoom
      if (dScreen > 4) this.moved = true
      const shape = selSettings.shape
      if (shape === 'rect' || shape === 'ellipse') this.dragBox(s0, s)
      else if (shape === 'free') this.dragFree(s0, s)
      else if (shape === 'auto') {
        this.thrNow = Math.min(1, Math.max(0, selSettings.threshold + ((s.x - s0.x) * this.zoom) / 400))
        if (!this.wandRaf) this.wandRaf = requestAnimationFrame(() => ((this.wandRaf = 0), this.runWand()))
      }
    }
    this.onChange?.()
  }

  end(_host: ToolHost): void {
    void _host
    const s0 = this.start
    this.start = null
    if (!s0) return
    const shape = selSettings.shape
    const svc = this.app.selection
    if (shape === 'free') {
      if (this.moved) {
        this.closePolygon()
      } else {
        // tap: polygon vertex / close
        if (this.pts.length >= 3 && Math.hypot(s0.x - this.pts[0].x, s0.y - this.pts[0].y) * this.zoom < 20) this.closePolygon()
        else {
          this.pts.push({ x: s0.x, y: s0.y })
          if (this.pts.length >= 3) this.previewPolygon()
        }
      }
      this.onChange?.()
      return
    }
    const live = this.live
    this.live = null
    if (!live) return
    if (shape === 'auto') {
      if (this.wandRaf) cancelAnimationFrame(this.wandRaf)
      this.wandRaf = 0
      this.runWand(live, s0)
      selSettings.threshold = this.thrNow
      this.pixels = null
      if (!live.commit('Select color area')) this.app.notify(t('selectxform.bar.nothing'))
    } else if (!this.moved) {
      // tap without drag: deselect (replace mode) like Procreate
      live.cancel()
      if (selSettings.mode === 'replace') svc.clear()
    } else live.commit(shape === 'rect' ? 'Select rectangle' : 'Select ellipse')
    this.onChange?.()
  }

  cancel(_host: ToolHost): void {
    void _host
    this.start = null
    if (selSettings.shape === 'free') return
    this.live?.cancel()
    this.live = null
    this.pixels = null
    this.onChange?.()
  }

  // ---------------------------------------------------------------- rect / ellipse
  private dragBox(a: Sample, b: Sample): void {
    let x1 = b.x
    let y1 = b.y
    if (selSettings.uniform || this.shiftDown) [x1, y1] = uniformBox(a.x, a.y, b.x, b.y)
    const poly = selSettings.shape === 'rect' ? rectPolygon(a.x, a.y, x1, y1) : ellipsePolygon(a.x, a.y, x1, y1)
    this.live?.preview(rasterizePolygon(poly, this.app.doc.width, this.app.doc.height), selSettings.mode)
  }

  // ---------------------------------------------------------------- freehand
  private dragFree(a: Sample, b: Sample): void {
    if (!this.moved) return
    if (!this.freeMoved) {
      this.freeMoved = true
      this.pts.push({ x: a.x, y: a.y })
    }
    const last = this.pts[this.pts.length - 1]
    if (Math.hypot(b.x - last.x, b.y - last.y) * this.zoom < 2.5) return
    this.pts.push({ x: b.x, y: b.y })
    this.previewPolygon()
  }

  private previewPolygon(): void {
    if (!this.live) this.live = this.app.selection.begin()
    if (this.pts.length < 3) return
    this.live.preview(rasterizePolygon(this.pts, this.app.doc.width, this.app.doc.height), selSettings.mode)
  }

  get polygonOpen(): boolean {
    return this.pts.length > 0
  }
  get polygon(): Pt[] {
    return this.pts
  }

  /** Close the in-progress freehand/polygon selection and commit it. */
  closePolygon(): void {
    const live = this.live
    const n = this.pts.length
    this.live = null
    const pts = this.pts
    this.pts = []
    if (!live) return
    if (n < 3) {
      live.cancel()
      return
    }
    live.preview(rasterizePolygon(pts, this.app.doc.width, this.app.doc.height), selSettings.mode)
    live.commit('Select freehand')
    this.onChange?.()
  }

  /** Abort an unfinished polygon. */
  cancelPolygon(): void {
    this.pts = []
    this.live?.cancel()
    this.live = null
    this.onChange?.()
  }

  // ---------------------------------------------------------------- automatic
  get threshold(): number {
    return this.thrNow
  }
  get wandActive(): boolean {
    return this.pixels !== null && this.start !== null
  }
  get wandSeed(): Pt | null {
    return this.start ? { x: this.start.x, y: this.start.y } : null
  }

  private runWand(live: LiveEdit | null = this.live, seed: Sample | null = this.start): void {
    const s = seed
    if (!live || !this.pixels || !s) return
    const { width: w, height: h } = this.app.doc
    const fill = floodFill(this.pixels, w, h, s.x, s.y, this.thrNow)
    const patch: MaskPatch | null = fill ? softenPatch(fill, w, h) : null
    live.preview(patch, selSettings.mode)
  }
}
