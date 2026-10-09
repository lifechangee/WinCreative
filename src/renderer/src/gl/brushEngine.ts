import { BLEND_MODES, blendIndex } from '../core/blend'
import { BrushPreset, DUAL_BLENDS, BURNT_MODES, GRAIN_BLENDS, isBlendingMode } from '../core/brush'
import type { Dab, Rect } from '../core/types'
import { clampToCanvas, dabBounds, unionRect } from '../core/geometry'
import { TILE, TileKey, intRect, tileKey, tileKeyX, tileKeyY, tileRange, tilesIn } from '../core/tiles'
import type { DabEx } from '../core/dynamics'
import { getTextureDef } from '../brush/textures'
import type { Document } from '../doc/document'
import type { Layer } from '../doc/layer'
import type { PixelEdit } from '../doc/pixelEdit'
import { GPU, Program, Surface } from './gpu'
import { bindClipMask, setClipCtx } from './clipMask'
import { MaskTileStore } from '../doc/maskStore'
import { StrokeTiles, SurfacePool, TileSource } from './strokeTiles'
import { COMMIT_FS, FS_VERT } from './shaders'
import { DAB_FS, DAB_VS, DIRECT_FS, FINAL_FS, LOAD_FS } from './dabShaders'

export type PaintMode = 'paint' | 'erase' | 'smudge'

export interface StrokeParams {
  mode: PaintMode
  preset: BrushPreset
  /** straight sRGB colour 0..1 */
  color: [number, number, number]
  /** whole-stroke opacity cap 0..1 */
  opacity: number
}

/** What the compositor needs to draw the in-progress stroke on top of its layer. */
export interface LiveStroke {
  layerId: string
  /** 1 = paint, 2 = erase */
  mode: 1 | 2
  opacity: number
  wet: number
  alphaLock: boolean
  /** fixed documents: the full-canvas stroke buffer (infinite documents: a 1x1 placeholder, see `tiles`) */
  surface: Surface
  /** infinite documents: the sparse stroke buffer, looked up per tile by the compositor */
  tiles?: TileSource
}

/** Set the STROKE_CHUNK uniforms (shared by compositor & commit passes). */
export function setStrokeUniforms(gpu: GPU, p: Program, live: LiveStroke | null, alphaLock: boolean, strokeTex?: WebGLTexture, region?: Rect): void {
  bindClipMask(gpu, p, region)
  if (live) {
    gpu.bindTex(1, strokeTex ?? live.surface.tex)
    p.i('uStroke', 1).i('uStrokeMode', live.mode).f('uStrokeOpacity', live.opacity).f('uWet', live.wet).f('uAlphaLock', alphaLock ? 1 : 0)
  } else {
    gpu.bindTex(1, gpu.blank)
    p.i('uStroke', 1).i('uStrokeMode', 0).f('uStrokeOpacity', 1).f('uWet', 0).f('uAlphaLock', 0)
  }
}

/**
 * Dither phase of a tile (px): the tile origin modulo 4096, computed exactly on the CPU. The noise functions lose all precision for
 * huge arguments (and would stop dithering far from the origin), so the phase wraps; inside a 4096 window it equals the global
 * pixel coordinate, i.e. identical to a fixed canvas.
 */
export const ditherOrigin = (tileIndex: number): number => (((tileIndex * TILE) % 4096) + 4096) % 4096

const FLOATS_PER_DAB = 20
const MAX_BATCH = 2048
const BUILD: Record<string, number> = { lightGlaze: 1, uniformedGlaze: 1, intenseGlaze: 1.8, heavyGlaze: 3.2, uniformBlending: 1, intenseBlending: 1 }

/**
 * Near-full-flow (>= 0.85) plain round brushes are stamped with MAX instead of OVER: with 0.25px dab spacing OVER accumulation drives every
 * anti-aliased edge pixel towards 100% (hard, pixelated edges, and pressure-opacity dynamics wash out). MAX keeps the exact
 * swept-shape coverage. Brushes with flow < 0.85, grain, tip textures or colour dynamics keep classic build-up.
 */
export function usesMaxCoverage(b: BrushPreset): boolean {
  if (b.flow < 0.85 || b.tipTexture || (b.grain.texture && b.grain.depth > 0)) return false
  const c = b.color
  type Rec = Record<string, number>
  const nz = (o: Rec): boolean => Object.values(o).some((v) => v !== 0)
  return !(nz(c.stampJitter as unknown as Rec) || nz(c.strokeJitter as unknown as Rec) || nz(c.pressure as unknown as Rec) || nz(c.tilt as unknown as Rec) || nz(c.roll as unknown as Rec))
}

type Kind = 'stamp' | 'smudge' | 'mix'
const texCaches = new WeakMap<GPU, Map<string, TexEntry>>()

interface TexEntry {
  tex: WebGLTexture
  rev: number
  size: number
}

/**
 * The brush engine. Strokes are stamped as dabs into a per-stroke buffer (RGBA16F, premultiplied) that
 * is overlaid live by the compositor and baked into the layer on end() (whole-stroke opacity cap).
 * Smudge and wet-mix (blending rendering modes) work directly on the layer; strokes with a brush blend
 * mode are re-blended from a snapshot every frame. Dual brushes stamp into a second buffer and the two are
 * combined (plus wet edge / burnt edges / alpha threshold) into a third by a per-frame finalize pass.
 */
export class BrushEngine {
  private gl: WebGL2RenderingContext
  private A!: Surface
  private B: Surface | null = null
  private C: Surface | null = null
  private base: Surface | null = null
  private loads: [Surface, Surface] | null = null
  private loadIdx = 0
  private dabProg: Program
  private loadProg: Program
  private finalProg: Program
  private directProg: Program
  private commitProg: Program
  private vao: WebGLVertexArrayObject
  private vbo: WebGLBuffer
  private data = new Float32Array(MAX_BATCH * FLOATS_PER_DAB)
  /** shared per GPU: the start-up warm-up engine uploads the tip / grain textures for the real one */
  private texCache: Map<string, TexEntry>
  private samplers: Record<string, WebGLSampler> = {}

  private layer: Layer | null = null
  private params: StrokeParams | null = null
  private edit: PixelEdit | null = null
  private liveRect: Rect | null = null
  private frameDirty: Rect | null = null
  private kind: Kind = 'stamp'
  private needFinal = false
  private directBlend = false
  private blendIdx = 0
  private doc: Document
  /** infinite canvas: the current stroke targets a tiled layer (sparse stroke buffers, per-tile passes) */
  private inf = false
  private sA: StrokeTiles
  private sB: StrokeTiles
  private sC: StrokeTiles
  private pool: SurfacePool
  private dummy: Surface
  /** infinite smudge / wet-mix: region assembled from tiles (lazy) and a tile-sized copy used by the stroke commit */
  private infScratch: Surface | null = null
  private tileTmp: Surface | null = null

  constructor(private gpu: GPU, doc: Document) {
    this.gl = gpu.gl
    this.doc = doc
    this.texCache = texCaches.get(gpu) ?? texCaches.set(gpu, new Map()).get(gpu)!
    this.pool = new SurfacePool(gpu, 'rgba16f')
    this.sA = new StrokeTiles(this.pool)
    this.sB = new StrokeTiles(this.pool)
    this.sC = new StrokeTiles(this.pool)
    this.dummy = gpu.surface(1, 1, 'rgba16f', 0)
    this.dabProg = gpu.program('dab2', DAB_VS, DAB_FS)
    this.loadProg = gpu.program('dabload', FS_VERT, LOAD_FS)
    this.finalProg = gpu.program('dabfinal', FS_VERT, FINAL_FS)
    this.directProg = gpu.program('dabdirect', FS_VERT, DIRECT_FS)
    this.commitProg = gpu.program('commit', FS_VERT, COMMIT_FS)
    const gl = this.gl
    this.vao = gl.createVertexArray()!
    this.vbo = gl.createBuffer()!
    gl.bindVertexArray(this.vao)
    gl.bindBuffer(gl.ARRAY_BUFFER, this.vbo)
    const stride = FLOATS_PER_DAB * 4
    ;['aA', 'aB', 'aC', 'aD', 'aE'].forEach((n, i) => {
      const loc = gl.getAttribLocation(this.dabProg.prog, n)
      gl.enableVertexAttribArray(loc)
      gl.vertexAttribPointer(loc, 4, gl.FLOAT, false, stride, i * 16)
      gl.vertexAttribDivisor(loc, 1)
    })
    gl.bindVertexArray(null)
    const mk = (min: number, wrap: number): WebGLSampler => {
      const s = gl.createSampler()!
      gl.samplerParameteri(s, gl.TEXTURE_MIN_FILTER, min)
      gl.samplerParameteri(s, gl.TEXTURE_MAG_FILTER, min === gl.NEAREST ? gl.NEAREST : gl.LINEAR)
      gl.samplerParameteri(s, gl.TEXTURE_WRAP_S, wrap)
      gl.samplerParameteri(s, gl.TEXTURE_WRAP_T, wrap)
      return s
    }
    for (const [name, min] of [['none', gl.NEAREST], ['classic', gl.LINEAR], ['improved', gl.LINEAR_MIPMAP_LINEAR]] as [string, number][]) {
      this.samplers['tip-' + name] = mk(min, gl.CLAMP_TO_EDGE)
      this.samplers['grain-' + name] = mk(min, gl.REPEAT)
    }
    this.allocStroke()
  }

  setDocument(doc: Document): void {
    this.cancel()
    this.doc = doc
    this.allocStroke()
  }

  private allocStroke(): void {
    this.A?.dispose()
    this.B?.dispose()
    this.C?.dispose()
    this.base?.dispose()
    this.B = this.C = this.base = null
    // infinite documents stamp into sparse tile buffers: no full-canvas surface at all
    this.A = this.doc.isInfinite ? this.gpu.surface(1, 1, 'rgba16f', 0) : this.gpu.surface(this.doc.width, this.doc.height, 'rgba16f')
  }

  get active(): boolean {
    return this.layer !== null
  }

  /** In-progress paint/erase stroke to overlay on its layer, or null. */
  get live(): LiveStroke | null {
    if (!this.layer || !this.params || this.kind !== 'stamp' || this.directBlend) return null
    return {
      layerId: this.layer.id,
      mode: this.params.mode === 'erase' ? 2 : 1,
      opacity: this.params.opacity,
      wet: 0,
      alphaLock: this.layer.alphaLock,
      surface: this.inf ? this.dummy : this.needFinal ? this.C! : this.A,
      ...(this.inf ? { tiles: this.needFinal ? this.sC : this.sA } : {})
    }
  }

  /** Region modified since the last call (for scissored recompositing). */
  takeDirty(): Rect | null {
    const r = this.frameDirty
    this.frameDirty = null
    return r
  }

  begin(layer: Layer, params: StrokeParams): void {
    if (this.layer) this.cancel()
    this.layer = layer
    this.params = params
    this.liveRect = null
    this.frameDirty = null
    this.inf = !!layer.editTiles
    const b = params.preset
    const mode = params.mode
    this.kind = mode === 'smudge' ? 'smudge' : mode === 'paint' && isBlendingMode(b.render.mode) ? 'mix' : 'stamp'
    const dual = mode !== 'smudge' && b.dual.enabled && !!b.dual.brush
    this.needFinal = this.kind === 'stamp' && (dual || b.wetEdge > 0 || b.render.burnt > 0 || b.render.alphaThreshold > 0)
    this.directBlend = this.kind === 'stamp' && mode === 'paint' && (b.render.blendMode !== 'normal' || b.render.luminance)
    const gpu = this.gpu
    if (!this.inf && dual && !this.B) this.B = gpu.surface(this.doc.width, this.doc.height, 'rgba16f')
    if (!this.inf && this.needFinal && !this.C) this.C = gpu.surface(this.doc.width, this.doc.height, 'rgba16f')
    if (this.kind === 'smudge') this.edit = this.doc.beginPixelEdit(layer, 'Smudge')
    else if (this.kind === 'mix') {
      this.edit = this.doc.beginPixelEdit(layer, 'Brush stroke')
      this.initLoad(params.color)
    } else if (this.directBlend) {
      this.edit = this.doc.beginPixelEdit(layer, 'Brush stroke')
      // infinite: the edit's per-tile "before" snapshots serve as the base, no full copy
      if (!this.inf) {
        if (!this.base) this.base = gpu.surface(this.doc.width, this.doc.height, layer.surface.fmt)
        gpu.blit(layer.surface, { x: 0, y: 0, w: this.doc.width, h: this.doc.height }, this.base, 0, 0)
      }
      let bi = blendIndex(b.render.blendMode as (typeof BLEND_MODES)[number])
      if (bi <= 0) bi = b.render.luminance ? blendIndex('luminosity') : 0
      this.blendIdx = bi
    }
  }

  // ------------------------------------------------------------------ textures
  private tex(id: string | null): TexEntry | null {
    if (!id) return null
    const def = getTextureDef(id)
    if (!def) return null
    const rev = def.rev ?? 0
    const cached = this.texCache.get(id)
    if (cached && cached.rev === rev) return cached
    const gl = this.gl
    if (cached) gl.deleteTexture(cached.tex)
    const t = gl.createTexture()!
    const size = def.size
    const levels = Math.floor(Math.log2(size)) + 1
    gl.bindTexture(gl.TEXTURE_2D, t)
    gl.texStorage2D(gl.TEXTURE_2D, levels, gl.R8, size, size)
    gl.texSubImage2D(gl.TEXTURE_2D, 0, 0, 0, size, size, gl.RED, gl.UNSIGNED_BYTE, def.data)
    gl.generateMipmap(gl.TEXTURE_2D)
    gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MIN_FILTER, gl.LINEAR_MIPMAP_LINEAR)
    gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MAG_FILTER, gl.LINEAR)
    const e = { tex: t, rev, size }
    this.texCache.set(id, e)
    return e
  }

  // ------------------------------------------------------------------ stamping
  /** Stamp dabs. Paint/erase: into the stroke buffer (target 1 = dual brush). Smudge / wet mix: directly into the layer. */
  stamp(dabs: (Dab | DabEx)[], target: 0 | 1 = 0): void {
    if (!this.layer || !this.params || !dabs.length) return
    if (this.kind === 'smudge') this.stampDirect(dabs as DabEx[], false)
    else if (this.kind === 'mix') this.stampDirect(dabs as DabEx[], true)
    else this.stampPaint(dabs as DabEx[], target)
  }

  private setupDabState(p: Program, mode: 0 | 1 | 2, brush: BrushPreset, dual: boolean): void {
    const { preset } = this.params!
    const gpu = this.gpu
    const gl = this.gl
    const tip = this.tex(brush.tipTexture)
    const gr = brush.grain
    const grain = this.tex(gr.texture)
    p.use()
    if (this.inf) p.v2('uCanvas', TILE, TILE).v2('uOrigin', 0, 0).v2('uSrcOff', 0, 0).v2('uSrcSize', 1, 1)
    else p.v2('uCanvas', this.doc.width, this.doc.height).v2('uOrigin', 0, 0).v2('uSrcOff', 0, 0).v2('uSrcSize', this.doc.width, this.doc.height)
    p.i('uMode', mode)
    p.f('uHardness', brush.hardness)
    p.i('uHasTip', tip ? 1 : 0).i('uTipInvert', brush.shape.invert ? 1 : 0).i('uTip', 1)
    p.i('uHasGrain', grain && gr.depth > 0 ? 1 : 0).i('uGrain', 2).i('uSrc', 3).i('uLoad', 5)
    p.v4('uGrainP', gr.scale, gr.moving ? 1 : 0, gr.moving ? gr.movement : 0, grain?.size ?? 256)
    p.v4('uGrainQ', (gr.rotation * Math.PI) / 180, gr.zoomCropped ? 1 : 0, Math.max(0, GRAIN_BLENDS.indexOf(gr.blend)), gr.invert ? 1 : 0)
    p.v2('uGrainCB', gr.contrast, gr.brightness)
    p.f('uBuild', BUILD[brush.render.mode] ?? 1)
    p.f('uAlphaLock', this.layer!.alphaLock ? 1 : 0)
    void dual
    void preset
    gpu.bindTex(1, tip?.tex ?? gpu.blank)
    gpu.bindTex(2, grain?.tex ?? gpu.blank)
    gpu.bindTex(3, gpu.blank)
    gpu.bindTex(5, gpu.blank)
    bindClipMask(gpu, p, this.inf ? { x: 0, y: 0, w: TILE, h: TILE } : undefined)
    gl.bindSampler(1, this.samplers['tip-' + brush.shape.filtering])
    gl.bindSampler(2, this.samplers['grain-' + gr.filtering])
  }

  private endDabState(): void {
    const gl = this.gl
    gl.bindSampler(1, null)
    gl.bindSampler(2, null)
    gl.bindVertexArray(null)
    gl.disable(gl.BLEND)
    gl.blendEquation(gl.FUNC_ADD)
    gl.disable(gl.SCISSOR_TEST)
  }

  /** Upload dabs; (ox,oy) is subtracted from their positions (infinite canvas: coordinates become tile-relative = exact in float32). */
  private upload(dabs: DabEx[], from: number, n: number, ox = 0, oy = 0): void {
    const d = this.data
    const c = this.params!.color
    for (let i = 0; i < n; i++) {
      const s = dabs[from + i]
      const o = i * FLOATS_PER_DAB
      d[o] = s.x - ox
      d[o + 1] = s.y - oy
      d[o + 2] = s.size
      d[o + 3] = s.angle
      d[o + 4] = s.alpha
      d[o + 5] = s.roundness
      d[o + 6] = s.px - ox
      d[o + 7] = s.py - oy
      d[o + 8] = s.r ?? c[0]
      d[o + 9] = s.g ?? c[1]
      d[o + 10] = s.b ?? c[2]
      d[o + 11] = s.flags ?? 0
      d[o + 12] = s.depth ?? 0
      d[o + 13] = s.gx ?? 0
      d[o + 14] = s.gy ?? 0
      d[o + 15] = s.soft ?? 0
      d[o + 16] = s.dil ?? 0
      d[o + 17] = s.blur ?? 0
      d[o + 18] = s.gmul ?? 1
      d[o + 19] = 0
    }
    const gl = this.gl
    gl.bindVertexArray(this.vao)
    gl.bindBuffer(gl.ARRAY_BUFFER, this.vbo)
    gl.bufferData(gl.ARRAY_BUFFER, d.subarray(0, n * FLOATS_PER_DAB), gl.DYNAMIC_DRAW)
  }

  private dabsRect(dabs: DabEx[]): Rect | null {
    let bounds: Rect | null = null
    for (const d of dabs) bounds = unionRect(bounds, dabBounds(d.x, d.y, d.size, 3))
    return bounds && clampToCanvas(bounds, this.doc.width, this.doc.height)
  }

  private stampPaint(dabs: DabEx[], target: 0 | 1): void {
    const gl = this.gl
    const gpu = this.gpu
    const params = this.params!
    const brush = target === 1 ? params.preset.dual.brush! : params.preset
    if (this.inf) return this.stampPaintInf(dabs, target, brush)
    const surf = target === 1 ? this.B! : this.A
    const p = this.dabProg
    this.setupDabState(p, 0, brush, target === 1)
    gpu.bindTarget(surf, null)
    gl.enable(gl.BLEND)
    if (brush.render.mode === 'uniformedGlaze' || usesMaxCoverage(brush)) {
      gl.blendEquation(gl.MAX)
      gl.blendFunc(gl.ONE, gl.ONE)
    } else gl.blendFunc(gl.ONE, gl.ONE_MINUS_SRC_ALPHA)
    for (let i = 0; i < dabs.length; i += MAX_BATCH) {
      const n = Math.min(MAX_BATCH, dabs.length - i)
      this.upload(dabs, i, n)
      gl.drawArraysInstanced(gl.TRIANGLE_STRIP, 0, 4, n)
    }
    this.endDabState()
    const r = this.dabsRect(dabs)
    if (!r) return
    this.liveRect = unionRect(this.liveRect, r)
    if (this.needFinal) this.finalize(r)
    if (this.directBlend) this.applyDirect(r)
    this.frameDirty = unionRect(this.frameDirty, r)
  }

  // ------------------------------------------------------------------ infinite canvas: tile passes
  /** Rect -> the tiles it touches, as keys with their tile-local scissor rect. */
  private tileSpans(r: Rect): { key: TileKey; tx: number; ty: number; local: Rect }[] {
    const out: { key: TileKey; tx: number; ty: number; local: Rect }[] = []
    for (const { tx, ty } of tilesIn(r)) {
      const x0 = Math.max(r.x, tx * TILE)
      const y0 = Math.max(r.y, ty * TILE)
      const x1 = Math.min(r.x + r.w, (tx + 1) * TILE)
      const y1 = Math.min(r.y + r.h, (ty + 1) * TILE)
      out.push({ key: tileKey(tx, ty), tx, ty, local: { x: x0 - tx * TILE, y: y0 - ty * TILE, w: x1 - x0, h: y1 - y0 } })
    }
    return out
  }

  private stampPaintInf(dabs: DabEx[], target: 0 | 1, brush: BrushPreset): void {
    const gl = this.gl
    const gpu = this.gpu
    const store = target === 1 ? this.sB : this.sA
    const p = this.dabProg
    // bucket the dabs per tile they touch
    const groups = new Map<TileKey, DabEx[]>()
    let bounds: Rect | null = null
    for (const d of dabs) {
      const b = dabBounds(d.x, d.y, d.size, 3)
      bounds = unionRect(bounds, b)
      const g = tileRange(b)
      if (!g) continue
      for (let ty = g.ty0; ty <= g.ty1; ty++) {
        for (let tx = g.tx0; tx <= g.tx1; tx++) {
          const k = tileKey(tx, ty)
          const list = groups.get(k)
          if (list) list.push(d)
          else groups.set(k, [d])
        }
      }
    }
    if (!bounds) return
    // allocate first: creating a texture re-binds the ACTIVE texture unit, which would alias a unit the dab program samples
    // (a render target bound as texture = feedback loop = the draw is dropped)
    for (const key of groups.keys()) store.ensure(key)
    this.setupDabState(p, 0, brush, target === 1)
    gl.enable(gl.BLEND)
    if (brush.render.mode === 'uniformedGlaze' || usesMaxCoverage(brush)) {
      gl.blendEquation(gl.MAX)
      gl.blendFunc(gl.ONE, gl.ONE)
    } else gl.blendFunc(gl.ONE, gl.ONE_MINUS_SRC_ALPHA)
    for (const [key, list] of groups) {
      const ox = tileKeyX(key) * TILE
      const oy = tileKeyY(key) * TILE
      gpu.bindTarget(store.ensure(key), null)
      p.v2('uOrigin', ox, oy)
      for (let i = 0; i < list.length; i += MAX_BATCH) {
        const n = Math.min(MAX_BATCH, list.length - i)
        this.upload(list, i, n, ox, oy)
        gl.drawArraysInstanced(gl.TRIANGLE_STRIP, 0, 4, n)
      }
    }
    this.endDabState()
    const r = intRect(bounds)
    this.liveRect = unionRect(this.liveRect, r)
    if (this.needFinal) this.finalizeInf(r)
    if (this.directBlend) this.applyDirectInf(r)
    this.frameDirty = unionRect(this.frameDirty, r)
  }

  private finalizeInf(r: Rect): void {
    const gpu = this.gpu
    const b = this.params!.preset
    const spans = this.tileSpans(r).filter((s) => this.sA.get(s.key) || this.sB.get(s.key))
    for (const s of spans) this.sC.ensure(s.key) // allocate before binding (see stampPaintInf)
    const p = this.finalProg.use()
    const dual = b.dual.enabled && !!b.dual.brush && this.sB.map.size > 0
    const dm = b.render.classicCombine ? 0 : Math.max(0, DUAL_BLENDS.indexOf(b.dual.mode))
    p.i('uA', 0).i('uB', 1).i('uDual', dual ? 1 : 0).i('uDualMode', dm).f('uDualOpacity', b.dual.opacity)
    p.f('uWet', b.wetEdge).f('uBurnt', b.render.burnt).i('uBurntMode', Math.max(0, BURNT_MODES.indexOf(b.render.burntMode))).f('uThr', b.render.alphaThreshold)
    for (const s of spans) {
      const a = this.sA.get(s.key)
      const bb = this.sB.get(s.key)
      gpu.bindTex(0, a?.tex ?? gpu.blank)
      gpu.bindTex(1, bb?.tex ?? gpu.blank)
      gpu.bindTarget(this.sC.ensure(s.key), s.local)
      gpu.fullscreen()
    }
    this.gl.disable(this.gl.SCISSOR_TEST)
  }

  private applyDirectInf(r: Rect): void {
    const gpu = this.gpu
    const layer = this.layer!
    const edit = this.edit!
    const src = this.needFinal ? this.sC : this.sA
    const spans = this.tileSpans(r).filter((s) => src.get(s.key))
    for (const s of spans) {
      edit.saveKey(s.key) // snapshots + tile allocation happen before any texture is bound
      layer.editTiles!.ensure(s.tx, s.ty)
    }
    const p = this.directProg.use()
    bindClipMask(gpu, p, { x: 0, y: 0, w: TILE, h: TILE })
    p.i('uBase', 0).i('uStroke', 1).i('uBlend', this.blendIdx).f('uOpacity', this.params!.opacity).f('uAlphaLock', layer.alphaLock ? 1 : 0).i('uMode', 1)
    for (const s of spans) {
      const st = src.get(s.key)!
      const base = edit.snapshot(s.key)
      gpu.bindTex(0, base?.tex ?? gpu.blank)
      gpu.bindTex(1, st.tex)
      setClipCtx(p, { x: s.tx * TILE, y: s.ty * TILE, w: TILE, h: TILE })
      gpu.bindTarget(layer.editTiles!.ensure(s.tx, s.ty), s.local)
      gpu.fullscreen()
    }
    this.gl.disable(this.gl.SCISSOR_TEST)
  }

  /** Smudge / wet mix on a tiled layer: assemble the dab's region into a scratch, then draw the dab into every tile it touches. */
  private stampDirectInf(dabs: DabEx[], mix: boolean): void {
    const gl = this.gl
    const gpu = this.gpu
    const layer = this.layer!
    const store = layer.editTiles!
    const brush = this.params!.preset
    const w = brush.wet
    const intense = brush.render.mode === 'intenseBlending'
    const p = this.dabProg
    gl.disable(gl.BLEND)
    for (const d of dabs) {
      // the region must cover the WHOLE dab quad (its corners reach sqrt(2) * (R + margin)), because the pass writes every texel of the quad
      const half = Math.SQRT2 * (d.size / 2 + 1.5) + 4
      let b: Rect = { x: d.x - half, y: d.y - half, w: 2 * half, h: 2 * half }
      if (!mix) b = unionRect(b, { x: d.px - half, y: d.py - half, w: 2 * half, h: 2 * half }) as Rect
      const r = intRect(b)
      const max = this.gpu.maxTexture
      if (r.w < 1 || r.h < 1 || r.w > max || r.h > max) continue
      const SCR = Math.max(1024, 1 << Math.ceil(Math.log2(Math.max(r.w, r.h))))
      if (!this.infScratch || this.infScratch.w < SCR) {
        this.infScratch?.dispose()
        this.infScratch = gpu.surface(SCR, SCR, store.fmt, 0)
      }
      const scratch = this.infScratch
      const SIZE = scratch.w
      this.edit!.save(r)
      gpu.clear(scratch, { x: 0, y: 0, w: r.w, h: r.h })
      const spans = this.tileSpans(r)
      for (const s of spans) store.ensure(s.tx, s.ty) // allocate before any texture binding
      for (const s of spans) {
        const t = store.get(s.tx, s.ty)
        if (t) gpu.blit(t, s.local, scratch, s.tx * TILE + s.local.x - r.x, s.ty * TILE + s.local.y - r.y)
      }
      if (mix) {
        const from = this.loads![this.loadIdx]
        const to = this.loads![1 - this.loadIdx]
        const lp = this.loadProg.use()
        gpu.bindTex(3, scratch.tex)
        gpu.bindTex(5, from.tex)
        const pull = Math.min(0.6, (0.02 + 0.33 * w.pull) * (intense ? 1.6 : 1) * (1 + d.dil * 0.8))
        const refill = 0.004 + 0.25 * Math.pow(w.charge, 1.5)
        lp.i('uSrc', 3).i('uLoad', 5).v2('uCanvas', SIZE, SIZE).v2('uSrcOrg', 0, 0).v3('uPos', d.x - r.x, d.y - r.y, d.size * 0.5)
        lp.v4('uBrush', d.r, d.g, d.b, 1).v2('uRates', pull, refill)
        gpu.bindTarget(to, null)
        gpu.fullscreen()
        this.loadIdx = 1 - this.loadIdx
      }
      this.setupDabState(p, mix ? 2 : 1, brush, false)
      if (mix) {
        p.v4('uMix', (0.25 + 0.75 * w.attack) * (intense ? 1.35 : 1) * this.params!.opacity, w.grade, intense ? 1 : 0, 0)
        gpu.bindTex(5, this.loads![this.loadIdx].tex)
      } else p.v4('uMix', brush.smudgeStrength, 0, 0, 0)
      gpu.bindTex(3, scratch.tex)
      bindClipMask(gpu, p, { x: 0, y: 0, w: TILE, h: TILE })
      for (const s of spans) {
        const ox = s.tx * TILE
        const oy = s.ty * TILE
        p.v2('uOrigin', ox, oy).v2('uSrcOff', ox - r.x, oy - r.y).v2('uSrcSize', SIZE, SIZE)
        setClipCtx(p, { x: ox, y: oy, w: TILE, h: TILE })
        gpu.bindTarget(store.ensure(s.tx, s.ty), null)
        this.upload([d], 0, 1, ox, oy)
        gl.drawArraysInstanced(gl.TRIANGLE_STRIP, 0, 4, 1)
      }
      this.gl.bindSampler(1, null)
      this.gl.bindSampler(2, null)
      this.frameDirty = unionRect(this.frameDirty, r)
      this.liveRect = unionRect(this.liveRect, r)
    }
    this.endDabState()
  }

  /** Free tiles of the edit that ended up fully transparent (erase / smudge), inside the same undo step. */
  private pruneEdited(): void {
    const edit = this.edit
    const store = this.layer?.editTiles
    if (!edit || !store) return
    for (const k of store.emptyAmong(edit.savedKeys())) edit.removeKey(k)
  }

  /** Combine primary + dual buffers and apply wet edge / burnt edges / threshold into C. */
  private finalize(r: Rect): void {
    const gpu = this.gpu
    const b = this.params!.preset
    const p = this.finalProg.use()
    gpu.bindTex(0, this.A.tex)
    gpu.bindTex(1, this.B?.tex ?? gpu.blank)
    const dual = b.dual.enabled && !!b.dual.brush && !!this.B
    const dm = b.render.classicCombine ? 0 : Math.max(0, DUAL_BLENDS.indexOf(b.dual.mode))
    // DUAL_BLENDS is ordered multiply, normal, ...; the shader uses the same order
    p.i('uA', 0).i('uB', 1).i('uDual', dual ? 1 : 0).i('uDualMode', dm).f('uDualOpacity', b.dual.opacity)
    p.f('uWet', b.wetEdge).f('uBurnt', b.render.burnt).i('uBurntMode', Math.max(0, BURNT_MODES.indexOf(b.render.burntMode))).f('uThr', b.render.alphaThreshold)
    gpu.bindTarget(this.C!, r)
    gpu.fullscreen()
    this.gl.disable(this.gl.SCISSOR_TEST)
  }

  private applyDirect(r: Rect): void {
    const gpu = this.gpu
    const layer = this.layer!
    this.edit!.save(r)
    const p = this.directProg.use()
    bindClipMask(gpu, p)
    gpu.bindTex(0, this.base!.tex)
    gpu.bindTex(1, (this.needFinal ? this.C! : this.A).tex)
    p.i('uBase', 0).i('uStroke', 1).i('uBlend', this.blendIdx).f('uOpacity', this.params!.opacity).f('uAlphaLock', layer.alphaLock ? 1 : 0).i('uMode', 1)
    gpu.bindTarget(layer.surface, r)
    gpu.fullscreen()
    this.gl.disable(this.gl.SCISSOR_TEST)
  }

  // ------------------------------------------------------------------ wet mix load
  private initLoad(c: [number, number, number]): void {
    const gpu = this.gpu
    const gl = this.gl
    if (!this.loads) this.loads = [gpu.surface(1, 1, 'rgba16f', 0), gpu.surface(1, 1, 'rgba16f', 0)]
    this.loadIdx = 0
    for (const s of this.loads) {
      gpu.bindTarget(s, null)
      gl.clearColor(c[0], c[1], c[2], 1)
      gl.clear(gl.COLOR_BUFFER_BIT)
    }
  }

  /** Per-dab sequential passes: smudge and wet mix read the layer copy in `scratch`. */
  private stampDirect(dabs: DabEx[], mix: boolean): void {
    if (this.inf) return this.stampDirectInf(dabs, mix)
    const gl = this.gl
    const gpu = this.gpu
    const layer = this.layer!
    const brush = this.params!.preset
    const w = brush.wet
    const intense = brush.render.mode === 'intenseBlending'
    const p = this.dabProg
    gl.disable(gl.BLEND)
    for (const d of dabs) {
      let b = dabBounds(d.x, d.y, d.size, 4)
      if (!mix) b = unionRect(b, dabBounds(d.px, d.py, d.size, 4)) as Rect
      const r = clampToCanvas(b, this.doc.width, this.doc.height)
      if (!r) continue
      this.edit!.save(r)
      gpu.blit(layer.surface, r, this.doc.scratch, r.x, r.y)
      if (mix) {
        const from = this.loads![this.loadIdx]
        const to = this.loads![1 - this.loadIdx]
        const lp = this.loadProg.use()
        gpu.bindTex(3, this.doc.scratch.tex)
        gpu.bindTex(5, from.tex)
        const pull = Math.min(0.6, (0.02 + 0.33 * w.pull) * (intense ? 1.6 : 1) * (1 + d.dil * 0.8))
        const refill = 0.004 + 0.25 * Math.pow(w.charge, 1.5)
        const premul = (v: number): number => v
        lp.i('uSrc', 3).i('uLoad', 5).v2('uCanvas', this.doc.width, this.doc.height).v2('uSrcOrg', 0, 0).v3('uPos', d.x, d.y, d.size * 0.5)
        lp.v4('uBrush', premul(d.r), premul(d.g), premul(d.b), 1).v2('uRates', pull, refill)
        gpu.bindTarget(to, null)
        gpu.fullscreen()
        this.loadIdx = 1 - this.loadIdx
      }
      this.setupDabState(p, mix ? 2 : 1, brush, false)
      if (mix) {
        p.v4('uMix', (0.25 + 0.75 * w.attack) * (intense ? 1.35 : 1) * this.params!.opacity, w.grade, intense ? 1 : 0, 0)
        gpu.bindTex(5, this.loads![this.loadIdx].tex)
      } else p.v4('uMix', brush.smudgeStrength, 0, 0, 0)
      gpu.bindTex(3, this.doc.scratch.tex)
      bindClipMask(gpu, p)
      gpu.bindTarget(layer.surface, null)
      this.upload([d], 0, 1)
      gl.drawArraysInstanced(gl.TRIANGLE_STRIP, 0, 4, 1)
      this.gl.bindSampler(1, null)
      this.gl.bindSampler(2, null)
      this.frameDirty = unionRect(this.frameDirty, r)
      this.liveRect = unionRect(this.liveRect, r)
    }
    this.endDabState()
  }

  /** Clear the stroke buffers: the same dabs will be stamped again (end taper). */
  restart(): void {
    if (!this.layer || this.kind !== 'stamp') return
    const r = this.liveRect
    if (!r) return
    if (this.inf) {
      for (const s of [this.sA, this.sB, this.sC]) for (const t of s.map.values()) this.gpu.clear(t)
      if (this.directBlend) {
        // put the pre-stroke tiles back (absent before = transparent again)
        for (const s of this.tileSpans(r)) {
          const snap = this.edit!.snapshot(s.key)
          if (snap === undefined) continue
          const t = this.layer.editTiles!.ensure(s.tx, s.ty)
          if (snap) this.gpu.blit(snap, { x: 0, y: 0, w: TILE, h: TILE }, t, 0, 0)
          else this.gpu.clear(t)
        }
      }
      this.frameDirty = unionRect(this.frameDirty, r)
      return
    }
    this.gpu.clear(this.A, r)
    if (this.B) this.gpu.clear(this.B, r)
    if (this.C) this.gpu.clear(this.C, r)
    if (this.directBlend) this.gpu.blit(this.base!, r, this.layer.surface, r.x, r.y)
    this.frameDirty = unionRect(this.frameDirty, r)
  }

  /** Draw layer + live stroke into `dst` (a surface with the canvas' size) over rect (used by previews / the drawing pad). */
  composeLiveTo(dst: Surface, rect: Rect): void {
    const layer = this.layer
    const gpu = this.gpu
    if (!layer || this.inf) return
    const p = this.commitProg.use()
    gpu.bindTex(0, layer.surface.tex)
    p.i('uSrc', 0).f('uDither', 0).v2('uOrigin', 0, 0)
    setStrokeUniforms(gpu, p, this.live, layer.alphaLock)
    gpu.bindTarget(dst, rect)
    gpu.fullscreen()
    this.gl.disable(this.gl.SCISSOR_TEST)
  }

  /** Bake the stroke into the layer and push the undo step. Returns dirty rect. */
  end(): { layerId: string; rect: Rect; mode: PaintMode } | null {
    const layer = this.layer
    const params = this.params
    if (!layer || !params) return null
    const rect = this.liveRect
    const gpu = this.gpu
    const doc = this.doc
    let result: { layerId: string; rect: Rect; mode: PaintMode } | null = null
    if (this.kind !== 'stamp' || this.directBlend) {
      if (this.inf && params.mode !== 'paint') this.pruneEdited()
      const dirty = this.edit?.finish() ?? null
      if (dirty) result = { layerId: layer.id, rect: dirty, mode: params.mode }
    } else if (rect && this.inf) {
      const dirty = this.commitInf(params.mode === 'erase')
      if (dirty) result = { layerId: layer.id, rect: dirty, mode: params.mode }
    } else if (rect) {
      const label = params.mode === 'erase' ? 'Erase' : 'Brush stroke'
      const edit = doc.beginPixelEdit(layer, label)
      edit.save(rect)
      gpu.blit(layer.surface, rect, doc.scratch, rect.x, rect.y)
      const p = this.commitProg.use()
      gpu.bindTex(0, doc.scratch.tex)
      p.i('uSrc', 0).f('uDither', layer.surface.fmt === 'rgba8' ? 1 : 0).v2('uOrigin', 0, 0)
      setStrokeUniforms(gpu, p, this.live, layer.alphaLock)
      gpu.bindTarget(layer.surface, rect)
      gpu.fullscreen()
      this.gl.disable(this.gl.SCISSOR_TEST)
      edit.finish()
      result = { layerId: layer.id, rect, mode: params.mode }
    }
    this.clearBuffers(rect)
    this.reset()
    return result
  }

  /** Bake the sparse stroke buffer into the layer tiles (one undo step). Returns the dirty rect. */
  private commitInf(erase: boolean): Rect | null {
    const layer = this.layer!
    const gpu = this.gpu
    const store = layer.editTiles!
    const src = this.needFinal ? this.sC : this.sA
    const edit = this.doc.beginPixelEdit(layer, erase ? 'Erase' : 'Brush stroke')
    const tmp = (this.tileTmp ??= gpu.surface(TILE, TILE, store.fmt, 0))
    const live = this.live
    for (const [key, st] of src.map) {
      const cur = store.getKey(key)
      if (!cur && erase) continue
      edit.saveKey(key)
      const target = store.ensureKey(key)
      if (cur) gpu.blit(cur, { x: 0, y: 0, w: TILE, h: TILE }, tmp, 0, 0)
      else if (store instanceof MaskTileStore) store.paintFill(tmp)
      else gpu.clear(tmp)
      const p = this.commitProg.use()
      gpu.bindTex(0, tmp.tex)
      p.i('uSrc', 0).f('uDither', store.fmt === 'rgba8' ? 1 : 0).v2('uOrigin', ditherOrigin(tileKeyX(key)), ditherOrigin(tileKeyY(key)))
      setStrokeUniforms(gpu, p, live, layer.alphaLock, st.tex, { x: tileKeyX(key) * TILE, y: tileKeyY(key) * TILE, w: TILE, h: TILE })
      gpu.bindTarget(target, null)
      gpu.fullscreen()
    }
    if (erase) for (const k of store.emptyAmong(edit.savedKeys())) edit.removeKey(k)
    return edit.finish()
  }

  private clearBuffers(rect: Rect | null): void {
    if (this.inf) {
      this.sA.clear()
      this.sB.clear()
      this.sC.clear()
      return
    }
    this.gpu.clear(this.A, rect)
    if (this.B) this.gpu.clear(this.B, rect)
    if (this.C) this.gpu.clear(this.C, rect)
  }

  cancel(): void {
    if (!this.layer) return
    if (this.kind !== 'stamp' || this.directBlend) {
      // these write straight into the layer: record then revert so pixels are restored
      if (this.edit?.hasChanges) {
        this.edit.finish()
        this.doc.history.undo()
      }
    }
    this.clearBuffers(this.liveRect)
    const r = this.liveRect
    this.reset()
    this.doc.events.emit('change', { rect: r })
  }

  private reset(): void {
    this.inf = false
    this.layer = null
    this.params = null
    this.edit = null
    this.liveRect = null
    this.kind = 'stamp'
    this.needFinal = false
    this.directBlend = false
  }

  dispose(): void {
    this.sA.clear()
    this.sB.clear()
    this.sC.clear()
    this.pool.dispose()
    this.dummy.dispose()
    this.infScratch?.dispose()
    this.tileTmp?.dispose()
    this.A.dispose()
    this.B?.dispose()
    this.C?.dispose()
    this.base?.dispose()
    this.loads?.forEach((s) => s.dispose())
  }
}
