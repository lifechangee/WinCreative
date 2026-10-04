import { Emitter } from '../core/events'
import type { Sample } from '../core/types'
import { View, gestureStep, panBy, rotateAt, screenToDoc, zoomAt } from '../core/viewTransform'
import { getAction, InputMode, ActionEnv } from './actions'
import { DEFAULT_GESTURE_CONFIG, Gesture, HoldDetector, TouchGestures } from './gestures'
import { PressureCalibrator, PressureSmoother, sphericalToTilt } from './penMath'
import { prefs } from './prefs'

/** Hooks the input layer needs from the app. */
export interface InputHost {
  canvas: HTMLElement
  getView(): View
  setView(v: View): void
  cssSize(): { w: number; h: number }
  state: {
    touchDraws: boolean
    pressureCurve: { points: [number, number][] }
    mousePressure: 'constant' | 'velocity'
    paintWithTouchWhenPenNear: boolean
    setTempEraser(on: boolean): void
  }
  /** Tool interface */
  strokeBegin(s: Sample): boolean
  strokeMove(samples: Sample[]): void
  strokeEnd(): void
  strokeCancel(): void
  undo(): void
  redo(): void
  /** hover / cursor feedback in css px relative to canvas; null hides it */
  cursor(pos: { x: number; y: number; pointerType: string } | null): void
}

/** Cursor feedback with extra info; installed by features/interface to replace the basic circle. */
export interface CursorInfo {
  x: number
  y: number
  pointerType: string
  /** pen is touching the surface */
  down: boolean
  /** eraser end in use */
  eraser: boolean
}

export interface InputHooks {
  /** run a bindable action (QuickMenu, undo, ...). `at` = client coordinates */
  action?(id: string, env: Pick<ActionEnv, 'at'>): void
  /** eyedropper sampling: client position relative to canvas + doc coordinates */
  eyedrop?(phase: 'start' | 'move' | 'end', pos: { x: number; y: number }, doc: { x: number; y: number }): void
}

const PEN_NEAR_MS = 700
const NAV_MODES: InputMode[] = ['pan', 'rotate', 'zoom']

/**
 * Turns Pointer Events into tool strokes + navigation.
 *  - pen: pressure (auto-calibrated), tilt/twist, coalesced events, eraser end, hover cursor, barrel buttons -> actions
 *  - mouse: simulated pressure, Space/middle drag pan, R+drag rotate, wheel zoom, right button -> action
 *  - touch: draws with one finger (unless pen near = palm rejection); gestures via TouchGestures
 */
export class PointerInput {
  hooks: InputHooks = {}
  /** semantic input events for observers (tutorial): recognised gestures, hold-mode start/end, barrel buttons, pen hold */
  readonly events = new Emitter<{
    gesture: Gesture
    mode: { mode: InputMode; src: string; on: boolean }
    barrel: { name: 'barrel' | 'barrel2'; action: string }
    penHold: { action: string }
  }>()
  /** display-only stroke prediction sink (input/prediction.ts); null pts = clear */
  predictor: ((from: { x: number; y: number; p: number }, pts: { x: number; y: number; p: number }[] | null) => void) | null = null
  /** replaces host.cursor when set */
  cursorRenderer: ((c: CursorInfo | null) => void) | null = null
  /** fired after a hold-mode (pan / rotate / zoom / eyedropper / eraser) starts or ends */
  onModeChange: (() => void) | null = null
  readonly calibrator = new PressureCalibrator(prefs.v.calibPeak, prefs.v.calibHits)
  readonly gestures: TouchGestures

  private strokeId: number | null = null
  private strokeType = ''
  private navId: number | null = null
  private nav: InputMode | null = null
  private hoverNav = false
  private navLast = { x: 0, y: 0 }
  private navStart = { x: 0, y: 0 }
  private navAngle = 0
  private touches = new Map<number, { x: number; y: number }>()
  private lastPenTime = -1e9
  private autoEraser = false
  private vel = { x: 0, y: 0, t: 0, p: 1 }
  private modes = new Map<InputMode, Set<string>>()
  private penButtons = new Map<number, number>()
  private barrelMode = new Map<string, string>() // 'barrel'|'barrel2' -> action id currently held
  private lastPos = { x: 0, y: 0, ok: false }
  private eyedropActive = false
  private touchHoldSampleId: number | null = null
  private mouseButtonMode: string | null = null
  private pSmooth = new PressureSmoother()
  private touchSm: { x: number; y: number } | null = null
  private penHold = new HoldDetector(0, 8)
  private timer = 0
  private rawRot: number | null = null
  private strokeMoved = 0
  private strokeStart = { x: 0, y: 0 }

  constructor(private h: InputHost) {
    const c = h.canvas
    c.style.touchAction = 'none'
    this.gestures = new TouchGestures({ ...DEFAULT_GESTURE_CONFIG }, (g) => this.onGesture(g))
    c.addEventListener('pointerdown', this.down)
    c.addEventListener('pointermove', this.move)
    c.addEventListener('pointerup', this.up)
    c.addEventListener('pointercancel', this.up)
    c.addEventListener('pointerleave', this.leave)
    c.addEventListener('lostpointercapture', this.lostCapture)
    c.addEventListener('wheel', this.wheel, { passive: false })
    // Kill Windows Ink press-and-hold right click, flicks, drag ghosts & browser gestures
    for (const t of ['contextmenu', 'gesturestart', 'gesturechange', 'dragstart', 'selectstart'] as const)
      window.addEventListener(t, (e) => e.preventDefault())
    // losing focus mid-stroke (another window, a dialog) keeps the paint already laid down instead of discarding it
    window.addEventListener('blur', () => this.releaseAll(true))
  }

  // ------------------------------------------------------------------ modes (held keys / pen buttons)
  get spaceDown(): boolean {
    return this.hasMode('pan', 'key:Space')
  }
  set spaceDown(v: boolean) {
    v ? this.beginMode('pan', 'key:Space') : this.endMode('pan', 'key:Space')
  }
  get rotateKeyDown(): boolean {
    return this.hasMode('rotate', 'key:R')
  }
  set rotateKeyDown(v: boolean) {
    v ? this.beginMode('rotate', 'key:R') : this.endMode('rotate', 'key:R')
  }

  /** last known pointer position (client px) or undefined */
  lastClient(): { x: number; y: number } | undefined {
    return this.lastPos.ok ? { x: this.lastPos.x, y: this.lastPos.y } : undefined
  }

  /** a stroke is being drawn (pointer down on the canvas with a tool) */
  get drawing(): boolean {
    return this.strokeId !== null
  }

  /** a pan / rotate / zoom drag is in progress (any device) */
  get navigating(): boolean {
    return this.nav !== null
  }

  hasMode(m: InputMode, src?: string): boolean {
    const s = this.modes.get(m)
    return !!s && (src ? s.has(src) : s.size > 0)
  }

  beginMode(m: InputMode, src: string): void {
    let s = this.modes.get(m)
    if (!s) this.modes.set(m, (s = new Set()))
    if (s.has(src)) return
    const wasActive = s.size > 0
    s.add(src)
    if (wasActive) return
    this.events.emit('mode', { mode: m, src, on: true })
    queueMicrotask(() => this.onModeChange?.())
    if (m === 'eraser') this.syncEraser()
    else if (m === 'eyedropper') {
      this.eyedropActive = true
      if (this.lastPos.ok) this.sampleAtClient(this.lastPos.x, this.lastPos.y, 'start')
    }
    this.h.canvas.classList.add('mode-' + m)
  }

  endMode(m: InputMode, src: string): void {
    const s = this.modes.get(m)
    if (!s || !s.delete(src) || s.size > 0) return
    this.events.emit('mode', { mode: m, src, on: false })
    queueMicrotask(() => this.onModeChange?.())
    this.h.canvas.classList.remove('mode-' + m)
    if (m === 'eraser') this.syncEraser()
    else if (m === 'eyedropper') this.endEyedrop()
    else if (this.hoverNav && !NAV_MODES.some((n) => this.hasMode(n))) {
      this.hoverNav = false
      this.navId = null
      this.nav = null
    }
  }

  private syncEraser(): void {
    const want = this.autoEraser || this.hasMode('eraser')
    this.h.state.setTempEraser(want)
  }

  private endEyedrop(): void {
    if (!this.eyedropActive) return
    this.eyedropActive = false
    this.hooks.eyedrop?.('end', { x: this.lastPos.x, y: this.lastPos.y }, { x: 0, y: 0 })
  }

  private sampleAtClient(cx: number, cy: number, phase: 'start' | 'move'): void {
    const r = this.rect()
    const s = this.h.cssSize()
    const d = screenToDoc(this.h.getView(), cx - r.left, cy - r.top, s.w, s.h)
    this.hooks.eyedrop?.(phase, { x: cx - r.left, y: cy - r.top }, d)
  }

  private dispatch(id: string, e: { clientX: number; clientY: number }): void {
    if (!id || id === 'none') return
    const at = { x: e.clientX, y: e.clientY }
    if (this.hooks.action) this.hooks.action(id, { at })
  }

  // ------------------------------------------------------------------ helpers
  private capture(id: number): void {
    try {
      this.h.canvas.setPointerCapture(id)
    } catch {
      /* synthetic or already-released pointer */
    }
  }

  private rect(): DOMRect {
    return this.h.canvas.getBoundingClientRect()
  }

  private penNear(): boolean {
    return performance.now() - this.lastPenTime < PEN_NEAR_MS
  }

  private toSample(e: PointerEvent, r: DOMRect, size: { w: number; h: number }): Sample {
    const v = this.h.getView()
    const p = screenToDoc(v, e.clientX - r.left, e.clientY - r.top, size.w, size.h)
    let pressure = e.pressure
    let tiltX = e.tiltX || 0
    let tiltY = e.tiltY || 0
    if (e.pointerType === 'pen') {
      const raw = pressure
      if (raw > 0) this.calibrator.observe(raw)
      pressure = this.calibrator.normalize(raw)
      if (pressure <= 0 && e.buttons) pressure = 0.05
      pressure = this.pSmooth.apply(pressure, prefs.v.pressureSmoothing)
      if (tiltX === 0 && tiltY === 0) {
        const alt = (e as PointerEvent & { altitudeAngle?: number }).altitudeAngle
        const az = (e as PointerEvent & { azimuthAngle?: number }).azimuthAngle
        if (typeof alt === 'number' && typeof az === 'number' && alt < Math.PI / 2 - 0.01) {
          const t = sphericalToTilt(az, alt)
          tiltX = t.tiltX
          tiltY = t.tiltY
        }
      }
    } else if (e.pointerType === 'mouse') pressure = this.mousePressure(e)
    else pressure = this.touchPressure(e)
    let x = p.x
    let y = p.y
    if (e.pointerType === 'touch' && prefs.v.touchSmoothing > 0) {
      const a = 1 - Math.min(0.92, prefs.v.touchSmoothing * 0.92)
      if (this.touchSm) {
        this.touchSm.x += (x - this.touchSm.x) * a
        this.touchSm.y += (y - this.touchSm.y) * a
        x = this.touchSm.x
        y = this.touchSm.y
      } else this.touchSm = { x, y }
    }
    return { x, y, pressure, tiltX, tiltY, twist: e.twist || 0, t: e.timeStamp, pointerType: e.pointerType === 'pen' || e.pointerType === 'touch' ? e.pointerType : 'mouse' }
  }

  /** Finger pressure: the device force when it reports one (browsers report 0.5 for plain touch), else per preference. */
  private touchPressure(e: PointerEvent): number {
    if (e.pressure > 0 && Math.abs(e.pressure - 0.5) > 1e-3) return e.pressure
    return this.mousePressure(e, prefs.v.touchPressure)
  }

  private mousePressure(e: PointerEvent, mode: 'constant' | 'velocity' = this.h.state.mousePressure): number {
    if (mode === 'constant') return 1
    const v = this.vel
    const dt = Math.max(1, e.timeStamp - v.t)
    const speed = Math.hypot(e.clientX - v.x, e.clientY - v.y) / dt // px/ms
    const target = Math.min(1, Math.max(0.2, 1.1 - speed * 0.35))
    v.p += (target - v.p) * 0.25
    v.x = e.clientX
    v.y = e.clientY
    v.t = e.timeStamp
    return v.p
  }

  private updateCursor(e: PointerEvent, x?: number, y?: number): void {
    const r = this.rect()
    const px = (x ?? e.clientX) - r.left
    const py = (y ?? e.clientY) - r.top
    const down = e.pointerType === 'pen' ? (e.buttons & 33) !== 0 : e.buttons !== 0
    if (this.cursorRenderer) {
      // coalesce to at most one style/transform write per animation frame (latest sample wins)
      this.pendingCursor = { x: px, y: py, pointerType: e.pointerType, down, eraser: this.autoEraser }
      if (!this.cursorRaf)
        this.cursorRaf = requestAnimationFrame(() => {
          this.cursorRaf = 0
          const c = this.pendingCursor
          this.pendingCursor = null
          if (c) this.cursorRenderer?.(c)
        })
    } else this.h.cursor({ x: px, y: py, pointerType: e.pointerType })
  }
  private pendingCursor: CursorInfo | null = null
  private cursorRaf = 0

  /** Stroke-start / continue decisions shared by pen and mouse. */
  private beginStroke(e: PointerEvent, r: DOMRect, size: { w: number; h: number }): void {
    this.vel = { x: e.clientX, y: e.clientY, t: e.timeStamp, p: 1 }
    this.pSmooth.reset()
    this.touchSm = null
    // fingers have their own pressure curve (Preferences > Pressure)
    this.h.state.pressureCurve = { points: e.pointerType === 'touch' ? prefs.v.touchPressureCurve : prefs.v.pressureCurve }
    if (this.h.strokeBegin(this.toSample(e, r, size))) {
      this.strokeId = e.pointerId
      this.strokeType = e.pointerType
      this.strokeMoved = 0
      this.strokeStart = { x: e.clientX, y: e.clientY }
      if ((e.pointerType === 'pen' || e.pointerType === 'mouse') && prefs.v.penHoldDelay > 0 && prefs.v.gestures.penHold !== 'none') {
        this.penHold.ms = prefs.v.penHoldDelay
        this.penHold.start(e.clientX, e.clientY, performance.now())
        this.ensureTimer()
      }
    } else this.endAutoEraser()
  }

  // ------------------------------------------------------------------ pen barrel buttons
  private penButtonEdges(e: PointerEvent): void {
    const prev = this.penButtons.get(e.pointerId) ?? 0
    const cur = e.buttons & (2 | 4)
    this.penButtons.set(e.pointerId, cur)
    // wacom style: buttons=2 (barrel) & 4 (second button)
    const pairs: ['barrel' | 'barrel2', number][] = [['barrel', 2], ['barrel2', 4]]
    for (const [name, bit] of pairs) {
      const was = (prev & bit) !== 0
      const now = (cur & bit) !== 0
      if (now && !was) this.barrelDown(name, e)
      else if (!now && was) this.barrelUp(name)
    }
  }

  private barrelDown(name: 'barrel' | 'barrel2', e: PointerEvent): void {
    const id = prefs.v.pen[name]
    if (!id || id === 'none') return
    const a = getAction(id)
    this.lastPos = { x: e.clientX, y: e.clientY, ok: true }
    this.events.emit('barrel', { name, action: id })
    if (a?.mode) {
      this.barrelMode.set(name, id)
      this.beginMode(a.mode, 'pen:' + name)
      this.navLast = { x: e.clientX, y: e.clientY }
      this.navStart = { x: e.clientX, y: e.clientY }
    } else this.dispatch(id, e)
  }

  private barrelUp(name: 'barrel' | 'barrel2'): void {
    const id = this.barrelMode.get(name)
    if (!id) return
    this.barrelMode.delete(name)
    const a = getAction(id)
    if (a?.mode) this.endMode(a.mode, 'pen:' + name)
  }

  // ------------------------------------------------------------------ pointer events
  private down = (e: PointerEvent): void => {
    e.preventDefault()
    const r = this.rect()
    const size = this.h.cssSize()
    if (e.pointerType === 'pen') {
      this.lastPenTime = performance.now()
      this.penButtonEdges(e)
    }
    this.lastPos = { x: e.clientX, y: e.clientY, ok: true }

    if (e.pointerType === 'touch') return this.touchDown(e, r, size)

    // ---- mouse extra buttons
    if (e.pointerType === 'mouse' && e.button !== 0) {
      const id = e.button === 2 ? prefs.v.mouse.right : e.button === 1 ? prefs.v.mouse.middle : 'none'
      const a = getAction(id)
      if (a?.mode) {
        this.capture(e.pointerId)
        this.mouseButtonMode = id
        this.beginMode(a.mode, 'mouse:' + e.button)
        if (NAV_MODES.includes(a.mode)) this.startNav(e, a.mode)
      } else this.dispatch(id, e)
      return
    }
    // pen barrel-only press (no contact): handled by penButtonEdges
    if (e.pointerType === 'pen' && (e.button === 2 || e.button === 1 || e.button === 3 || e.button === 4) && !(e.buttons & 1)) return

    this.capture(e.pointerId)
    // held navigation modes (Space / R / pen button ...)
    for (const m of NAV_MODES) if (this.hasMode(m)) return this.startNav(e, m)
    if (this.hasMode('eyedropper')) {
      this.eyedropActive = true
      this.sampleAtClient(e.clientX, e.clientY, 'move')
      return
    }
    if (this.strokeId !== null) {
      // a stroke is still open: its pointerup was lost (capture lost, focus change, load). Same device -> finish it and
      // start the new one instead of silently dropping the new stroke.
      if (e.pointerId !== this.strokeId && e.pointerType !== this.strokeType) return
      this.finishStroke(false)
    }
    const eraser = e.pointerType === 'pen' && prefs.v.pen.eraserEnd !== 'none' && (e.button === 5 || (e.buttons & 32) !== 0)
    if (eraser) {
      this.autoEraser = true
      this.syncEraser()
    }
    this.beginStroke(e, r, size)
    this.updateCursor(e)
  }

  private touchDown(e: PointerEvent, r: DOMRect, size: { w: number; h: number }): void {
    if (prefs.v.palmRejection && !this.h.state.paintWithTouchWhenPenNear && this.penNear()) return
    this.capture(e.pointerId)
    const cfg = this.gestures.cfg
    cfg.longPressMs = prefs.v.touchHoldDelay
    cfg.repeatMs = prefs.v.rapidUndoDelay
    cfg.tapMs = prefs.v.gestureAdv.tapMs
    cfg.moveTol = prefs.v.gestureAdv.moveTol
    cfg.holdMs = prefs.v.gestureAdv.holdMs
    if (this.hasMode('eyedropper') && this.touches.size === 0) {
      // modify button held with another finger: this touch picks colours instead of painting
      this.touchHoldSampleId = e.pointerId
      this.touches.set(e.pointerId, { x: e.clientX, y: e.clientY })
      this.sampleAtClient(e.clientX, e.clientY, 'move')
      return
    }
    this.touches.set(e.pointerId, { x: e.clientX, y: e.clientY })
    this.gestures.down(e.pointerId, e.clientX, e.clientY, e.timeStamp)
    this.ensureTimer()
    if (this.touches.size === 1) {
      if (this.h.state.touchDraws && this.strokeId === null && this.navId === null) this.beginStroke(e, r, size)
    } else if (this.strokeId !== null && this.strokeType === 'touch') {
      this.h.strokeCancel()
      this.strokeId = null
    }
  }

  private move = (e: PointerEvent): void => {
    const r = this.rect()
    const size = this.h.cssSize()
    if (e.pointerType === 'pen') {
      this.lastPenTime = performance.now()
      this.penButtonEdges(e)
    }
    this.lastPos = { x: e.clientX, y: e.clientY, ok: true }

    if (e.pointerType === 'touch') return this.touchMove(e, r, size)

    // cursor: the RAW pointer position (newest coalesced sample), never a predicted one; painted once per frame
    let cx = e.clientX
    let cy = e.clientY
    if (typeof e.getCoalescedEvents === 'function') {
      const co = e.getCoalescedEvents()
      if (co.length) {
        cx = co[co.length - 1].clientX
        cy = co[co.length - 1].clientY
      }
    }
    if (e.pointerType !== 'pen' || prefs.v.pen.hoverProximity || e.buttons) this.updateCursor(e, cx, cy)

    if (this.eyedropActive && this.hasMode('eyedropper')) this.sampleAtClient(e.clientX, e.clientY, 'move')

    if (e.pointerId === this.navId) return this.moveNav(e)
    // hover navigation (pen button held while hovering)
    if (this.navId === null && e.pointerType === 'pen' && !(e.buttons & 33)) {
      const m = NAV_MODES.find((n) => this.hasMode(n))
      if (m && [...(this.modes.get(m) ?? [])].some((s) => s.startsWith('pen:'))) {
        this.hoverNav = true
        this.nav = m
        this.navId = e.pointerId
      }
    }
    if (e.pointerId === this.navId) return this.moveNav(e)
    if (e.pointerId === this.strokeId) {
      e.preventDefault()
      this.emitMoves(e, r, size)
      this.predict(e, r)
      this.strokeMoved = Math.hypot(e.clientX - this.strokeStart.x, e.clientY - this.strokeStart.y)
      this.penHold.move(e.clientX, e.clientY)
    }
  }

  private touchMove(e: PointerEvent, r: DOMRect, size: { w: number; h: number }): void {
    const t = this.touches.get(e.pointerId)
    if (!t) return
    t.x = e.clientX
    t.y = e.clientY
    this.gestures.move(e.pointerId, e.clientX, e.clientY, e.timeStamp)
    if (e.pointerId === this.touchHoldSampleId) this.sampleAtClient(e.clientX, e.clientY, 'move')
    else if (e.pointerId === this.strokeId) this.emitMoves(e, r, size)
  }

  private ensureTimer(): void {
    if (!this.timer)
      this.timer = window.setInterval(() => {
        if (this.touches.size) this.gestures.tick(performance.now())
        this.tickPen()
      }, 30)
  }

  private tickPen(): void {
    if (this.strokeId !== null && this.strokeType !== 'touch' && this.penHold.check(performance.now())) {
      const id = prefs.v.gestures.penHold
      if (id && id !== 'none') {
        this.h.strokeCancel()
        this.strokeId = null
        this.endAutoEraser()
        this.events.emit('penHold', { action: id })
        const a = getAction(id)
        const p = this.lastPos
        if (a?.mode) {
          this.beginMode(a.mode, 'penhold')
          this.sampleAtClient(p.x, p.y, 'start')
        } else this.dispatch(id, { clientX: p.x, clientY: p.y })
      }
    }
    if (this.strokeId === null && this.touches.size === 0 && this.timer) {
      clearInterval(this.timer)
      this.timer = 0
    }
  }

  /** Show the predicted tip of the live stroke (display only). */
  private predict(e: PointerEvent, r: DOMRect): void {
    if (!this.predictor) return
    if (!prefs.v.predictStroke || typeof e.getPredictedEvents !== 'function') return this.predictor({ x: 0, y: 0, p: 0 }, null)
    const list = e.getPredictedEvents()
    this.predictor(
      { x: e.clientX - r.left, y: e.clientY - r.top, p: e.pressure },
      list.map((q) => ({ x: q.clientX - r.left, y: q.clientY - r.top, p: q.pressure }))
    )
  }

  private clearPrediction(): void {
    this.predictor?.({ x: 0, y: 0, p: 0 }, null)
  }

  private emitMoves(e: PointerEvent, r: DOMRect, size: { w: number; h: number }): void {
    const list = typeof e.getCoalescedEvents === 'function' ? e.getCoalescedEvents() : []
    const evs = list.length ? list : [e]
    const samples = evs.map((ev) => this.toSample(ev, r, size))
    this.h.strokeMove(samples)
  }

  private up = (e: PointerEvent): void => {
    if (e.pointerType === 'pen') {
      this.penButtonEdges(e)
      // pointerup for the pen tip: clear the contact bit but keep barrel state consistent
      if (e.type === 'pointercancel') {
        for (const n of ['barrel', 'barrel2'] as const) this.barrelUp(n)
        this.penButtons.delete(e.pointerId)
      }
    }
    if (e.pointerType === 'touch') return this.touchUp(e)
    if (this.mouseButtonMode && e.pointerType === 'mouse') {
      const a = getAction(this.mouseButtonMode)
      if (a?.mode) this.endMode(a.mode, 'mouse:' + e.button)
      this.mouseButtonMode = null
    }
    if (e.pointerId === this.navId) {
      if (!this.hoverNav) {
        this.navId = null
        this.nav = null
      }
    }
    if (this.eyedropActive && !this.hasMode('eyedropper')) this.endEyedrop()
    if (this.penHold.ms) this.penHold.stop()
    if (e.pointerId === this.strokeId) {
      // pen/mouse pointercancel (device hand-over, OS gesture, load) keeps the stroke; only a touch gesture discards it
      this.finishStroke(false)
    }
    if (e.pointerType === 'pen' && e.type === 'pointerup' && !(e.buttons & 6)) this.penButtons.set(e.pointerId, 0)
  }

  private touchUp(e: PointerEvent): void {
    if (!this.touches.has(e.pointerId)) return
    this.touches.delete(e.pointerId)
    this.gestures.up(e.pointerId, e.timeStamp, e.type === 'pointercancel')
    if (this.touches.size < 2) this.rawRot = null
    if (e.pointerId === this.touchHoldSampleId) {
      this.touchHoldSampleId = null
      this.endMode('eyedropper', 'touchhold')
    }
    if (e.pointerId === this.strokeId) {
      this.strokeId = null
      this.clearPrediction()
      e.type === 'pointercancel' ? this.h.strokeCancel() : this.h.strokeEnd()
    }
    if (this.touches.size === 0 && this.timer) {
      clearInterval(this.timer)
      this.timer = 0
    }
  }

  private lostCapture = (e: PointerEvent): void => {
    // Pointer capture can be lost (e.g. element re-parented). If the pointer is still down the browser keeps
    // sending events to whatever is under it; re-acquire so the stroke does not break.
    if (e.pointerId !== this.strokeId) return
    if (e.buttons || e.pressure > 0) this.capture(e.pointerId)
    else if (e.pointerType !== 'touch') this.finishStroke(false) // the pointerup never arrived: commit what was drawn
  }

  /** End (commit) the running stroke, or cancel it (`discard`). */
  private finishStroke(discard: boolean): void {
    if (this.strokeId === null) return
    this.strokeId = null
    this.clearPrediction()
    discard ? this.h.strokeCancel() : this.h.strokeEnd()
    this.endAutoEraser()
    this.recordCalibration()
  }

  private leave = (e: PointerEvent): void => {
    if (e.pointerType !== 'touch' && e.pointerId !== this.strokeId) {
      this.pendingCursor = null
      if (this.cursorRenderer) this.cursorRenderer(null)
      else this.h.cursor(null)
    }
    if (e.pointerType === 'pen') this.lastPenTime = performance.now() - PEN_NEAR_MS / 2
  }

  private endAutoEraser(): void {
    if (this.autoEraser) {
      this.autoEraser = false
      this.syncEraser()
    }
  }

  private recordCalibration(): void {
    if (!prefs.v.autoCalibrate) return
    const j = this.calibrator.toJSON()
    if (j.peak !== prefs.v.calibPeak || Math.abs(j.hits - prefs.v.calibHits) > 20) {
      prefs.v.calibPeak = j.peak
      prefs.v.calibHits = j.hits
      prefs.save()
    }
  }

  /** Abort everything (window blur, doc switch). */
  releaseAll(commitStroke = false): void {
    this.clearPrediction()
    if (this.strokeId !== null) commitStroke ? this.h.strokeEnd() : this.h.strokeCancel()
    this.strokeId = null
    this.navId = null
    this.nav = null
    this.hoverNav = false
    this.touches.clear()
    this.gestures.reset()
    this.penButtons.clear()
    this.barrelMode.clear()
    this.touchHoldSampleId = null
    for (const m of [...this.modes.keys()]) this.modes.get(m)!.clear(), this.h.canvas.classList.remove('mode-' + m)
    this.endEyedrop()
    this.endAutoEraser()
    this.syncEraser()
    if (this.timer) clearInterval(this.timer)
    this.timer = 0
  }

  // ------------------------------------------------------------------ gestures (touch)
  private onGesture(g: Gesture): void {
    this.events.emit('gesture', g)
    const cfg = prefs.v.gestures
    const c = this.lastPos
    const at = { clientX: c.x, clientY: c.y }
    const run = (id: string): void => {
      if (id === 'edit.undo') return this.h.undo()
      if (id === 'edit.redo') return this.h.redo()
      this.dispatch(id, at)
    }
    switch (g.type) {
      case 'transform': {
        const r = this.rect()
        const s = this.h.cssSize()
        const v0 = this.h.getView()
        let dRot = g.rot
        if (prefs.v.rotationSnap && !v0.mirror) {
          // sticky snapping: track the raw rotation, show the snapped one while within 4 degrees of a right angle
          if (this.rawRot === null) this.rawRot = v0.rot
          this.rawRot += g.rot
          const q = Math.PI / 2
          const near = Math.round(this.rawRot / q) * q
          const target = Math.abs(this.rawRot - near) < (4 * Math.PI) / 180 ? near : this.rawRot
          dRot = target - v0.rot
        }
        this.h.setView(gestureStep(v0, { x: g.prev.x - r.left, y: g.prev.y - r.top }, { x: g.cur.x - r.left, y: g.cur.y - r.top }, g.scale, dRot, s.w, s.h))
        break
      }
      case 'tap':
        run(g.fingers === 2 ? cfg.twoFingerTap : g.fingers === 3 ? cfg.threeFingerTap : cfg.fourFingerTap)
        break
      case 'hold':
        if (g.phase !== 'end') run(g.fingers === 2 ? cfg.twoFingerHold : cfg.threeFingerHold)
        break
      case 'scrub':
        run(cfg.threeFingerScrub)
        break
      case 'swipeDown':
        run(cfg.threeFingerSwipeDown)
        break
      case 'quickPinch':
        run(cfg.quickPinch)
        break
      case 'longPress': {
        const id = cfg.touchHold
        if (!id || id === 'none') break
        // cancel the tentative touch stroke (finger did not move)
        if (this.strokeId !== null && this.strokeType === 'touch') {
          this.h.strokeCancel()
          this.strokeId = null
        }
        const a = getAction(id)
        const pid = [...this.touches.keys()][0]
        if (a?.mode && pid !== undefined) {
          this.touchHoldSampleId = pid
          this.lastPos = { x: g.x, y: g.y, ok: true }
          this.beginMode(a.mode, 'touchhold')
          if (a.mode !== 'eyedropper') this.startNavAt(g.x, g.y, a.mode)
        } else this.dispatch(id, { clientX: g.x, clientY: g.y })
        break
      }
    }
  }

  // ------------------------------------------------------------------ navigation
  private startNav(e: PointerEvent, kind: InputMode): void {
    this.navId = e.pointerId
    this.nav = kind
    this.hoverNav = false
    this.startNavAt(e.clientX, e.clientY, kind)
  }

  private startNavAt(x: number, y: number, kind: InputMode): void {
    this.nav = kind
    this.navLast = { x, y }
    this.navStart = { x, y }
    const r = this.rect()
    const s = this.h.cssSize()
    this.navAngle = Math.atan2(y - r.top - s.h / 2, x - r.left - s.w / 2)
  }

  private moveNav(e: PointerEvent): void {
    const v = this.h.getView()
    const r = this.rect()
    const s = this.h.cssSize()
    if (this.nav === 'pan') {
      this.h.setView(panBy(v, e.clientX - this.navLast.x, e.clientY - this.navLast.y))
    } else if (this.nav === 'rotate') {
      const a = Math.atan2(e.clientY - r.top - s.h / 2, e.clientX - r.left - s.w / 2)
      let d = a - this.navAngle
      if (d > Math.PI) d -= 2 * Math.PI
      if (d < -Math.PI) d += 2 * Math.PI
      this.h.setView(rotateAt(v, s.w / 2, s.h / 2, d, s.w, s.h))
      this.navAngle = a
    } else if (this.nav === 'zoom') {
      const dy = e.clientY - this.navLast.y
      this.h.setView(zoomAt(v, this.navStart.x - r.left, this.navStart.y - r.top, Math.exp(-dy * 0.006), s.w, s.h))
    }
    this.navLast = { x: e.clientX, y: e.clientY }
  }

  // ------------------------------------------------------------------ wheel
  private wheel = (e: WheelEvent): void => {
    e.preventDefault()
    const r = this.rect()
    const s = this.h.cssSize()
    const v = this.h.getView()
    const notchy = e.deltaMode === 1 || (Math.abs(e.deltaY) >= 40 && e.deltaX === 0 && Number.isInteger(e.deltaY))
    if (e.ctrlKey || e.metaKey || (prefs.v.wheelZoom && notchy && !e.shiftKey)) {
      this.h.setView(zoomAt(v, e.clientX - r.left, e.clientY - r.top, Math.exp(-e.deltaY * (e.deltaMode === 1 ? 0.05 : e.ctrlKey ? 0.01 : 0.0015)), s.w, s.h))
    } else if (this.rotateKeyDown) {
      this.h.setView(rotateAt(v, s.w / 2, s.h / 2, e.deltaY * 0.002, s.w, s.h))
    } else {
      this.h.setView(panBy(v, e.shiftKey ? -e.deltaY : -e.deltaX, e.shiftKey ? 0 : -e.deltaY))
    }
  }
}
