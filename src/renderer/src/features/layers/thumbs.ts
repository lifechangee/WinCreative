import type { App } from '../../app/app'
import type { Layer } from '../../doc/layer'
import type { Surface } from '../../gl/gpu'
import { FS_VERT } from '../../gl/shaders'
import { THUMB_FS } from '../../gl/layerShaders'
import { TILE, tileKeyX, tileKeyY, unionBounds } from '../../core/tiles'
import type { Rect } from '../../core/types'

/** One layer tile box-filtered into the thumbnail (pixels whose centre lies inside the tile only). */
const TILE_THUMB_FS = `#version 300 es
precision highp float;
uniform sampler2D uTile;
uniform float uK;     // output px per document px
uniform vec2 uOff;    // tile origin relative to the thumbnail origin (document px)
out vec4 o;
void main(){
  vec2 d = gl_FragCoord.xy / uK - uOff;
  if (d.x < 0.0 || d.y < 0.0 || d.x >= 512.0 || d.y >= 512.0) discard;
  vec2 foot = vec2(1.0 / uK) / 512.0;
  vec4 acc = vec4(0.0);
  for (int j = 0; j < 8; j++) for (int i = 0; i < 8; i++) {
    vec2 e = (vec2(float(i), float(j)) + 0.5) / 8.0 - 0.5;
    acc += texture(uTile, d / 512.0 + e * foot);
  }
  o = acc / 64.0;
}`

const THUMB = 56

interface Entry {
  pixels: HTMLCanvasElement
  mask: HTMLCanvasElement
  dirtyP: boolean
  dirtyM: boolean
}

/** GPU-downscaled layer / mask thumbnails, refreshed lazily (a few per frame) after commits. */
export class Thumbs {
  private entries = new Map<string, Entry>()
  private out: Surface | null = null
  private raf = 0
  onUpdate: (() => void) | null = null

  constructor(private app: App) {}

  private entry(id: string): Entry {
    let e = this.entries.get(id)
    if (!e) {
      e = { pixels: document.createElement('canvas'), mask: document.createElement('canvas'), dirtyP: true, dirtyM: true }
      e.pixels.className = 'lthumb'
      e.mask.className = 'lthumb'
      this.entries.set(id, e)
    }
    return e
  }

  /** Canvas element for a layer's pixels (or its mask). Content is refreshed asynchronously. */
  canvas(layer: Layer, mask = false): HTMLCanvasElement {
    const e = this.entry(layer.id)
    this.schedule()
    return mask ? e.mask : e.pixels
  }

  markDirty(id: string | null, maskToo = true): void {
    if (id === null) {
      for (const e of this.entries.values()) {
        e.dirtyP = true
        e.dirtyM = maskToo || e.dirtyM
      }
    } else {
      const e = this.entries.get(id)
      if (e) {
        e.dirtyP = true
        if (maskToo) e.dirtyM = true
      }
    }
    this.schedule()
  }

  private schedule(): void {
    if (!this.raf) this.raf = requestAnimationFrame(() => this.tick())
  }

  private tick(): void {
    this.raf = 0
    const doc = this.app.doc
    let budget = 6
    for (const l of doc.layers) {
      if (l.isGroup) continue
      const e = this.entries.get(l.id)
      if (!e) continue
      if (e.dirtyP && budget > 0 && l.tiles) {
        this.renderTiles(l, e.pixels)
        e.dirtyP = false
        budget--
      } else if (e.dirtyP && budget > 0) {
        this.render(l.pixels, e.pixels)
        e.dirtyP = false
        budget--
      }
      if (e.dirtyM && l.mask && budget > 0) {
        if (l.maskTiles) this.renderMaskTiles(l, e.mask)
        else this.render(l.mask, e.mask)
        e.dirtyM = false
        budget--
      }
    }
    const pending = doc.layers.some((l) => {
      const e = this.entries.get(l.id)
      return !!e && !l.isGroup && (e.dirtyP || (e.dirtyM && !!l.mask))
    })
    if (pending) this.schedule()
    this.onUpdate?.()
  }

  /** Infinite canvas: thumbnail of the whole painted area (tile by tile, so content of any extent fits). */
  private renderTiles(l: Layer, canvas: HTMLCanvasElement): void {
    this.renderStore(l.tiles!, l.tiles!.tightBounds(), canvas, null)
  }

  /** Infinite mask thumbnail over the layer's content area; tiles the mask does not have show its fill value. */
  private renderMaskTiles(l: Layer, canvas: HTMLCanvasElement): void {
    const ms = l.maskTiles!
    const b = unionBounds(l.tiles?.bounds() ?? null, ms.bounds())
    this.renderStore(ms, b, canvas, l.maskFill)
  }

  /** Box-filter the tiles of `store` into a 56 px thumbnail of `b`. `bg`: opaque grey level behind missing tiles (masks), null = transparent. */
  private renderStore(store: NonNullable<Layer['tiles']>, b: Rect | null, canvas: HTMLCanvasElement, bg: 0 | 1 | null): void {
    const gpu = this.app.gpu
    const gl = gpu.gl
    if (!b) {
      canvas.width = 1
      canvas.height = 1
      const c = canvas.getContext('2d')!
      c.clearRect(0, 0, 1, 1)
      if (bg !== null) {
        c.fillStyle = bg ? '#fff' : '#000'
        c.fillRect(0, 0, 1, 1)
      }
      return
    }
    const k = Math.min(1, THUMB / Math.max(b.w, b.h))
    const tw = Math.max(1, Math.round(b.w * k))
    const th = Math.max(1, Math.round(b.h * k))
    const out = gpu.surface(tw, th, 'rgba8')
    gpu.bindTarget(out, null)
    gl.clearColor(bg ?? 0, bg ?? 0, bg ?? 0, bg === null ? 0 : 1)
    gl.clear(gl.COLOR_BUFFER_BIT)
    gl.clearColor(0, 0, 0, 0)
    gl.disable(gl.BLEND)
    const keys = [...store.keys()]
    const tiles = keys.map((key) => ({ key, s: store.getKey(key)! })).filter((t2) => t2.s)
    const p = gpu.program('layer-thumb-tile', FS_VERT, TILE_THUMB_FS).use()
    for (const t2 of tiles) {
      const ox = tileKeyX(t2.key) * TILE - b.x
      const oy = tileKeyY(t2.key) * TILE - b.y
      const x0 = Math.max(0, Math.floor(ox * k))
      const y0 = Math.max(0, Math.floor(oy * k))
      const x1 = Math.min(tw, Math.ceil((ox + TILE) * k))
      const y1 = Math.min(th, Math.ceil((oy + TILE) * k))
      if (x1 <= x0 || y1 <= y0) continue
      gpu.bindTex(0, t2.s.tex)
      p.i('uTile', 0).f('uK', k).v2('uOff', ox, oy)
      gpu.bindTarget(out, { x: x0, y: y0, w: x1 - x0, h: y1 - y0 })
      gpu.fullscreen()
    }
    gl.disable(gl.SCISSOR_TEST)
    const px = gpu.readRGBA8(out, { x: 0, y: 0, w: tw, h: th })
    out.dispose()
    canvas.width = tw
    canvas.height = th
    canvas.getContext('2d')!.putImageData(new ImageData(px as unknown as Uint8ClampedArray<ArrayBuffer>, tw, th), 0, 0)
  }

  private render(src: Surface, canvas: HTMLCanvasElement): void {
    const doc = this.app.doc
    const gpu = this.app.gpu
    const k = THUMB / Math.max(doc.width, doc.height)
    const tw = Math.max(1, Math.round(doc.width * k))
    const th = Math.max(1, Math.round(doc.height * k))
    if (!this.out || this.out.w !== tw || this.out.h !== th) {
      this.out?.dispose()
      this.out = gpu.surface(tw, th, 'rgba8')
    }
    const gl = gpu.gl
    const p = gpu.program('layer-thumb', FS_VERT, THUMB_FS).use()
    gpu.bindTex(0, src.tex)
    p.i('uSrc', 0).v2('uFoot', 1 / tw, 1 / th)
    gl.disable(gl.BLEND)
    gpu.bindTarget(this.out, null)
    gpu.fullscreen()
    const px = gpu.readRGBA8(this.out, { x: 0, y: 0, w: tw, h: th })
    canvas.width = tw
    canvas.height = th
    canvas.getContext('2d')!.putImageData(new ImageData(px as unknown as Uint8ClampedArray<ArrayBuffer>, tw, th), 0, 0)
  }

  prune(): void {
    const ids = new Set(this.app.doc.layers.map((l) => l.id))
    for (const id of [...this.entries.keys()]) if (!ids.has(id)) this.entries.delete(id)
  }

  dispose(): void {
    cancelAnimationFrame(this.raf)
    this.out?.dispose()
    this.out = null
    this.entries.clear()
  }
}
