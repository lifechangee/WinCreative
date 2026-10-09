import type { App } from '../../app/app'
import { screenToDoc } from '../../core/viewTransform'
import { hsvToHex, rgbToHex, rgbToHsv } from './colorMath'
import { getActiveColor, setActiveColor } from './colorTarget'
import { paletteStore } from './paletteStore'

/** Straight RGBA pixels of the sampled source. */
interface Cache {
  px: Uint8ClampedArray
  w: number
  h: number
  /** document position of px[0] (infinite canvas: a small window read around the pointer) */
  ox?: number
  oy?: number
}

export type SampleFn = (docX: number, docY: number) => [number, number, number, number] | null

/**
 * Eyedropper: long-press the canvas, hold Alt or I while pressing, or arm it with the panel button and
 * press. While the pointer is down a loupe ring follows it (magnified pixels; ring top half = colour under
 * the cursor, bottom half = the colour it will replace). Releasing commits the colour to the active
 * swatch and the colour history. Sampling source (composite / active layer) and sample size come from
 * the palette store settings.
 */
export class Eyedropper {
  /** armed via the panel button / hotkey: the next canvas press samples */
  armed = false
  private loupe: HTMLElement
  private zoom: HTMLCanvasElement
  private newHalf: HTMLElement
  private oldHalf: HTMLElement
  private cache: Cache | null = null
  private active: { id: number; old: string } | null = null
  private press: { id: number; x: number; y: number; lx: number; ly: number; timer: number } | null = null
  private listeners = new Set<() => void>()
  /** extra hook: called with the sampled colour while dragging (used by tests) */
  onSample: ((hex: string) => void) | null = null

  constructor(private app: App) {
    this.zoom = document.createElement('canvas')
    this.zoom.width = this.zoom.height = 11
    this.zoom.className = 'bw-loupe-zoom'
    this.newHalf = document.createElement('div')
    this.newHalf.className = 'bw-loupe-new'
    this.oldHalf = document.createElement('div')
    this.oldHalf.className = 'bw-loupe-old'
    this.loupe = document.createElement('div')
    this.loupe.className = 'bw-loupe'
    this.loupe.style.display = 'none'
    const ring = document.createElement('div')
    ring.className = 'bw-loupe-ring'
    ring.append(this.newHalf, this.oldHalf)
    const cross = document.createElement('div')
    cross.className = 'bw-loupe-cross'
    this.loupe.append(ring, this.zoom, cross)
    document.body.append(this.loupe)

    const canvas = app.canvas
    window.addEventListener('pointerdown', (e) => this.onDown(e, canvas), true)
    window.addEventListener('pointermove', (e) => this.onMove(e), true)
    window.addEventListener('pointerup', (e) => this.onUp(e), true)
    window.addEventListener('pointercancel', (e) => this.onUp(e, true), true)
  }

  onChange(fn: () => void): () => void {
    this.listeners.add(fn)
    return () => this.listeners.delete(fn)
  }
  private changed(): void {
    for (const f of this.listeners) f()
  }

  arm(on = !this.armed): void {
    this.armed = on
    this.app.canvas.style.cursor = on ? 'copy' : ''
    this.changed()
  }

  // ------------------------------------------------------------------ sampling
  /** Read the source pixels now (composite is expensive on big canvases, so cached per interaction). */
  private snapshot(): Cache {
    const { doc, compositor, gpu } = this.app
    const s = paletteStore().settings
    if (doc.isInfinite) return { px: new Uint8ClampedArray(0), w: 0, h: 0 } // read on demand around the pointer (see local())
    const full = { x: 0, y: 0, w: doc.width, h: doc.height }
    const px = s.eyeSource === 'layer' ? gpu.readRGBA8(doc.activeLayer.surface, full) : compositor.readFlattened(true)
    return { px, w: doc.width, h: doc.height }
  }

  /** Infinite canvas: the pixels around (x,y) (a 24 px window) from the composite or the active layer. */
  private local(x: number, y: number): Cache {
    const { doc, compositor } = this.app
    const R = 12
    const rect = { x: x - R, y: y - R, w: 2 * R, h: 2 * R }
    const px = paletteStore().settings.eyeSource === 'layer' ? doc.readRegionPixels(doc.activeLayer, rect) : compositor.readFlattened(rect, 1, true).px
    return { px, w: 2 * R, h: 2 * R, ox: rect.x, oy: rect.y }
  }

  /** Average `size` x `size` block around a pixel (alpha-weighted). Returns straight RGBA 0..255 or null. */
  static average(c: Cache, x: number, y: number, size: number): [number, number, number, number] | null {
    const r = (size - 1) >> 1
    let R = 0
    let G = 0
    let B = 0
    let A = 0
    let n = 0
    for (let yy = y - r; yy <= y + (size - 1 - r); yy++) {
      for (let xx = x - r; xx <= x + (size - 1 - r); xx++) {
        if (xx < 0 || yy < 0 || xx >= c.w || yy >= c.h) continue
        const i = (yy * c.w + xx) * 4
        const a = c.px[i + 3]
        R += c.px[i] * a
        G += c.px[i + 1] * a
        B += c.px[i + 2] * a
        A += a
        n++
      }
    }
    if (!n || A === 0) return null
    return [R / A, G / A, B / A, A / n]
  }

  private pointerToDoc(e: PointerEvent): { x: number; y: number } {
    const r = this.app.canvas.getBoundingClientRect()
    const s = this.app.cssSize()
    return screenToDoc(this.app.view, e.clientX - r.left, e.clientY - r.top, s.w, s.h)
  }

  // ------------------------------------------------------------------ interaction
  private shouldStartNow(e: PointerEvent): boolean {
    return this.armed
  }

  private onDown(e: PointerEvent, canvas: HTMLElement): void {
    if (e.target !== canvas) return
    if (this.active) return
    if (e.pointerType === 'touch' && this.press && this.press.id !== e.pointerId) {
      this.cancelPress() // second finger = gesture, not a long press
      return
    }
    if (this.app.input.hasMode('eyedropper')) return // hold-mode (Alt / I / pen button / touch-hold) runs through the input hook
    if (this.shouldStartNow(e) && (e.button === 0 || e.pointerType !== 'mouse')) {
      e.preventDefault()
      e.stopImmediatePropagation()
      this.begin(e)
      return
    }
    const ms = paletteStore().settings.longPressMs
    if (ms > 0 && e.pointerType !== 'touch' && e.button === 0 && !this.app.input.spaceDown && !this.app.input.rotateKeyDown) {
      const timer = window.setTimeout(() => {
        const p = this.press
        if (!p) return
        this.press = null
        // cancel the stroke the press started, then take over the pointer
        this.app.input.releaseAll()
        this.begin(e, { x: p.lx, y: p.ly })
      }, ms)
      this.press = { id: e.pointerId, x: e.clientX, y: e.clientY, lx: e.clientX, ly: e.clientY, timer }
    }
  }

  private cancelPress(): void {
    if (this.press) clearTimeout(this.press.timer)
    this.press = null
  }

  private onMove(e: PointerEvent): void {
    if (this.press && e.pointerId === this.press.id) {
      if (Math.hypot(e.clientX - this.press.x, e.clientY - this.press.y) > 7) this.cancelPress()
      else {
        this.press.lx = e.clientX
        this.press.ly = e.clientY
      }
    }
    if (this.active && e.pointerId === this.active.id) {
      e.stopImmediatePropagation()
      this.update(e.clientX, e.clientY)
    }
  }

  private onUp(e: PointerEvent, cancelled = false): void {
    if (this.press && e.pointerId === this.press.id) this.cancelPress()
    if (this.active && e.pointerId === this.active.id) {
      e.stopImmediatePropagation()
      this.end(cancelled)
    }
  }

  /**
   * Install as `app.input.hooks.eyedrop`: driven by the interface module's hold modes (Alt / I hold,
   * pen barrel button, touch-and-hold). `pos` is relative to the canvas element.
   */
  hook = (phase: 'start' | 'move' | 'end', pos: { x: number; y: number }, _doc?: { x: number; y: number }): void => {
    const r = this.app.canvas.getBoundingClientRect()
    if (phase === 'start') this.begin({ pointerId: -99, clientX: pos.x + r.left, clientY: pos.y + r.top })
    else if (phase === 'move') {
      if (this.active?.id === -99) this.update(pos.x + r.left, pos.y + r.top)
    } else if (this.active?.id === -99) this.end(false)
  }

  begin(e: { pointerId: number; clientX: number; clientY: number }, at?: { x: number; y: number }): void {
    const state = this.app.state
    this.cache = this.snapshot()
    this.active = { id: e.pointerId, old: hsvToHex(getActiveColor(state)) }
    this.oldHalf.style.background = this.active.old
    this.loupe.style.display = 'block'
    try {
      this.app.canvas.setPointerCapture(e.pointerId)
    } catch {
      /* synthetic pointer */
    }
    this.update(at?.x ?? e.clientX, at?.y ?? e.clientY)
  }

  /** Sample at client coordinates, show the loupe, live-update the swatch. */
  private update(cx: number, cy: number): void {
    let c = this.cache
    if (!c) return
    const r = this.app.canvas.getBoundingClientRect()
    const s = this.app.cssSize()
    const d = screenToDoc(this.app.view, cx - r.left, cy - r.top, s.w, s.h)
    let x = Math.floor(d.x)
    let y = Math.floor(d.y)
    if (this.app.doc.isInfinite) {
      c = this.local(x, y)
      x -= c.ox ?? 0
      y -= c.oy ?? 0
    }
    const size = paletteStore().settings.eyeSize
    const v = Eyedropper.average(c, x, y, size)
    // loupe placement: above the pointer unless too close to the top edge
    const above = cy > 170
    this.loupe.style.left = cx + 'px'
    this.loupe.style.top = (above ? cy - 92 : cy + 92) + 'px'
    this.drawZoom(c, x, y)
    if (!v) {
      this.newHalf.style.background = 'transparent'
      return
    }
    const hex = rgbToHex([v[0] / 255, v[1] / 255, v[2] / 255])
    this.newHalf.style.background = hex
    this.onSample?.(hex)
    const hsv = rgbToHsv(v[0] / 255, v[1] / 255, v[2] / 255)
    const cur = getActiveColor(this.app.state)
    if (hsv.s === 0 || hsv.v === 0) hsv.h = cur.h
    setActiveColor(this.app.state, hsv, false)
  }

  private drawZoom(c: Cache, x: number, y: number): void {
    const ctx = this.zoom.getContext('2d')!
    const n = 11
    const img = ctx.createImageData(n, n)
    for (let j = 0; j < n; j++)
      for (let i = 0; i < n; i++) {
        const sx = x + i - 5
        const sy = y + j - 5
        const o = (j * n + i) * 4
        if (sx < 0 || sy < 0 || sx >= c.w || sy >= c.h) {
          img.data.set([40, 40, 44, 255], o)
          continue
        }
        const k = (sy * c.w + sx) * 4
        const a = c.px[k + 3] / 255
        const chk = ((sx >> 2) + (sy >> 2)) & 1 ? 200 : 150 // transparency checker
        img.data[o] = c.px[k] * a + chk * (1 - a)
        img.data[o + 1] = c.px[k + 1] * a + chk * (1 - a)
        img.data[o + 2] = c.px[k + 2] * a + chk * (1 - a)
        img.data[o + 3] = 255
      }
    ctx.putImageData(img, 0, 0)
  }

  private end(cancelled: boolean): void {
    const a = this.active
    this.active = null
    this.cache = null
    this.loupe.style.display = 'none'
    if (this.armed) this.arm(false)
    if (!a) return
    const state = this.app.state
    if (cancelled) {
      const old = a.old
      const rgbStr = old.slice(1).match(/../g)!.map((h) => parseInt(h, 16) / 255) as [number, number, number]
      setActiveColor(state, rgbToHsv(...rgbStr), false)
    } else setActiveColor(state, getActiveColor(state), true) // add to history
  }
}
