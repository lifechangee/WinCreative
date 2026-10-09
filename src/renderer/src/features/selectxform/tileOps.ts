import type { App } from '../../app/app'
import { TILE, tileKey } from '../../core/tiles'
import type { Rect } from '../../core/types'
import type { Layer } from '../../doc/layer'
import { LiveTileEdit } from '../../doc/tileEdit'
import { bindClipMask, CLIP_CHUNK } from '../../gl/clipMask'
import { FS_VERT } from '../../gl/gpu'

/** Infinite-canvas versions of the selection pixel operations: one pass per 512 px layer tile, selection sampled through ClipCtx. */
const OP_FS = `#version 300 es
precision highp float;
uniform sampler2D uSrc;
uniform int uMode;      // 0 clear selected, 1 fill selected, 2 keep selected (copy)
uniform vec3 uColor;
uniform float uAlphaLock;
${CLIP_CHUNK}
in vec2 vUv;
out vec4 o;
void main(){
  vec4 L = texelFetch(uSrc, ivec2(gl_FragCoord.xy), 0);
  float m = selCov(vUv);
  if (uMode == 2) { o = L * m; return; }
  if (uMode == 0) { o = uAlphaLock > 0.5 ? L : L * (1.0 - m); return; }
  if (uAlphaLock > 0.5) { o = vec4(mix(L.rgb, uColor * L.a, m), L.a); return; }
  o = vec4(uColor * m, m) + L * (1.0 - m);
}`

export interface TileOpParams {
  mode: 'clear' | 'fill'
  color?: [number, number, number]
  alphaLock?: boolean
}

/** Clear / colour-fill the selected pixels of an infinite layer inside `rect` as ONE undo step. Returns the dirty rect. */
export function selectionOpInf(app: App, layer: Layer, rect: Rect, p: TileOpParams, label: string): Rect | null {
  const { doc, gpu } = app
  const gl = gpu.gl
  const live = new LiveTileEdit(doc, layer, label)
  const spans = live.prepare(rect, p.mode === 'clear')
  if (!spans.length) {
    live.cancel()
    return null
  }
  const scratch = gpu.surface(TILE, TILE, layer.tiles!.fmt, 0)
  const prog = gpu.program('sx:tileop', FS_VERT, OP_FS).use()
  const c = p.color ?? [0, 0, 0]
  gl.disable(gl.BLEND)
  for (const s of spans) {
    gpu.blit(s.surf, { x: 0, y: 0, w: TILE, h: TILE }, scratch, 0, 0)
    gpu.bindTex(0, scratch.tex)
    prog.i('uSrc', 0).i('uMode', p.mode === 'clear' ? 0 : 1).v3('uColor', c[0], c[1], c[2]).f('uAlphaLock', p.alphaLock ? 1 : 0)
    bindClipMask(gpu, prog, { x: s.ox, y: s.oy, w: TILE, h: TILE })
    gpu.bindTarget(s.surf, null)
    gpu.fullscreen()
  }
  scratch.dispose()
  const dirty = live.commit()
  if (dirty) doc.events.emit('change', { rect: dirty })
  return dirty
}

/** dst := src x selection coverage inside `rect` (tiles of `dst` are created as needed; no undo - `dst` is a brand-new layer). */
export function copySelectedInf(app: App, src: Layer, dst: Layer, rect: Rect, useSelection: boolean): void {
  const { gpu } = app
  const gl = gpu.gl
  const from = src.tiles!
  const to = dst.tiles!
  const keys: { tx: number; ty: number }[] = []
  const x0 = Math.floor(rect.x / TILE)
  const y0 = Math.floor(rect.y / TILE)
  const x1 = Math.floor((rect.x + rect.w - 1) / TILE)
  const y1 = Math.floor((rect.y + rect.h - 1) / TILE)
  for (let ty = y0; ty <= y1; ty++) for (let tx = x0; tx <= x1; tx++) if (from.has(tx, ty)) keys.push({ tx, ty })
  for (const k of keys) to.ensure(k.tx, k.ty) // allocate before binding
  const prog = gpu.program('sx:tileop', FS_VERT, OP_FS).use()
  gl.disable(gl.BLEND)
  for (const k of keys) {
    gpu.bindTex(0, from.get(k.tx, k.ty)!.tex)
    prog.i('uSrc', 0).i('uMode', 2).v3('uColor', 0, 0, 0).f('uAlphaLock', 0)
    if (useSelection) bindClipMask(gpu, prog, { x: k.tx * TILE, y: k.ty * TILE, w: TILE, h: TILE })
    else {
      gpu.bindTex(4, gpu.blank)
      prog.i('uSelMask', 4).f('uSelOn', 0)
    }
    gpu.bindTarget(to.get(k.tx, k.ty)!, null)
    gpu.fullscreen()
  }
  to.prune(keys.map((k) => tileKey(k.tx, k.ty)))
}
