import type { Document } from '../doc/document'
import type { Layer } from '../doc/layer'
import { StackRenderer } from '../gl/compositor'
import type { Compositor } from '../gl/compositor'
import type { GPU, Surface } from '../gl/gpu'
import type { Bitmap } from './imageFormats'
import { resample } from './gpuUtil'

/**
 * Renders arbitrary lists of root layers/groups (a "frame" or "page") to bitmaps, independent of what is
 * currently visible on screen. Uses its own StackRenderer scratch surfaces so it can run at any time.
 */
export class FrameRenderer {
  readonly renderer: StackRenderer
  private full: Surface
  private out: Surface | null = null

  constructor(
    private gpu: GPU,
    private doc: Document
  ) {
    this.renderer = new StackRenderer(gpu, () => doc)
    this.full = gpu.surface(doc.width, doc.height, doc.format)
  }

  /** Render roots (bottom->top) at full canvas size into an internal surface and return it (valid until next call). */
  renderFull(roots: Layer[]): Surface {
    this.renderer.render(roots, this.full, null, null)
    return this.full
  }

  /** Render roots into a caller-owned surface of the document's size. */
  renderInto(roots: Layer[], dest: Surface): void {
    this.renderer.render(roots, dest, null, null)
  }

  /**
   * Straight RGBA8 bitmap of the roots. `paper` = opaque background colour (0..1) or null to keep transparency.
   * `size` resamples (box filter) to a different resolution.
   */
  bitmap(roots: Layer[], opts: { paper?: [number, number, number] | null; size?: { width: number; height: number } } = {}): Bitmap {
    const src = this.renderFull(roots)
    const w = opts.size?.width ?? this.doc.width
    const h = opts.size?.height ?? this.doc.height
    if (!this.out || this.out.w !== w || this.out.h !== h) {
      this.out?.dispose()
      this.out = this.gpu.surface(w, h, 'rgba8')
    }
    resample(this.gpu, src, this.out, { paper: opts.paper ?? null })
    return { width: w, height: h, data: this.gpu.readRGBA8(this.out, { x: 0, y: 0, w, h }) }
  }

  dispose(): void {
    this.renderer.dispose()
    this.full.dispose()
    this.out?.dispose()
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
export function flattenedBitmap(comp: Compositor, doc: Document, withBackground: boolean): Bitmap {
  const data = withRealView(comp, doc, () => comp.readFlattened(withBackground))
  return { width: doc.width, height: doc.height, data }
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
