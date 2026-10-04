import type { App } from '../../app/app'
import { docToScreen, screenToDoc } from '../../core/viewTransform'
import type { Pt } from './model'

/** A drag in progress on an overlay handle; positions are CSS px relative to the stage. */
export interface DragHandler {
  move(sx: number, sy: number, e: PointerEvent): void
  up?(e: PointerEvent): void
}
/** Returns a drag if (sx,sy) hits one of the interactor's handles. Called in the capture phase before the canvas sees the event. */
export interface Interactor {
  pick(sx: number, sy: number, e: PointerEvent): DragHandler | null
}
export type Painter = (ctx: CanvasRenderingContext2D, w: number, h: number) => void

/** Screen-space overlay above the GL canvas: guides, QuickShape handles, text boxes. Respects view rotate/zoom. */
export class Overlay {
  readonly canvas: HTMLCanvasElement
  readonly stage: HTMLElement
  private ctx: CanvasRenderingContext2D
  private painters: { fn: Painter; order: number }[] = []
  private interactors: { i: Interactor; order: number }[] = []
  private raf = 0
  w = 1
  h = 1
  dpr = 1

  constructor(readonly app: App) {
    this.stage = app.canvas.parentElement!
    this.canvas = document.createElement('canvas')
    this.canvas.className = 'bw-overlay'
    this.canvas.style.cssText = 'position:absolute;inset:0;width:100%;height:100%;pointer-events:none;z-index:2'
    this.stage.append(this.canvas)
    this.ctx = this.canvas.getContext('2d')!
    app.events.on('resize', () => this.resize())
    this.resize()
    app.events.on('view', () => this.redraw())
    app.events.on('doc', () => this.redraw())
    // capture phase on the stage: runs before PointerInput's listener on the canvas
    this.stage.addEventListener('pointerdown', this.onDown, true)
  }

  private resize(): void {
    const s = this.app.cssSize()
    this.dpr = window.devicePixelRatio || 1
    this.w = s.w
    this.h = s.h
    this.canvas.width = Math.round(this.w * this.dpr)
    this.canvas.height = Math.round(this.h * this.dpr)
    this.redraw()
  }

  addPainter(fn: Painter, order = 0): void {
    this.painters.push({ fn, order })
    this.painters.sort((a, b) => a.order - b.order)
    this.redraw()
  }
  addInteractor(i: Interactor, order = 0): void {
    this.interactors.push({ i, order })
    this.interactors.sort((a, b) => a.order - b.order)
  }

  redraw(): void {
    if (this.raf) return
    this.raf = requestAnimationFrame(() => {
      this.raf = 0
      this.paint()
    })
  }

  paint(): void {
    const c = this.ctx
    c.setTransform(this.dpr, 0, 0, this.dpr, 0, 0)
    c.clearRect(0, 0, this.w, this.h)
    for (const p of this.painters) {
      c.save()
      try {
        p.fn(c, this.w, this.h)
      } catch (e) {
        console.error('overlay painter failed', e)
      }
      c.restore()
    }
  }

  // ---- coordinate helpers
  toScreen(p: Pt): Pt {
    return docToScreen(this.app.view, p.x, p.y, this.w, this.h)
  }
  toDoc(sx: number, sy: number): Pt {
    return screenToDoc(this.app.view, sx, sy, this.w, this.h)
  }
  local(e: { clientX: number; clientY: number }): Pt {
    const r = this.stage.getBoundingClientRect()
    return { x: e.clientX - r.left, y: e.clientY - r.top }
  }

  private onDown = (e: PointerEvent): void => {
    if (e.pointerType === 'mouse' && e.button !== 0) return
    const p = this.local(e)
    for (const { i } of this.interactors) {
      const drag = i.pick(p.x, p.y, e)
      if (!drag) continue
      e.stopPropagation()
      e.preventDefault()
      const id = e.pointerId
      const mv = (ev: PointerEvent): void => {
        if (ev.pointerId !== id) return
        const q = this.local(ev)
        drag.move(q.x, q.y, ev)
      }
      const up = (ev: PointerEvent): void => {
        if (ev.pointerId !== id) return
        window.removeEventListener('pointermove', mv, true)
        window.removeEventListener('pointerup', up, true)
        window.removeEventListener('pointercancel', up, true)
        drag.up?.(ev)
      }
      window.addEventListener('pointermove', mv, true)
      window.addEventListener('pointerup', up, true)
      window.addEventListener('pointercancel', up, true)
      return
    }
  }
}
