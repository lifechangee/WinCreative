import { BLEND_MODES, blendIndex } from '../core/blend'
import { BrushPreset, DUAL_BLENDS, BURNT_MODES, GRAIN_BLENDS, isBlendingMode } from '../core/brush'
import type { Dab, Rect } from '../core/types'
import { clampToCanvas, dabBounds, unionRect } from '../core/geometry'
import type { DabEx } from '../core/dynamics'
import { getTextureDef } from '../brush/textures'
import type { Document } from '../doc/document'
import type { Layer } from '../doc/layer'
import type { PixelEdit } from '../doc/pixelEdit'
import { GPU, Program, Surface } from './gpu'
import { bindClipMask } from './clipMask'
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
  surface: Surface
}

/** Set the STROKE_CHUNK uniforms (shared by compositor & commit passes). */
export function setStrokeUniforms(gpu: GPU, p: Program, live: LiveStroke | null, alphaLock: boolean): void {
  bindClipMask(gpu, p)
  if (live) {
    gpu.bindTex(1, live.surface.tex)
    p.i('uStroke', 1).i('uStrokeMode', live.mode).f('uStrokeOpacity', live.opacity).f('uWet', live.wet).f('uAlphaLock', alphaLock ? 1 : 0)
  } else {
    gpu.bindTex(1, gpu.blank)
    p.i('uStroke', 1).i('uStrokeMode', 0).f('uStrokeOpacity', 1).f('uWet', 0).f('uAlphaLock', 0)
  }
}

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

  constructor(private gpu: GPU, doc: Document) {
    this.gl = gpu.gl
    this.doc = doc
    this.texCache = texCaches.get(gpu) ?? texCaches.set(gpu, new Map()).get(gpu)!
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
    this.A = this.gpu.surface(this.doc.width, this.doc.height, 'rgba16f')
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
      surface: this.needFinal ? this.C! : this.A
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
    const b = params.preset
    const mode = params.mode
    this.kind = mode === 'smudge' ? 'smudge' : mode === 'paint' && isBlendingMode(b.render.mode) ? 'mix' : 'stamp'
    const dual = mode !== 'smudge' && b.dual.enabled && !!b.dual.brush
    this.needFinal = this.kind === 'stamp' && (dual || b.wetEdge > 0 || b.render.burnt > 0 || b.render.alphaThreshold > 0)
    this.directBlend = this.kind === 'stamp' && mode === 'paint' && (b.render.blendMode !== 'normal' || b.render.luminance)
    const gpu = this.gpu
    if (dual && !this.B) this.B = gpu.surface(this.doc.width, this.doc.height, 'rgba16f')
    if (this.needFinal && !this.C) this.C = gpu.surface(this.doc.width, this.doc.height, 'rgba16f')
    if (this.kind === 'smudge') this.edit = this.doc.beginPixelEdit(layer, 'Smudge')
    else if (this.kind === 'mix') {
      this.edit = this.doc.beginPixelEdit(layer, 'Brush stroke')
      this.initLoad(params.color)
    } else if (this.directBlend) {
      this.edit = this.doc.beginPixelEdit(layer, 'Brush stroke')
      if (!this.base) this.base = gpu.surface(this.doc.width, this.doc.height, layer.surface.fmt)
      gpu.blit(layer.surface, { x: 0, y: 0, w: this.doc.width, h: this.doc.height }, this.base, 0, 0)
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
    p.v2('uCanvas', this.doc.width, this.doc.height).i('uMode', mode)
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
    bindClipMask(gpu, p)
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

  private upload(dabs: DabEx[], from: number, n: number): void {
    const d = this.data
    const c = this.params!.color
    for (let i = 0; i < n; i++) {
      const s = dabs[from + i]
      const o = i * FLOATS_PER_DAB
      d[o] = s.x
      d[o + 1] = s.y
      d[o + 2] = s.size
      d[o + 3] = s.angle
      d[o + 4] = s.alpha
      d[o + 5] = s.roundness
      d[o + 6] = s.px
      d[o + 7] = s.py
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
        lp.i('uSrc', 3).i('uLoad', 5).v2('uCanvas', this.doc.width, this.doc.height).v3('uPos', d.x, d.y, d.size * 0.5)
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
    if (!layer) return
    const p = this.commitProg.use()
    gpu.bindTex(0, layer.surface.tex)
    p.i('uSrc', 0).f('uDither', 0)
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
      const dirty = this.edit?.finish() ?? null
      if (dirty) result = { layerId: layer.id, rect: dirty, mode: params.mode }
    } else if (rect) {
      const label = params.mode === 'erase' ? 'Erase' : 'Brush stroke'
      const edit = doc.beginPixelEdit(layer, label)
      edit.save(rect)
      gpu.blit(layer.surface, rect, doc.scratch, rect.x, rect.y)
      const p = this.commitProg.use()
      gpu.bindTex(0, doc.scratch.tex)
      p.i('uSrc', 0).f('uDither', layer.surface.fmt === 'rgba8' ? 1 : 0)
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

  private clearBuffers(rect: Rect | null): void {
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
    this.layer = null
    this.params = null
    this.edit = null
    this.liveRect = null
    this.kind = 'stamp'
    this.needFinal = false
    this.directBlend = false
  }

  dispose(): void {
    this.A.dispose()
    this.B?.dispose()
    this.C?.dispose()
    this.base?.dispose()
    this.loads?.forEach((s) => s.dispose())
  }
}
