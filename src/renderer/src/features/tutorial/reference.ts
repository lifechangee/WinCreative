import { getAction, actionLabel } from '../../input/actions'
import { prefs } from '../../input/prefs'
import { shortcutMap } from '../../input/shortcuts'
import { t } from '../../i18n'

export type RefGroup = 'touch' | 'pen' | 'layers' | 'mouse'

export interface RefCard {
  id: string
  group: RefGroup
  /** illustration scene (illus.ts) */
  anim: string
  /** what the gesture / button is bound to right now (live from prefs); null = fixed behaviour */
  now?: () => string | null
  /** shortcut chips read from the shortcut map (reflects user rebinds) */
  keys?: () => string[]
  /** lesson that practises it */
  lesson?: string
}

/** label of the action bound in prefs, or the "not assigned" text */
const bound = (id: string | undefined): string => {
  const a = id && id !== 'none' ? getAction(id) : undefined
  return a ? actionLabel(a) : t('tutorial.ref.unbound')
}
const gest = (k: keyof typeof prefs.v.gestures) => (): string => bound(prefs.v.gestures[k])
const keysOf = (...ids: string[]) => (): string[] => ids.flatMap((id) => shortcutMap.keysFor(id))

/**
 * Every gesture and pen action the app supports. Texts are `tutorial.ref.<id>.t/.d`; bindings and shortcuts are read from the
 * live preferences / action registry, so remapped pen buttons, gestures and keys show their CURRENT meaning.
 */
export const REF_CARDS: RefCard[] = [
  // ---- touch
  { id: 'draw1', group: 'touch', anim: 'fingerDraw', lesson: 'basics' },
  { id: 'pinch', group: 'touch', anim: 'pinch', lesson: 'nav' },
  { id: 'twist', group: 'touch', anim: 'twist', lesson: 'nav' },
  { id: 'pan2', group: 'touch', anim: 'pan2', lesson: 'nav' },
  { id: 'quickPinch', group: 'touch', anim: 'quickPinch', now: gest('quickPinch'), lesson: 'nav' },
  { id: 'tap2', group: 'touch', anim: 'tap:2', now: gest('twoFingerTap'), lesson: 'basics' },
  { id: 'hold2', group: 'touch', anim: 'hold:2', now: gest('twoFingerHold') },
  { id: 'tap3', group: 'touch', anim: 'tap:3', now: gest('threeFingerTap'), lesson: 'basics' },
  { id: 'hold3', group: 'touch', anim: 'hold:3', now: gest('threeFingerHold') },
  { id: 'scrub3', group: 'touch', anim: 'scrub3', now: gest('threeFingerScrub') },
  { id: 'swipe3', group: 'touch', anim: 'swipe3', now: gest('threeFingerSwipeDown') },
  { id: 'tap4', group: 'touch', anim: 'tap:4', now: gest('fourFingerTap'), lesson: 'quick' },
  { id: 'longPress', group: 'touch', anim: 'touchHold', now: gest('touchHold'), lesson: 'color' },
  { id: 'palm', group: 'touch', anim: 'devices' },
  // ---- pen
  { id: 'pressure', group: 'pen', anim: 'penPressure', lesson: 'pen' },
  { id: 'tilt', group: 'pen', anim: 'penTilt', lesson: 'pen' },
  { id: 'eraserEnd', group: 'pen', anim: 'penEraser', now: () => bound(prefs.v.pen.eraserEnd), lesson: 'pen' },
  { id: 'barrel', group: 'pen', anim: 'penButton', now: () => bound(prefs.v.pen.barrel), lesson: 'penSetup' },
  { id: 'barrel2', group: 'pen', anim: 'penButton', now: () => bound(prefs.v.pen.barrel2), lesson: 'penSetup' },
  { id: 'penHold', group: 'pen', anim: 'penHold', now: gest('penHold') },
  { id: 'quickShape', group: 'pen', anim: 'quickShape', lesson: 'shapes' },
  { id: 'hover', group: 'pen', anim: 'penHover', lesson: 'pen' },
  { id: 'hoverSize', group: 'pen', anim: 'penHoverAdjust', keys: () => ['Shift'], lesson: 'pen' },
  { id: 'hoverOpacity', group: 'pen', anim: 'penHoverAdjust', keys: () => ['Ctrl', 'Shift'], lesson: 'pen' },
  { id: 'curve', group: 'pen', anim: 'curve', lesson: 'penSetup' },
  { id: 'inkRing', group: 'pen', anim: 'ring', lesson: 'penSetup' },
  { id: 'diag', group: 'pen', anim: 'diag', lesson: 'penSetup' },
  // ---- layers
  { id: 'rowTap', group: 'layers', anim: 'layerRow:swipeR', lesson: 'layers' },
  { id: 'rowRight', group: 'layers', anim: 'layerRow:swipeR', lesson: 'layers' },
  { id: 'rowLeft', group: 'layers', anim: 'layerRow:swipeL', lesson: 'layers' },
  { id: 'rowTap2', group: 'layers', anim: 'layerRow:tap2', lesson: 'layers' },
  { id: 'rowAlpha', group: 'layers', anim: 'layerRow:alpha', lesson: 'layers' },
  { id: 'rowAlt', group: 'layers', anim: 'layerRow:altDrag', keys: () => ['Alt'], lesson: 'layers' },
  { id: 'rowPinch', group: 'layers', anim: 'layerRow:pinch', lesson: 'layers' },
  { id: 'rowDrag', group: 'layers', anim: 'layerRow:drag', lesson: 'layers' },
  // ---- mouse and keyboard
  { id: 'space', group: 'mouse', anim: 'mouse:Space', keys: keysOf('nav.pan'), lesson: 'nav' },
  { id: 'rotate', group: 'mouse', anim: 'mouse:R', keys: keysOf('nav.rotate'), lesson: 'nav' },
  { id: 'zoomKey', group: 'mouse', anim: 'mouse:Z', keys: keysOf('nav.zoom', 'view.zoomIn', 'view.zoomOut') },
  { id: 'wheel', group: 'mouse', anim: 'wheel', keys: () => ['Ctrl'], lesson: 'nav' },
  { id: 'fit', group: 'mouse', anim: 'quickPinch', keys: keysOf('view.fit', 'view.resetRotation'), lesson: 'nav' },
  { id: 'eyedropper', group: 'mouse', anim: 'click', keys: keysOf('tool.eyedropper'), lesson: 'color' },
  { id: 'modify', group: 'mouse', anim: 'click', now: () => bound(prefs.v.modifyButton), lesson: 'color' },
  { id: 'tlePause', group: 'mouse', anim: 'timelapse', keys: () => ['P'], lesson: 'export' },
  { id: 'tleRange', group: 'mouse', anim: 'timelapse', keys: () => ['S'], lesson: 'export' },
  { id: 'sizeKeys', group: 'mouse', anim: 'slider:size', keys: keysOf('brush.sizeDown', 'brush.sizeUp', 'brush.opacityDown', 'brush.opacityUp'), lesson: 'basics' },
  { id: 'undoKeys', group: 'mouse', anim: 'keys:Ctrl+Z', keys: keysOf('edit.undo', 'edit.redo'), lesson: 'basics' },
  { id: 'quickMenu', group: 'mouse', anim: 'qm', keys: keysOf('ui.quickMenu'), lesson: 'quick' },
  { id: 'cheat', group: 'mouse', anim: 'cheat', keys: keysOf('ui.cheatsheet'), lesson: 'quick' },
  { id: 'hideUI', group: 'mouse', anim: 'hideUI', keys: keysOf('ui.hideUI', 'ui.fullscreen'), lesson: 'quick' },
  { id: 'rightBtn', group: 'mouse', anim: 'click', now: () => bound(prefs.v.mouse.right) },
  { id: 'middleBtn', group: 'mouse', anim: 'mouse:', now: () => bound(prefs.v.mouse.middle) },
  { id: 'xformKeys', group: 'mouse', anim: 'transform', keys: () => ['Shift', 'Alt'], lesson: 'selxf' }
]

export const REF_GROUPS: RefGroup[] = ['touch', 'pen', 'layers', 'mouse']

/** Text the search box matches against (already localised, incl. the current binding and key chips). */
export function cardSearchText(c: RefCard): string {
  const parts = [t(`tutorial.ref.${c.id}.t`), t(`tutorial.ref.${c.id}.d`), c.now?.() ?? '', ...(c.keys?.() ?? [])]
  return parts.join(' ').toLowerCase()
}
