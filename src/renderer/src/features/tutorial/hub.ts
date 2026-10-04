import type { App } from '../../app/app'
import { Emitter } from '../../core/events'
import type { CommitEvent } from '../../doc/document'
import { actionEvents } from '../../input/actions'
import type { Gesture } from '../../input/gestures'
import { prefs } from '../../input/prefs'
import { menuEvents } from '../../ui/registry'
import type { MenuId, UIContext } from '../../ui/registry'

export type Device = 'pen' | 'mouse' | 'touch'

/** One finished stroke (pointer down -> up on the canvas), measured from the raw pointer events. */
export interface StrokeInfo {
  device: Device
  minP: number
  maxP: number
  /** max tilt magnitude in degrees */
  maxTilt: number
  /** drawn with the eraser end of the pen */
  eraser: boolean
  /** path length in css px */
  length: number
  durationMs: number
}

/** Live pen readout (for the meters in the coach card). */
export interface PenLive {
  pressure: number
  tiltX: number
  tiltY: number
  buttons: number
  contact: boolean
  hovering: boolean
  eraser: boolean
  lastMs: number
}

export interface HubEvents {
  stroke: StrokeInfo
  gesture: Gesture
  mode: { mode: string; src: string; on: boolean }
  barrel: { name: 'barrel' | 'barrel2'; action: string }
  /** raw pen button pressed (bit 2 = barrel, 4 = second button), whatever it is mapped to */
  button: { bit: number }
  penHold: { action: string }
  action: { id: string }
  menu: { menu: MenuId; id: string }
  commit: CommitEvent
  tool: void
  settings: void
  color: void
  view: void
  layers: void
  prefs: string
  /** live pen state changed (coalesced to one event per frame) */
  pen: PenLive
  /** a pen moved over the canvas without touching */
  hover: void
  /** first event of a device type in this session */
  device: Device
}

/**
 * Observation point for the tutorial: raw pen/touch/mouse measurements plus every semantic app event
 * (actions, gestures, hold modes, commits, tool / view / prefs changes) on one typed bus.
 */
export class Hub {
  readonly events = new Emitter<HubEvents>()
  readonly pen: PenLive = { pressure: 0, tiltX: 0, tiltY: 0, buttons: 0, contact: false, hovering: false, eraser: false, lastMs: 0 }
  readonly devices = new Set<Device>()
  strokeCount = 0
  hoverCount = 0
  app!: App
  ui!: UIContext
  private acc = new Map<number, { info: StrokeInfo; x: number; y: number; t0: number }>()
  private raf = 0
  private offDoc: (() => void)[] = []
  private started = false

  on<K extends keyof HubEvents>(type: K, fn: (p: HubEvents[K]) => void): () => void {
    return this.events.on(type, fn)
  }

  start(app: App, ui: UIContext): void {
    if (this.started) return
    this.started = true
    this.app = app
    this.ui = ui
    const c = app.canvas
    const opt = { capture: true } as const
    window.addEventListener('pointerdown', this.down, opt)
    window.addEventListener('pointermove', this.move, opt)
    window.addEventListener('pointerup', this.up, opt)
    window.addEventListener('pointercancel', this.up, opt)
    void c
    app.input.events.on('gesture', (g) => this.events.emit('gesture', g))
    app.input.events.on('mode', (m) => this.events.emit('mode', m))
    app.input.events.on('barrel', (b) => this.events.emit('barrel', b))
    app.input.events.on('penHold', (b) => this.events.emit('penHold', b))
    actionEvents.on('run', (a) => this.events.emit('action', a))
    menuEvents.on('run', (m) => this.events.emit('menu', m))
    app.state.events.on('tool', () => this.events.emit('tool', undefined))
    app.state.events.on('toolSettings', () => this.events.emit('settings', undefined))
    app.state.events.on('color', () => this.events.emit('color', undefined))
    app.events.on('view', () => this.events.emit('view', undefined))
    prefs.events.on('change', (k) => this.events.emit('prefs', String(k)))
    const bindDoc = (): void => {
      for (const o of this.offDoc) o()
      this.offDoc = [app.doc.events.on('commit', (e) => this.events.emit('commit', e)), app.doc.events.on('layers', () => this.events.emit('layers', undefined))]
    }
    bindDoc()
    app.events.on('doc', bindDoc)
  }

  private target(e: PointerEvent): boolean {
    return e.target === this.app.canvas
  }

  private device(e: PointerEvent): Device {
    return e.pointerType === 'pen' ? 'pen' : e.pointerType === 'touch' ? 'touch' : 'mouse'
  }

  private seen(d: Device): void {
    if (this.devices.has(d)) return
    this.devices.add(d)
    this.events.emit('device', d)
  }

  private notifyPen(): void {
    if (this.raf) return
    this.raf = requestAnimationFrame(() => {
      this.raf = 0
      this.events.emit('pen', this.pen)
    })
  }

  private tilt(e: PointerEvent): number {
    return Math.hypot(e.tiltX || 0, e.tiltY || 0)
  }

  private penUpdate(e: PointerEvent): void {
    const p = this.pen
    const rise = (e.buttons & 6) & ~(p.buttons & 6)
    if (rise) this.events.emit('button', { bit: rise })
    p.pressure = e.pressure
    p.tiltX = e.tiltX || 0
    p.tiltY = e.tiltY || 0
    p.buttons = e.buttons
    p.eraser = (e.buttons & 32) !== 0 || e.button === 5
    p.contact = (e.buttons & (1 | 32)) !== 0 && e.pressure > 0
    p.hovering = (e.buttons & (1 | 32)) === 0
    p.lastMs = performance.now()
    this.notifyPen()
  }

  private down = (e: PointerEvent): void => {
    if (!this.target(e)) return
    const d = this.device(e)
    this.seen(d)
    if (d === 'pen') this.penUpdate(e)
    if (d === 'pen' && (e.buttons & (1 | 32)) === 0) return // barrel-only press: not a stroke
    if (d === 'mouse' && e.button !== 0) return
    const p = d === 'pen' || d === 'touch' ? e.pressure : 0.5
    this.acc.set(e.pointerId, {
      info: { device: d, minP: p, maxP: p, maxTilt: this.tilt(e), eraser: d === 'pen' && ((e.buttons & 32) !== 0 || e.button === 5), length: 0, durationMs: 0 },
      x: e.clientX,
      y: e.clientY,
      t0: performance.now()
    })
  }

  private move = (e: PointerEvent): void => {
    if (!this.target(e)) return
    const d = this.device(e)
    if (d === 'pen') {
      this.penUpdate(e)
      if ((e.buttons & (1 | 32)) === 0) {
        this.hoverCount++
        this.events.emit('hover', undefined)
      }
    }
    const a = this.acc.get(e.pointerId)
    if (!a) return
    a.info.length += Math.hypot(e.clientX - a.x, e.clientY - a.y)
    a.x = e.clientX
    a.y = e.clientY
    if (d === 'pen' || d === 'touch') {
      // a reading of 0 right after contact is a sensor artefact, not "light pressure"
      if (e.pressure > 0) {
        a.info.minP = Math.min(a.info.minP, e.pressure)
        a.info.maxP = Math.max(a.info.maxP, e.pressure)
      }
      a.info.maxTilt = Math.max(a.info.maxTilt, this.tilt(e))
      if ((e.buttons & 32) !== 0) a.info.eraser = true
    }
  }

  private up = (e: PointerEvent): void => {
    if (e.pointerType === 'pen' && this.target(e)) {
      this.penUpdate(e)
      this.pen.contact = false
      this.notifyPen()
    }
    const a = this.acc.get(e.pointerId)
    if (!a) return
    this.acc.delete(e.pointerId)
    a.info.durationMs = performance.now() - a.t0
    this.strokeCount++
    this.events.emit('stroke', a.info)
  }
}

export const hub = new Hub()
