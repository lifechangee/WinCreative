import type { Rect } from '../core/types'

export type PixFormat = 'rgba8' | 'rgba16f'

/** A GPU texture + framebuffer pair. Pixel row 0 = document y 0. Content is premultiplied alpha. */
let surfaceUid = 0
export class Surface {
  tex: WebGLTexture
  fbo: WebGLFramebuffer
  /** unique id (cache key for async save) */
  readonly uid = ++surfaceUid
  /** bumped whenever the surface is bound as a render target / blit destination = "pixels may have changed" (save cache) */
  rev = 0
  /** infinite canvas: a layer mask is a 1x1 placeholder surface that owns its sparse tile store (doc/maskStore.ts) */
  inf?: import('../doc/tileStore').TileStore
  constructor(
    private gpu: GPU,
    public w: number,
    public h: number,
    public fmt: PixFormat,
    filter: number = gpuFilterLinear
  ) {
    const gl = gpu.gl
    this.tex = gl.createTexture()!
    gl.bindTexture(gl.TEXTURE_2D, this.tex)
    gl.texStorage2D(gl.TEXTURE_2D, 1, fmt === 'rgba16f' ? gl.RGBA16F : gl.RGBA8, w, h)
    gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MIN_FILTER, filter === gpuFilterLinear ? gl.LINEAR : gl.NEAREST)
    gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MAG_FILTER, filter === gpuFilterLinear ? gl.LINEAR : gl.NEAREST)
    gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_S, gl.CLAMP_TO_EDGE)
    gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_T, gl.CLAMP_TO_EDGE)
    this.fbo = gl.createFramebuffer()!
    gl.bindFramebuffer(gl.FRAMEBUFFER, this.fbo)
    gl.framebufferTexture2D(gl.FRAMEBUFFER, gl.COLOR_ATTACHMENT0, gl.TEXTURE_2D, this.tex, 0)
    gl.clearColor(0, 0, 0, 0)
    gl.clear(gl.COLOR_BUFFER_BIT)
  }
  get bytes(): number {
    return this.w * this.h * (this.fmt === 'rgba16f' ? 8 : 4)
  }
  dispose(): void {
    this.inf?.dispose()
    this.gpu.gl.deleteTexture(this.tex)
    this.gpu.gl.deleteFramebuffer(this.fbo)
  }
}
export const gpuFilterLinear = 1
export const gpuFilterNearest = 0

export class Program {
  prog: WebGLProgram
  private u = new Map<string, WebGLUniformLocation | null>()
  constructor(private gl: WebGL2RenderingContext, name: string, vs: string, fs: string) {
    const mk = (type: number, src: string): WebGLShader => {
      const s = gl.createShader(type)!
      gl.shaderSource(s, src)
      gl.compileShader(s)
      if (!gl.getShaderParameter(s, gl.COMPILE_STATUS)) throw new Error(`[${name}] shader compile: ${gl.getShaderInfoLog(s)}`)
      return s
    }
    this.prog = gl.createProgram()!
    gl.attachShader(this.prog, mk(gl.VERTEX_SHADER, vs))
    gl.attachShader(this.prog, mk(gl.FRAGMENT_SHADER, fs))
    gl.linkProgram(this.prog)
    if (!gl.getProgramParameter(this.prog, gl.LINK_STATUS)) throw new Error(`[${name}] link: ${gl.getProgramInfoLog(this.prog)}`)
  }
  use(): this {
    this.gl.useProgram(this.prog)
    return this
  }
  loc(n: string): WebGLUniformLocation | null {
    if (!this.u.has(n)) this.u.set(n, this.gl.getUniformLocation(this.prog, n))
    return this.u.get(n)!
  }
  f(n: string, v: number): this {
    this.gl.uniform1f(this.loc(n), v)
    return this
  }
  i(n: string, v: number): this {
    this.gl.uniform1i(this.loc(n), v)
    return this
  }
  v2(n: string, a: number, b: number): this {
    this.gl.uniform2f(this.loc(n), a, b)
    return this
  }
  v3(n: string, a: number, b: number, c: number): this {
    this.gl.uniform3f(this.loc(n), a, b, c)
    return this
  }
  v4(n: string, a: number, b: number, c: number, d: number): this {
    this.gl.uniform4f(this.loc(n), a, b, c, d)
    return this
  }
}

export class GPU {
  gl: WebGL2RenderingContext
  /** true when RGBA16F is renderable */
  half: boolean
  maxTexture: number
  private readFbo: WebGLFramebuffer
  private drawFbo: WebGLFramebuffer
  private emptyVao: WebGLVertexArrayObject
  /** 1x1 transparent texture, bound to unused sampler units to avoid feedback loops. */
  blank: WebGLTexture
  /** 1x1 opaque white (the value of a mask tile that does not exist yet) */
  white: WebGLTexture
  private programs = new Map<string, Program>()

  /** true between webglcontextlost and webglcontextrestored */
  lost = false
  contextListeners: ((s: 'lost' | 'restored') => void)[] = []

  constructor(public canvas: HTMLCanvasElement) {
    const gl = canvas.getContext('webgl2', {
      antialias: false,
      alpha: false,
      depth: false,
      stencil: false,
      desynchronized: true,
      powerPreference: 'high-performance',
      preserveDrawingBuffer: false
    })
    if (!gl) throw new Error('WebGL2 is not available')
    this.gl = gl
    canvas.addEventListener('webglcontextlost', (e) => {
      e.preventDefault() // lets the browser restore the context
      this.lost = true
      window.brushwork?.diag('webglcontextlost')
      console.error('[gpu] webglcontextlost')
      for (const f of this.contextListeners) f('lost')
    })
    canvas.addEventListener('webglcontextrestored', () => {
      this.lost = false
      window.brushwork?.diag('webglcontextrestored')
      console.error('[gpu] webglcontextrestored')
      for (const f of this.contextListeners) f('restored')
    })
    this.half = !!(gl.getExtension('EXT_color_buffer_float') || gl.getExtension('EXT_color_buffer_half_float'))
    gl.getExtension('OES_texture_float_linear')
    this.maxTexture = gl.getParameter(gl.MAX_TEXTURE_SIZE)
    this.readFbo = gl.createFramebuffer()!
    this.drawFbo = gl.createFramebuffer()!
    this.emptyVao = gl.createVertexArray()!
    this.blank = gl.createTexture()!
    gl.bindTexture(gl.TEXTURE_2D, this.blank)
    gl.texImage2D(gl.TEXTURE_2D, 0, gl.RGBA8, 1, 1, 0, gl.RGBA, gl.UNSIGNED_BYTE, new Uint8Array(4))
    gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MIN_FILTER, gl.NEAREST)
    gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MAG_FILTER, gl.NEAREST)
    this.white = gl.createTexture()!
    gl.bindTexture(gl.TEXTURE_2D, this.white)
    gl.texImage2D(gl.TEXTURE_2D, 0, gl.RGBA8, 1, 1, 0, gl.RGBA, gl.UNSIGNED_BYTE, new Uint8Array([255, 255, 255, 255]))
    gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MIN_FILTER, gl.NEAREST)
    gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MAG_FILTER, gl.NEAREST)
    gl.pixelStorei(gl.UNPACK_ALIGNMENT, 1)
    gl.pixelStorei(gl.PACK_ALIGNMENT, 1)
  }

  /** Cache-compiled program by key. */
  program(key: string, vs: string, fs: string): Program {
    let p = this.programs.get(key)
    if (!p) this.programs.set(key, (p = new Program(this.gl, key, vs, fs)))
    return p
  }

  surface(w: number, h: number, fmt: PixFormat, filter = gpuFilterLinear): Surface {
    return new Surface(this, w, h, fmt === 'rgba16f' && !this.half ? 'rgba8' : fmt, filter)
  }

  bindTarget(s: Surface | null, scissor?: Rect | null): void {
    const gl = this.gl
    gl.bindFramebuffer(gl.FRAMEBUFFER, s ? s.fbo : null)
    if (s) {
      s.rev++
      gl.viewport(0, 0, s.w, s.h)
    }
    if (scissor) {
      gl.enable(gl.SCISSOR_TEST)
      gl.scissor(scissor.x, scissor.y, scissor.w, scissor.h)
    } else gl.disable(gl.SCISSOR_TEST)
  }

  bindTex(unit: number, tex: WebGLTexture | null): void {
    const gl = this.gl
    gl.activeTexture(gl.TEXTURE0 + unit)
    gl.bindTexture(gl.TEXTURE_2D, tex)
  }

  /** Draw a full-target triangle strip quad (uv 0..1 via gl_VertexID). */
  fullscreen(): void {
    const gl = this.gl
    gl.bindVertexArray(this.emptyVao)
    gl.drawArrays(gl.TRIANGLE_STRIP, 0, 4)
  }

  clear(s: Surface, rect?: Rect | null): void {
    const gl = this.gl
    this.bindTarget(s, rect ?? null)
    gl.clearColor(0, 0, 0, 0)
    gl.clear(gl.COLOR_BUFFER_BIT)
    gl.disable(gl.SCISSOR_TEST)
  }

  /** Copy a rect between two surfaces of the same format (no scaling). */
  blit(src: Surface, sr: Rect, dst: Surface, dx: number, dy: number): void {
    const gl = this.gl
    gl.disable(gl.SCISSOR_TEST)
    dst.rev++
    gl.bindFramebuffer(gl.READ_FRAMEBUFFER, src.fbo)
    gl.bindFramebuffer(gl.DRAW_FRAMEBUFFER, dst.fbo)
    gl.blitFramebuffer(sr.x, sr.y, sr.x + sr.w, sr.y + sr.h, dx, dy, dx + sr.w, dy + sr.h, gl.COLOR_BUFFER_BIT, gl.NEAREST)
  }

  /** Read a rect as straight RGBA8, un-premultiplied. Rows top-to-bottom in document space. */
  readRGBA8(s: Surface, rect: Rect): Uint8ClampedArray {
    const gl = this.gl
    const out = new Uint8ClampedArray(rect.w * rect.h * 4)
    gl.bindFramebuffer(gl.FRAMEBUFFER, s.fbo)
    const CH = 256 // rows per chunk to bound temp memory
    for (let y0 = 0; y0 < rect.h; y0 += CH) {
      const h = Math.min(CH, rect.h - y0)
      if (s.fmt === 'rgba16f') {
        const f = new Float32Array(rect.w * h * 4)
        gl.readPixels(rect.x, rect.y + y0, rect.w, h, gl.RGBA, gl.FLOAT, f)
        const o = y0 * rect.w * 4
        for (let i = 0; i < f.length; i += 4) {
          const a = f[i + 3]
          const k = a > 1e-6 ? 1 / a : 0
          out[o + i] = f[i] * k * 255 + 0.5
          out[o + i + 1] = f[i + 1] * k * 255 + 0.5
          out[o + i + 2] = f[i + 2] * k * 255 + 0.5
          out[o + i + 3] = a * 255 + 0.5
        }
      } else {
        const u = new Uint8Array(rect.w * h * 4)
        gl.readPixels(rect.x, rect.y + y0, rect.w, h, gl.RGBA, gl.UNSIGNED_BYTE, u)
        const o = y0 * rect.w * 4
        for (let i = 0; i < u.length; i += 4) {
          const a = u[i + 3]
          const k = a > 0 ? 255 / a : 0
          out[o + i] = u[i] * k + 0.5
          out[o + i + 1] = u[i + 1] * k + 0.5
          out[o + i + 2] = u[i + 2] * k + 0.5
          out[o + i + 3] = a
        }
      }
    }
    return out
  }

  /** Raw premultiplied float read of a small rect (tests/diagnostics). */
  readPremultFloat(s: Surface, rect: Rect): Float32Array {
    const gl = this.gl
    gl.bindFramebuffer(gl.FRAMEBUFFER, s.fbo)
    const f = new Float32Array(rect.w * rect.h * 4)
    if (s.fmt === 'rgba16f') gl.readPixels(rect.x, rect.y, rect.w, rect.h, gl.RGBA, gl.FLOAT, f)
    else {
      const u = new Uint8Array(rect.w * rect.h * 4)
      gl.readPixels(rect.x, rect.y, rect.w, rect.h, gl.RGBA, gl.UNSIGNED_BYTE, u)
      for (let i = 0; i < u.length; i++) f[i] = u[i] / 255
    }
    return f
  }

  /** Upload straight RGBA8 pixels into a surface (premultiplying) via a temporary texture. */
  uploadRGBA8(s: Surface, x: number, y: number, w: number, h: number, data: Uint8ClampedArray | Uint8Array): void {
    const gl = this.gl
    const t = gl.createTexture()!
    gl.bindTexture(gl.TEXTURE_2D, t)
    gl.texStorage2D(gl.TEXTURE_2D, 1, gl.RGBA8, w, h)
    gl.texSubImage2D(gl.TEXTURE_2D, 0, 0, 0, w, h, gl.RGBA, gl.UNSIGNED_BYTE, data)
    gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MIN_FILTER, gl.NEAREST)
    gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MAG_FILTER, gl.NEAREST)
    const p = this.program('upload', FS_VERT, UPLOAD_FRAG).use()
    this.bindTex(0, t)
    p.i('uTex', 0).v2('uSize', w, h)
    this.bindTarget(s, { x, y, w, h })
    gl.viewport(0, 0, s.w, s.h)
    gl.disable(gl.BLEND)
    // Map the quad so uv 0..1 covers just the rect: use an offset uniform
    p.v2('uOrigin', x, y).v2('uTarget', s.w, s.h)
    this.fullscreen()
    gl.disable(gl.SCISSOR_TEST)
    gl.deleteTexture(t)
  }
}

export const FS_VERT = `#version 300 es
out vec2 vUv;
void main(){
  vec2 p = vec2(float(gl_VertexID & 1), float((gl_VertexID >> 1) & 1));
  vUv = p;
  gl_Position = vec4(p * 2.0 - 1.0, 0.0, 1.0);
}`

const UPLOAD_FRAG = `#version 300 es
precision highp float;
uniform sampler2D uTex; uniform vec2 uSize; uniform vec2 uOrigin; uniform vec2 uTarget;
out vec4 o;
void main(){
  ivec2 p = ivec2(gl_FragCoord.xy - uOrigin);
  vec4 c = texelFetch(uTex, p, 0);
  o = vec4(c.rgb * c.a, c.a);
}`
