import type { Sample } from '../core/types'
import type { Document } from '../doc/document'
import type { BrushEngine } from '../gl/brushEngine'
import type { AppState } from '../app/state'

/** What tools may use from the app. */
export interface ToolHost {
  readonly doc: Document
  readonly engine: BrushEngine
  readonly state: AppState
  requestRender(): void
  notify(message: string): void
}

/**
 * Pointer-driven tool. Samples arrive in DOCUMENT coordinates with pressure/tilt already
 * normalised. Register tools in app/app.ts (`registerTool`) and map them to a toolbar button.
 */
export interface Tool {
  id: string
  /** last stamped position of the live stroke (document coords): the painted tip (display-only prediction anchors here) */
  tip?: { x: number; y: number } | null
  /** Return false to refuse the stroke (e.g. locked layer). */
  begin(s: Sample, host: ToolHost): boolean
  move(samples: Sample[], host: ToolHost): void
  end(host: ToolHost): void
  cancel(host: ToolHost): void
}
