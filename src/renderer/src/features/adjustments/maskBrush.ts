import { getTextureDef } from '../../brush/textures'
import type { BrushPreset } from '../../core/brush'
import { clampToCanvas, dabBounds, unionRect } from '../../core/geometry'
import type { Dab, Rect } from '../../core/types'
import type { Layer } from '../../doc/layer'
import type { FX } from '../../gl/filters'
import type { GPU, Program, Surface } from '../../gl/gpu'

// Local copy of the basic dab shaders so Pencil-mode masks are independent of brush-engine shader changes.
const DAB_VS = `#version 300 es
precision highp float;
in vec4 aA; in vec4 aB;
uniform vec2 uCanvas;
out vec2 vLocal; out float vRad; out float vAlpha; out float vRho; out vec2 vWorld;
void main(){
  vec2 c = vec2(float(gl_VertexID & 1), float((gl_VertexID >> 1) & 1)) * 2.0 - 1.0;
  float R = aA.z * 0.5; float rho = aB.y;
  vec2 local = vec2(c.x * (R + 1.5), c.y * (R * rho + 1.5));
  float ca = cos(aA.w), sa = sin(aA.w);
  vec2 w = aA.xy + vec2(ca * local.x - sa * local.y, sa * local.x + ca * local.y);
  vLocal = local; vRad = R; vAlpha = aB.x; vRho = rho; vWorld = w;
  gl_Position = vec4(w / uCanvas * 2.0 - 1.0, 0.0, 1.0);
}`
const DAB_FS = `#version 300 es
precision highp float;
uniform float uHardness;
uniform int uHasTip; uniform sampler2D uTip;
uniform int uHasGrain; uniform sampler2D uGrain; uniform vec4 uGrainP;
in vec2 vLocal; in float vRad; in float vAlpha; in float vRho; in vec2 vWorld;
out vec4 o;
void main(){
  vec2 q = vec2(vLocal.x, vLocal.y / vRho);
  float a;
  if (uHasTip == 1) { a = texture(uTip, q / vRad * 0.5 + 0.5).r; a *= 1.0 - smoothstep(vRad * 0.94, vRad * 1.02, length(q)); }
  else { float w = max(vRad * (1.0 - uHardness), 1.0); float t = clamp((vRad + 0.5 - length(q)) / w, 0.0, 1.0); a = t * t * (3.0 - 2.0 * t); }
  a *= min(1.0, 4.0 * vRad * vRad);
  if (uHasGrain == 1) { vec2 gp = uGrainP.z > 0.5 ? (q / (uGrainP.x * uGrainP.w) + 0.5) : vWorld / (uGrainP.x * uGrainP.w); a *= mix(1.0, texture(uGrain, gp).r, uGrainP.y); }
  a *= vAlpha;
  o = vec4(a);
}`

const TILE = 256

/** Lazy tile snapshots of a surface so a change can be reverted (session-local undo). */
export class TileSnap {
  private tiles = new Map<number, { x: number; y: number; w: number; h: number; s: Surface }>()
  constructor(
    private gpu: GPU,
    private surf: Surface
  ) {}
  save(rect: Rect): void {
    const W = this.surf.w
    const H = this.surf.h
    const x0 = Math.max(0, Math.floor(rect.x))
    const y0 = Math.max(0, Math.floor(rect.y))
    const x1 = Math.min(W, Math.ceil(rect.x + rect.w))
    const y1 = Math.min(H, Math.ceil(rect.y + rect.h))
    if (x1 <= x0 || y1 <= y0) return
    const cols = Math.ceil(W / TILE)
    for (let ty = Math.floor(y0 / TILE); ty <= Math.floor((y1 - 1) / TILE); ty++)
      for (let tx = Math.floor(x0 / TILE); tx <= Math.floor((x1 - 1) / TILE); tx++) {
        const key = ty * cols + tx
        if (this.tiles.has(key)) continue
        const x = tx * TILE
        const y = ty * TILE
        const w = Math.min(TILE, W - x)
        const h = Math.min(TILE, H - y)
        const s = this.gpu.surface(w, h, this.surf.fmt, 0)
        this.gpu.blit(this.surf, { x, y, w, h }, s, 0, 0)
        this.tiles.set(key, { x, y, w, h, s })
      }
  }
  get empty(): boolean {
    return this.tiles.size === 0
  }
  /** Copy the saved tiles back; returns the affected bounds. */
  restore(): Rect | null {
    let r: Rect | null = null
    for (const t of this.tiles.values()) {
      this.gpu.blit(t.s, { x: 0, y: 0, w: t.w, h: t.h }, this.surf, t.x, t.y)
      r = unionRect(r, { x: t.x, y: t.y, w: t.w, h: t.h })
    }
    return r
  }
  dispose(): void {
    for (const t of this.tiles.values()) t.s.dispose()
    this.tiles.clear()
  }
}

export interface MaskStrokeParams {
  mode: 'paint' | 'erase' | 'smudge'
  preset: BrushPreset
  color: [number, number, number]
  opacity: number
}

const MAX_BATCH = 4096
const FLOATS = 8

/**
 * A stand-in for BrushEngine that paints a single-channel coverage mask (Pencil mode of adjustments).
 * Implements the subset of BrushEngine that PaintTool uses (begin / stamp / end / cancel), so the very same
 * brush pipeline (smoothing, dynamics, spacing, tips, grain, pressure) drives it. Coverage lives in `view`
 * (.a channel, RGBA16F); `view` always equals the committed mask plus the in-progress stroke.
 */
export class MaskEngine {
  readonly stroke: Surface
  /** committed coverage */
  readonly mask: Surface
  /** committed + live coverage (what adjustments read) */
  readonly view: Surface
  /** called with the rect whose coverage changed (during and after strokes, undo, clear) */
  onDirty: (r: Rect) => void = () => {}
  /** called after a stroke was merged: rect + mode */
  onEnd: (r: Rect, mode: string) => void = () => {}
  private dabProg: Program
  private vao: WebGLVertexArrayObject
  private vbo: WebGLBuffer
  private data = new Float32Array(MAX_BATCH * FLOATS)
  private texCache = new Map<string, WebGLTexture>()
  private params: MaskStrokeParams | null = null
  private layer: Layer | null = null
  private liveRect: Rect | null = null
  private history: TileSnap[] = []
  /** true when anything has been painted (mask may be non-empty) */
  painted = false
  /** number of strokes merged so far */
  strokes = 0
  /** total painted bounds (for scissoring the final apply) */
  bounds: Rect | null = null

  constructor(
    private gpu: GPU,
    private fx: FX,
    private w: number,
    private h: number
  ) {
    this.stroke = gpu.surface(w, h, 'rgba16f')
    this.mask = gpu.surface(w, h, 'rgba16f')
    this.view = gpu.surface(w, h, 'rgba16f')
    this.dabProg = gpu.program('adj-dab', DAB_VS, DAB_FS)
    const gl = gpu.gl
    this.vao = gl.createVertexArray()!
    this.vbo = gl.createBuffer()!
    gl.bindVertexArray(this.vao)
    gl.bindBuffer(gl.ARRAY_BUFFER, this.vbo)
    const aA = gl.getAttribLocation(this.dabProg.prog, 'aA')
    const aB = gl.getAttribLocation(this.dabProg.prog, 'aB')
    gl.enableVertexAttribArray(aA)
    gl.vertexAttribPointer(aA, 4, gl.FLOAT, false, FLOATS * 4, 0)
    gl.vertexAttribDivisor(aA, 1)
    gl.enableVertexAttribArray(aB)
    gl.vertexAttribPointer(aB, 4, gl.FLOAT, false, FLOATS * 4, 16)
    gl.vertexAttribDivisor(aB, 1)
    gl.bindVertexArray(null)
  }

  get active(): boolean {
    return this.layer !== null
  }
  get canUndo(): boolean {
    return this.history.length > 0
  }

  // ---- BrushEngine-compatible surface used by PaintTool
  begin(layer: Layer, params: MaskStrokeParams): void {
    this.layer = layer
    this.params = params
    this.liveRect = null
  }

  private tex(id: string | null): WebGLTexture | null {
    if (!id) return null
    const cached = this.texCache.get(id)
    if (cached) return cached
    const def = getTextureDef(id)
    if (!def) return null
    const gl = this.gpu.gl
    const t = gl.createTexture()!
    const levels = Math.floor(Math.log2(def.size)) + 1
    gl.bindTexture(gl.TEXTURE_2D, t)
    gl.texStorage2D(gl.TEXTURE_2D, levels, gl.R8, def.size, def.size)
    gl.texSubImage2D(gl.TEXTURE_2D, 0, 0, 0, def.size, def.size, gl.RED, gl.UNSIGNED_BYTE, def.data)
    gl.generateMipmap(gl.TEXTURE_2D)
    gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MIN_FILTER, gl.LINEAR_MIPMAP_LINEAR)
    gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MAG_FILTER, gl.LINEAR)
    // grain textures repeat; tips clamp (a texture used as both would need two objects - the tip clamp window hides it)
    gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_S, gl.REPEAT)
    gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_T, gl.REPEAT)
    this.texCache.set(id, t)
    return t
  }

  stamp(dabs: Dab[]): void {
    if (!this.params || !dabs.length) return
    const gpu = this.gpu
    const gl = gpu.gl
    const { preset } = this.params
    const p = this.dabProg.use()
    const tip = this.tex(preset.tipTexture)
    const grain = this.tex(preset.grain.texture)
    p.v2('uCanvas', this.w, this.h).f('uHardness', preset.hardness)
    p.i('uHasTip', tip ? 1 : 0).i('uTip', 1).i('uHasGrain', grain && preset.grain.depth > 0 ? 1 : 0).i('uGrain', 2)
    const gdef = getTextureDef(preset.grain.texture ?? '')
    p.v4('uGrainP', Math.max(0.05, preset.grain.scale), preset.grain.depth, preset.grain.moving ? 1 : 0, gdef?.size ?? 256)
    gpu.bindTex(1, tip ?? gpu.blank)
    gpu.bindTex(2, grain ?? gpu.blank)
    gpu.bindTex(3, gpu.blank)
    gpu.bindTarget(this.stroke, null)
    gl.enable(gl.BLEND)
    gl.blendFunc(gl.ONE, gl.ONE_MINUS_SRC_ALPHA)
    gl.bindVertexArray(this.vao)
    gl.bindBuffer(gl.ARRAY_BUFFER, this.vbo)
    let bounds: Rect | null = null
    for (let i = 0; i < dabs.length; i += MAX_BATCH) {
      const n = Math.min(MAX_BATCH, dabs.length - i)
      const d = this.data
      for (let k = 0; k < n; k++) {
        const s = dabs[i + k]
        const o = k * FLOATS
        d[o] = s.x
        d[o + 1] = s.y
        d[o + 2] = s.size
        d[o + 3] = s.angle
        d[o + 4] = s.alpha
        d[o + 5] = s.roundness
        d[o + 6] = s.px
        d[o + 7] = s.py
      }
      gl.bufferData(gl.ARRAY_BUFFER, d.subarray(0, n * FLOATS), gl.DYNAMIC_DRAW)
      gl.drawArraysInstanced(gl.TRIANGLE_STRIP, 0, 4, n)
    }
    gl.disable(gl.BLEND)
    gl.bindVertexArray(null)
    for (const d of dabs) bounds = unionRect(bounds, dabBounds(d.x, d.y, d.size, 3))
    const r = bounds && clampToCanvas(bounds, this.w, this.h)
    if (!r) return
    this.liveRect = unionRect(this.liveRect, r)
    this.merge(r)
    this.onDirty(r)
  }

  /** view(rect) = mask (+/-) stroke * opacity */
  private merge(r: Rect): void {
    const p = this.params!
    this.fx.pass(
      'maskMerge',
      `uniform float uCap, uErase;
       vec4 fx(){ float m = texture(uT0, vUv).a; float s = texture(uT1, vUv).a * uCap; float v = uErase > 0.5 ? m * (1.0 - s) : m + s * (1.0 - m); return vec4(v); }`,
      this.view,
      { tex: [this.mask, this.stroke], u: { uCap: p.opacity, uErase: p.mode === 'erase' ? 1 : 0 }, rect: r }
    )
  }

  end(): { layerId: string; rect: Rect; mode: 'paint' | 'erase' | 'smudge' } | null {
    const layer = this.layer
    const params = this.params
    const rect = this.liveRect
    this.layer = null
    this.params = null
    this.liveRect = null
    if (!layer || !params) return null
    if (rect) {
      const snap = new TileSnap(this.gpu, this.mask)
      snap.save(rect)
      this.history.push(snap)
      if (this.history.length > 24) this.history.shift()?.dispose()
      this.gpu.blit(this.view, rect, this.mask, rect.x, rect.y)
      this.gpu.clear(this.stroke, rect)
      this.painted = true
      this.strokes++
      this.bounds = unionRect(this.bounds, rect)
      this.onEnd(rect, params.mode)
      return { layerId: layer.id, rect, mode: params.mode }
    }
    return null
  }

  cancel(): void {
    const r = this.liveRect
    this.layer = null
    this.params = null
    this.liveRect = null
    if (r) {
      this.gpu.clear(this.stroke, r)
      this.gpu.blit(this.mask, r, this.view, r.x, r.y)
      this.onDirty(r)
    }
  }

  // ---- session utilities
  /** Undo the last committed stroke. Returns dirty rect or null. */
  undo(): Rect | null {
    const s = this.history.pop()
    if (!s) return null
    const r = s.restore()
    s.dispose()
    if (r) {
      this.gpu.blit(this.mask, r, this.view, r.x, r.y)
      this.onDirty(r)
    }
    return r
  }

  /** Clear all coverage (undoable). */
  clear(undoable = true): void {
    const full = { x: 0, y: 0, w: this.w, h: this.h }
    if (undoable) {
      const snap = new TileSnap(this.gpu, this.mask)
      snap.save(this.bounds ?? full)
      this.history.push(snap)
    }
    this.gpu.clear(this.mask)
    this.gpu.clear(this.view)
    this.painted = false
    this.onDirty(full)
  }

  /** Wipe committed coverage without history (clone: after baking each stroke). */
  wipe(rect: Rect | null): void {
    this.gpu.clear(this.mask, rect)
    this.gpu.clear(this.view, rect)
    this.history.forEach((h) => h.dispose())
    this.history = []
  }

  dispose(): void {
    this.stroke.dispose()
    this.mask.dispose()
    this.view.dispose()
    this.history.forEach((h) => h.dispose())
    for (const t of this.texCache.values()) this.gpu.gl.deleteTexture(t)
    this.gpu.gl.deleteVertexArray(this.vao)
    this.gpu.gl.deleteBuffer(this.vbo)
  }
}
