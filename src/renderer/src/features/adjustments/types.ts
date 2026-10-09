import type { FX } from '../../gl/filters'
import type { Surface } from '../../gl/gpu'
import type { CurveSet, GradientStop } from './math'

export type Params = Record<string, number>

export interface ParamDef {
  key: string
  label: string
  min: number
  max: number
  def: number
  unit?: '%' | '°' | 'px' | ''
  step?: number
  kind?: 'slider' | 'select' | 'toggle' | 'color' | 'point'
  options?: string[]
  /** second key for 'point' params (x = key, y = key2; both 0..1 of the canvas) */
  key2?: string
  show?: (p: Params) => boolean
}

/** Non-numeric per-session data (curve points, gradient stops, GL resources). JSON-cloneable parts undo cleanly. */
export interface Extra {
  curves: CurveSet
  /** which curve tab the editor shows (UI only) */
  curveChannel: 'master' | 'r' | 'g' | 'b'
  stops: GradientStop[]
  /** liquify displacement field (RG in doc px) - managed by the liquify tool */
  disp: Surface | null
  /** clone accumulator - managed by the clone tool */
  cloneAcc: Surface | null
}

export interface AdjDef {
  id: string
  name: string
  params: ParamDef[]
  /** param dragged horizontally in Layer mode (default: first slider); the last touched slider wins */
  main?: string
  /** which modes are available (default both) */
  modes?: ('layer' | 'pencil')[]
  /** brush-driven tools with their own pointer handling and UI */
  custom?: 'curves' | 'gradient' | 'liquify' | 'clone'
  /** true when the adjustment ignores drag-to-adjust (curves...) */
  noDrag?: boolean
  /** pixel-local colour adjustment: on an infinite canvas Apply covers every tile of the layer (no region limit) */
  local?: boolean
  /** infinite canvas: fraction of the work-rect size to pad the working surface with so neighbourhood filters are exact at the edges */
  pad?: number
  /** src -> dst (both canvas-sized surfaces; never the same one). Must fully write dst. */
  render(fx: FX, src: Surface, dst: Surface, p: Params, x: Extra): void
}

import type { App } from '../../app/app'
import type { Sample } from '../../core/types'
import type { Layer } from '../../doc/layer'

/** What brush-driven (Pencil mode) tools get from the session. */
export interface ToolCtx {
  app: App
  fx: FX
  layer: Layer
  /** surface the preview is drawn into (the layer's own surface on a fixed canvas, a temporary region copy on an infinite one) */
  target: Surface
  extra: Extra
  /** untouched layer pixels from session start */
  orig: Surface
  params(): Params
  /** `target` pixels changed in this (surface-local) rect: show them */
  changed(rect: import('../../core/types').Rect): void
  /** the adjustment output must be recomputed (liquify field changed, ...) */
  invalidate(rect?: import('../../core/types').Rect | null): void
  /** only the combine/preview step must be redone in this rect */
  combine(rect: import('../../core/types').Rect | null): void
  /** clone: where the source crosshair is (doc coords) or null to hide */
  sourceMarker(x: number, y: number, visible: boolean): void
}

export interface PencilTool {
  begin(s: Sample): boolean
  move(ss: Sample[]): void
  /** returns true when the stroke changed something (one session-undo step) */
  end(): boolean
  cancel(): void
  /** revert the last stroke; false when nothing to undo */
  undo(): boolean
  /** discard everything painted so far in this session (undoable) */
  reset(): void
  dispose(): void
  /** current brush diameter in doc px (for the cursor ring) */
  brushSize(): number
  /** true if anything has been painted */
  dirty(): boolean
  /** bounding rect of all changes (null = none) */
  bounds(): import('../../core/types').Rect | null
  /** pencil coverage mask (.a channel) to blend the adjustment with; null/absent = not mask-based */
  coverage?(): Surface | null
}
