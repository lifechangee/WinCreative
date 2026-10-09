import type { Rect } from '../core/types'
import type { GPU, Program } from './gpu'

/**
 * Global selection clip mask (owned by features/selectxform, read by shaders).
 * `tex` = R8-in-RGBA8 coverage texture (value in .r, row = document y) or null when nothing is selected.
 * Any pass that writes pixels of a layer should call `bindClipMask(gpu, prog[, ctx])` and multiply its effect by
 * `selCov(uv)` (GLSL from CLIP_CHUNK).
 *
 * Fixed documents: the texture is canvas-sized and `uv` = 0..1 across the canvas (no `ctx` needed).
 * Infinite documents: the texture covers the selection WINDOW `win` (document px, grows as the selection grows); a pass must tell
 * where its own pixel space lives: `ctx = {x, y, w, h}` = document position of the pass' pixel (0,0) and the pixel size `uv` is
 * normalised by (e.g. a 512 px layer tile drawn with `uv = px / 512` -> `{x: tileOriginX, y: tileOriginY, w: 512, h: 512}`).
 * Outside the window the coverage is 0. A pass on an infinite document that supplies no ctx ignores the selection.
 */
export interface ClipCtx {
  x: number
  y: number
  w: number
  h: number
}

/**
 * `off`: legacy flag set by the app while an infinite canvas is open (smart selection still checks it). `bindClipMask` does NOT read it.
 * `win`: selection window of an infinite document (null on fixed documents).
 */
export const clipMask: {
  tex: WebGLTexture | null
  off: boolean
  win: Rect | null
  /** features/frame: document-space integer rectangle that painting is limited to (frame clipping ON), or null. Effective clip = selection x frame. */
  frame: Rect | null
  /** size of the fixed canvas = the default pass region (uv 0..1 across the canvas) for the frame test */
  canvas: { w: number; h: number }
} = { tex: null, off: false, win: null, frame: null, canvas: { w: 1, h: 1 } }

export const CLIP_UNIT = 4

export const CLIP_CHUNK = `
uniform sampler2D uSelMask;
uniform float uSelOn;
uniform vec4 uSelWin;   // infinite docs: selection window size (zw, > 0); (0,0,0,0) = fixed canvas-sized mask
uniform vec4 uSelMap;   // infinite docs: pass pixel origin relative to the window (xy), pass normalisation size (zw)
uniform vec4 uFrameBox; // frame rectangle in the uv space of this pass: lo.xy, hi.zw (features/frame)
uniform float uFrameOn;
float frameCov(vec2 uv){
  if (uFrameOn < 0.5) return 1.0;
  vec2 a = step(uFrameBox.xy, uv) * (1.0 - step(uFrameBox.zw, uv));
  return a.x * a.y;
}
float selCovSel(vec2 uv){
  if (uSelOn < 0.5) return 1.0;
  if (uSelWin.z > 0.0) {
    vec2 d = uv * uSelMap.zw + uSelMap.xy;
    if (d.x < 0.0 || d.y < 0.0 || d.x >= uSelWin.z || d.y >= uSelWin.w) return 0.0;
    return texture(uSelMask, d / uSelWin.zw).r;
  }
  return texture(uSelMask, uv).r;
}
float selCov(vec2 uv){ return selCovSel(uv) * frameCov(uv); }
`

/** Set only the pass geometry (use after bindClipMask when the same program is drawn into several tiles). */
export function setClipCtx(p: Program, ctx: ClipCtx): void {
  setFrameRegion(p, ctx)
  const w = clipMask.win
  if (w) p.v4('uSelMap', ctx.x - w.x, ctx.y - w.y, ctx.w, ctx.h)
}

/** Bind the selection mask on texture unit 4 and set uSelMask / uSelOn on the (currently used) program. */
/** Set the frame uniforms for a pass whose uv 0..1 spans `region` (document px; default = the whole fixed canvas). */
export function setFrameRegion(p: Program, region?: ClipCtx | null): void {
  const f = clipMask.frame
  if (!f) {
    p.f('uFrameOn', 0)
    return
  }
  const r = region ?? { x: 0, y: 0, w: clipMask.canvas.w, h: clipMask.canvas.h }
  p.f('uFrameOn', 1).v4('uFrameBox', (f.x - r.x) / r.w, (f.y - r.y) / r.h, (f.x + f.w - r.x) / r.w, (f.y + f.h - r.y) / r.h)
}

export function bindClipMask(gpu: GPU, p: Program, ctx?: ClipCtx | null): void {
  setFrameRegion(p, ctx)
  const w = clipMask.win
  let tex = clipMask.tex
  if (tex && w && !ctx) tex = null // infinite document, pass not migrated: selection ignored
  gpu.bindTex(CLIP_UNIT, tex ?? gpu.blank)
  p.i('uSelMask', CLIP_UNIT).f('uSelOn', tex ? 1 : 0)
  if (tex && w && ctx) p.v4('uSelWin', 0, 0, w.w, w.h).v4('uSelMap', ctx.x - w.x, ctx.y - w.y, ctx.w, ctx.h)
  else p.v4('uSelWin', 0, 0, 0, 0).v4('uSelMap', 0, 0, 0, 0)
}
