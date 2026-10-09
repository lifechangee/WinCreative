import type { App } from '../../app/app'
import { clampToCanvas, unionRect } from '../../core/geometry'
import type { Rect } from '../../core/types'
import { t } from '../../i18n'
import type { Layer } from '../../doc/layer'
import type { Surface } from '../../gl/gpu'
import { tilesIn } from '../../core/tiles'
import { LiveTileEdit, type TileSpan } from '../../doc/tileEdit'
import { workRect } from '../frame/workRect'
import { chunkPlan, extractChunk, removeSourceInf, type SrcChunk } from './xformInf'
import type { Pt } from './geom'
import { extractFloat, Interp, MeshRenderer, readRedChannel, removeSelected } from './gpuOps'
import { groupHistory } from './history'
import { MAX_SEL_WINDOW, type SelSnapshot } from './selection'
import {
  HandleId,
  Net,
  Quad,
  applyH,
  bendAmount,
  bendNet,
  cloneNet,
  distortQuad,
  evalNet,
  flipNet,
  handlePos,
  isAffineQuad,
  makeNet,
  mapNet,
  netBounds,
  netCorners,
  pointInQuad,
  quadBounds,
  quadCenter,
  resampleNet,
  rotatePt,
  rotationNode,
  scaleQuad,
  similarity,
  snapAngle,
  snapDelta,
  solveHomography,
  tessellate,
  warpDrag
} from './xformMath'

export type XMode = 'freeform' | 'uniform' | 'distort' | 'warp' | 'bend'

export interface XformSettings {
  interp: Interp
  magnetics: boolean
  /** snapping distance, screen px */
  snapDist: number
  /** snapping is suspended while the pointer moves faster than this (screen px per ms) */
  snapVelocity: number
  advancedMesh: boolean
  /** snap to the Drawing Guide (grid lines / symmetry axes / vanishing points) */
  snapGuides: boolean
  cols: number
  rows: number
  allLayers: boolean
}

const DEFAULTS: XformSettings = { interp: 'bilinear', magnetics: true, snapDist: 10, snapVelocity: 1.6, advancedMesh: false, snapGuides: true, cols: 4, rows: 4, allLayers: false }

function load(): XformSettings {
  try {
    const j = JSON.parse(localStorage.getItem('bw.xform') ?? '{}')
    return { ...DEFAULTS, ...j }
  } catch {
    return { ...DEFAULTS }
  }
}
export const xs: XformSettings = load()
export function saveXformSettings(): void {
  try {
    localStorage.setItem('bw.xform', JSON.stringify(xs))
  } catch {
    /* ignore */
  }
}

interface Entry {
  layer: Layer
  orig: Surface
  float: Surface
}

type Hit = { kind: 'handle'; hd: HandleId } | { kind: 'rot' } | { kind: 'pivot' } | { kind: 'pt'; idx: number } | { kind: 'move' } | { kind: 'push' } | { kind: 'bend'; axis: 'h' | 'v' }

interface Drag {
  hit: Hit
  startP: Pt
  startNet: Net
  startPivot: Pt
  lastP: Pt
  lastT: number
}

export interface SnapLine {
  axis: 'x' | 'y'
  v: number
}

const PAD = 2
/** halo (px) around the chunks of a source that is split to respect the GPU texture limit */
const HALO = 8
const DEG15 = Math.PI / 12

/** Bounding box of non-transparent pixels of a layer (null when empty). */
export function layerContentBounds(app: App, layer: Layer): Rect | null {
  if (app.doc.isInfinite) return layer.tiles ? layer.tiles.tightBounds() : null
  const { width: w, height: h } = app.doc
  const px = app.gpu.readRGBA8(layer.surface, { x: 0, y: 0, w, h })
  let x0 = w
  let y0 = h
  let x1 = -1
  let y1 = -1
  for (let y = 0; y < h; y++) {
    const o = y * w * 4 + 3
    for (let x = 0; x < w; x++) {
      if (px[o + x * 4] > 0) {
        if (x < x0) x0 = x
        if (x > x1) x1 = x
        if (y < y0) y0 = y
        if (y > y1) y1 = y
      }
    }
  }
  return x1 < 0 ? null : { x: x0, y: y0, w: x1 - x0 + 1, h: y1 - y0 + 1 }
}

/**
 * Interactive transform of the active layer(s) (whole layer, or the selected pixels).
 * Live preview writes into the real layer surface from an untouched copy (`orig`) so undo is one tile snapshot.
 */
export class TransformSession {
  mode: XMode = 'freeform'
  net: Net
  net0: Net
  pivot: Pt
  snapLines: SnapLine[] = []
  /** text shown next to the box while rotating */
  info = ''
  keys = { shift: false, alt: false }
  onChange: (() => void) | null = null

  private entries: Entry[] = []
  /** infinite canvas: live tile edits per layer + the source split into GPU-sized chunks */
  private ie: { layer: Layer; live: LiveTileEdit }[] = []
  private chunks: SrcChunk[] = []
  private inf = false
  private warnedBig = false
  private curLayer = 0
  private maskFloat: Surface | null = null
  private srcRect: Rect
  private box: { w: number; h: number }
  private mesh: MeshRenderer
  private touched: Rect | null = null
  private hadSel: boolean
  private selBefore: SelSnapshot | null
  private drag: Drag | null = null
  /** which edge the rotate handle sits beyond (1 = top, -1 = bottom); set while drawing so hit-testing matches */
  private rotSide: 1 | -1 = 1
  private speed = 0
  private done = false

  private constructor(
    private app: App,
    layers: Layer[],
    rect: Rect
  ) {
    const { gpu, doc } = app
    this.srcRect = rect
    this.box = { w: rect.w, h: rect.h }
    this.hadSel = app.selection.hasSelection()
    this.selBefore = app.selection.snapshot()
    this.mesh = new MeshRenderer(gpu)
    if (doc.isInfinite) {
      this.inf = true
      this.net0 = makeNet(rect, 1, 1)
      this.net = cloneNet(this.net0)
      this.pivot = { x: rect.x + rect.w / 2, y: rect.y + rect.h / 2 }
      this.initInf(layers, rect)
      return
    }
    const full = { x: 0, y: 0, w: doc.width, h: doc.height }
    for (const layer of layers) {
      const orig = gpu.surface(doc.width, doc.height, layer.surface.fmt, 0)
      gpu.blit(layer.surface, full, orig, 0, 0)
      const float = extractFloat(gpu, layer.surface, rect, PAD, false, this.hadSel)
      this.entries.push({ layer, orig, float })
    }
    if (this.hadSel) this.maskFloat = extractFloat(gpu, layers[0].surface, rect, PAD, true, true)
    this.net0 = makeNet(rect, 1, 1)
    this.net = cloneNet(this.net0)
    this.pivot = { x: rect.x + rect.w / 2, y: rect.y + rect.h / 2 }
  }

  /** Begin a session on `layers`. Returns null (with a toast) when there is nothing to transform. */
  static start(app: App, layers: Layer[]): TransformSession | null {
    layers = layers.filter((l) => l.visible)
    if (!layers.length) {
      app.notify(t('selectxform.xform.layerHidden'))
      return null
    }
    if (layers.some((l) => l.locked)) {
      app.notify(t('selectxform.action.layerLocked'))
      return null
    }
    let rect: Rect | null
    const svc = app.selection
    if (svc.hasSelection()) rect = svc.bounds()
    else {
      rect = null
      for (const l of layers) rect = unionRect(rect, layerContentBounds(app, l))
    }
    if (!rect) {
      app.notify(t('selectxform.xform.nothingToTransform'))
      return null
    }
    return new TransformSession(app, layers, rect)
  }

  get layerCount(): number {
    return this.inf ? this.ie.length : this.entries.length
  }
  get selectionBased(): boolean {
    return this.hadSel
  }
  get dragging(): boolean {
    return this.drag !== null
  }
  get quad(): Quad {
    return netCorners(this.net)
  }
  get rotationDeg(): number {
    const q = this.quad
    return (Math.atan2(q[1].y - q[0].y, q[1].x - q[0].x) * 180) / Math.PI
  }
  get changedFromStart(): boolean {
    const a = this.net.pts
    const b = this.net0.pts
    return this.net.cols !== 1 || this.net.rows !== 1 || a.some((p, i) => Math.abs(p.x - b[i].x) > 1e-4 || Math.abs(p.y - b[i].y) > 1e-4)
  }

  // ------------------------------------------------------------------ rendering
  private meshData(): ReturnType<typeof tessellate> {
    const n = this.net
    let sub: number
    if (n.cols === 1 && n.rows === 1) sub = isAffineQuad(netCorners(n)) ? 1 : 20
    else sub = Math.max(3, Math.ceil(36 / Math.max(n.cols, n.rows)))
    return tessellate(n, sub)
  }

  private srcPadRect(): Rect {
    return { x: this.srcRect.x - PAD, y: this.srcRect.y - PAD, w: this.srcRect.w + PAD * 2, h: this.srcRect.h + PAD * 2 }
  }

  private dstRect(): Rect | null {
    const b = netBounds(this.net)
    if (![b.x, b.y, b.w, b.h].every(Number.isFinite)) return null
    if (this.inf) {
      const r = { x: Math.floor(b.x - 3), y: Math.floor(b.y - 3), w: Math.ceil(b.w + 6) + 1, h: Math.ceil(b.h + 6) + 1 }
      if (tilesIn(r).length > 2500) {
        if (!this.warnedBig) this.app.notify(t('selectxform.xform.tooBig'))
        this.warnedBig = true
        return null
      }
      return r
    }
    return clampToCanvas({ x: b.x - 3, y: b.y - 3, w: b.w + 6, h: b.h + 6 }, this.app.doc.width, this.app.doc.height)
  }

  private renderEntry(e: Entry, R: Rect, mesh: ReturnType<typeof tessellate>, dst: Rect | null): void {
    const gpu = this.app.gpu
    gpu.blit(e.orig, R, e.layer.surface, R.x, R.y)
    const s = clampToCanvas(this.srcRect, this.app.doc.width, this.app.doc.height)
    if (s) removeSelected(gpu, e.orig, e.layer.surface, s, this.hadSel)
    if (dst) this.mesh.draw(e.layer.surface, dst, mesh, e.float, this.box, PAD, xs.interp)
  }

  /** Re-render the live preview into the layer(s). */
  render(): void {
    if (this.done) return
    if (this.inf) return this.renderInf()
    const dst = this.dstRect()
    const src = clampToCanvas(this.srcRect, this.app.doc.width, this.app.doc.height)
    let R = unionRect(unionRect(src, dst), this.touched)
    if (!R) return
    R = clampToCanvas(R, this.app.doc.width, this.app.doc.height)
    if (!R) return
    const mesh = this.meshData()
    for (const e of this.entries) this.renderEntry(e, R, mesh, dst)
    this.touched = unionRect(src, dst)
    this.app.doc.events.emit('change', { rect: R })
    this.onChange?.()
  }

  // ------------------------------------------------------------------ mutation helpers
  private applyMap(f: (p: Pt) => Pt, keepPivot = false): void {
    this.net = mapNet(this.net, f)
    if (!keepPivot) this.pivot = f(this.pivot)
    this.render()
  }

  private setNet(n: Net, pivot?: Pt): void {
    this.net = n
    if (pivot) this.pivot = pivot
    this.render()
  }

  setMode(m: XMode): void {
    this.mode = m
    if ((m === 'warp' || m === 'bend') && this.net.cols === 1 && this.net.rows === 1) {
      const c = m === 'bend' ? 8 : xs.advancedMesh ? xs.cols : 5
      const r = m === 'bend' ? 8 : xs.advancedMesh ? xs.rows : 5
      this.net = resampleNet(this.net, c, r)
    }
    this.onChange?.()
    this.app.requestRender()
  }

  /** Change Advanced Mesh density (resamples the current surface). */
  setGrid(cols: number, rows: number): void {
    xs.cols = Math.max(2, Math.min(16, Math.round(cols)))
    xs.rows = Math.max(2, Math.min(16, Math.round(rows)))
    this.net = resampleNet(this.net, xs.cols, xs.rows)
    this.render()
  }

  flip(dir: 'h' | 'v'): void {
    this.setNet(flipNet(this.net, dir))
  }

  rotate45(): void {
    const c = this.pivot
    this.applyMap((p) => rotatePt(p, c, Math.PI / 4), true)
  }

  rotateBy(a: number): void {
    const c = this.pivot
    this.applyMap((p) => rotatePt(p, c, a), true)
  }

  nudge(dx: number, dy: number): void {
    this.applyMap((p) => ({ x: p.x + dx, y: p.y + dy }))
  }

  /** Scale to fit the canvas and centre. */
  fitToScreen(): void {
    const b = netBounds(this.net)
    const wr = this.inf ? workRect(this.app) : { x: 0, y: 0, w: this.app.doc.width, h: this.app.doc.height }
    const W = wr.w
    const H = wr.h
    if (b.w < 1e-6 || b.h < 1e-6) return
    const s = Math.min(W / b.w, H / b.h)
    const bc = { x: b.x + b.w / 2, y: b.y + b.h / 2 }
    this.applyMap((p) => ({ x: wr.x + W / 2 + (p.x - bc.x) * s, y: wr.y + H / 2 + (p.y - bc.y) * s }))
  }

  reset(): void {
    this.net = cloneNet(this.net0)
    this.pivot = { x: this.srcRect.x + this.srcRect.w / 2, y: this.srcRect.y + this.srcRect.h / 2 }
    if (this.mode === 'warp') this.net = resampleNet(this.net, xs.advancedMesh ? xs.cols : 5, xs.advancedMesh ? xs.rows : 5)
    this.info = ''
    this.render()
  }

  /** Two-finger pinch/twist: scale + rotate about `centre`, then translate by `move` (doc space). */
  pinch(centre: Pt, scale: number, dAngle: number, move: Pt): void {
    if (!Number.isFinite(scale) || scale <= 0) return
    this.applyMap((p) => similarity(p, centre, scale, dAngle, move))
  }

  // ------------------------------------------------------------------ hit testing / pointer
  private targets(): { xs: number[]; ys: number[] } {
    const wr = this.inf ? workRect(this.app) : { x: 0, y: 0, w: this.app.doc.width, h: this.app.doc.height }
    const tx = [wr.x, wr.x + wr.w / 2, wr.x + wr.w]
    const ty = [wr.y, wr.y + wr.h / 2, wr.y + wr.h]
    const g = xs.snapGuides ? (this.app as any).guides : null
    try {
      const extra = g?.snapTargets?.() as { x?: number[]; y?: number[] } | undefined
      if (extra?.x) tx.push(...extra.x)
      if (extra?.y) ty.push(...extra.y)
    } catch {
      /* optional integration */
    }
    return { xs: tx, ys: ty }
  }

  private hit(p: Pt, rad: number): Hit | null {
    const q = this.quad
    const warp = this.mode === 'warp'
    if (Math.hypot(p.x - rotationNode(q, rad * 2.6, this.rotSide).x, p.y - rotationNode(q, rad * 2.6, this.rotSide).y) <= rad * 1.15) return { kind: 'rot' }
    // the pivot marker sits at the centre by default, so it is only grabbable with Alt held (or once displaced)
    const c0 = quadCenter(q)
    const pivotFree = this.keys.alt || Math.hypot(this.pivot.x - c0.x, this.pivot.y - c0.y) > rad * 1.2
    if (pivotFree && Math.hypot(p.x - this.pivot.x, p.y - this.pivot.y) <= rad * 0.9) return { kind: 'pivot' }
    if (this.mode === 'bend') {
      for (const [axis, u, v] of [['h', 0.5, 0], ['v', 0, 0.5]] as const) {
        const bp = evalNet(this.net, u, v)
        if (Math.hypot(p.x - bp.x, p.y - bp.y) <= rad * 1.2) return { kind: 'bend', axis }
      }
    }
    if (warp && xs.advancedMesh) {
      let best = -1
      let bd = rad * 1.2
      this.net.pts.forEach((pt, i) => {
        const d = Math.hypot(p.x - pt.x, p.y - pt.y)
        if (d < bd) {
          bd = d
          best = i
        }
      })
      if (best >= 0) return { kind: 'pt', idx: best }
    }
    if (!warp && this.mode !== 'bend') {
      const hs: HandleId[] = [
        { hx: 0, hy: 0 },
        { hx: 1, hy: 0 },
        { hx: 1, hy: 1 },
        { hx: 0, hy: 1 },
        { hx: 0.5, hy: 0 },
        { hx: 1, hy: 0.5 },
        { hx: 0.5, hy: 1 },
        { hx: 0, hy: 0.5 }
      ]
      let best: HandleId | null = null
      let bd = rad * 1.15
      for (const hd of hs) {
        const hp = handlePos(q, hd)
        const d = Math.hypot(p.x - hp.x, p.y - hp.y)
        if (d < bd) {
          bd = d
          best = hd
        }
      }
      if (best) return { kind: 'handle', hd: best }
    }
    if (pointInQuad(q, p)) return warp && !xs.advancedMesh ? { kind: 'push' } : warp ? { kind: 'move' } : { kind: 'move' }
    return null
  }

  /** Cursor hint for hover. */
  cursorAt(p: Pt, rad: number): string {
    const h = this.hit(p, rad)
    if (!h) return 'default'
    if (h.kind === 'move') return 'move'
    if (h.kind === 'bend') return h.axis === 'h' ? 'ns-resize' : 'ew-resize'
    if (h.kind === 'rot') return 'grab'
    if (h.kind === 'pivot' || h.kind === 'pt') return 'pointer'
    if (h.kind === 'push') return 'crosshair'
    return h.hd.hx === 0.5 ? 'ns-resize' : h.hd.hy === 0.5 ? 'ew-resize' : (h.hd.hx === h.hd.hy ? 'nwse-resize' : 'nesw-resize')
  }

  /** radius = handle pick radius in DOCUMENT px. Returns false if nothing was hit. */
  down(p: Pt, rad: number, t: number): boolean {
    const hit = this.hit(p, rad)
    if (!hit) return false
    this.drag = { hit, startP: p, startNet: cloneNet(this.net), startPivot: { ...this.pivot }, lastP: p, lastT: t }
    this.speed = 0
    this.snapLines = []
    return true
  }

  move(p: Pt, t: number, zoom: number): void {
    const d = this.drag
    if (!d) return
    // pointer speed in screen px per ms
    const dt = Math.max(1, t - d.lastT)
    const inst = (Math.hypot(p.x - d.lastP.x, p.y - d.lastP.y) * zoom) / dt
    this.speed = this.speed * 0.6 + inst * 0.4
    d.lastP = p
    d.lastT = t
    const snapOn = xs.magnetics && this.speed <= xs.snapVelocity
    const dist = xs.snapDist / zoom
    const tg = this.targets()
    this.snapLines = []
    const dx = p.x - d.startP.x
    const dy = p.y - d.startP.y
    const startQ = netCorners(d.startNet)
    const h = d.hit
    if (h.kind === 'move') {
      let mx = dx
      let my = dy
      if (snapOn) {
        const b = netBounds(d.startNet)
        const sx = snapDelta([b.x + dx, b.x + b.w / 2 + dx, b.x + b.w + dx], tg.xs, dist)
        const sy = snapDelta([b.y + dy, b.y + b.h / 2 + dy, b.y + b.h + dy], tg.ys, dist)
        if (sx) {
          mx += sx.delta
          this.snapLines.push({ axis: 'x', v: sx.target })
        }
        if (sy) {
          my += sy.delta
          this.snapLines.push({ axis: 'y', v: sy.target })
        }
      }
      this.net = mapNet(d.startNet, (q) => ({ x: q.x + mx, y: q.y + my }))
      this.pivot = { x: d.startPivot.x + mx, y: d.startPivot.y + my }
    } else if (h.kind === 'handle') {
      let P = p
      if (snapOn) {
        const sx = h.hd.hx === 0.5 ? null : snapDelta([p.x], tg.xs, dist)
        const sy = h.hd.hy === 0.5 ? null : snapDelta([p.y], tg.ys, dist)
        P = { x: p.x + (sx?.delta ?? 0), y: p.y + (sy?.delta ?? 0) }
        if (sx) this.snapLines.push({ axis: 'x', v: sx.target })
        if (sy) this.snapLines.push({ axis: 'y', v: sy.target })
      }
      let nq: Quad
      if (this.mode === 'distort') nq = distortQuad(startQ, h.hd, { x: P.x - d.startP.x, y: P.y - d.startP.y })
      else nq = scaleQuad(startQ, h.hd, P, this.mode === 'uniform' || this.keys.shift, this.keys.alt)
      this.applyQuadChange(d, startQ, nq)
    } else if (h.kind === 'rot') {
      const c = d.startPivot
      const a0 = Math.atan2(d.startP.y - c.y, d.startP.x - c.x)
      const a1 = Math.atan2(p.y - c.y, p.x - c.x)
      let da = a1 - a0
      const abs0 = Math.atan2(startQ[1].y - startQ[0].y, startQ[1].x - startQ[0].x)
      if (snapOn) {
        const s = snapAngle(abs0 + da, DEG15, (4 * Math.PI) / 180)
        if (s.snapped) da = s.angle - abs0
      }
      this.net = mapNet(d.startNet, (q) => rotatePt(q, c, da))
      this.pivot = { ...c }
      let deg = ((abs0 + da) * 180) / Math.PI
      deg = ((((deg + 180) % 360) + 360) % 360) - 180
      this.info = Math.round(deg) + '°'
    } else if (h.kind === 'bend') {
      this.net = bendNet(d.startNet, startQ, h.axis, bendAmount(startQ, h.axis, { x: dx, y: dy }))
    } else if (h.kind === 'pivot') {
      this.pivot = { x: d.startPivot.x + dx, y: d.startPivot.y + dy }
    } else if (h.kind === 'pt') {
      let mx = dx
      let my = dy
      const b = d.startNet.pts[h.idx]
      if (snapOn) {
        const sx = snapDelta([b.x + dx], tg.xs, dist)
        const sy = snapDelta([b.y + dy], tg.ys, dist)
        if (sx) (mx += sx.delta, this.snapLines.push({ axis: 'x', v: sx.target }))
        if (sy) (my += sy.delta, this.snapLines.push({ axis: 'y', v: sy.target }))
      }
      this.net = { ...cloneNet(d.startNet) }
      this.net.pts[h.idx] = { x: b.x + mx, y: b.y + my }
    } else if (h.kind === 'push') {
      const qb = quadBounds(startQ)
      const radius = Math.max(20, Math.min(qb.w, qb.h) * 0.45)
      this.net = warpDrag(d.startNet, d.startP, { x: dx, y: dy }, radius)
    }
    this.render()
  }

  private applyQuadChange(d: Drag, startQ: Quad, nq: Quad): void {
    if (![...nq].every((q) => Number.isFinite(q.x) && Number.isFinite(q.y))) return
    if (d.startNet.cols === 1 && d.startNet.rows === 1) {
      this.net = { cols: 1, rows: 1, pts: [nq[0], nq[1], nq[3], nq[2]] } // row-major: TL, TR, BL, BR
      // pivot follows the quad centre displacement
      const c0 = quadCenter(startQ)
      const c1 = quadCenter(nq)
      this.pivot = { x: d.startPivot.x + (c1.x - c0.x), y: d.startPivot.y + (c1.y - c0.y) }
      return
    }
    let f: (p: Pt) => Pt
    if (this.mode === 'distort') {
      const H = solveHomography(startQ, nq)
      if (!H) return
      f = (p) => applyH(H, p.x, p.y)
    } else {
      // affine frame map (TL,TR,BL) -> new frame
      const a = { x: startQ[1].x - startQ[0].x, y: startQ[1].y - startQ[0].y }
      const b = { x: startQ[3].x - startQ[0].x, y: startQ[3].y - startQ[0].y }
      const a2 = { x: nq[1].x - nq[0].x, y: nq[1].y - nq[0].y }
      const b2 = { x: nq[3].x - nq[0].x, y: nq[3].y - nq[0].y }
      const det = a.x * b.y - a.y * b.x
      if (Math.abs(det) < 1e-9) return
      f = (p) => {
        const rx = p.x - startQ[0].x
        const ry = p.y - startQ[0].y
        const s = (rx * b.y - ry * b.x) / det
        const t = (a.x * ry - a.y * rx) / det
        return { x: nq[0].x + s * a2.x + t * b2.x, y: nq[0].y + s * a2.y + t * b2.y }
      }
    }
    this.net = mapNet(d.startNet, f)
    this.pivot = f(d.startPivot)
  }

  up(): void {
    this.drag = null
    this.snapLines = []
    this.info = ''
    this.onChange?.()
  }

  // ------------------------------------------------------------------ finish
  private dispose(): void {
    this.done = true
    for (const c of this.chunks) {
      c.floats.forEach((f) => f.dispose())
      c.mask?.dispose()
    }
    this.chunks = []
    this.ie = []
    for (const e of this.entries) {
      e.orig.dispose()
      e.float.dispose()
    }
    this.entries = []
    this.maskFloat?.dispose()
    this.maskFloat = null
    this.mesh.dispose()
  }

  cancel(): void {
    if (this.done) return
    const { doc } = this.app
    if (this.inf) {
      const rects = [this.srcRect, this.touched]
      for (const e of this.ie) e.live.cancel()
      for (const r of rects) if (r) doc.events.emit('change', { rect: r })
      this.dispose()
      return
    }
    const R = clampToCanvas(unionRect(this.srcPadRect(), this.touched)!, doc.width, doc.height)
    if (R) {
      for (const e of this.entries) this.app.gpu.blit(e.orig, R, e.layer.surface, R.x, R.y)
      doc.events.emit('change', { rect: R })
    }
    this.dispose()
  }

  /** Drop GPU resources without touching layers (document was replaced). */
  abandon(): void {
    if (this.done) return
    for (const e of this.ie) e.live.edit.abort()
    this.dispose()
  }

  /** Bake into the layers as ONE undo step (plus the moved selection). */
  commit(): boolean {
    if (this.done) return false
    if (!this.changedFromStart) {
      this.cancel()
      return false
    }
    if (this.inf) return this.commitInf()
    const { doc, gpu } = this.app
    const svc = this.app.selection
    const dst = this.dstRect()
    const src = clampToCanvas(this.srcRect, doc.width, doc.height)
    const R = clampToCanvas(unionRect(unionRect(this.srcPadRect(), dst), this.touched)!, doc.width, doc.height)
    if (!R) {
      this.cancel()
      return false
    }
    const mesh = this.meshData()
    const firstId = this.entries[0].layer.id
    groupHistory(doc, 'Transform', (extra) => {
      for (const e of this.entries) {
        gpu.blit(e.orig, R, e.layer.surface, R.x, R.y) // restore original inside R
        const edit = doc.beginPixelEdit(e.layer, 'Transform')
        edit.save(R)
        this.renderEntry(e, R, mesh, dst)
        edit.finish()
      }
      if (this.hadSel && this.maskFloat) {
        const nm = gpu.surface(doc.width, doc.height, 'rgba8', 0)
        if (dst) this.mesh.draw(nm, dst, mesh, this.maskFloat, this.box, PAD, xs.interp)
        const data = dst ? readRedChannel(gpu, nm, dst) : null
        nm.dispose()
        svc.replaceWithRegion(dst, data, src)
        extra.push(svc.command('Transform selection', this.selBefore, svc.snapshot()))
      }
    })
    doc.emitCommit('transform', firstId, R, 'Transform')
    doc.events.emit('change', { rect: R })
    this.dispose()
    return true
  }

  // ------------------------------------------------------------------ infinite canvas
  private initInf(layers: Layer[], rect: Rect): void {
    const { doc } = this.app
    for (const layer of layers) this.ie.push({ layer, live: new LiveTileEdit(doc, layer, 'Transform') })
    const plan = chunkPlan(this.app, rect, PAD, HALO)
    for (const core of plan.cores) {
      this.chunks.push({
        core,
        halo: plan.halo,
        floats: layers.map((l) => extractChunk(this.app, l, rect, core, plan.halo, this.hadSel)),
        mask: this.hadSel ? extractChunk(this.app, null, rect, core, plan.halo, true) : null
      })
    }
  }

  /** Draw the whole mesh of every source chunk into the target whose pixel (0,0) is document (ox, oy). */
  private drawChunks(target: Surface, ox: number, oy: number, mesh: ReturnType<typeof tessellate>, mask: boolean): void {
    const v = mesh.verts.slice()
    for (let i = 0; i < v.length; i += 4) {
      v[i] -= ox
      v[i + 1] -= oy
    }
    const m = { verts: v, indices: mesh.indices }
    const single = this.chunks.length === 1
    for (const c of this.chunks) {
      const src = mask ? c.mask : c.floats[this.curLayer]
      if (!src) continue
      const sx = c.core.x - this.srcRect.x
      const sy = c.core.y - this.srcRect.y
      this.mesh.draw(target, null, m, src, this.box, c.halo, xs.interp, single ? undefined : { shift: [sx, sy], core: [sx, sy, sx + c.core.w, sy + c.core.h] })
    }
  }

  private renderInf(): void {
    const { doc } = this.app
    const dst = this.dstRect()
    const prev = this.touched
    const mesh = this.meshData()
    this.ie.forEach((e, li) => {
      e.live.restore(prev)
      e.live.restore(this.srcRect)
      const sspans = e.live.prepare(this.srcRect, true)
      removeSourceInf(this.app, e.live, sspans, this.srcRect, this.hadSel)
      if (!dst) return
      const dspans: TileSpan[] = e.live.prepare(dst)
      this.curLayer = li
      for (const s of dspans) this.drawChunks(s.surf, s.ox, s.oy, mesh, false)
    })
    this.touched = dst
    for (const r of [this.srcRect, prev, dst]) if (r) doc.events.emit('change', { rect: r })
    this.onChange?.()
  }

  private commitInf(): boolean {
    const { doc, gpu } = this.app
    const svc = this.app.selection
    const dst = this.dstRect()
    const src = this.srcRect
    const mesh = this.meshData()
    const firstId = this.ie[0].layer.id
    let dirty: Rect | null = null
    groupHistory(doc, 'Transform', (extra) => {
      for (const e of this.ie) dirty = unionRect(dirty, e.live.commit())
      if (this.hadSel && dst && this.chunks[0]?.mask) {
        const r: Rect = { x: dst.x, y: dst.y, w: Math.min(dst.w, MAX_SEL_WINDOW, gpu.maxTexture), h: Math.min(dst.h, MAX_SEL_WINDOW, gpu.maxTexture) }
        const nm = gpu.surface(r.w, r.h, 'rgba8', 0)
        this.drawChunks(nm, r.x, r.y, mesh, true)
        const data = readRedChannel(gpu, nm, { x: 0, y: 0, w: r.w, h: r.h })
        nm.dispose()
        svc.replaceWithRegion(r, data, src)
        extra.push(svc.command('Transform selection', this.selBefore, svc.snapshot()))
      }
    })
    const R2 = unionRect(unionRect(src, dst), dirty)
    doc.emitCommit('transform', firstId, R2, 'Transform')
    if (R2) doc.events.emit('change', { rect: R2 })
    this.dispose()
    return true
  }

  // ------------------------------------------------------------------ overlay
  /** Draw handles etc. `s` maps doc->screen (css px). */
  draw(ctx: CanvasRenderingContext2D, s: (p: Pt) => Pt, zoom: number, dims: { w: number; h: number }): void {
    const q = this.quad.map(s)
    const line = (pts: Pt[], close = false): void => {
      ctx.beginPath()
      pts.forEach((p, i) => (i ? ctx.lineTo(p.x, p.y) : ctx.moveTo(p.x, p.y)))
      if (close) ctx.closePath()
    }
    const stroke2 = (width: number, c1: string, c2: string): void => {
      ctx.lineWidth = width + 2
      ctx.strokeStyle = c2
      ctx.stroke()
      ctx.lineWidth = width
      ctx.strokeStyle = c1
      ctx.stroke()
    }
    // snap guides
    for (const l of this.snapLines) {
      const a = l.axis === 'x' ? s({ x: l.v, y: -1e5 }) : s({ x: -1e5, y: l.v })
      const b = l.axis === 'x' ? s({ x: l.v, y: 1e5 }) : s({ x: 1e5, y: l.v })
      line([a, b])
      ctx.setLineDash([6, 4])
      stroke2(1, '#ffd23f', 'rgba(0,0,0,.5)')
      ctx.setLineDash([])
    }
    // warp mesh
    if (this.mode === 'warp' || this.net.cols > 1 || this.net.rows > 1) {
      const n = this.net
      const seg = 12
      for (let j = 0; j <= n.rows; j++) {
        const pts: Pt[] = []
        for (let k = 0; k <= n.cols * seg; k++) pts.push(s(evalNet(n, k / (n.cols * seg), j / n.rows)))
        line(pts)
        stroke2(1, 'rgba(255,255,255,.85)', 'rgba(0,0,0,.4)')
      }
      for (let i = 0; i <= n.cols; i++) {
        const pts: Pt[] = []
        for (let k = 0; k <= n.rows * seg; k++) pts.push(s(evalNet(n, i / n.cols, k / (n.rows * seg))))
        line(pts)
        stroke2(1, 'rgba(255,255,255,.85)', 'rgba(0,0,0,.4)')
      }
    }
    // box
    line(q, true)
    stroke2(1.5, '#4c9bff', 'rgba(0,0,0,.55)')
    const dot = (p: Pt, r: number, fill: string): void => {
      ctx.beginPath()
      ctx.arc(p.x, p.y, r, 0, Math.PI * 2)
      ctx.fillStyle = fill
      ctx.fill()
      ctx.lineWidth = 1.5
      ctx.strokeStyle = 'rgba(0,0,0,.65)'
      ctx.stroke()
    }
    if (this.mode === 'bend') {
      // two bend handles on the curved edges: drag across the edge to bow it
      for (const [u, v] of [[0.5, 0], [0, 0.5]] as const) dot(s(evalNet(this.net, u, v)), 9, '#ff7a45')
    } else if (this.mode === 'warp') {
      if (xs.advancedMesh) for (const p of this.net.pts) dot(s(p), 5.5, '#fff')
    } else {
      for (const hd of [{ hx: 0.5, hy: 0 }, { hx: 1, hy: 0.5 }, { hx: 0.5, hy: 1 }, { hx: 0, hy: 0.5 }]) dot(s(handlePos(this.quad, hd)), 6, '#fff')
      for (const hd of [{ hx: 0, hy: 0 }, { hx: 1, hy: 0 }, { hx: 1, hy: 1 }, { hx: 0, hy: 1 }]) dot(s(handlePos(this.quad, hd)), 8, '#4c9bff')
    }
    // rotation node
    const rad = 18 / zoom
    // keep the rotate handle reachable: below the box when the top one would hide under the top bar
    const topN = s(rotationNode(this.quad, rad * 2.6, 1))
    const botN = s(rotationNode(this.quad, rad * 2.6, -1))
    const vis = (p: Pt): boolean => p.y >= 16 && p.y <= dims.h - 16 && p.x >= 16 && p.x <= dims.w - 16 // overlay space: the canvas starts below the top bar
    this.rotSide = !vis(topN) && vis(botN) ? -1 : 1
    const rn = rotationNode(this.quad, rad * 2.6, this.rotSide)
    const rm = handlePos(this.quad, { hx: 0.5, hy: this.rotSide === 1 ? 0 : 1 })
    line([s(rm), s(rn)])
    stroke2(1, '#4c9bff', 'rgba(0,0,0,.5)')
    dot(s(rn), 9, '#fff')
    // pivot
    const pv = s(this.pivot)
    ctx.beginPath()
    ctx.moveTo(pv.x - 8, pv.y)
    ctx.lineTo(pv.x + 8, pv.y)
    ctx.moveTo(pv.x, pv.y - 8)
    ctx.lineTo(pv.x, pv.y + 8)
    stroke2(1.5, '#ff7a45', 'rgba(0,0,0,.5)')
    if (this.info) {
      ctx.font = '600 13px system-ui, sans-serif'
      const rp = s(rn)
      const tw = ctx.measureText(this.info).width
      ctx.fillStyle = 'rgba(0,0,0,.75)'
      ctx.fillRect(rp.x + 14, rp.y - 12, tw + 12, 22)
      ctx.fillStyle = '#fff'
      ctx.fillText(this.info, rp.x + 20, rp.y + 4)
    }
  }
}
