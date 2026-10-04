import type { App } from '../../app/app'
import type { UIContext } from '../../ui/registry'
import type { Hub, HubEvents } from './hub'
import type { Practice } from './practice'

/** What a step's `watch` gets: subscribe to app events; everything is released when the step ends. */
export interface StepCtx {
  app: App
  ui: UIContext
  hub: Hub
  practice: Practice
  /** the step is done (idempotent) */
  pass(): void
  /** re-check `fn` every `ms` (default 120) and pass as soon as it returns true */
  poll(fn: () => boolean, ms?: number): void
  /** subscribe to a hub event */
  on<K extends keyof HubEvents>(type: K, fn: (p: HubEvents[K]) => void): void
  /** scratch values for the step */
  data: Record<string, number | boolean | string>
}

export type LiveMeter = 'pressure' | 'tilt' | 'buttons' | 'devices'

export interface StepDef {
  /** step id; texts are `tutorial.l.<lesson>.<id>.t` (title) / `.b` (body) */
  id: string
  /** element to spotlight: css selector or resolver (re-evaluated while the step is shown) */
  target?: string | (() => HTMLElement | null)
  /** animated illustration scene, see illus.ts (`keys:Ctrl+Z`, `tap:2`, ...) */
  anim: string
  /** live readout shown under the instruction */
  live?: LiveMeter
  /** needs a pen: shows a "no pen? skip" note until a pen has been seen */
  needsPen?: boolean
  /** extra button under the text (e.g. "Open Preferences > Pen"); label is `tutorial.l.<lesson>.<id>.c` */
  cta?: (c: StepCtx) => void
  /** `{name}` values for the step's texts (live key bindings, current mappings) */
  params?: (app: App) => Record<string, string | number>
  /** run when the step starts (set a tool, seed the view...) */
  prepare?(c: StepCtx): void
  /** wire the success detection; omit for an "information" step that the user confirms with Next */
  watch?(c: StepCtx): void
}

export interface LessonDef {
  id: string
  /** icon name from ui/dom ICONS */
  icon: string
  /** teaches pen features (lesson list shows a pen badge) */
  pen?: boolean
  /** paint content on the practice canvas before the first step */
  setup?(p: Practice, app: App): void
  steps: StepDef[]
}
