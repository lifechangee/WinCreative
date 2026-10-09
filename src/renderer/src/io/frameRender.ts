import type { Document } from '../doc/document'
import type { Layer } from '../doc/layer'
import { StackRenderer } from '../gl/compositor'
import type { Compositor } from '../gl/compositor'
import type { GPU, Surface } from '../gl/gpu'
import type { Bitmap } from './imageFormats'
import { resample } from './gpuUtil'
import { readExportArea } from '../features/frame/exportArea'
import { frameRect } from '../features/frame/workRect'
import { infiniteToFixed } from '../features/infinite/convert'
import type { Rect } from '../core/types'

/**
 * Renders arbitrary lists of root layers/groups (a "frame" or "page") to bitmaps, independent of what is
 * currently visible on screen. Uses its own StackRenderer scratch surfaces so it can run at any time.
 */
export class FrameRenderer {
  private renderer: StackRenderer
  private full: Surface
  private out: Surface | null = null
  /** infinite documents: a temporary fixed copy of the frame rectangle (layer ids are kept), rebuilt lazily after edits */
  private work: Document | null = null
  private stale = true
  private offs: (() => void)[] = []
  /** size of the allocated surfaces (follows `width` / `height` on the next render) */
  private sw: number
  private sh: number

  /** size of the rendered area: the canvas, or the frame rectangle of an infinite document */
  get width(): number {
    return this.doc.isInfinite ? this.area().w : this.doc.width
  }
  get height(): number {
    return this.doc.isInfinite ? this.area().h : this.doc.height
  }

  constructor(
    private gpu: GPU,
    private doc: Document
  ) {
    if (doc.isInfinite) {
      const r = this.area()
      this.sw = r.w
      this.sh = r.h
      this.renderer = new StackRenderer(gpu, () => this.work ?? doc)
      this.full = gpu.surface(r.w, r.h, doc.format)
      for (const ev of ['commit', 'layers', 'change'] as const) this.offs.push((doc.events as unknown as { on(e: string, f: () => void): () => void }).on(ev, () => (this.stale = true)))
    } else {
      this.sw = doc.width
      this.sh = doc.height
      this.renderer = new StackRenderer(gpu, () => doc)
      this.full = gpu.surface(doc.width, doc.height, doc.format)
    }
  }

  /** Document rectangle of an infinite document that frames / pages cover: the frame (else the painted area), within the GPU limit. */
  private area(): Rect {
    const d = this.doc
    const r = frameRect(d) ?? d.contentBounds({ tight: true, visibleOnly: false }) ?? { x: 0, y: 0, w: 1024, h: 1024 }
    const m = this.gpu.maxTexture
    return { x: r.x, y: r.y, w: Math.max(1, Math.min(m, r.w)), h: Math.max(1, Math.min(m, r.h)) }
  }

  /** infinite: copy the rectangle into the temporary fixed document (once per edit); resizes the target when the frame changed */
  private sync(): void {
    if (!this.doc.isInfinite || !this.stale && this.work) return
    this.stale = false
    const r = this.area()
    this.work?.dispose()
    this.work = infiniteToFixed(this.gpu, this.doc, r)
    if (r.w !== this.sw || r.h !== this.sh) {
      this.full.dispose()
      this.full = this.gpu.surface(r.w, r.h, this.doc.format)
      this.sw = r.w
      this.sh = r.h
    }
  }

  /** the document `roots` belong to as far as rendering goes (infinite: the frame copy) */
  private roots(roots: Layer[]): Layer[] {
    if (!this.work) return roots
    const w = this.work
    return roots.map((l) => w.getLayer(l.id)).filter((l): l is Layer => !!l)
  }

  /** Render roots (bottom->top) at full canvas size into an internal surface and return it (valid until next call). */
  renderFull(roots: Layer[]): Surface {
    this.sync()
    this.renderer.render(this.roots(roots), this.full, null, null)
    return this.full
  }

  /** Render roots into a caller-owned surface of the document's size. */
  renderInto(roots: Layer[], dest: Surface): void {
    this.sync()
    this.renderer.render(this.roots(roots), dest, null, null)
  }

  /**
   * Straight RGBA8 bitmap of the roots. `paper` = opaque background colour (0..1) or null to keep transparency.
   * `size` resamples (box filter) to a different resolution.
   */
  bitmap(roots: Layer[], opts: { paper?: [number, number, number] | null; size?: { width: number; height: number } } = {}): Bitmap {
    const src = this.renderFull(roots)
    const w = opts.size?.width ?? this.width
    const h = opts.size?.height ?? this.height
    if (!this.out || this.out.w !== w || this.out.h !== h) {
      this.out?.dispose()
      this.out = this.gpu.surface(w, h, 'rgba8')
    }
    resample(this.gpu, src, this.out, { paper: opts.paper ?? null })
    return { width: w, height: h, data: this.gpu.readRGBA8(this.out, { x: 0, y: 0, w, h }) }
  }

  /** infinite: where the rendered area sits in the document (ghost layers are written back there) */
  areaRect(): Rect {
    return this.doc.isInfinite ? this.area() : { x: 0, y: 0, w: this.doc.width, h: this.doc.height }
  }

  dispose(): void {
    for (const o of this.offs) o()
    this.offs = []
    this.renderer.dispose()
    this.full.dispose()
    this.out?.dispose()
    this.work?.dispose()
    this.work = null
  }
}

/** Run `fn` with the compositor showing the REAL document (no Animation/Page Assist view override), then restore. */
export function withRealView<T>(comp: Compositor, doc: Document, fn: () => T): T {
  const prev = comp.rootProvider
  comp.rootProvider = null
  try {
    return fn()
  } finally {
    comp.rootProvider = prev
    if (prev) doc.events.emit('change', { rect: null })
  }
}

/** Composite of the real document (with background if `withBackground` and visible), straight RGBA8. */
export function flattenedBitmap(comp: Compositor, doc: Document, withBackground: boolean, lang?: string): Bitmap {
  const img = withRealView(comp, doc, () => readExportArea(doc, comp, withBackground, undefined, lang))
  return { width: img.w, height: img.h, data: img.px }
}

/** One paint layer's pixels as straight RGBA, with its mask baked into alpha. */
export function layerBitmap(gpu: GPU, doc: Document, layer: Layer): Bitmap {
  const full = { x: 0, y: 0, w: doc.width, h: doc.height }
  const data = gpu.readRGBA8(layer.pixels, full)
  if (layer.mask && layer.maskEnabled) {
    const m = gpu.readRGBA8(layer.mask, full)
    for (let i = 0; i < data.length; i += 4) {
      const luma = (0.299 * m[i] + 0.587 * m[i + 1] + 0.114 * m[i + 2]) / 255
      data[i + 3] = data[i + 3] * luma * (m[i + 3] / 255)
    }
  }
  return { width: doc.width, height: doc.height, data }
}
