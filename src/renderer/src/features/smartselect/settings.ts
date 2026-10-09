import type { BrushOpts } from './brushSeg'
import type { ModelId } from './manifest'
import type { EpChoice } from './ortWorker'
import type { SampleMode } from './source'

export type SmartMode = 'fast' | 'precise' | 'brush'
export type CombineMode = 'replace' | 'add' | 'subtract' | 'intersect'

export interface SsSettings {
  mode: SmartMode
  sample: SampleMode
  combine: CombineMode
  /** next click removes area (the "-" toggle; Alt / eraser end / right click do it momentarily) */
  negative: boolean
  smooth: number
  feather: number
  shift: number
  decontaminate: boolean
  /** brush radius in screen px */
  brushSize: number
  /** 0 = auto, 1..3 = candidate (part / object / whole) */
  level: number
  hover: boolean
  idleMinutes: number
  ep: EpChoice
  /** tuning hook for QA (not saved) */
  brushOpts?: BrushOpts
}

const DEFAULTS: SsSettings = { mode: 'fast', sample: 'layer', combine: 'replace', negative: false, smooth: 0.25, feather: 0, shift: 0, decontaminate: true, brushSize: 34, level: 0, hover: true, idleMinutes: 5, ep: 'auto' }

function load(): SsSettings {
  try {
    const j = JSON.parse(localStorage.getItem('bw.smartselect') ?? '{}')
    const s = { ...DEFAULTS, ...j } as SsSettings
    s.negative = false // never start in negative mode
    delete s.brushOpts
    return s
  } catch {
    return { ...DEFAULTS }
  }
}
export const ss: SsSettings = load()
export function saveSs(): void {
  try {
    localStorage.setItem('bw.smartselect', JSON.stringify({ ...ss, brushOpts: undefined }))
  } catch {
    /* storage unavailable */
  }
}
export const modelOf = (m: SmartMode): ModelId => (m === 'precise' ? 'precise' : 'fast')
