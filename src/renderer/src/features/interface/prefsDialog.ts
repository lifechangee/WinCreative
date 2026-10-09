import type { App } from '../../app/app'
import { PRESSURE_PRESETS } from '../../core/pressure'
import { ActionDef, actionCategory, actionLabel, listActions } from '../../input/actions'
import { I18nRef, I18nText, LANGS, onLangChange, t, tk } from '../../i18n'
import { DEFAULT_GESTURE_CONFIG, TouchGestures } from '../../input/gestures'
import { defaultPrefs, Prefs, prefs } from '../../input/prefs'
import { comboFromEvent } from '../../input/shortcutMap'
import { saveShortcuts, shortcutMap, syncShortcutOverrides } from '../../input/shortcuts'
import { clearThumbnails } from '../brushes/preview'
import { isProjecting, toggleProjector } from './projector'
import { h } from '../../ui/dom'
import { createCurveEditor } from './curveEditor'
import { createDiagnostics, createTestPad } from './diagnostics'
import { buildRadial, slotLabel } from './quickMenu'

// ------------------------------------------------------------------ small control builders
function toggle(get: () => boolean, set: (v: boolean) => void): HTMLElement {
  const b = h('button', { class: 'toggle' + (get() ? ' on' : ''), role: 'switch' })
  b.addEventListener('click', () => {
    const v = !get()
    set(v)
    b.classList.toggle('on', v)
  })
  return b
}

function slider(min: number, max: number, step: number, get: () => number, set: (v: number) => void, fmt: (v: number) => string = (v) => String(v)): HTMLElement {
  const val = h('span', { class: 'val', text: fmt(get()) })
  const input = h('input', { type: 'range', min, max, step, value: get() }) as HTMLInputElement
  input.addEventListener('input', () => {
    const v = Number(input.value)
    val.textContent = fmt(v)
    set(v)
  })
  return h('div', { style: 'display:flex;align-items:center;gap:8px' }, input, val)
}

function select(options: [string, I18nText][], get: () => string, set: (v: string) => void): HTMLSelectElement {
  const s = h('select') as HTMLSelectElement
  for (const [v, l] of options) s.append(h('option', { value: v, text: l }))
  s.value = get()
  s.addEventListener('change', () => set(s.value))
  return s
}

function seg(options: [string, I18nText][], get: () => string, set: (v: string) => void): HTMLElement {
  const wrap = h('div', { class: 'seg' })
  const sync = (): void => wrap.querySelectorAll('button').forEach((b) => b.classList.toggle('sel', b.dataset.v === get()))
  for (const [v, l] of options) {
    const b = h('button', { text: l })
    b.dataset.v = v
    b.addEventListener('click', () => {
      set(v)
      sync()
    })
    wrap.append(b)
  }
  sync()
  return wrap
}

function row(label: string | I18nRef, hint: I18nText | null, control: HTMLElement): HTMLElement {
  return h('div', { class: 'prow' }, h('label', null, label, hint ? h('span', { class: 'hint', text: hint }) : null), control)
}

function actionSelect(get: () => string, set: (v: string) => void, filter?: (a: ActionDef) => boolean): HTMLSelectElement {
  const s = h('select') as HTMLSelectElement
  s.append(h('option', { value: 'none', text: tk('interface.prefs.none_paren') }))
  const groups = new Map<string, HTMLOptGroupElement>()
  for (const a of listActions()) {
    if (filter && !filter(a)) continue
    let g = groups.get(a.category)
    if (!g) {
      g = h('optgroup', { label: actionCategory(a) }) as HTMLOptGroupElement
      groups.set(a.category, g)
      s.append(g)
    }
    g.append(h('option', { value: a.id, text: actionLabel(a) }))
  }
  if (get() && ![...s.options].some((o) => o.value === get())) s.append(h('option', { value: get(), text: get() }))
  s.value = get() || 'none'
  s.addEventListener('change', () => set(s.value))
  return s
}

const P = prefs
const set = <K extends keyof Prefs>(k: K) => (v: Prefs[K]): void => P.set(k, v)

// ------------------------------------------------------------------ tabs
type Builder = (pane: HTMLElement, app: App, rerender: () => void) => (() => void) | void

const interfaceTab: Builder = (pane) => {
  pane.append(h('h4', { text: tk('interface.prefs.appearance') }))
  pane.append(
    row(
      tk('interface.prefs.language'),
      tk('interface.prefs.language_hint'),
      select([['auto', tk('interface.prefs.language_auto')], ...LANGS.map((l) => [l.id, l.name] as [string, string])], () => P.v.language, (v) => P.set('language', v as Prefs['language']))
    )
  )
  pane.append(row(tk('interface.prefs.interface_theme'), null, seg([['dark', tk('interface.prefs.dark')], ['light', tk('interface.prefs.light')]], () => P.v.theme, (v) => P.set('theme', v as 'dark'))))
  pane.append(row(tk('interface.prefs.right_hand_interface'), tk('interface.prefs.moves_the_sidebar_to_the_right_side_of'), toggle(() => P.v.rightHandInterface, set('rightHandInterface'))))
  pane.append(row(tk('interface.prefs.brush_cursor'), tk('interface.prefs.outline_shown_at_the_pen_pointer'), select([['contrast', tk('interface.prefs.contrast_outline')], ['color', tk('interface.prefs.active_color_outline')], ['none', tk('interface.prefs.none')]], () => P.v.cursorMode, (v) => P.set('cursorMode', v as 'none'))))
  pane.append(row(tk('interface.prefs.dynamic_brush_scaling'), tk('interface.prefs.keep_the_brush_the_same_size_on_screen'), toggle(() => P.v.dynamicBrushScaling, set('dynamicBrushScaling'))))
  pane.append(row(tk('interface.prefs.canvas_rotation_snapping'), tk('interface.prefs.snap_to_0_90_180_270_degrees_while_rot'), toggle(() => P.v.rotationSnap, set('rotationSnap'))))
  pane.append(row(tk('interface.prefs.zoom_rotation_readout'), null, toggle(() => P.v.showZoomHud, set('showZoomHud'))))
  pane.append(row(tk('interface.prefs.tooltips'), null, toggle(() => P.v.tooltips, set('tooltips'))))
  pane.append(row(tk('interface.prefs.selection_mask_visibility'), tk('interface.prefs.opacity_of_the_selection_overlay'), slider(0, 1, 0.05, () => P.v.selectionMaskVisibility, set('selectionMaskVisibility'), (v) => Math.round(v * 100) + '%')))
  pane.append(row(tk('interface.prefs.mouse_wheel_zooms'), tk('interface.prefs.off_wheel_pans_ctrl_wheel_always_zooms'), toggle(() => P.v.wheelZoom, set('wheelZoom'))))
  pane.append(row(tk('interface.prefs.hold_ctrl_to_show_shortcuts'), null, toggle(() => P.v.showShortcutsOnCtrlHold, set('showShortcutsOnCtrlHold'))))
  pane.append(h('h4', { text: tk('interface.prefs.accessibility') }))
  pane.append(row(tk('interface.prefs.high_contrast'), null, toggle(() => P.v.highContrast, set('highContrast'))))
  pane.append(row(tk('interface.prefs.larger_interface_text'), null, toggle(() => P.v.largeText, set('largeText'))))
  pane.append(row(tk('interface.prefs.reduce_motion'), tk('interface.prefs.disables_interface_animations'), toggle(() => P.v.reducedMotion, set('reducedMotion'))))
}

const pressureTab: Builder = (pane, app) => {
  const curveObj = { get points() { return P.v.pressureCurve } }
  let ed: ReturnType<typeof createCurveEditor>
  const apply = (): void => {
    P.touch('pressureCurve')
  }
  ed = createCurveEditor(300, () => curveObj as never, apply)
  const pad = createTestPad(app, 300, 150, (_e, cal) => ed.setLive(cal > 0 ? cal : null))
  const presets = h('div', { class: 'seg', style: 'margin-top:8px;flex-wrap:wrap' })
  for (const [name, c] of Object.entries(PRESSURE_PRESETS)) {
    presets.append(
      h('button', {
        text: tk('interface.prefs.preset.' + name.toLowerCase().replace(/[^a-z]+/g, '_')),
        onclick: () => {
          P.v.pressureCurve = c.points.map((p) => [...p] as [number, number])
          apply()
          ed.redraw()
        }
      })
    )
  }
  pane.append(
    h('h4', { text: tk('interface.prefs.pressure_curve') }),
    h('p', { class: 'kbd', text: tk('interface.prefs.drag_points_to_shape_the_response_clic') }),
    h('div', { class: 'curve-wrap' }, h('div', null, ed.el, presets), h('div', null, pad.el, h('p', { class: 'kbd', text: tk('interface.prefs.draw_on_the_test_pad_with_your_pen_to') })))
  )
  // finger strokes get their own curve
  const touchObj = { get points() { return P.v.touchPressureCurve } }
  const ted = createCurveEditor(300, () => touchObj as never, () => P.touch('touchPressureCurve'))
  pane.append(
    h('h4', { text: tk('interface.prefs.touch_pressure_curve') }),
    h('p', { class: 'kbd', text: tk('interface.prefs.applied_to_finger_strokes_devices_that') }),
    h('div', { class: 'curve-wrap' }, ted.el),
    row(tk('interface.prefs.finger_pressure_source'), tk('interface.prefs.used_when_the_screen_reports_no_touch'), select([['constant', tk('interface.prefs.constant')], ['velocity', tk('interface.prefs.speed_based')]], () => P.v.touchPressure, (v) => P.set('touchPressure', v as 'constant'))),
    row(tk('interface.prefs.reset_touch_curve'), null, h('button', { class: 'btn', text: tk('interface.prefs.reset'), onclick: () => { P.v.touchPressureCurve = defaultPrefs().touchPressureCurve; P.touch('touchPressureCurve'); ted.redraw() } }))
  )
  pane.append(h('h4', { text: tk('interface.prefs.smoothing') }))
  pane.append(row(tk('interface.prefs.pressure_smoothing'), tk('interface.prefs.low_pass_filter_on_pen_pressure'), slider(0, 1, 0.01, () => P.v.pressureSmoothing, set('pressureSmoothing'), (v) => Math.round(v * 100) + '%')))
  pane.append(row(tk('interface.prefs.touch_smoothing'), tk('interface.prefs.smooths_finger_strokes'), slider(0, 1, 0.01, () => P.v.touchSmoothing, set('touchSmoothing'), (v) => Math.round(v * 100) + '%')))
  pane.append(
    row(tk('interface.prefs.global_streamline'), tk('interface.prefs.override_every_brush_s_own_streamline'), toggle(() => P.v.streamline !== null, (v) => P.set('streamline', v ? 0.3 : null)))
  )
  pane.append(row(tk('interface.prefs.streamline_amount'), null, slider(0, 1, 0.01, () => P.v.streamline ?? 0, (v) => P.set('streamline', v), (v) => Math.round(v * 100) + '%')))
  pane.append(h('h4', { text: tk('interface.prefs.devices') }))
  pane.append(row(tk('interface.prefs.mouse_pressure'), tk('interface.prefs.simulated_pressure_for_mouse_users'), select([['constant', tk('interface.prefs.constant')], ['velocity', tk('interface.prefs.speed_based')]], () => P.v.mousePressure, (v) => P.set('mousePressure', v as 'constant'))))
  pane.append(row(tk('interface.prefs.auto_calibrate_pen_pressure'), tk('interface.prefs.detects_drivers_that_never_reach_full'), toggle(() => P.v.autoCalibrate, (v) => {
    P.set('autoCalibrate', v)
    app.input.calibrator.enabled = v
  })))
  pane.append(row(tk('interface.prefs.reset_pressure_curve'), null, h('button', { class: 'btn', text: tk('interface.prefs.reset'), onclick: () => { P.v.pressureCurve = defaultPrefs().pressureCurve; apply(); ed.redraw() } })))
}

const GESTURE_ROWS: [keyof Prefs['gestures'], I18nRef][] = [
  ['twoFingerTap', tk('interface.prefs.two_finger_tap')],
  ['threeFingerTap', tk('interface.prefs.three_finger_tap')],
  ['fourFingerTap', tk('interface.prefs.four_finger_tap')],
  ['twoFingerHold', tk('interface.prefs.two_finger_tap_and_hold_repeats')],
  ['threeFingerHold', tk('interface.prefs.three_finger_tap_and_hold_repeats')],
  ['threeFingerScrub', tk('interface.prefs.three_finger_scrub')],
  ['threeFingerSwipeDown', tk('interface.prefs.three_finger_swipe_down')],
  ['quickPinch', tk('interface.prefs.quick_pinch')],
  ['touchHold', tk('interface.prefs.touch_and_hold_finger')],
  ['penHold', tk('interface.prefs.touch_and_hold_pen_tip')]
]

const gesturesTab: Builder = (pane, _app, rerender) => {
  pane.append(h('h4', { text: tk('interface.prefs.touch') }))
  pane.append(row(tk('interface.prefs.draw_with_finger'), tk('interface.prefs.off_fingers_only_navigate_disable_touc'), toggle(() => P.v.touchDraws, set('touchDraws'))))
  pane.append(row(tk('interface.prefs.palm_rejection'), tk('interface.prefs.ignore_touches_while_a_pen_is_in_range'), toggle(() => P.v.palmRejection, set('palmRejection'))))
  pane.append(h('h4', { text: tk('interface.prefs.delays') }))
  pane.append(row(tk('interface.prefs.touch_and_hold_delay'), null, slider(200, 1500, 50, () => P.v.touchHoldDelay, set('touchHoldDelay'), (v) => t('interface.prefs.fmt.ms', { n: v }))))
  pane.append(row(tk('interface.prefs.pen_hold_delay_0_off'), null, slider(0, 1500, 50, () => P.v.penHoldDelay, set('penHoldDelay'), (v) => (v ? t('interface.prefs.fmt.ms', { n: v }) : t('interface.prefs.fmt.off')))))
  pane.append(row(tk('interface.prefs.rapid_undo_delay'), tk('interface.prefs.interval_between_repeated_undo_redo_wh'), slider(40, 400, 10, () => P.v.rapidUndoDelay, set('rapidUndoDelay'), (v) => t('interface.prefs.fmt.ms', { n: v }))))
  pane.append(h('h4', { text: tk('interface.prefs.advanced_gesture_settings') }))
  pane.append(row(tk('interface.prefs.tap_duration'), tk('interface.prefs.longest_finger_down_time_that_still_co'), slider(120, 800, 10, () => P.v.gestureAdv.tapMs, (v) => { P.v.gestureAdv.tapMs = v; P.touch('gestureAdv') }, (v) => t('interface.prefs.fmt.ms', { n: v }))))
  pane.append(row(tk('interface.prefs.movement_tolerance'), tk('interface.prefs.how_far_fingers_may_drift_during_a_tap'), slider(4, 40, 1, () => P.v.gestureAdv.moveTol, (v) => { P.v.gestureAdv.moveTol = v; P.touch('gestureAdv') }, (v) => t('interface.prefs.fmt.px', { n: v }))))
  pane.append(row(tk('interface.prefs.two_three_finger_hold_time'), tk('interface.prefs.delay_before_a_held_multi_finger_tap_s'), slider(200, 1200, 10, () => P.v.gestureAdv.holdMs, (v) => { P.v.gestureAdv.holdMs = v; P.touch('gestureAdv') }, (v) => t('interface.prefs.fmt.ms', { n: v }))))
  pane.append(row(tk('interface.prefs.hold_smudge_eraser_to_quick_switch'), tk('interface.prefs.press_and_hold_the_tool_button_to_use'), slider(0, 1000, 50, () => P.v.quickToolSwitchMs, set('quickToolSwitchMs'), (v) => (v ? t('interface.prefs.fmt.ms', { n: v }) : t('interface.prefs.fmt.off')))))
  pane.append(h('h4', { text: tk('interface.prefs.gesture_assignments') }))
  for (const [k, label] of GESTURE_ROWS) {
    pane.append(row(label, null, actionSelect(() => P.v.gestures[k], (v) => { P.v.gestures[k] = v; P.touch('gestures') })))
  }
  pane.append(row(tk('interface.prefs.reset_gestures_to_default'), null, h('button', { class: 'btn', text: tk('interface.prefs.reset'), onclick: () => { P.v.gestures = defaultPrefs().gestures; P.v.gestureAdv = defaultPrefs().gestureAdv; P.v.quickToolSwitchMs = defaultPrefs().quickToolSwitchMs; P.touch('gestures'); rerender() } })))
  // practice pad
  const out = h('div', { style: 'font-size:15px;font-weight:600;margin-top:8px', text: t('interface.prefs.touch_the_pad_with_1_4_fingers') })
  const padEl = h('div', { style: 'height:150px;border:1px dashed var(--line);border-radius:12px;display:grid;place-items:center;touch-action:none;background:var(--panel2)' }, out)
  const g = new TouchGestures({ ...DEFAULT_GESTURE_CONFIG }, (ev) => {
    if (ev.type === 'transform') return
    const what =
      ev.type === 'tap' ? t('interface.prefs.pad.tap', { count: ev.fingers })
      : ev.type === 'hold' ? t('interface.prefs.pad.hold', { count: ev.fingers, phase: ev.phase })
      : ev.type === 'scrub' ? t('interface.prefs.pad.scrub')
      : ev.type === 'swipeDown' ? t('interface.prefs.pad.swipeDown')
      : ev.type === 'longPress' ? t('interface.prefs.pad.longPress')
      : ev.type
    out.textContent = t('interface.prefs.pad.recognized', { what })
  })
  const ids = new Set<number>()
  let timer = 0
  const ensure = (): void => {
    if (!timer) timer = window.setInterval(() => g.tick(performance.now()), 30)
  }
  padEl.addEventListener('pointerdown', (e) => {
    if (e.pointerType !== 'touch') return
    padEl.setPointerCapture(e.pointerId)
    ids.add(e.pointerId)
    g.cfg.longPressMs = P.v.touchHoldDelay
    g.cfg.repeatMs = P.v.rapidUndoDelay
    g.down(e.pointerId, e.clientX, e.clientY, e.timeStamp)
    ensure()
  })
  padEl.addEventListener('pointermove', (e) => ids.has(e.pointerId) && g.move(e.pointerId, e.clientX, e.clientY, e.timeStamp))
  const up = (e: PointerEvent): void => {
    if (!ids.delete(e.pointerId)) return
    g.up(e.pointerId, e.timeStamp, e.type === 'pointercancel')
    if (!ids.size) {
      clearInterval(timer)
      timer = 0
    }
  }
  padEl.addEventListener('pointerup', up)
  padEl.addEventListener('pointercancel', up)
  pane.append(h('h4', { text: tk('interface.prefs.gesture_practice_pad') }), padEl)
  return () => clearInterval(timer)
}

const penTab: Builder = (pane) => {
  pane.append(h('h4', { text: tk('interface.prefs.pen_buttons_windows_ink_wacom_huion_xp') }))
  pane.append(h('p', { class: 'kbd', text: tk('interface.prefs.buttons_are_read_from_the_pointer_even') }))
  pane.append(row(tk('interface.prefs.barrel_button'), null, actionSelect(() => P.v.pen.barrel, (v) => { P.v.pen.barrel = v; P.touch('pen') })))
  pane.append(row(tk('interface.prefs.second_barrel_button'), null, actionSelect(() => P.v.pen.barrel2, (v) => { P.v.pen.barrel2 = v; P.touch('pen') })))
  pane.append(row(tk('interface.prefs.eraser_end_of_the_pen'), null, select([['tool.eraser', tk('interface.prefs.erase')], ['none', tk('interface.prefs.ignore_paint')]], () => P.v.pen.eraserEnd, (v) => { P.v.pen.eraserEnd = v; P.touch('pen') })))
  pane.append(row(tk('interface.prefs.show_brush_outline_while_hovering'), tk('interface.prefs.uses_pen_proximity_events'), toggle(() => P.v.pen.hoverProximity, (v) => { P.v.pen.hoverProximity = v; P.touch('pen') })))
  pane.append(row(tk('interface.prefs.hover_size_opacity'), tk('interface.prefs.hovering_pen_shift_move_sideways_brush'), toggle(() => P.v.pen.hoverAdjust, (v) => { P.v.pen.hoverAdjust = v; P.touch('pen') })))
  pane.append(row(tk('interface.prefs.predict_stroke_tip'), tk('interface.prefs.shows_where_the_pen_is_heading_display'), toggle(() => P.v.predictStroke, (v) => { P.v.predictStroke = v; P.touch('predictStroke') })))
  pane.append(h('h4', { text: tk('interface.prefs.mouse') }))
  pane.append(row(tk('interface.prefs.right_button'), null, actionSelect(() => P.v.mouse.right, (v) => { P.v.mouse.right = v; P.touch('mouse') })))
  pane.append(row(tk('interface.prefs.middle_button'), null, actionSelect(() => P.v.mouse.middle, (v) => { P.v.mouse.middle = v; P.touch('mouse') })))
  pane.append(h('h4', { text: tk('interface.prefs.sidebar_modify_button') }))
  pane.append(row(tk('interface.prefs.modify_button_hold'), tk('interface.prefs.the_square_button_between_the_sliders'), actionSelect(() => P.v.modifyButton, set('modifyButton'))))
  pane.append(h('h4', { text: tk('interface.prefs.windows_tip') }))
  pane.append(h('p', { class: 'kbd', text: tk('interface.prefs.if_windows_shows_a_circle_when_you_hol') }))
}

const shortcutsTab: Builder = (pane) => {
  const list = h('div')
  const search = h('input', { type: 'text', placeholder: t('interface.prefs.filter_actions'), style: 'width:100%;margin-bottom:8px;padding:7px;border-radius:8px;border:1px solid var(--line);background:var(--panel2);color:var(--text)' }) as HTMLInputElement
  const draw = (): void => {
    list.replaceChildren()
    const q = search.value.toLowerCase()
    let cat = ''
    for (const a of listActions()) {
      if (q && !(actionLabel(a).toLowerCase().includes(q) || actionCategory(a).toLowerCase().includes(q))) continue
      if (a.category === 'Menus' && !q) continue
      if (a.category !== cat) {
        cat = a.category
        list.append(h('h4', { text: actionCategory(a) }))
      }
      const keys = h('div', { class: 'keys' })
      for (const k of shortcutMap.keysFor(a.id)) {
        keys.append(
          h('span', {
            class: 'kchip',
            text: k,
            title: t('interface.prefs.click_to_remove'),
            onclick: () => {
              shortcutMap.unbind(a.id, k)
              saveShortcuts()
              draw()
            }
          })
        )
      }
      const add = h('button', { class: 'btn small', text: tk('interface.prefs.add_key') })
      add.addEventListener('click', () => capture(a, add))
      const reset = h('button', { class: 'btn small', text: tk('interface.prefs.reset'), onclick: () => { shortcutMap.reset(a.id); saveShortcuts(); draw() } })
      list.append(h('div', { class: 'sc-row' }, h('span', { class: 'nm', text: actionLabel(a) }), keys, add, reset))
    }
  }
  const capture = (a: ActionDef, btn: HTMLElement): void => {
    btn.textContent = t('interface.prefs.press_keys')
    btn.classList.add('keycapture')
    let pendingMod = ''
    const done = (combo: string | null): void => {
      window.removeEventListener('keydown', kd, true)
      window.removeEventListener('keyup', ku, true)
      if (combo) {
        const lost = shortcutMap.bind(a.id, combo, false)
        saveShortcuts()
        if (lost.length) console.info('[shortcuts] reassigned', combo, 'from', lost.join(', '))
      }
      draw()
    }
    const kd = (e: KeyboardEvent): void => {
      e.preventDefault()
      e.stopPropagation()
      if (e.key === 'Escape') return done(null)
      const c = comboFromEvent(e)
      if (['Ctrl', 'Alt', 'Shift'].includes(c)) pendingMod = c
      else done(c)
    }
    const ku = (e: KeyboardEvent): void => {
      e.preventDefault()
      if (pendingMod && ['Control', 'Alt', 'Shift', 'Meta'].includes(e.key)) done(pendingMod)
    }
    window.addEventListener('keydown', kd, true)
    window.addEventListener('keyup', ku, true)
  }
  search.addEventListener('input', draw)
  pane.append(
    h('p', { class: 'kbd', text: tk('interface.prefs.assigning_a_key_that_is_already_used_m') }),
    search,
    list,
    h('div', { class: 'row' }, h('button', { class: 'btn', text: tk('interface.prefs.reset_all_shortcuts'), onclick: () => { shortcutMap.reset(); saveShortcuts(); draw() } }))
  )
  draw()
}

const quickMenuTab: Builder = (pane, _app, rerender) => {
  pane.append(h('p', { class: 'kbd', text: tk('interface.prefs.the_quickmenu_opens_with_the_quickmenu') }))
  const menus = P.v.quickMenus
  menus.forEach((m, mi) => {
    const preview = h('div', { class: 'qm-preview' })
    preview.append(buildRadial(m, mi, menus.length, { radius: 88 }))
    ;(preview.firstElementChild as HTMLElement).style.cssText = 'position:absolute;left:125px;top:125px;width:0;height:0'
    const slots = h('div', { class: 'slots' }, h('h4', { text: tk('interface.prefs.quickmenu_n', { n: mi + 1 }) }))
    m.forEach((id, si) => {
      slots.append(
        row(tk('interface.prefs.slot_n', { n: si + 1 }), null, actionSelect(() => id, (v) => {
          m[si] = v
          P.touch('quickMenus')
          rerender()
        }))
      )
    })
    if (menus.length > 1) slots.append(h('button', { class: 'btn small', text: tk('interface.prefs.remove_this_menu'), onclick: () => { menus.splice(mi, 1); P.touch('quickMenus'); rerender() } }))
    pane.append(h('div', { class: 'qm-prefs' }, preview, slots))
  })
  const btns = h('div', { class: 'row' })
  if (menus.length < 5) btns.append(h('button', { class: 'btn', text: tk('interface.prefs.add_quickmenu'), onclick: () => { menus.push(['none', 'none', 'none', 'none', 'none', 'none']); P.touch('quickMenus'); rerender() } }))
  btns.append(h('button', { class: 'btn', text: tk('interface.prefs.reset_quickmenus'), onclick: () => { P.v.quickMenus = defaultPrefs().quickMenus; P.touch('quickMenus'); rerender() } }))
  pane.append(btns)
  void slotLabel
}

const diagTab: Builder = (pane, app) => {
  const d = createDiagnostics(app)
  pane.append(h('h4', { text: tk('interface.prefs.tablet_diagnostics') }), d.el)
  return () => d.dispose()
}

import { tileMemory } from '../../doc/tileMemory'

const advancedTab: Builder = (pane, app, rerender) => {
  pane.append(h('h4', { text: tk('interface.prefs.brush_cache') }))
  pane.append(row(tk('interface.prefs.brush_preview_cache'), tk('interface.prefs.rendered_stroke_previews_used_in_the_b'), h('button', { class: 'btn', text: tk('interface.prefs.clear_cache'), onclick: () => { clearThumbnails(); app.notify(t('interface.prefs.cache_cleared')) } })))
  pane.append(h('h4', { text: tk('interface.prefs.rendering') }))
  const gl = app.gpu.gl
  const ext = gl.getExtension('WEBGL_debug_renderer_info')
  const gpuName = ext ? String(gl.getParameter(ext.UNMASKED_RENDERER_WEBGL)) : String(gl.getParameter(gl.RENDERER))
  pane.append(row(tk('interface.prefs.graphics_device'), null, h('span', { class: 'kbd', text: gpuName })))
  pane.append(row(tk('interface.prefs.max_texture_size'), null, h('span', { class: 'kbd', text: t('interface.prefs.fmt.px', { n: String(gl.getParameter(gl.MAX_TEXTURE_SIZE)) }) })))
  // infinite canvas tile memory: budgets are derived from the device; 0 = automatic
  pane.append(h('h4', { text: tk('ui.inf.mem.title') }))
  const memOv = (): { gpuMB: number; cpuMB: number } => {
    try {
      return { gpuMB: 0, cpuMB: 0, ...(JSON.parse(localStorage.getItem('bw.tileMem') ?? '{}') as object) }
    } catch {
      return { gpuMB: 0, cpuMB: 0 }
    }
  }
  const memInput = (key: 'gpuMB' | 'cpuMB'): HTMLElement => {
    const i = h('input', { type: 'number', min: '0', max: '65536', step: '64', value: String(memOv()[key]), style: 'width:90px' }) as HTMLInputElement
    i.addEventListener('change', () => {
      const o = memOv()
      o[key] = Math.max(0, Math.round(Number(i.value) || 0))
      try {
        localStorage.setItem('bw.tileMem', JSON.stringify(o))
      } catch {
        /* storage unavailable */
      }
      tileMemory.configure(app.gpu)
    })
    return i
  }
  pane.append(row(tk('ui.inf.mem.gpu'), tk('ui.inf.mem.note'), memInput('gpuMB')))
  pane.append(row(tk('ui.inf.mem.cpu'), null, memInput('cpuMB')))
  pane.append(h('h4', { text: tk('interface.prefs.project_canvas') }))
  pane.append(row(tk('interface.prefs.second_window'), tk('interface.prefs.shows_the_artwork_without_the_interfac'), h('button', { class: 'btn', text: isProjecting() ? t('interface.prefs.stopProjecting') : t('interface.prefs.projectCanvas'), onclick: () => { toggleProjector(app); rerender() } })))
  pane.append(h('h4', { text: tk('interface.prefs.reset') }))
  pane.append(row(tk('interface.prefs.reset_all_preferences'), tk('interface.prefs.restores_every_setting_on_every_tab_sh'), h('button', { class: 'btn', text: tk('interface.prefs.reset_everything'), onclick: () => { P.reset(); syncShortcutOverrides(); app.notify(t('interface.prefs.reset_done')) } })))
}

const TABS: [string, I18nRef, Builder][] = [
  ['interface', tk('interface.prefs.tab.interface'), interfaceTab],
  ['pressure', tk('interface.prefs.tab.pressure'), pressureTab],
  ['gestures', tk('interface.prefs.tab.gestures'), gesturesTab],
  ['pen', tk('interface.prefs.tab.pen'), penTab],
  ['shortcuts', tk('interface.prefs.tab.shortcuts'), shortcutsTab],
  ['quickmenu', tk('interface.prefs.tab.quickmenu'), quickMenuTab],
  ['diagnostics', tk('interface.prefs.tab.diagnostics'), diagTab],
  ['advanced', tk('interface.prefs.tab.advanced'), advancedTab]
]

let openBack: HTMLElement | null = null

export function openPrefs(app: App, tab = 'interface'): void {
  openBack?.remove()
  let cleanup: (() => void) | void
  let current = tab
  const pane = h('div', { class: 'prefs-pane' })
  const tabsEl = h('div', { class: 'prefs-tabs' })
  const close = (): void => {
    cleanup?.()
    back.remove()
    openBack = null
    window.removeEventListener('keydown', esc, true)
    offLang()
  }
  const offLang = onLangChange(() => show(current)) // pane content built with plain t() calls: rebuild in the new language
  const esc = (e: KeyboardEvent): void => {
    if (e.key === 'Escape' && !document.querySelector('.keycapture')) close()
  }
  const show = (id: string): void => {
    cleanup?.()
    current = id
    pane.replaceChildren()
    cleanup = TABS.find((t) => t[0] === id)![2](pane, app, () => show(current))
    tabsEl.querySelectorAll('button').forEach((b) => b.classList.toggle('sel', b.dataset.id === id))
  }
  for (const [id, label] of TABS) {
    const b = h('button', { text: label, onclick: () => show(id) })
    b.dataset.id = id
    tabsEl.append(b)
  }
  const modal = h(
    'div',
    { class: 'modal prefs' },
    h('div', { class: 'prefs-head' }, h('h3', { text: tk('interface.prefs.title') }), h('button', { class: 'btn', text: tk('interface.prefs.done'), onclick: close })),
    h('div', { class: 'prefs-main' }, tabsEl, pane)
  )
  const back = h('div', { class: 'modal-back' }, modal)
  back.addEventListener('pointerdown', (e) => e.target === back && close())
  document.body.append(back)
  openBack = back
  window.addEventListener('keydown', esc, true)
  show(current)
}
