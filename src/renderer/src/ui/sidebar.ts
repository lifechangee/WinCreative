import { MAX_BRUSH_SIZE, sizeFromSlider, sliderFromSize } from '../app/state'
import type { App } from '../app/app'
import { actionEnv, actionLabel, getAction, runAction } from '../input/actions'
import { I18nText, onLangChange, t, tk } from '../i18n'
import { prefs } from '../input/prefs'
import { h, icon } from './dom'

interface VSliderOpts {
  title: I18nText
  get(): number
  set(t: number): void
  label(): string
  /** on-screen diameter (css px) of a brush dot shown in the bubble; omit for text only */
  dot?(): number
}

/**
 * Procreate-style vertical pill slider. Value is 0..1 bottom-to-top.
 * Fine control: after grabbing the slider, drag horizontally away from the track - the further away, the
 * finer the resolution. The bubble shows the value (and a live brush dot for size).
 */
function vslider(o: VSliderOpts): { el: HTMLElement; update(): void } {
  const fill = h('div', { class: 'vs-fill' })
  const dot = h('div', { class: 'vs-dot' })
  const txt = h('div', { class: 'vs-txt' })
  const bubble = h('div', { class: 'vs-bubble' }, o.dot ? dot : null, txt)
  const fine = h('div', { class: 'vs-fine' })
  const el = h('div', { class: 'vslider', 'data-tip': o.title, title: o.title }, fill, bubble)
  el.append(fine)
  const update = (): void => {
    fill.style.height = o.get() * 100 + '%'
    txt.textContent = o.label()
    bubble.style.bottom = `calc(${o.get() * 100}% - 20px)`
    if (o.dot) {
      const d = Math.max(2, Math.min(96, o.dot()))
      dot.style.width = dot.style.height = d + 'px'
    }
  }
  el.addEventListener('pointerdown', (e) => {
    e.preventDefault()
    try {
      el.setPointerCapture(e.pointerId)
    } catch {
      /* ignore */
    }
    el.classList.add('drag')
    const r = el.getBoundingClientRect()
    const cx = r.left + r.width / 2
    let value = Math.min(1, Math.max(0, 1 - (e.clientY - r.top) / r.height))
    let lastY = e.clientY
    o.set(value)
    const mv = (ev: PointerEvent): void => {
      const dx = Math.abs(ev.clientX - cx)
      const factor = dx < 46 ? 1 : dx < 110 ? 0.5 : dx < 200 ? 0.2 : 0.06
      fine.textContent = factor < 1 ? t('ui.sidebar.fine', { factor }) : ''
      fine.style.opacity = factor < 1 ? '1' : '0'
      if (factor === 1) {
        // on the track: absolute positioning, like a normal slider
        value = Math.min(1, Math.max(0, 1 - (ev.clientY - r.top) / r.height))
      } else value = Math.min(1, Math.max(0, value - ((ev.clientY - lastY) / r.height) * factor))
      lastY = ev.clientY
      o.set(value)
    }
    const up = (): void => {
      el.classList.remove('drag')
      fine.style.opacity = '0'
      el.removeEventListener('pointermove', mv)
      el.removeEventListener('pointerup', up)
      el.removeEventListener('pointercancel', up)
    }
    el.addEventListener('pointermove', mv)
    el.addEventListener('pointerup', up)
    el.addEventListener('pointercancel', up)
  })
  update()
  return { el, update }
}

export function buildSidebar(app: App): HTMLElement {
  const st = app.state
  const size = vslider({
    title: tk('ui.sidebar.brushSize'),
    get: () => sliderFromSize(st.settings.size),
    set: (t) => st.setSize(Math.round(sizeFromSlider(t))),
    label: () => Math.round(st.settings.size) + (st.settings.size >= MAX_BRUSH_SIZE ? '' : t('ui.unit.px')),
    dot: () => st.settings.size * app.view.zoom
  })
  const opacity = vslider({
    title: tk('ui.sidebar.brushOpacity'),
    get: () => st.settings.opacity,
    set: (t) => st.setOpacity(t),
    label: () => Math.round(st.settings.opacity * 100) + '%'
  })

  // ---- modify button: hold = per-preference action (eyedropper by default); quick tap latches for one pick
  const modify = h('button', { class: 'modify-btn' })
  modify.append(icon('pipette', 20))
  const syncModifyTip = (): void => {
    const a = getAction(prefs.v.modifyButton)
    const tip = t('ui.sidebar.modifyTip', { action: a ? actionLabel(a).toLowerCase() : t('ui.sidebar.modifyNone') })
    modify.setAttribute('data-tip', tip)
    modify.title = tip
  }
  syncModifyTip()
  onLangChange(syncModifyTip)
  prefs.events.on('change', syncModifyTip)
  modify.addEventListener('pointerdown', (e) => {
    e.preventDefault()
    const id = prefs.v.modifyButton
    const a = getAction(id)
    if (!a) return
    if (!a.mode) {
      runAction(id, actionEnv())
      return
    }
    try {
      modify.setPointerCapture(e.pointerId)
    } catch {
      /* ignore */
    }
    const t0 = performance.now()
    modify.classList.add('on')
    app.input.beginMode(a.mode, 'modify')
    const up = (): void => {
      modify.removeEventListener('pointerup', up)
      modify.removeEventListener('pointercancel', up)
      modify.classList.remove('on')
      app.input.endMode(a.mode!, 'modify')
      if (performance.now() - t0 < 320 && e.pointerType !== 'touch') {
        // latch: the next canvas press picks, then the mode ends
        app.input.beginMode(a.mode!, 'modify-latch')
        modify.classList.add('on')
        setTimeout(() => {
          const off = (ev: PointerEvent): void => {
            if (ev.target !== app.canvas) return
            window.removeEventListener('pointerup', off, true)
            setTimeout(() => {
              app.input.endMode(a.mode!, 'modify-latch')
              modify.classList.remove('on')
            }, 30)
          }
          window.addEventListener('pointerup', off, true)
        }, 0)
      }
    }
    modify.addEventListener('pointerup', up)
    modify.addEventListener('pointercancel', up)
  })

  const undo = h('button', { class: 'round-btn', 'data-tip': tk('ui.sidebar.undo'), title: tk('ui.sidebar.undo'), onclick: () => app.undo() }, icon('undo', 20))
  const redo = h('button', { class: 'round-btn', 'data-tip': tk('ui.sidebar.redo'), title: tk('ui.sidebar.redo'), onclick: () => app.redo() }, icon('redo', 20))
  const refresh = (): void => {
    size.update()
    opacity.update()
  }
  st.events.on('toolSettings', refresh)
  app.events.on('view', () => size.update())
  const hist = (): void => {
    undo.toggleAttribute('disabled', !app.doc.history.canUndo)
    redo.toggleAttribute('disabled', !app.doc.history.canRedo)
  }
  let off = app.doc.events.on('history', hist)
  app.events.on('doc', (d) => {
    off()
    off = d.events.on('history', hist)
    hist()
  })
  hist()

  // ---- draggable up/down via the grip
  const grip = h('div', { class: 'sb-grip', 'data-tip': tk('ui.sidebar.grip'), title: tk('ui.sidebar.grip') }, h('span'), h('span'), h('span'))
  const sb = h('div', { class: 'sidebar' }, grip, size.el, modify, opacity.el, undo, redo)

  const place = (): void => {
    const top = 44 + 8
    const avail = window.innerHeight - top - 12 - sb.offsetHeight
    sb.style.top = top + Math.max(0, Math.min(1, prefs.v.sidebarY)) * Math.max(0, avail) + 'px'
  }
  grip.addEventListener('pointerdown', (e) => {
    e.preventDefault()
    grip.setPointerCapture(e.pointerId)
    const top = 52
    const avail = Math.max(1, window.innerHeight - top - 12 - sb.offsetHeight)
    const startY = e.clientY
    const startV = prefs.v.sidebarY
    const mv = (ev: PointerEvent): void => {
      prefs.v.sidebarY = Math.max(0, Math.min(1, startV + (ev.clientY - startY) / avail))
      place()
    }
    const up = (): void => {
      grip.removeEventListener('pointermove', mv)
      grip.removeEventListener('pointerup', up)
      grip.removeEventListener('pointercancel', up)
      prefs.touch('sidebarY')
    }
    grip.addEventListener('pointermove', mv)
    grip.addEventListener('pointerup', up)
    grip.addEventListener('pointercancel', up)
  })
  window.addEventListener('resize', place)
  prefs.events.on('change', place)
  requestAnimationFrame(place)
  return sb
}
