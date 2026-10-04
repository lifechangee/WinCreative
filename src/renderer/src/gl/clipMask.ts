import type { GPU, Program } from './gpu'

/**
 * Global selection clip mask (owned by features/selectxform, read by shaders).
 * `tex` = R8-in-RGBA8 coverage texture (value in .r, doc-sized, row = document y) or null when nothing is selected.
 * Any pass that writes pixels of a layer should call `bindClipMask(gpu, prog)` and multiply its effect by
 * `selCov(uv)` (GLSL from CLIP_CHUNK; uv = 0..1 across the canvas).
 */
export const clipMask: { tex: WebGLTexture | null } = { tex: null }

export const CLIP_UNIT = 4

export const CLIP_CHUNK = `
uniform sampler2D uSelMask;
uniform float uSelOn;
float selCov(vec2 uv){ return uSelOn > 0.5 ? texture(uSelMask, uv).r : 1.0; }
`

/** Bind the selection mask on texture unit 4 and set uSelMask / uSelOn on the (currently used) program. */
export function bindClipMask(gpu: GPU, p: Program): void {
  gpu.bindTex(CLIP_UNIT, clipMask.tex ?? gpu.blank)
  p.i('uSelMask', CLIP_UNIT).f('uSelOn', clipMask.tex ? 1 : 0)
}
