import { PaintTool } from '../../tools/paintTool'
import type { ToolHost } from '../../tools/tool'
import type { Sample, Rect } from '../../core/types'
import type { Surface } from '../../gl/gpu'
import { MaskEngine } from './maskBrush'
import type { PencilTool, ToolCtx } from './types'

/**
 * Pencil mode for regular adjustments: the current brush (any preset, pressure dynamics, smoothing) paints a
 * coverage mask; the eraser tool / pen eraser end removes coverage. The adjustment shows only where painted.
 */
export class MaskPencil implements PencilTool {
  readonly engine: MaskEngine
  private paint = new PaintTool('adj-paint', 'paint')
  private erase = new PaintTool('adj-erase', 'erase')
  private cur: PaintTool | null = null
  private host: ToolHost

  constructor(private c: ToolCtx) {
    this.engine = new MaskEngine(c.app.gpu, c.fx, c.orig.w, c.orig.h)
    this.engine.onDirty = (r) => c.combine(r)
    this.host = {
      doc: { activeLayer: c.layer, writableActive: () => c.layer, emitCommit: () => {} },
      engine: this.engine,
      state: c.app.state,
      requestRender: () => c.app.requestRender(),
      notify: (m: string) => c.app.notify(m)
    } as unknown as ToolHost
  }

  begin(s: Sample): boolean {
    this.cur = this.c.app.state.effectiveTool === 'eraser' ? this.erase : this.paint
    if (!this.cur.begin(s, this.host)) {
      this.cur = null
      return false
    }
    return true
  }
  move(ss: Sample[]): void {
    this.cur?.move(ss, this.host)
  }
  end(): boolean {
    const before = this.engine.strokes
    this.cur?.end(this.host)
    this.cur = null
    return this.engine.strokes > before
  }
  cancel(): void {
    this.cur?.cancel(this.host)
    this.cur = null
  }
  undo(): boolean {
    return this.engine.undo() !== null
  }
  reset(): void {
    if (this.engine.painted) this.engine.clear(true)
  }
  dispose(): void {
    this.engine.dispose()
  }
  brushSize(): number {
    return this.c.app.state.settings.size
  }
  dirty(): boolean {
    return this.engine.painted
  }
  bounds(): Rect | null {
    return this.engine.bounds
  }
  coverage(): Surface | null {
    return this.engine.view
  }
}
