import { getBrushPreset } from '../../../brush/presets'
import type { P, Q } from './brushQA'

/** Display-quality, tablet-path and performance probes of the brush QA harness (see brushQA.ts). */

let seed = 99
const rnd = (): number => {
  seed = (seed * 1664525 + 1013904223) >>> 0
  return seed / 4294967296
}

export function display(q: Q, zoom: number, rot: number): { zoom: number; rot: number; shimmerCv: number; inkMean: number; png: string } {
  const app = q.app
  const W = 1000
  const H = 700
  q.prep(W, H, true)
  q.select('hard-round', 1.6)
  const seg = (a: [number, number], b: [number, number], pid: number): void => {
    const l = Math.hypot(b[0] - a[0], b[1] - a[1])
    q.drive(q.path(l, 800, 4, (t) => ({ x: a[0] + (b[0] - a[0]) * t, y: a[1] + (b[1] - a[1]) * t, p: 1, tx: 0, ty: 0, tw: 0 })), { pointerId: pid })
  }
  seg([300, 200], [700, 500], 90)
  seg([300, 500], [700, 230], 91)
  const cv = document.createElement('canvas')
  const sums: number[] = []
  let png = ''
  for (let k = 0; k < 8; k++) {
    app.setView({ cx: W / 2 + (k * 0.25) / zoom, cy: H / 2 + (k * 0.13) / zoom, zoom, rot })
    app.renderNow()
    cv.width = app.canvas.width
    cv.height = app.canvas.height
    const g = cv.getContext('2d', { willReadFrequently: true })!
    g.drawImage(app.canvas, 0, 0)
    const cw = Math.min(app.canvas.width, 400)
    const ch = Math.min(app.canvas.height, 300)
    const x0 = Math.floor(app.canvas.width / 2 - cw / 2)
    const y0 = Math.floor(app.canvas.height / 2 - ch / 2)
    const d = g.getImageData(x0, y0, cw, ch).data
    let ink = 0
    for (let i = 0; i < d.length; i += 4) ink += 255 - d[i]
    sums.push(ink / 255)
    if (k === 0) {
      const o = document.createElement('canvas')
      const zz = 3
      const sw = 160
      const sh = 100
      o.width = sw * zz
      o.height = sh * zz
      const og = o.getContext('2d')!
      og.imageSmoothingEnabled = false
      og.drawImage(cv, Math.floor(app.canvas.width / 2 - sw / 2), Math.floor(app.canvas.height / 2 - sh / 2), sw, sh, 0, 0, sw * zz, sh * zz)
      png = o.toDataURL('image/png')
    }
  }
  const m = sums.reduce((a, b) => a + b, 0) / sums.length
  const sd = Math.sqrt(sums.reduce((a, b) => a + (b - m) ** 2, 0) / sums.length)
  return { zoom, rot, shimmerCv: +(sd / m).toFixed(4), inkMean: +m.toFixed(1), png }
}

type ToolLike = { move: (s: unknown[], h: unknown) => void }

function wrapCount(q: Q): { samples: number; restore: () => void } {
  const tools = (q.app as unknown as { tools: Map<string, ToolLike> }).tools
  const st = { samples: 0, restore: (): void => {} }
  const undo: (() => void)[] = []
  for (const t of tools.values()) {
    const orig = t.move
    t.move = function (this: unknown, ss: unknown[], h: unknown) {
      st.samples += ss.length
      return orig.call(this, ss, h)
    }
    undo.push(() => (t.move = orig))
  }
  st.restore = () => undo.forEach((u) => u())
  return st
}

/** Real-time pen input: 4 coalesced 250 Hz samples per animation frame along a scribble. Returns latency / frame / GC stats. */
export async function realtime(q: Q, id: string, size: number, docW: number, docH: number, seconds: number, speed: number, opt: { noise?: number; sync?: boolean } = {}): Promise<Record<string, unknown>> {
  const app = q.app
  const gl = app.gpu.gl
  q.prep(docW, docH, true)
  app.setView({ cx: docW / 2, cy: docH / 2, zoom: Math.min(app.cssSize().w / docW, app.cssSize().h / docH), rot: 0 })
  q.select(id, size)
  const cnt = wrapCount(q)
  const comp = app.compositor as unknown as { compose: (...a: unknown[]) => void; present: (...a: unknown[]) => void }
  const oc = comp.compose
  const op = comp.present
  let composeMs = 0
  let presentMs = 0
  let presentEnd = 0
  if (opt.sync) {
    comp.compose = function (this: unknown, ...a: unknown[]) {
      const t = performance.now()
      oc.apply(this, a)
      gl.finish()
      composeMs += performance.now() - t
    }
    comp.present = function (this: unknown, ...a: unknown[]) {
      const t = performance.now()
      op.apply(this, a)
      gl.finish()
      presentEnd = performance.now()
      presentMs += presentEnd - t
    }
  }
  const mem = (): number => (performance as unknown as { memory?: { usedJSHeapSize: number } }).memory?.usedJSHeapSize ?? 0
  const frames: number[] = []
  const handler: number[] = []
  const compMs: number[] = []
  const presMs: number[] = []
  const latency: number[] = []
  const heap: number[] = []
  const cx = docW / 2
  const cy = docH / 2
  const ax = docW * 0.42
  const ay = docH * 0.4
  let phase = 0
  const rad = (ax + ay) / 2
  const pos = (ph: number): P => ({ x: cx + ax * Math.sin(ph + 0.3), y: cy + ay * Math.sin(ph * 1.31), p: 0.5 + 0.5 * Math.sin(ph * 0.7), tx: 30 * Math.sin(ph), ty: 20 * Math.cos(ph), tw: 0 })
  const pid = 55
  const mk = (type: string, p: P, t: number, buttons: number): PointerEvent => q.mkEv(type, p, t, { pointerId: pid, buttons, button: type === 'pointermove' ? -1 : 0 })
  const raf = (): Promise<number> => new Promise((r) => requestAnimationFrame(r))
  let last = await raf()
  app.canvas.dispatchEvent(mk('pointerdown', pos(phase), performance.now(), 1))
  const tEnd = performance.now() + seconds * 1000
  const ephase = (speed / rad) * 0.004
  let evCount = 0
  while (performance.now() < tEnd) {
    const ts = await raf()
    if (frames.length === 0) last = ts
    else frames.push(ts - last)
    last = ts
    heap.push(mem())
    const t0 = performance.now()
    const co: PointerEvent[] = []
    for (let k = 0; k < 4; k++) {
      phase += ephase
      const p = pos(phase)
      if (opt.noise) p.p = Math.max(0, Math.min(1, p.p + (rnd() - 0.5) * 2 * opt.noise))
      co.push(mk('pointermove', p, performance.now() - (3 - k) * 4, 1))
    }
    const ev = co[3]
    Object.defineProperty(ev, 'getCoalescedEvents', { value: () => co })
    Object.defineProperty(ev, 'getPredictedEvents', { value: () => [] })
    composeMs = 0
    presentMs = 0
    app.canvas.dispatchEvent(ev)
    evCount += 4
    handler.push(performance.now() - t0)
    const ts2 = await raf()
    frames.push(ts2 - last)
    last = ts2
    compMs.push(composeMs)
    presMs.push(presentMs)
    if (opt.sync) latency.push(presentEnd - t0)
  }
  const tUp = performance.now()
  app.canvas.dispatchEvent(mk('pointerup', pos(phase), tUp, 0))
  const upMs = performance.now() - tUp
  comp.compose = oc
  comp.present = op
  cnt.restore()
  const pc = (v: number[], p: number): number => {
    const s = [...v].sort((a, b) => a - b)
    return +(s[Math.min(s.length - 1, Math.floor(p * s.length))] ?? 0).toFixed(2)
  }
  const avg = (v: number[]): number => (v.length ? +(v.reduce((a, b) => a + b, 0) / v.length).toFixed(2) : 0)
  let alloc = 0
  let gcs = 0
  for (let i = 1; i < heap.length; i++) {
    const d = heap[i] - heap[i - 1]
    if (d > 0) alloc += d
    else if (d < -1_000_000) gcs++
  }
  return {
    id,
    size,
    doc: docW + 'x' + docH,
    frames: frames.length,
    fpsMean: +(1000 / avg(frames)).toFixed(1),
    frameP50: pc(frames, 0.5),
    frameP95: pc(frames, 0.95),
    frameP99: pc(frames, 0.99),
    frameMax: pc(frames, 1),
    over20ms: frames.filter((f) => f > 20).length,
    handlerMeanMs: avg(handler),
    handlerP95: pc(handler, 0.95),
    handlerMax: pc(handler, 1),
    composeMeanMs: avg(compMs),
    presentMeanMs: avg(presMs),
    latencyP50: pc(latency, 0.5),
    latencyP95: pc(latency, 0.95),
    dispatchedSamples: evCount + 1,
    receivedSamples: cnt.samples,
    penUpMs: +upMs.toFixed(1),
    heapAllocMBperS: +(alloc / 1e6 / seconds).toFixed(2),
    gcDrops: gcs
  }
}

/** Pen input behaviours: eraser end, barrel buttons, leaving the canvas, pressure curve applied once. */
export function tabletBehaviour(q: Q): Record<string, unknown> {
  const app = q.app
  const out: Record<string, unknown> = {}
  const covOf = (W: number, H: number): Uint8Array => {
    const tr = app.compositor.readFlattened(false)
    const c = new Uint8Array(W * H)
    for (let i = 0; i < c.length; i++) c[i] = tr[i * 4 + 3]
    return c
  }
  {
    q.prep(400, 200, false)
    q.select('hard-round', 20)
    const line = (y: number): P[] => q.path(300, 300, 4, (t) => ({ x: 50 + 300 * t, y, p: 0.8, tx: 0, ty: 0, tw: 0 }))
    q.drive(line(100), { pointerId: 60 })
    const before = covOf(400, 200).reduce((a, b) => a + b, 0)
    const pts = line(100)
    const mk = (type: string, i: number, b: number): PointerEvent => q.mkEv(type, pts[i], 1000 + i * 4, { pointerId: 61, buttons: b, button: type === 'pointerdown' ? 5 : -1 })
    app.canvas.dispatchEvent(mk('pointerdown', 0, 32 | 1))
    out.eraserToolDuring = app.state.effectiveTool
    for (let i = 1; i < pts.length; i++) app.canvas.dispatchEvent(mk('pointermove', i, 32 | 1))
    app.canvas.dispatchEvent(q.mkEv('pointerup', pts[pts.length - 1], 5000, { pointerId: 61, buttons: 0, button: 5 }))
    const after = covOf(400, 200).reduce((a, b) => a + b, 0)
    out.eraserRemovedFrac = +(1 - after / before).toFixed(3)
    out.toolAfterEraser = app.state.effectiveTool
  }
  {
    const inp = app.input
    const pt: P = { x: 100, y: 100, p: 0, tx: 0, ty: 0, tw: 0 }
    app.canvas.dispatchEvent(q.mkEv('pointermove', pt, 100, { pointerId: 62, buttons: 0, button: -1 }))
    app.canvas.dispatchEvent(q.mkEv('pointermove', pt, 110, { pointerId: 62, buttons: 2, button: 2 }))
    out.barrelEyedropperOn = inp.hasMode('eyedropper')
    app.canvas.dispatchEvent(q.mkEv('pointermove', pt, 120, { pointerId: 62, buttons: 0, button: -1 }))
    out.barrelEyedropperOff = !inp.hasMode('eyedropper')
  }
  {
    q.prep(600, 200, false)
    q.select('hard-round', 6)
    const pts = q.path(500, 250, 4, (t) => ({ x: 50 + 500 * t, y: 100, p: 0.8, tx: 0, ty: 0, tw: 0 }))
    const half = Math.floor(pts.length / 2)
    const mk = (type: string, i: number, b: number): PointerEvent => q.mkEv(type, pts[i], 1000 + i * 4, { pointerId: 63, buttons: b, button: type === 'pointerdown' ? 0 : -1 })
    app.canvas.dispatchEvent(mk('pointerdown', 0, 1))
    for (let i = 1; i < pts.length; i++) {
      if (i === half) app.canvas.dispatchEvent(new PointerEvent('pointerleave', { pointerId: 63, pointerType: 'pen', bubbles: false }))
      app.canvas.dispatchEvent(mk('pointermove', i, 1))
    }
    app.canvas.dispatchEvent(q.mkEv('pointerup', pts[pts.length - 1], 5000, { pointerId: 63, buttons: 0, button: 0 }))
    const c = covOf(600, 200)
    let inkR = 0
    for (let y = 0; y < 200; y++) inkR += c[y * 600 + 500] > 128 ? 1 : 0
    out.strokeSurvivesLeave = inkR > 0
  }
  {
    const W = 400
    const H = 120
    const res: Record<string, number> = {}
    for (const pr of [0.5, 1]) {
      q.prep(W, H, false)
      q.select('hard-round', 40)
      app.state.pressureCurve = { points: [[0, 0], [0.25, 0.0625], [0.5, 0.25], [0.75, 0.5625], [1, 1]] }
      const b = getBrushPreset('hard-round')!
      const saved = b.dynamics.pressureSize
      b.dynamics.pressureSize = 1
      q.drive(q.path(300, 300, 4, (t) => ({ x: 50 + 300 * t, y: 60, p: pr, tx: 0, ty: 0, tw: 0 })), { pointerId: 64 })
      b.dynamics.pressureSize = saved
      const c = covOf(W, H)
      let th = 0
      for (let y = 0; y < H; y++) th += c[y * W + 200]
      res['p' + pr] = th / 255
    }
    app.state.pressureCurve = { points: [[0, 0], [1, 1]] }
    out.pressureOnceThickness = res
    out.pressureRatio = +(res['p0.5'] / res.p1).toFixed(3)
  }
  return out
}
