import type { App } from '../../app/app'
import { makePressureCurve } from '../../core/pressure'
import { tiltToSpherical } from '../../input/penMath'
import { prefs } from '../../input/prefs'
import { t } from '../../i18n'
import { h } from '../../ui/dom'

export interface PadHandle {
  el: HTMLCanvasElement
  clear(): void
}

/**
 * Drawing pad for testing pens: line width follows the (calibrated + curve-mapped) pressure.
 * `onSample` is called for every coalesced event (also while hovering).
 */
export function createTestPad(app: App, w: number, hgt: number, onSample: (e: PointerEvent, calibrated: number) => void): PadHandle {
  const dpr = window.devicePixelRatio || 1
  const cv = h('canvas', { class: 'pad' }) as HTMLCanvasElement
  cv.width = Math.round(w * dpr)
  cv.height = Math.round(hgt * dpr)
  cv.style.cssText = `width:${w}px;height:${hgt}px;border-radius:12px;border:1px solid var(--line);background:var(--panel2);touch-action:none;cursor:crosshair;display:block`
  const ctx = cv.getContext('2d')!
  ctx.scale(dpr, dpr)
  let last: { x: number; y: number; w: number } | null = null
  let down = false
  const label = (): void => {
    ctx.fillStyle = getComputedStyle(document.documentElement).getPropertyValue('--dim')
    ctx.font = '12px "Segoe UI", sans-serif'
    ctx.fillText(t('interface.diag.testPad'), 10, 18)
  }
  const clear = (): void => {
    ctx.clearRect(0, 0, w, hgt)
    label()
  }
  clear()
  const pos = (e: PointerEvent): { x: number; y: number } => {
    const r = cv.getBoundingClientRect()
    return { x: (e.clientX - r.left) * (w / r.width), y: (e.clientY - r.top) * (hgt / r.height) }
  }
  const handle = (e: PointerEvent, ev: PointerEvent): void => {
    const raw = e.pointerType === 'pen' ? ev.pressure : e.pointerType === 'mouse' ? (ev.buttons ? 0.6 : 0) : ev.pressure
    const cal = e.pointerType === 'pen' ? app.input.calibrator.normalize(raw) : raw
    onSample(ev, cal)
    if (!down) return
    const curve = makePressureCurve({ points: prefs.v.pressureCurve })
    const p = pos(ev)
    const wd = 1 + curve(cal) * 16
    ctx.strokeStyle = getComputedStyle(document.documentElement).getPropertyValue('--text')
    ctx.lineCap = 'round'
    ctx.lineJoin = 'round'
    if (last) {
      ctx.lineWidth = (last.w + wd) / 2
      ctx.beginPath()
      ctx.moveTo(last.x, last.y)
      ctx.lineTo(p.x, p.y)
      ctx.stroke()
    }
    last = { ...p, w: wd }
  }
  cv.addEventListener('pointerdown', (e) => {
    e.preventDefault()
    try {
      cv.setPointerCapture(e.pointerId)
    } catch {
      /* ignore */
    }
    down = (e.buttons & 33) !== 0 || e.pointerType === 'touch'
    last = null
    handle(e, e)
  })
  cv.addEventListener('pointermove', (e) => {
    const list = typeof e.getCoalescedEvents === 'function' ? e.getCoalescedEvents() : []
    for (const ev of list.length ? list : [e]) handle(e, ev)
  })
  const up = (e: PointerEvent): void => {
    down = false
    last = null
    onSample(e, 0)
  }
  cv.addEventListener('pointerup', up)
  cv.addEventListener('pointercancel', up)
  cv.addEventListener('contextmenu', (e) => e.preventDefault())
  return { el: cv, clear }
}

/** Live tablet diagnostics: pressure, tilt, twist, buttons, report rate, calibration. */
export function createDiagnostics(app: App): { el: HTMLElement; dispose(): void } {
  const cells = new Map<string, HTMLElement>()
  const grid = h('div', { class: 'diag-grid' })
  const cell = (key: string, title: string): void => {
    const v = h('span', { text: '-' })
    cells.set(key, v)
    grid.append(h('div', { class: 'diag-cell' }, h('b', { text: title }), v))
  }
  for (const [k, label] of [
    ['type', t('interface.diag.cell.type')],
    ['pressure', t('interface.diag.cell.pressure')],
    ['cal', t('interface.diag.cell.cal')],
    ['curve', t('interface.diag.cell.curve')],
    ['tilt', t('interface.diag.cell.tilt')],
    ['az', t('interface.diag.cell.az')],
    ['alt', t('interface.diag.cell.alt')],
    ['twist', t('interface.diag.cell.twist')],
    ['buttons', t('interface.diag.cell.buttons')],
    ['btnname', t('interface.diag.cell.btnname')],
    ['size', t('interface.diag.cell.size')],
    ['rate', t('interface.diag.cell.rate')],
    ['coal', t('interface.diag.cell.coal')],
    ['state', t('interface.diag.cell.state')],
    ['max', t('interface.diag.cell.max')],
    ['id', t('interface.diag.cell.id')]
  ] as [string, string][]) cell(k, label)
  const bar = h('i')
  const barWrap = h('div', { class: 'bar' }, bar)
  const calInfo = h('div', { class: 'kbd', style: 'margin:6px 0' })
  let maxSeen = 0
  const times: number[] = []
  let lastEv: PointerEvent | null = null
  let lastCal = 0
  let coalN = 0
  let predN = 0
  let state = 'idle'
  let raf = 0

  const pad = createTestPad(app, 560, 220, (e, cal) => {
    lastEv = e
    lastCal = cal
    if (e.pressure > maxSeen) maxSeen = e.pressure
    times.push(e.timeStamp)
    state = e.type === 'pointerup' || e.type === 'pointercancel' ? 'lifted' : e.buttons & 1 || e.buttons & 32 ? 'contact' : 'hover'
  })
  pad.el.addEventListener('pointermove', (e) => {
    coalN = e.getCoalescedEvents?.().length ?? 0
    predN = e.getPredictedEvents?.().length ?? 0
  })
  pad.el.addEventListener('pointerleave', () => (state = 'out'))
  pad.el.addEventListener('pointerenter', (e) => (state = e.buttons ? 'contact' : 'hover'))

  const set = (k: string, v: string): void => {
    const c = cells.get(k)
    if (c && c.textContent !== v) c.textContent = v
  }
  const tick = (): void => {
    raf = requestAnimationFrame(tick)
    const now = performance.now()
    while (times.length && now - times[0] > 1000) times.shift()
    const e = lastEv
    if (e) {
      const sph = tiltToSpherical(e.tiltX, e.tiltY)
      const curve = makePressureCurve({ points: prefs.v.pressureCurve })
      set('type', e.pointerType)
      set('pressure', e.pressure.toFixed(3))
      set('cal', lastCal.toFixed(3))
      set('curve', curve(lastCal).toFixed(3))
      set('tilt', `${e.tiltX} / ${e.tiltY}`)
      set('az', ((sph.azimuth * 180) / Math.PI).toFixed(0))
      set('alt', ((sph.altitude * 180) / Math.PI).toFixed(0))
      set('twist', String(e.twist))
      set('buttons', `${e.buttons} (0b${e.buttons.toString(2).padStart(6, '0')})`)
      const names: string[] = []
      if (e.buttons & 1) names.push('tip')
      if (e.buttons & 2) names.push('barrel')
      if (e.buttons & 4) names.push('barrel2')
      if (e.buttons & 32) names.push('eraser')
      set('btnname', names.join(' + ') || 'none')
      set('size', `${e.width.toFixed(1)} x ${e.height.toFixed(1)}`)
      set('id', String(e.pointerId))
      bar.style.width = lastCal * 100 + '%'
    }
    set('rate', times.length ? String(times.length) : '0')
    set('coal', `${coalN} / ${predN}`)
    set('state', t('interface.diag.state.' + state))
    set('max', maxSeen.toFixed(3))
    const cal = app.input.calibrator
    calInfo.textContent = cal.calibrated
      ? t('interface.diag.calActive', { peak: cal.peak.toFixed(3), scale: (1 / cal.scale).toFixed(2) })
      : t('interface.diag.calNone', { peak: cal.peak.toFixed(3) })
  }
  raf = requestAnimationFrame(tick)

  const reset = h('button', {
    class: 'btn small',
    text: t('interface.diag.resetCalibration'),
    onclick: () => {
      app.input.calibrator.reset()
      prefs.v.calibPeak = 0
      prefs.v.calibHits = 0
      prefs.touch('calibPeak')
      maxSeen = 0
    }
  })
  const el = h(
    'div',
    null,
    h('p', { class: 'kbd', text: t('interface.diag.instructions') }),
    pad.el,
    grid,
    h('div', { class: 'diag-cell' }, h('b', { text: t('interface.diag.pressure') }), barWrap),
    calInfo,
    h('div', { class: 'row' }, reset, h('button', { class: 'btn small', text: t('interface.diag.clearPad'), onclick: () => pad.clear() }))
  )
  return {
    el,
    dispose: () => cancelAnimationFrame(raf)
  }
}
