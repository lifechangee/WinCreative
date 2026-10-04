import type { App } from '../../app/app'
import type { Layer } from '../../doc/layer'
import type { Surface } from '../../gl/gpu'
import { FS_VERT } from '../../gl/shaders'
import { THUMB_FS } from '../../gl/layerShaders'

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
      if (e.dirtyP && budget > 0) {
        this.render(l.pixels, e.pixels)
        e.dirtyP = false
        budget--
      }
      if (e.dirtyM && l.mask && budget > 0) {
        this.render(l.mask, e.mask)
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
