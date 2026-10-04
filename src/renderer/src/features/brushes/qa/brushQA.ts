import type { App } from '../../../app/app'
import { clampBrushSize } from '../../../core/brush'
import type { BrushPreset } from '../../../core/brush'
import { listBrushPresets, getBrushPreset } from '../../../brush/presets'
import { display, realtime, tabletBehaviour } from './tabletQA'
import { CovMap, centroid, columnThickness, endBlob, gapFrac, hardJumpFrac, lineStats } from './metrics'

/**
 * Brush / tablet QA harness (BW_BRUSH_QA=1). Exposes window.__bwqa; driven from qa-brush.mjs through Playwright.
 * Strokes go through the REAL input path: synthetic PointerEvents (pen) with virtual timestamps and coalesced sub-samples.
 */

export interface P {
  x: number
  y: number
  p: number
  tx: number
  ty: number
  tw: number
}
export interface DriveOpts {
  /** ms between samples (4 = 250 Hz) */
  dt?: number
  /** samples per dispatched pointermove (coalesced group) */
  group?: number
  noise?: number
  buttons?: number
  t0?: number
  pointerId?: number
  /** first-event flags for the pen eraser end (buttons 32) */
  downButtons?: number
}

let seed = 1234567
const rnd = (): number => {
  seed = (seed * 1664525 + 1013904223) >>> 0
  return seed / 4294967296
}

function toolOf(b: BrushPreset): 'brush' | 'smudge' | 'eraser' {
  return b.category === 'erase' ? 'eraser' : b.category === 'smudge' ? 'smudge' : 'brush'
}

export function isSmooth(b: BrushPreset): boolean {
  const d = b.dynamics
  const pa = b.path
  const sh = b.shape
  return (
    !b.tipTexture &&
    !(b.grain.texture && b.grain.depth > 0) &&
    !d.scatter &&
    !d.sizeJitter &&
    !d.opacityJitter &&
    !d.angleJitter &&
    !pa.lateralJitter &&
    !pa.linearJitter &&
    !pa.spacingJitter &&
    sh.count <= 1 &&
    !sh.roundnessJitterH &&
    !sh.roundnessJitterV &&
    !sh.randomize &&
    b.category !== 'smudge' &&
    b.wet.wetnessJitter === 0
  )
}

type Layout = {
  W: number
  H: number
  s: { x0: number; x1: number; yc: number; amp: number }
  d: { a: [number, number]; b: [number, number] }
  h: { xa: number; xb: number; y0: number; slope: number }
  p: { xa: number; xb: number; y: number }
}

export class Q {
  constructor(readonly app: App) {}

  // ------------------------------------------------------------ setup
  prep(w: number, h: number, whiteBg = true, fmt?: 'rgba8' | 'rgba16f'): void {
    const app = this.app
    app.input.calibrator.enabled = false
    app.newDocument(w, h, { background: { color: [1, 1, 1], visible: whiteBg }, ...(fmt ? { format: fmt } : {}) })
    app.setView({ cx: w / 2, cy: h / 2, zoom: 1, rot: 0 })
    app.state.setColor({ h: 0, s: 0, v: 0 })
  }

  select(id: string, size: number): { tool: 'brush' | 'smudge' | 'eraser'; eff: number } {
    const app = this.app
    const b = getBrushPreset(id)!
    const tool = toolOf(b)
    app.state.setTool(tool)
    app.state.setPreset(tool, id)
    app.state.toolSettings[tool].size = size
    app.state.toolSettings[tool].opacity = 1
    return { tool, eff: clampBrushSize(b, size) }
  }

  fillBlack(): void {
    const app = this.app
    const { width: w, height: h } = app.doc
    const d = new Uint8ClampedArray(w * h * 4)
    for (let i = 0; i < d.length; i += 4) d[i + 3] = 255
    app.gpu.uploadRGBA8(app.doc.activeLayer.surface, 0, 0, w, h, d)
  }

  fillRamp(): void {
    const app = this.app
    const { width: w, height: h } = app.doc
    const d = new Uint8ClampedArray(w * h * 4)
    for (let y = 0; y < h; y++)
      for (let x = 0; x < w; x++) {
        const o = (y * w + x) * 4
        d[o] = d[o + 1] = d[o + 2] = Math.round((x / (w - 1)) * 255)
        d[o + 3] = 255
      }
    app.gpu.uploadRGBA8(app.doc.activeLayer.surface, 0, 0, w, h, d)
  }

  // ------------------------------------------------------------ pointer synthesis
  client(x: number, y: number): { x: number; y: number } {
    const app = this.app
    const r = app.canvas.getBoundingClientRect()
    const v = app.view
    const s = app.cssSize()
    const c = Math.cos(v.rot)
    const sn = Math.sin(v.rot)
    const dx = x - v.cx
    const dy = y - v.cy
    return { x: r.left + s.w / 2 + v.zoom * (c * dx - sn * dy), y: r.top + s.h / 2 + v.zoom * (sn * dx + c * dy) }
  }

  mkEv(type: string, pt: P, t: number, o: { pointerId: number; buttons: number; button?: number; pointerType?: string; clientX?: number; clientY?: number }): PointerEvent {
    const c = this.client(pt.x, pt.y)
    const e = new PointerEvent(type, {
      pointerId: o.pointerId,
      pointerType: (o.pointerType ?? 'pen') as 'pen',
      isPrimary: true,
      clientX: o.clientX ?? c.x,
      clientY: o.clientY ?? c.y,
      pressure: pt.p,
      tiltX: Math.round(pt.tx),
      tiltY: Math.round(pt.ty),
      twist: Math.round(pt.tw),
      bubbles: true,
      cancelable: true,
      button: o.button ?? 0,
      buttons: o.buttons
    })
    Object.defineProperty(e, 'timeStamp', { value: t })
    return e
  }

  /** Dispatch a full pen stroke: down, grouped (coalesced) moves, up. */
  drive(pts: P[], o: DriveOpts = {}): { moves: number; samples: number } {
    const app = this.app
    const dt = o.dt ?? 4
    const group = Math.max(1, o.group ?? 4)
    const t0 = o.t0 ?? 1000
    const noise = o.noise ?? 0
    const pid = o.pointerId ?? 77
    const buttons = o.buttons ?? 1
    const mk = (type: string, i: number, b: number): PointerEvent => {
      const q = pts[i]
      const p = noise ? Math.max(0, Math.min(1, q.p + (rnd() - 0.5) * 2 * noise)) : q.p
      return this.mkEv(type, { ...q, p: Math.round(p * 1023) / 1023 }, t0 + i * dt, { pointerId: pid, buttons: b, button: type === 'pointermove' ? -1 : 0 })
    }
    let moves = 0
    app.canvas.dispatchEvent(mk('pointerdown', 0, o.downButtons ?? buttons))
    for (let i = 1; i < pts.length; i += group) {
      const last = Math.min(pts.length - 1, i + group - 1)
      const co: PointerEvent[] = []
      for (let k = i; k <= last; k++) co.push(mk('pointermove', k, buttons))
      const ev = co[co.length - 1]
      Object.defineProperty(ev, 'getCoalescedEvents', { value: () => co })
      Object.defineProperty(ev, 'getPredictedEvents', { value: () => [] })
      app.canvas.dispatchEvent(ev)
      moves++
    }
    const l = pts[pts.length - 1]
    app.canvas.dispatchEvent(this.mkEv('pointerup', { ...l, p: 0 }, t0 + pts.length * dt, { pointerId: pid, buttons: 0, button: 0 }))
    return { moves, samples: pts.length }
  }

  // ------------------------------------------------------------ geometry
  layout(size: number): Layout {
    const m = Math.ceil(size * 0.8) + 18
    const pitch = Math.max(70, Math.ceil(size * 1.4) + 26)
    const W = Math.max(560, 420 + size * 3)
    const dH = Math.max(pitch, 220)
    const H = Math.ceil(pitch * 3 + dH + 20)
    const amp = Math.max(6, Math.min(pitch * 0.3, 40 + size * 0.2))
    const y1 = 10 + pitch / 2
    const y2 = y1 + pitch / 2 + dH / 2
    const dx = Math.min(W - 2 * m, 420)
    const dy = Math.min(dH - 2 * m * 0.6, dx * 0.45)
    const y3 = y2 + dH / 2 + pitch / 2
    const hlen = Math.min(W - 2 * m, (0.8 * pitch) / 0.13)
    const y4 = y3 + pitch
    return {
      W,
      H,
      s: { x0: m, x1: W - m, yc: y1, amp },
      d: { a: [m, y2 - dy / 2], b: [m + dx, y2 + dy / 2] },
      h: { xa: m, xb: m + hlen, y0: y3 - (0.13 * hlen) / 2, slope: 0.13 },
      p: { xa: m, xb: W - m, y: y4 }
    }
  }

  path(len: number, speed: number, dt: number, f: (t: number) => P): P[] {
    const n = Math.max(2, Math.ceil(len / ((speed * dt) / 1000)))
    const out: P[] = []
    for (let i = 0; i <= n; i++) out.push(f(i / n))
    return out
  }

  // ------------------------------------------------------------ one preset x size
  runCase(id: string, size: number, opt: { images?: boolean; noise?: number } = {}): Record<string, unknown> {
    const app = this.app
    const b = getBrushPreset(id)!
    const L = this.layout(size)
    const dt = 4
    this.prep(L.W, L.H, true)
    const sel = this.select(id, size)
    const invert = sel.tool === 'eraser'
    if (invert) this.fillBlack()
    if (sel.tool === 'smudge') this.fillRamp()
    const noise = opt.noise ?? 0
    const { s, d, h, p } = L
    // 1. slow S-curve with pressure 0 -> 1 -> 0 and tilt
    const sl = s.x1 - s.x0
    const S = this.path(sl * 1.1, 250, dt, (t) => ({
      x: s.x0 + sl * t,
      y: s.yc + Math.sin(t * Math.PI * 2) * s.amp,
      p: Math.sin(t * Math.PI),
      tx: 35 * Math.sin(t * 6.28),
      ty: 20 * Math.cos(t * 6.28),
      tw: 0
    }))
    this.drive(S, { dt, noise })
    // 2. fast straight diagonal, 5000 px/s, full pressure
    const dl = Math.hypot(d.b[0] - d.a[0], d.b[1] - d.a[1])
    const D = this.path(dl, 5000, dt, (t) => ({ x: d.a[0] + (d.b[0] - d.a[0]) * t, y: d.a[1] + (d.b[1] - d.a[1]) * t, p: 1, tx: 0, ty: 0, tw: 0 }))
    this.drive(D, { dt, noise, pointerId: 78 })
    // 3. near-horizontal line (slope 0.13) at constant pressure, 400 px/s
    const hl = h.xb - h.xa
    const H = this.path(hl, 400, dt, (t) => ({ x: h.xa + hl * t, y: h.y0 + h.slope * hl * t, p: 0.7, tx: 0, ty: 0, tw: 0 }))
    this.drive(H, { dt, noise, pointerId: 79 })
    // 4. horizontal pressure ramp line
    const pl = p.xb - p.xa
    const Pl = this.path(pl, 300, dt, (t) => ({ x: p.xa + pl * t, y: p.y, p: Math.sin(t * Math.PI) * 0.98 + 0.02, tx: 0, ty: 0, tw: 0 }))
    this.drive(Pl, { dt, noise, pointerId: 80 })

    const tr = app.compositor.readFlattened(false)
    const wh = app.compositor.readFlattened(true)
    const cov = new Uint8Array(L.W * L.H)
    let maxDiff = 0
    for (let i = 0; i < cov.length; i++) {
      cov[i] = invert ? 255 - tr[i * 4 + 3] : tr[i * 4 + 3]
      // white paper: black ink -> coverage = 255 - R (eraser: R)
      const cw = invert ? wh[i * 4] : 255 - wh[i * 4]
      const df = Math.abs(cov[i] - cw)
      if (df > maxDiff) maxDiff = df
    }
    const C: CovMap = { w: L.W, h: L.H, a: cov }
    const pad = sel.eff * 0.5 + 6
    const hs = lineStats(C, h.xa, h.y0, h.slope, h.xb, pad, Math.max(sel.eff * 1.2, hl * 0.12))
    const thP = columnThickness(C, p.xa, p.xb, p.y, pad)
    const gap = gapFrac(C, d.a, d.b, 0.2, 0.8)
    const subH = Math.floor(h.y0 - pad - 4)
    const hj = hardJumpFrac({ w: L.W, h: subH, a: cov.subarray(0, L.W * subH) })
    // hook: centroid y of the straight pressure line must equal the pen y in every column, incl. the first ones
    let hookDev = 0
    let hookAtStart = 0
    const k0 = Math.floor(p.xa)
    for (let x = k0; x < p.xb; x++) {
      let sum = 0
      let sy = 0
      for (let y = Math.floor(p.y - pad - 2); y <= Math.ceil(p.y + pad + 2); y++) {
        const v = cov[y * L.W + x]
        sum += v
        sy += v * (y + 0.5)
      }
      if (sum > 255 * 0.3) {
        const dev = Math.abs(sy / sum - p.y)
        if (dev > hookDev) hookDev = dev
        if (x < k0 + Math.max(6, sel.eff * 0.6)) hookAtStart = Math.max(hookAtStart, dev)
      }
    }
    let firstInk = -1
    for (let x = 0; x < L.W && firstInk < 0; x++) for (let y = Math.floor(p.y - pad); y < p.y + pad; y++) if (cov[y * L.W + x] > 24) (firstInk = x), (y = 1e9)
    const res: Record<string, unknown> = {
      id,
      size,
      eff: sel.eff,
      smooth: isSmooth(b),
      tool: sel.tool,
      taper: b.taper.pressure.start > 0 || b.taper.pressure.end > 0 || b.dynamics.taperStart > 0,
      round: b.roundness >= 0.99 && b.angle === 0,
      W: L.W,
      H: L.H,
      hardFrac: +hj.frac.toFixed(4),
      edgePairs: hj.edge,
      centroidRms: +hs.centroidRms.toFixed(4),
      thicknessCv: +hs.thicknessCv.toFixed(4),
      centerCv: +hs.centerCv.toFixed(4),
      edgePx: +hs.edgePx.toFixed(3),
      meanThickness: +hs.meanThickness.toFixed(2),
      gapFrac: +gap.frac.toFixed(4),
      gapMinRel: +gap.minRel.toFixed(3),
      startBlob: +endBlob(thP, 0.15, false).toFixed(3),
      endBlob: +endBlob(thP, 0.15, true).toFixed(3),
      hookDev: +hookDev.toFixed(3),
      hookAtStart: +hookAtStart.toFixed(3),
      firstInkGap: firstInk < 0 ? null : +(p.xa - firstInk).toFixed(1),
      bgDiff: maxDiff,
      inkMass: +centroid(C).mass.toFixed(1)
    }
    if (opt.images) {
      res.pngT = this.montage(tr, L, sel.eff, true)
      res.pngW = this.montage(wh, L, sel.eff, false)
    }
    return res
  }

  /** 3 crops (S-curve start region, diagonal middle, near-horizontal middle) at 400% nearest neighbour. */
  montage(px: Uint8ClampedArray, L: Layout, size: number, checker: boolean): string {
    const CW = 96
    const CH = 64
    const Z = 4
    const off = size >= 40 ? Math.min(size / 2 - 18, 90) : 0
    const centers: [number, number][] = [
      [L.s.x0 + 40, L.s.yc + off],
      [(L.d.a[0] + L.d.b[0]) / 2, (L.d.a[1] + L.d.b[1]) / 2 + off],
      [(L.h.xa + L.h.xb) / 2, L.h.y0 + (L.h.slope * (L.h.xb - L.h.xa)) / 2 + off]
    ]
    const cv = document.createElement('canvas')
    cv.width = (CW * Z + 4) * 3
    cv.height = CH * Z
    const g = cv.getContext('2d')!
    g.fillStyle = '#c33'
    g.fillRect(0, 0, cv.width, cv.height)
    centers.forEach((c, k) => {
      const ox = Math.round(c[0] - CW / 2)
      const oy = Math.round(c[1] - CH / 2)
      const img = g.createImageData(CW * Z, CH * Z)
      for (let y = 0; y < CH * Z; y++)
        for (let x = 0; x < CW * Z; x++) {
          const sx = ox + (x >> 2)
          const sy = oy + (y >> 2)
          const o = (y * CW * Z + x) * 4
          if (sx < 0 || sy < 0 || sx >= L.W || sy >= L.H) {
            img.data[o] = 200
            img.data[o + 1] = 60
            img.data[o + 2] = 60
            img.data[o + 3] = 255
            continue
          }
          const i = (sy * L.W + sx) * 4
          let r = px[i]
          let gg = px[i + 1]
          let bb = px[i + 2]
          const a = px[i + 3] / 255
          if (checker) {
            const bg = (((x >> 3) + (y >> 3)) & 1) === 0 ? 235 : 190
            r = r * a + bg * (1 - a)
            gg = gg * a + bg * (1 - a)
            bb = bb * a + bg * (1 - a)
          }
          img.data[o] = r
          img.data[o + 1] = gg
          img.data[o + 2] = bb
          img.data[o + 3] = 255
        }
      g.putImageData(img, k * (CW * Z + 4), 0)
    })
    return cv.toDataURL('image/png')
  }

  // ------------------------------------------------------------ tap (pen-down accuracy)
  tap(id: string, size: number, x: number, y: number): { dx: number; dy: number; mass: number } {
    const W = 300
    const H = 300
    this.prep(W, H, false)
    this.select(id, size)
    const pt: P = { x, y, p: 0.8, tx: 0, ty: 0, tw: 0 }
    this.drive([pt, { ...pt }], { dt: 4 })
    const tr = this.app.compositor.readFlattened(false)
    const cov = new Uint8Array(W * H)
    for (let i = 0; i < cov.length; i++) cov[i] = tr[i * 4 + 3]
    const c = centroid({ w: W, h: H, a: cov })
    return { dx: +(c.x - x).toFixed(3), dy: +(c.y - y).toFixed(3), mass: +c.mass.toFixed(1) }
  }


  // ------------------------------------------------------------ banding of a soft low-opacity airbrush blob
  banding(fmt: 'rgba8' | 'rgba16f', id = 'soft-airbrush', size = 400, opacity = 0.12): { fmt: string; docFmt: string; layerRun: number; displayRun: number; displayDistinct: number; layerDistinct: number; png: string } {
    const app = this.app
    const W = 700
    const H = 500
    this.prep(W, H, true, fmt)
    this.select(id, size)
    app.state.toolSettings.brush.opacity = opacity
    const pts: P[] = []
    for (let i = 0; i < 60; i++) pts.push({ x: 350 + i * 0.2, y: 250, p: 1, tx: 0, ty: 0, tw: 0 })
    this.drive(pts, { group: 1 })
    app.setView({ cx: W / 2, cy: H / 2, zoom: 1, rot: 0 })
    const y = 250
    const tr = app.compositor.readFlattened(true)
    const line = (px: ArrayLike<number>): number[] => {
      const o: number[] = []
      for (let x = 350; x < 350 + 200; x++) o.push(px[(y * W + x) * 4])
      return o
    }
    const a = line(tr)
    app.renderNow()
    const cv = document.createElement('canvas')
    cv.width = app.canvas.width
    cv.height = app.canvas.height
    const g = cv.getContext('2d', { willReadFrequently: true })!
    g.drawImage(app.canvas, 0, 0)
    const r = app.canvas.getBoundingClientRect()
    const dpr = app.canvas.width / r.width
    const sy = Math.round(app.canvas.height / 2)
    const sx = Math.round(app.canvas.width / 2)
    const row = g.getImageData(sx, sy, Math.min(200 * dpr, app.canvas.width - sx), 1).data
    const b: number[] = []
    for (let i = 0; i < row.length; i += 4) b.push(row[i])
    const run = (v: number[]): number => {
      let best = 1
      let c = 1
      for (let i = 1; i < v.length; i++) (c = v[i] === v[i - 1] ? c + 1 : 1), (best = Math.max(best, c))
      return best
    }
    return { fmt, docFmt: app.doc.format, layerRun: run(a), displayRun: run(b) / dpr, layerDistinct: new Set(a).size, displayDistinct: new Set(b).size, png: cv.toDataURL('image/png') }
  }

  display(zoom: number, rot: number): ReturnType<typeof display> {
    return display(this, zoom, rot)
  }
  realtime(id: string, size: number, w: number, h: number, secs: number, speed: number, opt: { noise?: number; sync?: boolean } = {}): ReturnType<typeof realtime> {
    return realtime(this, id, size, w, h, secs, speed, opt)
  }
  tabletBehaviour(): ReturnType<typeof tabletBehaviour> {
    return tabletBehaviour(this)
  }

  // ------------------------------------------------------------ misc
  ids(): { id: string; cat: string; smooth: boolean; def: number; hardness: number; flow: number }[] {
    return listBrushPresets().map((b) => ({ id: b.id, cat: b.category, smooth: isSmooth(b), def: b.defaultSize, hardness: b.hardness, flow: b.flow }))
  }
}

export function installBrushQA(app: App): void {
  ;(window as unknown as { __bwqa: Q }).__bwqa = new Q(app)
}
