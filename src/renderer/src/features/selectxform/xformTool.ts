import type { App } from '../../app/app'
import { screenToDoc } from '../../core/viewTransform'
import type { Layer } from '../../doc/layer'
import type { Sample } from '../../core/types'
import type { Tool, ToolHost } from '../../tools/tool'
import type { Pt } from './geom'
import { TransformSession, XMode, xs } from './xformSession'

/** Pointer tool for the active TransformSession (mouse / pen). Touch is handled by the gesture interceptor below. */
export class TransformTool implements Tool {
  readonly id = 'transform'
  session: TransformSession | null = null
  onChange: (() => void) | null = null

  constructor(private app: App) {
    window.addEventListener('keydown', (e) => this.keys(e, true))
    window.addEventListener('keyup', (e) => this.keys(e, false))
    this.installTouch()
  }

  private keys(e: KeyboardEvent, down: boolean): void {
    if (this.session) {
      this.session.keys.shift = e.shiftKey
      this.session.keys.alt = e.altKey
    }
    void down
  }

  /** Layers a transform applies to: multi-selection, or every visible layer when "All layers" is on. */
  targetLayers(): Layer[] {
    const doc = this.app.doc
    if (xs.allLayers) return doc.paintLayers.filter((l) => l.visible)
    const ids = doc.selectedLayerIds()
    const layers = ids.map((i) => doc.getLayer(i)!).filter((l) => l && !l.isGroup)
    return layers.length ? layers : [doc.activeLayer]
  }

  start(mode: XMode = 'freeform'): boolean {
    if (this.session) {
      this.session.setMode(mode)
      return true
    }
    const s = TransformSession.start(this.app, this.targetLayers())
    if (!s) return false
    this.session = s
    s.mode = mode
    if (mode === 'warp' || mode === 'bend') s.setMode(mode)
    s.onChange = () => this.onChange?.()
    s.render()
    this.onChange?.()
    return true
  }

  commit(): void {
    const s = this.session
    if (!s) return
    this.session = null
    s.commit()
    this.onChange?.()
  }

  /** The document was replaced: forget the session. */
  abandon(): void {
    this.session?.abandon()
    this.session = null
    this.onChange?.()
  }

  discard(): void {
    const s = this.session
    if (!s) return
    this.session = null
    s.cancel()
    this.onChange?.()
  }

  private rad(): number {
    return 20 / this.app.view.zoom
  }

  begin(s: Sample, _host: ToolHost): boolean {
    void _host
    return this.session ? this.session.down({ x: s.x, y: s.y }, this.rad(), s.t) : false
  }
  move(samples: Sample[], _host: ToolHost): void {
    void _host
    if (!this.session) return
    for (const s of samples) this.session.move({ x: s.x, y: s.y }, s.t, this.app.view.zoom)
  }
  end(_host: ToolHost): void {
    void _host
    this.session?.up()
  }
  cancel(_host: ToolHost): void {
    void _host
    this.session?.up()
  }

  /** Cursor for hover feedback. */
  hover(p: Pt): string {
    return this.session ? this.session.cursorAt(p, this.rad()) : 'default'
  }

  // ---------------------------------------------------------------- touch: 1 finger = handles, 2 fingers = pinch/twist
  private installTouch(): void {
    const app = this.app
    const pts = new Map<number, { x: number; y: number }>()
    let g: { c: Pt; d: number; a: number } | null = null
    let single = false
    const css = (e: PointerEvent): { x: number; y: number } => {
      const r = app.canvas.getBoundingClientRect()
      return { x: e.clientX - r.left, y: e.clientY - r.top }
    }
    const doc = (p: { x: number; y: number }): Pt => {
      const { w, h } = app.cssSize()
      return screenToDoc(app.view, p.x, p.y, w, h)
    }
    const metrics = (): { c: Pt; d: number; a: number } => {
      const [a, b] = [...pts.values()]
      return { c: { x: (a.x + b.x) / 2, y: (a.y + b.y) / 2 }, d: Math.hypot(b.x - a.x, b.y - a.y) || 1, a: Math.atan2(b.y - a.y, b.x - a.x) }
    }
    const eat = (e: PointerEvent): void => {
      e.preventDefault()
      e.stopImmediatePropagation()
    }
    window.addEventListener(
      'pointerdown',
      (e) => {
        if (!this.session || e.pointerType !== 'touch' || e.target !== app.canvas) return
        eat(e)
        pts.set(e.pointerId, css(e))
        if (pts.size === 1) {
          single = this.session.down(doc(css(e)), this.rad() * 1.4, e.timeStamp)
        } else if (pts.size === 2) {
          if (single) this.session.up()
          single = false
          g = metrics()
        }
      },
      true
    )
    window.addEventListener(
      'pointermove',
      (e) => {
        if (!this.session || e.pointerType !== 'touch' || !pts.has(e.pointerId)) return
        eat(e)
        pts.set(e.pointerId, css(e))
        if (pts.size === 1 && single) this.session.move(doc(css(e)), e.timeStamp, app.view.zoom)
        else if (pts.size === 2 && g) {
          const m = metrics()
          const c0 = doc(g.c)
          const c1 = doc(m.c)
          // scale is screen-space ratio; rotation is screen angle (view rotation accounted for by same sign)
          this.session.pinch(c1, m.d / g.d, m.a - g.a, { x: c1.x - c0.x, y: c1.y - c0.y })
          g = m
        }
      },
      true
    )
    const end = (e: PointerEvent): void => {
      if (!pts.has(e.pointerId)) return
      if (this.session && e.pointerType === 'touch') eat(e)
      pts.delete(e.pointerId)
      if (pts.size < 2) g = null
      if (pts.size === 0) {
        if (single) this.session?.up()
        single = false
      }
    }
    window.addEventListener('pointerup', end, true)
    window.addEventListener('pointercancel', end, true)
  }
}
