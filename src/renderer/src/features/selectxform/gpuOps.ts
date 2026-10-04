import type { Rect } from '../../core/types'
import type { GPU, Surface } from '../../gl/gpu'
import { FS_VERT } from '../../gl/gpu'
import { bindClipMask, CLIP_CHUNK } from '../../gl/clipMask'
import type { Mesh } from './xformMath'

export type Interp = 'nearest' | 'bilinear' | 'bicubic'

// ---------------------------------------------------------------- shaders
/** layer -> layer with the selection applied: mode 0 = clear selected, 1 = fill colour over selected. */
const MASKED_FS = `#version 300 es
precision highp float;
uniform sampler2D uSrc;
uniform vec2 uCanvas;
uniform int uMode;
uniform vec3 uColor;
uniform float uAlphaLock;
${CLIP_CHUNK}
in vec2 vUv;
out vec4 o;
void main(){
  vec4 L = texelFetch(uSrc, ivec2(gl_FragCoord.xy), 0);
  float m = selCov(vUv);
  if (uMode == 0) { o = uAlphaLock > 0.5 ? L : L * (1.0 - m); return; }
  if (uAlphaLock > 0.5) { o = vec4(mix(L.rgb, uColor * L.a, m), L.a); return; }
  o = vec4(uColor * m, m) + L * (1.0 - m);
}`

/** Lift: copy a rect of a layer (times selection coverage) into a padded float surface. */
const EXTRACT_FS = `#version 300 es
precision highp float;
uniform sampler2D uSrc;
uniform vec2 uCanvas;
uniform vec2 uOrigin;   // doc px of the float's content origin
uniform vec2 uBox;      // content size
uniform float uPad;
uniform float uMaskOut; // 1: output the coverage itself (premultiplied white)
${CLIP_CHUNK}
in vec2 vUv;
out vec4 o;
void main(){
  vec2 q = gl_FragCoord.xy - vec2(uPad);
  if (q.x < 0.0 || q.y < 0.0 || q.x >= uBox.x || q.y >= uBox.y) { o = vec4(0.0); return; }
  vec2 d = q + uOrigin;
  if (d.x < 0.0 || d.y < 0.0 || d.x >= uCanvas.x || d.y >= uCanvas.y) { o = vec4(0.0); return; }
  float m = selCov(d / uCanvas);
  if (uMaskOut > 0.5) { o = vec4(m); return; }
  o = texelFetch(uSrc, ivec2(d), 0) * m;
}`

/** Layer minus selection coverage (source is a copy of the original layer). */
const REMOVE_FS = `#version 300 es
precision highp float;
uniform sampler2D uSrc;
uniform vec2 uCanvas;
${CLIP_CHUNK}
in vec2 vUv;
out vec4 o;
void main(){
  vec4 L = texelFetch(uSrc, ivec2(gl_FragCoord.xy), 0);
  o = L * (1.0 - selCov(vUv));
}`

const MESH_VS = `#version 300 es
precision highp float;
layout(location = 0) in vec4 aV; // dest x, y (doc px), source u, v (0..1)
uniform vec2 uCanvas;
uniform vec2 uBox;
uniform float uPad;
out vec2 vT;
void main(){
  vT = vec2(uPad) + aV.zw * uBox;
  gl_Position = vec4(aV.xy / uCanvas * 2.0 - 1.0, 0.0, 1.0);
}`

const MESH_FS = `#version 300 es
precision highp float;
uniform sampler2D uTex;
uniform ivec2 uSize;
uniform int uInterp; // 0 nearest, 1 bilinear, 2 bicubic
in vec2 vT;
out vec4 o;
vec4 fetch(ivec2 p){ return texelFetch(uTex, clamp(p, ivec2(0), uSize - 1), 0); }
vec4 sNearest(vec2 t){ return fetch(ivec2(floor(t))); }
vec4 sLinear(vec2 t){
  vec2 c = t - 0.5;
  ivec2 i = ivec2(floor(c));
  vec2 f = c - vec2(i);
  return mix(mix(fetch(i), fetch(i + ivec2(1, 0)), f.x), mix(fetch(i + ivec2(0, 1)), fetch(i + ivec2(1, 1)), f.x), f.y);
}
vec4 cubicW(float f){
  float f2 = f * f, f3 = f2 * f;
  return vec4(-0.5 * f3 + f2 - 0.5 * f, 1.5 * f3 - 2.5 * f2 + 1.0, -1.5 * f3 + 2.0 * f2 + 0.5 * f, 0.5 * f3 - 0.5 * f2);
}
vec4 sCubic(vec2 t){
  vec2 c = t - 0.5;
  ivec2 i = ivec2(floor(c));
  vec2 f = c - vec2(i);
  vec4 wx = cubicW(f.x), wy = cubicW(f.y);
  vec4 acc = vec4(0.0);
  for (int j = 0; j < 4; j++) {
    vec4 row = fetch(i + ivec2(-1, j - 1)) * wx.x + fetch(i + ivec2(0, j - 1)) * wx.y + fetch(i + ivec2(1, j - 1)) * wx.z + fetch(i + ivec2(2, j - 1)) * wx.w;
    acc += row * wy[j];
  }
  float a = clamp(acc.a, 0.0, 1.0);
  return vec4(clamp(acc.rgb, 0.0, a), a);
}
vec4 samp(vec2 t){
  if (uInterp == 0) return sNearest(t);
  if (uInterp == 1) return sLinear(t);
  return sCubic(t);
}
void main(){
  vec2 dx = dFdx(vT), dy = dFdy(vT);
  float sc = max(length(dx), length(dy));
  int n = int(clamp(ceil(sc - 0.25), 1.0, 6.0));
  if (n <= 1) { o = samp(vT); return; }
  vec4 acc = vec4(0.0);
  for (int j = 0; j < 6; j++) {
    if (j >= n) break;
    for (int i = 0; i < 6; i++) {
      if (i >= n) break;
      vec2 off = (vec2(float(i), float(j)) + 0.5) / float(n) - 0.5;
      acc += samp(vT + dx * off.x + dy * off.y);
    }
  }
  o = acc / float(n * n);
}`

// ---------------------------------------------------------------- helpers
export interface MaskedOpParams {
  mode: 'clear' | 'fill'
  color?: [number, number, number]
  alphaLock?: boolean
}

/** Apply clear/fill to `layer` inside `rect`, respecting the global selection mask. `scratch` = doc scratch surface. */
export function maskedOp(gpu: GPU, layer: Surface, scratch: Surface, rect: Rect, p: MaskedOpParams): void {
  const gl = gpu.gl
  gpu.blit(layer, rect, scratch, rect.x, rect.y)
  const prog = gpu.program('sx:masked', FS_VERT, MASKED_FS).use()
  gpu.bindTex(0, scratch.tex)
  prog.i('uSrc', 0).v2('uCanvas', layer.w, layer.h).i('uMode', p.mode === 'clear' ? 0 : 1)
  const c = p.color ?? [0, 0, 0]
  prog.v3('uColor', c[0], c[1], c[2]).f('uAlphaLock', p.alphaLock ? 1 : 0)
  bindClipMask(gpu, prog)
  gl.disable(gl.BLEND)
  gpu.bindTarget(layer, rect)
  gpu.fullscreen()
  gl.disable(gl.SCISSOR_TEST)
}

/** Copy `rect` of `src` (x selection coverage if any) into a new padded surface. `asMask` outputs coverage only. */
export function extractFloat(gpu: GPU, src: Surface, rect: Rect, pad: number, asMask: boolean, useMask: boolean): Surface {
  const gl = gpu.gl
  const fmt = asMask ? 'rgba8' : src.fmt
  const out = gpu.surface(rect.w + pad * 2, rect.h + pad * 2, fmt, 0)
  const prog = gpu.program('sx:extract', FS_VERT, EXTRACT_FS).use()
  gpu.bindTex(0, src.tex)
  prog.i('uSrc', 0).v2('uCanvas', src.w, src.h).v2('uOrigin', rect.x, rect.y).v2('uBox', rect.w, rect.h).f('uPad', pad).f('uMaskOut', asMask ? 1 : 0)
  if (useMask) bindClipMask(gpu, prog)
  else {
    gpu.bindTex(4, gpu.blank)
    prog.i('uSelMask', 4).f('uSelOn', 0)
  }
  gl.disable(gl.BLEND)
  gpu.bindTarget(out, null)
  gpu.fullscreen()
  return out
}

/** dst rect := orig rect * (1 - selection coverage). */
export function removeSelected(gpu: GPU, orig: Surface, dst: Surface, rect: Rect, useMask: boolean): void {
  const gl = gpu.gl
  gl.disable(gl.BLEND)
  gpu.bindTarget(dst, rect)
  if (!useMask) {
    gl.clearColor(0, 0, 0, 0)
    gl.clear(gl.COLOR_BUFFER_BIT)
    gl.disable(gl.SCISSOR_TEST)
    return
  }
  const prog = gpu.program('sx:remove', FS_VERT, REMOVE_FS).use()
  gpu.bindTex(0, orig.tex)
  prog.i('uSrc', 0).v2('uCanvas', orig.w, orig.h)
  bindClipMask(gpu, prog)
  gpu.fullscreen()
  gl.disable(gl.SCISSOR_TEST)
}

/** Draws transform meshes. */
export class MeshRenderer {
  private vao: WebGLVertexArrayObject
  private vbo: WebGLBuffer
  private ibo: WebGLBuffer
  constructor(private gpu: GPU) {
    const gl = gpu.gl
    this.vao = gl.createVertexArray()!
    this.vbo = gl.createBuffer()!
    this.ibo = gl.createBuffer()!
    gl.bindVertexArray(this.vao)
    gl.bindBuffer(gl.ARRAY_BUFFER, this.vbo)
    gl.enableVertexAttribArray(0)
    gl.vertexAttribPointer(0, 4, gl.FLOAT, false, 16, 0)
    gl.bindBuffer(gl.ELEMENT_ARRAY_BUFFER, this.ibo)
    gl.bindVertexArray(null)
  }

  /** Draw `mesh` sampling `src` (padded float surface, content box `box`) over `target` inside `scissor` (premultiplied over). */
  draw(target: Surface, scissor: Rect, mesh: Mesh, src: Surface, box: { w: number; h: number }, pad: number, interp: Interp): void {
    const gl = this.gpu.gl
    const gpu = this.gpu
    const prog = gpu.program('sx:mesh', MESH_VS, MESH_FS).use()
    gpu.bindTex(0, src.tex)
    prog.i('uTex', 0).v2('uCanvas', target.w, target.h).v2('uBox', box.w, box.h).f('uPad', pad)
    gl.uniform2i(prog.loc('uSize'), src.w, src.h)
    prog.i('uInterp', interp === 'nearest' ? 0 : interp === 'bilinear' ? 1 : 2)
    gpu.bindTarget(target, scissor)
    gl.enable(gl.BLEND)
    gl.blendFunc(gl.ONE, gl.ONE_MINUS_SRC_ALPHA)
    gl.bindVertexArray(this.vao)
    gl.bindBuffer(gl.ARRAY_BUFFER, this.vbo)
    gl.bufferData(gl.ARRAY_BUFFER, mesh.verts, gl.DYNAMIC_DRAW)
    gl.bindBuffer(gl.ELEMENT_ARRAY_BUFFER, this.ibo)
    gl.bufferData(gl.ELEMENT_ARRAY_BUFFER, mesh.indices, gl.DYNAMIC_DRAW)
    gl.drawElements(gl.TRIANGLES, mesh.indices.length, gl.UNSIGNED_INT, 0)
    gl.bindVertexArray(null)
    gl.disable(gl.BLEND)
    gl.disable(gl.SCISSOR_TEST)
  }

  dispose(): void {
    const gl = this.gpu.gl
    gl.deleteVertexArray(this.vao)
    gl.deleteBuffer(this.vbo)
    gl.deleteBuffer(this.ibo)
  }
}

/** Raw red channel of an RGBA8 surface rect (top-to-bottom rows). */
export function readRedChannel(gpu: GPU, s: Surface, rect: Rect): Uint8Array {
  const gl = gpu.gl
  const out = new Uint8Array(rect.w * rect.h)
  gl.bindFramebuffer(gl.FRAMEBUFFER, s.fbo)
  const CH = 256
  for (let y0 = 0; y0 < rect.h; y0 += CH) {
    const h = Math.min(CH, rect.h - y0)
    const u = new Uint8Array(rect.w * h * 4)
    gl.readPixels(rect.x, rect.y + y0, rect.w, h, gl.RGBA, gl.UNSIGNED_BYTE, u)
    for (let i = 0, o = y0 * rect.w; i < u.length; i += 4, o++) out[o] = u[i]
  }
  return out
}
