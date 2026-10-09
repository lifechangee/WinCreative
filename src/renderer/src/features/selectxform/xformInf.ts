import type { App } from '../../app/app'
import { TILE } from '../../core/tiles'
import type { Rect } from '../../core/types'
import { intersectRect } from '../../core/geometry'
import type { Layer } from '../../doc/layer'
import type { LiveTileEdit, TileSpan } from '../../doc/tileEdit'
import { bindClipMask, CLIP_CHUNK } from '../../gl/clipMask'
import { FS_VERT, type Surface } from '../../gl/gpu'

/** Transform on an infinite canvas: sources are read through the region API in CHUNKS (GPU texture limit), results land in layer tiles. */

const EXTRACT_FS = `#version 300 es
precision highp float;
uniform sampler2D uSrc;
uniform vec2 uOff;     // float px where region texel (0,0) lands
uniform vec2 uReg;     // region size
uniform float uMaskOut;
${CLIP_CHUNK}
out vec4 o;
void main(){
  vec2 q = gl_FragCoord.xy - uOff;
  if (q.x < 0.0 || q.y < 0.0 || q.x >= uReg.x || q.y >= uReg.y) { o = vec4(0.0); return; }
  float m = selCov(q / uReg);
  if (uMaskOut > 0.5) { o = vec4(m); return; }
  o = texelFetch(uSrc, ivec2(q), 0) * m;
}`

const REMOVE_FS = `#version 300 es
precision highp float;
uniform sampler2D uOrig;
${CLIP_CHUNK}
in vec2 vUv;
out vec4 o;
void main(){ o = texelFetch(uOrig, ivec2(gl_FragCoord.xy), 0) * (1.0 - selCov(vUv)); }`

/** One piece of the source: `core` (document px) is what it is responsible for; the float surface also holds `halo` px of neighbours. */
export interface SrcChunk {
  core: Rect
  halo: number
  /** per transformed layer */
  floats: Surface[]
  mask: Surface | null
}

/** Core size of a chunk: a single chunk when the source fits the GPU, else grid cells of at most this size. */
export function chunkPlan(app: App, src: Rect, halo1: number, halo2: number): { cores: Rect[]; halo: number } {
  const maxTex = app.gpu.maxTexture
  const single = Math.min(maxTex, 4096) - 2 * halo1
  if (src.w <= single && src.h <= single) return { cores: [{ ...src }], halo: halo1 }
  const cell = Math.min(maxTex, 4096) - 2 * halo2
  const cores: Rect[] = []
  for (let y = src.y; y < src.y + src.h; y += cell) for (let x = src.x; x < src.x + src.w; x += cell) cores.push({ x, y, w: Math.min(cell, src.x + src.w - x), h: Math.min(cell, src.y + src.h - y) })
  return { cores, halo: halo2 }
}

/** Build the float surface of one chunk: layer pixels (x selection coverage) of core+halo, zero outside `src`. `layer` null = coverage only. */
export function extractChunk(app: App, layer: Layer | null, src: Rect, core: Rect, halo: number, useSel: boolean): Surface {
  const { gpu, doc } = app
  const gl = gpu.gl
  const fw = core.w + 2 * halo
  const fh = core.h + 2 * halo
  const full: Rect = { x: core.x - halo, y: core.y - halo, w: fw, h: fh }
  const rr = intersectRect(full, src)
  const out = gpu.surface(fw, fh, layer ? layer.tiles!.fmt : 'rgba8', 0)
  if (!rr) return out
  const region = layer ? doc.readRegion(layer, rr) : null
  const prog = gpu.program('sx:xinf-extract', FS_VERT, EXTRACT_FS).use()
  gpu.bindTex(0, region ? region.tex : gpu.blank)
  prog.i('uSrc', 0).v2('uOff', rr.x - full.x, rr.y - full.y).v2('uReg', rr.w, rr.h).f('uMaskOut', layer ? 0 : 1)
  if (useSel) bindClipMask(gpu, prog, { x: rr.x, y: rr.y, w: rr.w, h: rr.h })
  else {
    gpu.bindTex(4, gpu.blank)
    prog.i('uSelMask', 4).f('uSelOn', 0)
  }
  gl.disable(gl.BLEND)
  gpu.bindTarget(out, null)
  gpu.fullscreen()
  region?.dispose()
  return out
}

/** Remove the (selected part of the) source from the tiles of `live` - the originals come from its snapshots. */
export function removeSourceInf(app: App, live: LiveTileEdit, spans: TileSpan[], src: Rect, useSel: boolean): void {
  const { gpu } = app
  const gl = gpu.gl
  gl.disable(gl.BLEND)
  const prog = gpu.program('sx:xinf-remove', FS_VERT, REMOVE_FS).use()
  for (const s of spans) {
    const local = intersectRect({ x: src.x - s.ox, y: src.y - s.oy, w: src.w, h: src.h }, { x: 0, y: 0, w: TILE, h: TILE })
    if (!local) continue
    if (!useSel) {
      gpu.bindTarget(s.surf, local)
      gl.clearColor(0, 0, 0, 0)
      gl.clear(gl.COLOR_BUFFER_BIT)
      gl.disable(gl.SCISSOR_TEST)
      continue
    }
    const orig = live.edit.snapshot(s.key)
    if (!orig) continue // the tile did not exist: nothing to remove
    gpu.bindTex(0, orig.tex)
    prog.i('uOrig', 0)
    bindClipMask(gpu, prog, { x: s.ox, y: s.oy, w: TILE, h: TILE })
    gpu.bindTarget(s.surf, local)
    gpu.fullscreen()
    gl.disable(gl.SCISSOR_TEST)
  }
}
