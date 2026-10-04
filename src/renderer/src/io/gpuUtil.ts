import type { GPU, Surface } from '../gl/gpu'
import { FS_VERT } from '../gl/gpu'

/**
 * Generic "sample a region of a surface into another" pass used for time-lapse frame downscaling, crop/resize/flip
 * and onion-skin ghosts. Box-filters when minifying (up to 8x8 bilinear taps), exact copy for integer 1:1 mapping.
 *   dst pixel (x,y) centre -> src pixel position  origin + (x+.5, y+.5) * step      (step may be negative = flip)
 */
const FS = `#version 300 es
precision highp float;
uniform sampler2D uSrc; uniform vec2 uSrcSize; uniform vec2 uOrigin; uniform vec2 uStep;
uniform vec4 uPaper;   // rgb + on-flag: composite over an opaque paper colour
uniform vec4 uTint;    // rgb + amount: mix layer colour towards tint (premultiplied, keeps alpha)
uniform float uAlpha;
out vec4 o;
void main(){
  vec2 c0 = uOrigin + gl_FragCoord.xy * uStep;
  ivec2 n = ivec2(clamp(ceil(abs(uStep)), vec2(1.0), vec2(8.0)));
  vec4 acc = vec4(0.0);
  for (int j = 0; j < 8; j++) {
    if (j >= n.y) break;
    for (int i = 0; i < 8; i++) {
      if (i >= n.x) break;
      vec2 f = (vec2(float(i), float(j)) + 0.5) / vec2(n) - 0.5;
      vec2 uv = (c0 + f * uStep) / uSrcSize;
      if (uv.x >= 0.0 && uv.x <= 1.0 && uv.y >= 0.0 && uv.y <= 1.0) acc += texture(uSrc, uv);
    }
  }
  acc /= float(n.x * n.y);
  acc.rgb = mix(acc.rgb, uTint.rgb * acc.a, uTint.a);
  acc *= uAlpha;
  if (uPaper.w > 0.5) { acc.rgb = acc.rgb + (1.0 - acc.a) * uPaper.rgb; acc.a = 1.0; }
  o = acc;
}`

export interface ResampleOpts {
  /** src pixel of the dst's top-left corner (default 0,0) */
  origin?: [number, number]
  /** src pixels per dst pixel (default: whole src fits dst) */
  step?: [number, number]
  paper?: [number, number, number] | null
  tint?: [number, number, number, number]
  alpha?: number
}

export function resample(gpu: GPU, src: Surface, dst: Surface, o: ResampleOpts = {}): void {
  const gl = gpu.gl
  const step = o.step ?? [src.w / dst.w, src.h / dst.h]
  const origin = o.origin ?? [0, 0]
  const p = gpu.program('animio-resample', FS_VERT, FS).use()
  gpu.bindTex(0, src.tex)
  const t = o.tint ?? [0, 0, 0, 0]
  p.i('uSrc', 0)
    .v2('uSrcSize', src.w, src.h)
    .v2('uOrigin', origin[0], origin[1])
    .v2('uStep', step[0], step[1])
    .v4('uPaper', o.paper?.[0] ?? 0, o.paper?.[1] ?? 0, o.paper?.[2] ?? 0, o.paper ? 1 : 0)
    .v4('uTint', t[0], t[1], t[2], t[3])
    .f('uAlpha', o.alpha ?? 1)
  gpu.bindTarget(dst, null)
  gl.viewport(0, 0, dst.w, dst.h)
  gl.disable(gl.BLEND)
  gpu.fullscreen()
}

/**
 * Non-blocking readback of a small RGBA8 surface via a pixel-pack buffer + fence. Resolves with tightly packed
 * rows (row 0 = top). The GL pipeline is never stalled: the copy is polled from timers until the GPU signals.
 */
const pbos = new Map<number, WebGLBuffer[]>()
export function readbackAsync(gpu: GPU, s: Surface): Promise<Uint8Array<ArrayBuffer>> {
  const gl = gpu.gl
  const size = s.w * s.h * 4
  // pixel-pack buffers are pooled per size: no driver allocation per captured frame
  const buf = pbos.get(size)?.pop() ?? gl.createBuffer()!
  gl.bindBuffer(gl.PIXEL_PACK_BUFFER, buf)
  gl.bufferData(gl.PIXEL_PACK_BUFFER, size, gl.STREAM_READ)
  gl.bindFramebuffer(gl.FRAMEBUFFER, s.fbo)
  gl.readPixels(0, 0, s.w, s.h, gl.RGBA, gl.UNSIGNED_BYTE, 0)
  gl.bindBuffer(gl.PIXEL_PACK_BUFFER, null)
  const sync = gl.fenceSync(gl.SYNC_GPU_COMMANDS_COMPLETE, 0)!
  gl.flush()
  return new Promise((resolve, reject) => {
    let tries = 0
    const release = (): void => {
      const pool = pbos.get(size) ?? pbos.set(size, []).get(size)!
      if (pool.length < 2) pool.push(buf)
      else gl.deleteBuffer(buf)
    }
    const poll = (): void => {
      const r = gl.clientWaitSync(sync, 0, 0)
      if (r === gl.ALREADY_SIGNALED || r === gl.CONDITION_SATISFIED) {
        gl.deleteSync(sync)
        // copy out in ~1 MB bands with a yield in between: an 8 MB getBufferSubData in one go stalls the main thread
        const out = new Uint8Array(size)
        const BAND = 1 << 20
        let o = 0
        const pump = (): void => {
          try {
            const t = performance.now()
            gl.bindBuffer(gl.PIXEL_PACK_BUFFER, buf)
            do {
              const n = Math.min(BAND, size - o)
              gl.getBufferSubData(gl.PIXEL_PACK_BUFFER, o, out, o, n)
              o += n
            } while (o < size && performance.now() - t < 2)
            gl.bindBuffer(gl.PIXEL_PACK_BUFFER, null)
          } catch (e) {
            reject(e)
            return
          }
          if (o < size) setTimeout(pump, 0)
          else {
            release()
            resolve(out)
          }
        }
        pump()
      } else if (r === gl.WAIT_FAILED || ++tries > 2000) {
        release()
        gl.deleteSync(sync)
        reject(new Error('GPU readback failed'))
      } else setTimeout(poll, 4)
    }
    setTimeout(poll, 1)
  })
}
