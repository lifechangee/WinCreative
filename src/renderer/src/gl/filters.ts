import { has, t } from '../i18n'
import type { Document } from '../doc/document'
import type { Rect } from '../core/types'
import { GPU, PixFormat, Surface } from './gpu'
import { bindClipMask } from './clipMask'
import { FS_VERT, filterFragment } from './shaders'

/**
 * Adjustment / filter extension point.
 * A filter supplies GLSL defining `vec4 filterPixel(vec4 premult, vec2 uv)` and optional float uniforms.
 * The runner applies it to the active layer with a tile-based undo step and a commit event.
 * (The full interactive adjustments live in features/adjustments and are built on the `FX` toolkit below.)
 */
export interface LayerFilter {
  id: string
  name: string
  /** GLSL body defining filterPixel(); may use uniforms `uSrc`, `uCanvas`, and float uniforms in `params`. */
  glsl: string
  /** default float uniform values (declare them yourself in glsl: `uniform float uAmount;`) */
  params?: Record<string, number>
}

const filters = new Map<string, LayerFilter>()
export const registerFilter = (f: LayerFilter): void => void filters.set(f.id, f)
export const listFilters = (): LayerFilter[] => [...filters.values()]

export function applyFilter(doc: Document, filterId: string, params: Record<string, number> = {}): boolean {
  const f = filters.get(filterId)
  const layer = doc.activeLayer
  if (!f || !layer || layer.locked) return false
  const gpu = doc.gpu
  const full = { x: 0, y: 0, w: doc.width, h: doc.height }
  const edit = doc.beginPixelEdit(layer, f.name)
  edit.save(full)
  gpu.blit(layer.surface, full, doc.scratch, 0, 0)
  const p = gpu.program('filter:' + f.id, FS_VERT, filterFragment(f.glsl)).use()
  gpu.bindTex(0, doc.scratch.tex)
  p.i('uSrc', 0).v2('uCanvas', doc.width, doc.height)
  bindClipMask(gpu, p) // adjustments are limited to the selection
  for (const [k, v] of Object.entries({ ...f.params, ...params })) p.f(k, v)
  gpu.gl.disable(gpu.gl.BLEND)
  gpu.bindTarget(layer.surface, null)
  gpu.fullscreen()
  const dirty = edit.finish()
  doc.emitCommit('filter', layer.id, dirty, f.name)
  return true
}

export function registerBuiltinFilters(): void {
  registerFilter({
    id: 'invert',
    name: 'Invert',
    glsl: `vec4 filterPixel(vec4 c, vec2 uv){ return vec4((vec3(c.a) - c.rgb), c.a); }`
  })
  registerFilter({
    id: 'desaturate',
    name: 'Desaturate',
    glsl: `vec4 filterPixel(vec4 c, vec2 uv){ float l = dot(c.rgb, vec3(0.3, 0.59, 0.11)); return vec4(vec3(l), c.a); }`
  })
  registerFilter({
    id: 'brightness',
    name: 'Brighten +15%',
    glsl: `uniform float uAmount; vec4 filterPixel(vec4 c, vec2 uv){ return vec4(min(c.rgb + c.a * uAmount, c.a), c.a); }`,
    params: { uAmount: 0.15 }
  })
}

// =====================================================================================================
// FX toolkit: multi-pass full-canvas effects on Surfaces (used by features/adjustments)
// =====================================================================================================

/** Shared GLSL helpers available to every FX pass (`unp`, `pre`, `lum`, hsv, hashes, noise, ...). */
export const FX_LIB = `
vec3 unp(vec4 c){ return c.a > 1e-5 ? c.rgb / c.a : vec3(0.0); }
vec4 pre(vec3 c, float a){ return vec4(c * a, a); }
float lum(vec3 c){ return dot(c, vec3(0.3, 0.59, 0.11)); }
vec3 rgb2hsv(vec3 c){
  vec4 K = vec4(0.0, -1.0/3.0, 2.0/3.0, -1.0);
  vec4 p = mix(vec4(c.bg, K.wz), vec4(c.gb, K.xy), step(c.b, c.g));
  vec4 q = mix(vec4(p.xyw, c.r), vec4(c.r, p.yzx), step(p.x, c.r));
  float d = q.x - min(q.w, q.y);
  return vec3(abs(q.z + (q.w - q.y) / (6.0 * d + 1e-10)), d / (q.x + 1e-10), q.x);
}
vec3 hsv2rgb(vec3 c){
  vec4 K = vec4(1.0, 2.0/3.0, 1.0/3.0, 3.0);
  vec3 p = abs(fract(c.xxx + K.xyz) * 6.0 - K.www);
  return c.z * mix(K.xxx, clamp(p - K.xxx, 0.0, 1.0), c.y);
}
float hash21(vec2 p){ p = fract(p * vec2(123.34, 456.21)); p += dot(p, p + 45.32); return fract(p.x * p.y); }
vec2 hash22(vec2 p){ return vec2(hash21(p), hash21(p + 17.31)); }
float hash11(float p){ p = fract(p * 0.1031); p *= p + 33.33; p *= p + p; return fract(p); }
vec2 grad2(vec2 i){ float a = hash21(i) * 6.2831853; return vec2(cos(a), sin(a)); }
float pnoise(vec2 p){
  vec2 i = floor(p), f = fract(p);
  vec2 u = f * f * f * (f * (f * 6.0 - 15.0) + 10.0);
  float a = dot(grad2(i), f);
  float b = dot(grad2(i + vec2(1.0, 0.0)), f - vec2(1.0, 0.0));
  float c = dot(grad2(i + vec2(0.0, 1.0)), f - vec2(0.0, 1.0));
  float d = dot(grad2(i + vec2(1.0, 1.0)), f - vec2(1.0, 1.0));
  return mix(mix(a, b, u.x), mix(c, d, u.x), u.y) * 1.4142; // about -1..1
}
`

export type Uniforms = Record<string, number | number[]>
export type TexInput = Surface | WebGLTexture | null | undefined

export interface PassOpts {
  /** bound to samplers uT0..uT3 */
  tex?: TexInput[]
  u?: Uniforms
  /** scissor rectangle in target pixels */
  rect?: Rect | null
}

const FX_HEAD = `#version 300 es
precision highp float;
uniform vec2 uCanvas;   // document size in px
uniform vec2 uSize;     // target size in px
uniform sampler2D uT0;
uniform sampler2D uT1;
uniform sampler2D uT2;
uniform sampler2D uT3;
in vec2 vUv;
out vec4 o;
${FX_LIB}
`

/**
 * Multi-pass GPU effect runner. All surfaces are premultiplied; `pass()` draws a fragment body that
 * defines `vec4 fx()` into a target (optionally scissored). Temporaries are pooled per size.
 */
export class FX {
  private free_ = new Map<string, Surface[]>()
  private all = new Set<Surface>()
  readonly maxDim: number

  constructor(
    readonly gpu: GPU,
    readonly w: number,
    readonly h: number,
    readonly fmt: PixFormat
  ) {
    this.maxDim = Math.max(w, h)
  }

  /** Borrow a temporary surface (default: canvas size). Return it with free(). */
  tmp(w = this.w, h = this.h): Surface {
    const key = w + 'x' + h
    const list = this.free_.get(key)
    if (list && list.length) return list.pop()!
    const s = this.gpu.surface(w, h, this.fmt)
    this.all.add(s)
    return s
  }
  free(...ss: Surface[]): void {
    for (const s of ss) {
      const key = s.w + 'x' + s.h
      const l = this.free_.get(key) ?? []
      l.push(s)
      this.free_.set(key, l)
    }
  }
  dispose(): void {
    for (const s of this.all) s.dispose()
    this.all.clear()
    this.free_.clear()
    for (const t of this.luts.values()) this.gpu.gl.deleteTexture(t)
    this.luts.clear()
  }

  private luts = new Map<string, WebGLTexture>()
  /** (Re)upload a 256x1 RGBA8 lookup texture, cached by key. */
  lut(key: string, data: Uint8Array): WebGLTexture {
    const gl = this.gpu.gl
    let t = this.luts.get(key)
    if (!t) {
      t = gl.createTexture()!
      gl.bindTexture(gl.TEXTURE_2D, t)
      gl.texStorage2D(gl.TEXTURE_2D, 1, gl.RGBA8, data.length / 4, 1)
      gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MIN_FILTER, gl.LINEAR)
      gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MAG_FILTER, gl.LINEAR)
      gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_S, gl.CLAMP_TO_EDGE)
      gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_T, gl.CLAMP_TO_EDGE)
      this.luts.set(key, t)
    }
    gl.bindTexture(gl.TEXTURE_2D, t)
    gl.texSubImage2D(gl.TEXTURE_2D, 0, 0, 0, data.length / 4, 1, gl.RGBA, gl.UNSIGNED_BYTE, data)
    return t
  }

  pass(key: string, body: string, target: Surface, opts: PassOpts = {}): void {
    const gpu = this.gpu
    const gl = gpu.gl
    const p = gpu.program('fx:' + key, FS_VERT, FX_HEAD + body + '\nvoid main(){ o = fx(); }').use()
    const tex = opts.tex ?? []
    for (let i = 0; i < 4; i++) {
      const t = tex[i]
      gpu.bindTex(i, t ? (t instanceof Surface ? t.tex : t) : gpu.blank)
      p.i('uT' + i, i)
    }
    p.v2('uCanvas', this.w, this.h).v2('uSize', target.w, target.h)
    if (opts.u) {
      for (const [k, v] of Object.entries(opts.u)) {
        if (typeof v === 'number') p.f(k, v)
        else if (v.length === 2) p.v2(k, v[0], v[1])
        else if (v.length === 3) p.v3(k, v[0], v[1], v[2])
        else p.v4(k, v[0], v[1], v[2], v[3])
      }
    }
    gl.disable(gl.BLEND)
    gpu.bindTarget(target, opts.rect ?? null)
    gpu.fullscreen()
    gl.disable(gl.SCISSOR_TEST)
  }

  /** Copy with resampling (bilinear) between surfaces of any size. */
  resample(src: Surface, dst: Surface): void {
    this.pass('copy', `vec4 fx(){ return texture(uT0, vUv); }`, dst, { tex: [src] })
  }

  /** Separable Gaussian blur; sigma in px of `src`. Large sigmas run on a downsampled chain. */
  blur(src: Surface, dst: Surface, sigma: number): void {
    if (sigma < 0.05) {
      this.gpu.blit(src, { x: 0, y: 0, w: src.w, h: src.h }, dst, 0, 0)
      return
    }
    let scale = 1
    while (sigma / scale > 6 && scale < 64) scale *= 2
    const w = Math.max(1, Math.ceil(this.w / scale))
    const h = Math.max(1, Math.ceil(this.h / scale))
    let cur = src
    const temps: Surface[] = []
    // downsample chain (x2 each) with a 4-tap box
    for (let s = 2; s <= scale; s *= 2) {
      const t = this.tmp(Math.max(1, Math.ceil(this.w / s)), Math.max(1, Math.ceil(this.h / s)))
      temps.push(t)
      this.pass(
        'down',
        `uniform vec2 uInv; vec4 fx(){ vec2 d = uInv * 0.5; return 0.25 * (texture(uT0, vUv + vec2(-d.x, -d.y)) + texture(uT0, vUv + vec2(d.x, -d.y)) + texture(uT0, vUv + vec2(-d.x, d.y)) + texture(uT0, vUv + vec2(d.x, d.y))); }`,
        t,
        { tex: [cur], u: { uInv: [1 / cur.w, 1 / cur.h] } }
      )
      cur = t
    }
    const sg = sigma / scale
    const R = Math.min(40, Math.ceil(sg * 3))
    const a = this.tmp(w, h)
    const b = this.tmp(w, h)
    const body = `uniform vec2 uDir; uniform float uSigma; uniform float uR;
      vec4 fx(){ float s2 = 2.0 * uSigma * uSigma; vec4 acc = vec4(0.0); float ws = 0.0;
        for (int i = -40; i <= 40; i++) { float fi = float(i); if (abs(fi) > uR) continue; float wt = exp(-fi * fi / s2); acc += wt * texture(uT0, vUv + uDir * fi); ws += wt; }
        return acc / ws; }`
    this.pass('blur1d', body, a, { tex: [cur], u: { uDir: [1 / w, 0], uSigma: sg, uR: R } })
    if (scale === 1) {
      this.pass('blur1d', body, dst, { tex: [a], u: { uDir: [0, 1 / h], uSigma: sg, uR: R } })
    } else {
      this.pass('blur1d', body, b, { tex: [a], u: { uDir: [0, 1 / h], uSigma: sg, uR: R } })
      this.resample(b, dst)
    }
    this.free(a, b, ...temps)
  }
}

/** Display name of a layer filter (built-in ones are translated by id). */
export const filterName = (f: { id: string; name: string }): string => (has('core.filter.' + f.id) ? t('core.filter.' + f.id) : f.name)
