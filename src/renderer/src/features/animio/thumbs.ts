import type { App } from '../../app/app'
import type { Layer } from '../../doc/layer'
import type { Surface } from '../../gl/gpu'
import type { FrameRenderer } from '../../io/frameRender'
import { resample } from '../../io/gpuUtil'

/** Renders small previews of frames/pages (layer or group subtrees) into 2D canvases. */
export class ThumbMaker {
  private small: Surface | null = null

  constructor(
    private app: App,
    private fr: () => FrameRenderer
  ) {}

  /** Draw `roots` (bottom->top) onto `cv`, fitting the canvas aspect into maxW x maxH device pixels. */
  draw(cv: HTMLCanvasElement, roots: Layer[], maxW = 176, maxH = 140): void {
    const doc = this.app.doc
    const k = Math.min(maxW / doc.width, maxH / doc.height, 1)
    const w = Math.max(2, Math.round(doc.width * k))
    const h = Math.max(2, Math.round(doc.height * k))
    const gpu = this.app.gpu
    if (!this.small || this.small.w !== w || this.small.h !== h) {
      this.small?.dispose()
      this.small = gpu.surface(w, h, 'rgba8')
    }
    const src = this.fr().renderFull(roots)
    const bg = doc.background
    resample(gpu, src, this.small, { paper: bg.visible ? bg.color : [1, 1, 1] })
    const px = gpu.readRGBA8(this.small, { x: 0, y: 0, w, h })
    cv.width = w
    cv.height = h
    cv.getContext('2d')!.putImageData(new ImageData(px as unknown as Uint8ClampedArray<ArrayBuffer>, w, h), 0, 0)
  }

  dispose(): void {
    this.small?.dispose()
    this.small = null
  }
}
