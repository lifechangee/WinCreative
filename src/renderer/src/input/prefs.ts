import { Emitter } from '../core/events'
import { CurvePoint, LINEAR_CURVE, sanitizeCurve } from '../core/pressure'

/** Persistent user preferences that concern interface + input. Stored in localStorage as JSON. */
export interface Prefs {
  // interface
  /** UI language: 'auto' = OS language (navigator.language), else a supported language id (see i18n) */
  language: 'auto' | 'en' | 'ru'
  theme: 'dark' | 'light'
  rightHandInterface: boolean
  /** vertical position of the sidebar 0..1 */
  sidebarY: number
  cursorMode: 'contrast' | 'color' | 'none'
  dynamicBrushScaling: boolean
  rotationSnap: boolean
  showZoomHud: boolean
  reducedMotion: boolean
  highContrast: boolean
  largeText: boolean
  tooltips: boolean
  wheelZoom: boolean
  selectionMaskVisibility: number
  showShortcutsOnCtrlHold: boolean
  /** time-lapse editor: new recordings start with "hide undone actions" switched on */
  timelapseHideUndone: boolean
  // pressure / smoothing
  pressureCurve: CurvePoint[]
  autoCalibrate: boolean
  calibPeak: number
  calibHits: number
  pressureSmoothing: number
  touchSmoothing: number
  /** draw the predicted stroke tip (getPredictedEvents) as a display-only overlay: hides ~1-2 frames of input latency */
  predictStroke: boolean
  /** global StreamLine override (0..1); null = use each brush's own */
  streamline: number | null
  mousePressure: 'constant' | 'velocity'
  /** pressure curve applied to finger strokes (the pen curve above is used for pen / mouse) */
  touchPressureCurve: CurvePoint[]
  /** finger pressure when the device reports no force: constant, or simulated from finger speed */
  touchPressure: 'constant' | 'velocity'
  // touch
  touchDraws: boolean
  palmRejection: boolean
  touchHoldDelay: number
  penHoldDelay: number
  rapidUndoDelay: number
  /** press-and-hold on the Smudge / Eraser toolbar button switches to it temporarily (ms, 0 = off) */
  quickToolSwitchMs: number
  /** Advanced gesture timing (Gesture Controls > Advanced) */
  gestureAdv: { tapMs: number; moveTol: number; holdMs: number }
  /** gesture -> action id ('none' disables) */
  gestures: {
    twoFingerTap: string
    threeFingerTap: string
    fourFingerTap: string
    twoFingerHold: string
    threeFingerHold: string
    threeFingerScrub: string
    threeFingerSwipeDown: string
    quickPinch: string
    touchHold: string
    penHold: string
  }
  // pen hardware
  pen: {
    barrel: string
    barrel2: string
    eraserEnd: string
    hoverProximity: boolean
    /** hovering pen: Shift + move = brush size, Ctrl+Shift + move = opacity (Apple Pencil hover pinch / slide equivalents) */
    hoverAdjust: boolean
  }
  mouse: { right: string; middle: string }
  modifyButton: string
  /** user shortcut overrides: action id -> combos (empty array = unbound) */
  shortcuts: Record<string, string[]>
  /** QuickMenus: each has 6 action ids */
  quickMenus: string[][]
}

export const DEFAULT_QUICKMENUS: string[][] = [
  ['edit.copy', 'edit.paste', 'layer.new', 'transform.flipH', 'select.all', 'layer.merge'],
  ['tool.brush', 'tool.smudge', 'tool.eraser', 'ui.color', 'ui.layers', 'view.fit']
]

export const defaultPrefs = (): Prefs => ({
  language: 'auto',
  theme: 'dark',
  rightHandInterface: false,
  sidebarY: 0.5,
  cursorMode: 'contrast',
  dynamicBrushScaling: false,
  rotationSnap: true,
  showZoomHud: true,
  reducedMotion: false,
  highContrast: false,
  largeText: false,
  tooltips: true,
  wheelZoom: true,
  selectionMaskVisibility: 0.5,
  showShortcutsOnCtrlHold: true,
  timelapseHideUndone: true,
  pressureCurve: LINEAR_CURVE.points.map((p) => [...p] as CurvePoint),
  autoCalibrate: true,
  calibPeak: 0,
  calibHits: 0,
  pressureSmoothing: 0,
  touchSmoothing: 0,
  predictStroke: true,
  streamline: null,
  mousePressure: 'constant',
  touchPressureCurve: LINEAR_CURVE.points.map((p) => [...p] as CurvePoint),
  touchPressure: 'constant',
  touchDraws: true,
  palmRejection: true,
  touchHoldDelay: 600,
  penHoldDelay: 0,
  rapidUndoDelay: 90,
  quickToolSwitchMs: 450,
  gestureAdv: { tapMs: 350, moveTol: 14, holdMs: 450 },
  gestures: {
    twoFingerTap: 'edit.undo',
    threeFingerTap: 'edit.redo',
    fourFingerTap: 'ui.fullscreen',
    twoFingerHold: 'edit.undo',
    threeFingerHold: 'edit.redo',
    threeFingerScrub: 'layer.clear',
    threeFingerSwipeDown: 'edit.pasteMenu',
    quickPinch: 'view.fit',
    touchHold: 'tool.eyedropper',
    penHold: 'none'
  },
  pen: { barrel: 'tool.eyedropper', barrel2: 'ui.quickMenu', eraserEnd: 'tool.eraser', hoverProximity: true, hoverAdjust: true },
  mouse: { right: 'none', middle: 'nav.pan' },
  modifyButton: 'tool.eyedropper',
  shortcuts: {},
  quickMenus: DEFAULT_QUICKMENUS.map((m) => [...m]),
})

const KEY = 'brushwork.prefs.v1'

function merge<T>(base: T, over: unknown): T {
  if (over === null || typeof over !== 'object' || Array.isArray(base) || base === null || typeof base !== 'object') return (over === undefined ? base : (over as T)) ?? base
  const out: Record<string, unknown> = { ...(base as Record<string, unknown>) }
  for (const [k, v] of Object.entries(over as Record<string, unknown>)) {
    if (!(k in out)) continue
    const b = out[k]
    if (b !== null && typeof b === 'object' && !Array.isArray(b)) out[k] = merge(b, v)
    else if (typeof b === typeof v || b === null || v === null) out[k] = v
  }
  return out as T
}

export class PrefStore {
  readonly events = new Emitter<{ change: keyof Prefs | '*' }>()
  v: Prefs = defaultPrefs()
  private timer = 0

  constructor(private storage: Pick<Storage, 'getItem' | 'setItem'> | null = safeStorage()) {
    this.load()
  }

  load(): void {
    try {
      const s = this.storage?.getItem(KEY)
      if (s) this.v = merge(defaultPrefs(), JSON.parse(s))
    } catch {
      this.v = defaultPrefs()
    }
    this.v.pressureCurve = sanitizeCurve(this.v.pressureCurve).points
    this.v.touchPressureCurve = sanitizeCurve(this.v.touchPressureCurve).points
    if (!Array.isArray(this.v.quickMenus) || !this.v.quickMenus.length) this.v.quickMenus = defaultPrefs().quickMenus
    this.v.quickMenus = this.v.quickMenus.slice(0, 5).map((m) => {
      const a = Array.isArray(m) ? m.slice(0, 6) : []
      while (a.length < 6) a.push('none')
      return a
    })
  }

  save(): void {
    clearTimeout(this.timer)
    this.timer = window.setTimeout(() => {
      try {
        this.storage?.setItem(KEY, JSON.stringify(this.v))
      } catch {
        /* storage unavailable */
      }
    }, 150)
  }

  set<K extends keyof Prefs>(key: K, value: Prefs[K]): void {
    this.v[key] = value
    this.events.emit('change', key)
    this.save()
  }

  /** call after mutating nested fields in place */
  touch(key: keyof Prefs | '*' = '*'): void {
    this.events.emit('change', key)
    this.save()
  }

  reset(keys?: (keyof Prefs)[]): void {
    const d = defaultPrefs()
    if (!keys) this.v = d
    else for (const k of keys) (this.v as unknown as Record<string, unknown>)[k] = d[k]
    this.events.emit('change', '*')
    this.save()
  }
}

function safeStorage(): Storage | null {
  try {
    return typeof localStorage !== 'undefined' ? localStorage : null
  } catch {
    return null
  }
}

/** App-wide singleton (renderer). */
export const prefs = new PrefStore()
