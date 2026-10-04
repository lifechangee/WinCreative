import type { App } from '../../app/app'
import { t } from '../../i18n'
import { hsvToRgb, rgbToHex } from '../../app/state'
import { CursorInfo } from '../../input/pointerInput'
import { prefs } from '../../input/prefs'
import { h } from '../../ui/dom'

const THEME_COLORS = {
  dark: { color: '#1c1c1e', symbolColor: '#e8e8ea' },
  light: { color: '#e7e7ec', symbolColor: '#1d1d20' }
}

/** Apply theme / handedness / accessibility prefs to the document + window chrome. */
export function applyAppearance(): void {
  const r = document.documentElement
  const p = prefs.v
  r.dataset.theme = p.theme
  r.classList.toggle('hc', p.highContrast)
  r.classList.toggle('large-text', p.largeText)
  r.classList.toggle('reduced-motion', p.reducedMotion)
  document.body.classList.toggle('rh', p.rightHandInterface)
  window.brushwork?.setTitleBar?.(THEME_COLORS[p.theme])
}

/** Brush outline at the pen / mouse position (replaces App.updateCursor). */
export function installCursor(app: App): void {
  const el = app.cursorEl
  const canvas = app.canvas
  let last: CursorInfo | null = null
  const render = (c: CursorInfo | null): void => {
    last = c
    if (!c || c.pointerType === 'touch' || app.brushCursorHidden) {
      el.style.display = 'none'
      canvas.classList.remove('pen-cursor')
      return
    }
    const nav = app.input.navigating || ['pan', 'rotate', 'zoom', 'eyedropper'].some((m) => app.input.hasMode(m as 'pan'))
    const mode = prefs.v.cursorMode
    if (nav) {
      el.style.display = 'none'
      canvas.classList.remove('pen-cursor')
      return
    }
    const st = app.state
    const d = Math.max(3, st.settings.size * app.view.zoom)
    el.style.display = 'block'
    el.style.width = el.style.height = d + 'px'
    el.style.transform = `translate3d(${(c.x - d / 2).toFixed(2)}px, ${(c.y - d / 2).toFixed(2)}px, 0)`
    const cls = (mode === 'none' ? 'bc-none' : mode === 'color' ? 'bc-color' : 'bc-contrast') + (st.effectiveTool === 'eraser' ? ' bc-erase' : '') + (c.down ? ' bc-down' : '')
    if (el.className !== cls) el.className = cls
    if (mode === 'color') el.style.setProperty('--bc', rgbToHex(hsvToRgb(st.color)))
    canvas.classList.toggle('pen-cursor', mode !== 'none')
  }
  app.input.cursorRenderer = render
  // keep the outline in sync when size / view / brush change without a pointer move (e.g. [ ] keys, zoom shortcuts)
  const refresh = (): void => {
    if (last && el.style.display !== 'none') render(last)
  }
  app.state.events.on('toolSettings', refresh)
  app.state.events.on('tool', refresh)
  app.events.on('view', refresh)
  // hide while a navigation mode (Space pan, R rotate, Z zoom, eyedropper) is held, show again when released
  app.input.onModeChange = () => (last ? render(last) : undefined)
  prefs.events.on('change', () => {
    el.style.display = 'none'
  })
}

/** Transient zoom / rotation readout while the view changes. */
export function installZoomHud(app: App): void {
  const hud = h('div', { class: 'zoom-hud' })
  document.body.append(hud)
  let timer = 0
  let last = { zoom: app.view.zoom, rot: app.view.rot }
  app.events.on('view', (v) => {
    if (Math.abs(v.zoom - last.zoom) < 1e-6 && Math.abs(v.rot - last.rot) < 1e-6) return
    last = { zoom: v.zoom, rot: v.rot }
    if (!prefs.v.showZoomHud) return
    let deg = (v.rot * 180) / Math.PI
    deg = ((((deg + 180) % 360) + 360) % 360) - 180
    hud.textContent = `${Math.round(v.zoom * 100)}%   ${Math.round(deg)}°`
    hud.classList.add('show')
    clearTimeout(timer)
    timer = window.setTimeout(() => hud.classList.remove('show'), 900)
  })
}

/** Dynamic brush scaling: keep the on-screen brush size constant while zooming (size number changes). */
export function installDynamicScaling(app: App): void {
  let screenSize = app.state.settings.size * app.view.zoom
  let lastZoom = app.view.zoom
  let self = false
  app.state.events.on('toolSettings', () => {
    if (self) return
    screenSize = app.state.settings.size * app.view.zoom
  })
  app.state.events.on('tool', () => {
    screenSize = app.state.settings.size * app.view.zoom
  })
  app.events.on('view', (v) => {
    if (!prefs.v.dynamicBrushScaling) {
      lastZoom = v.zoom
      return
    }
    if (v.zoom === lastZoom) return
    lastZoom = v.zoom
    self = true
    app.state.setSize(Math.max(1, Math.round(screenSize / v.zoom)))
    self = false
  })
  prefs.events.on('change', (k) => {
    if (k === 'dynamicBrushScaling' || k === '*') screenSize = app.state.settings.size * app.view.zoom
  })
}

/** Redo canvas sizing when the display scale changes (moving between monitors, Windows scaling change). */
export function installDprWatcher(app: App): void {
  const check = (): void => {
    const dpr = window.devicePixelRatio || 1
    const canvasW = app.canvas.width
    const want = Math.round(app.cssSize().w * dpr)
    if (canvasW !== want) app.resize()
    watch(dpr)
  }
  let mq: MediaQueryList | null = null
  const watch = (dpr: number): void => {
    mq?.removeEventListener('change', check)
    mq = window.matchMedia(`(resolution: ${dpr}dppx)`)
    mq.addEventListener('change', check, { once: true })
  }
  watch(window.devicePixelRatio || 1)
  window.addEventListener('resize', () => {
    if (app.canvas.width !== Math.round(app.cssSize().w * (window.devicePixelRatio || 1))) app.resize()
  })
}

export function isUIHidden(): boolean {
  return document.documentElement.classList.contains('ui-hidden')
}

export function setUIHidden(hidden: boolean, app: App): void {
  document.documentElement.classList.toggle('ui-hidden', hidden)
  if (hidden) app.notify(t('interface.hidden'))
}

let fullscreenOn = false
/** Full-screen mode: real window full screen + hidden interface (Ctrl+F / F11 / four-finger tap). */
export function toggleFullscreen(app: App): void {
  fullscreenOn = !fullscreenOn
  if (window.brushwork?.setFullScreen) void window.brushwork.setFullScreen(fullscreenOn)
  else if (fullscreenOn) void document.documentElement.requestFullscreen().catch(() => undefined)
  else if (document.fullscreenElement) void document.exitFullscreen()
  setUIHidden(fullscreenOn, app)
}

/** Custom tooltips: takes over `title` / `data-tip` attributes with a styled, animated bubble. */
export function installTooltips(): void {
  const tip = h('div', { class: 'tip' })
  document.body.append(tip)
  let timer = 0
  let cur: HTMLElement | null = null
  const hide = (): void => {
    clearTimeout(timer)
    tip.classList.remove('show')
    cur = null
  }
  document.addEventListener('pointerover', (e) => {
    if (e.pointerType === 'touch' || !prefs.v.tooltips) return
    const t = (e.target as HTMLElement | null)?.closest?.('[data-tip],[title]') as HTMLElement | null
    if (!t || t === cur) return
    const text = t.getAttribute('data-tip') ?? t.getAttribute('title')
    if (!text) return
    if (t.hasAttribute('title')) {
      t.setAttribute('data-tip', t.getAttribute('title')!)
      t.removeAttribute('title') // suppress the native tooltip
    }
    hide()
    cur = t
    timer = window.setTimeout(() => {
      const r = t.getBoundingClientRect()
      tip.textContent = t.getAttribute('data-tip') || text
      tip.style.left = '0px'
      tip.style.top = '0px'
      const w = tip.offsetWidth
      const right = document.body.classList.contains('rh')
      let x = right && t.closest('.sidebar') ? r.left - w - 10 : t.closest('.sidebar') ? r.right + 10 : r.left + r.width / 2 - w / 2
      const y = t.closest('.sidebar') ? r.top + r.height / 2 - 14 : r.bottom + 8
      x = Math.max(6, Math.min(window.innerWidth - w - 6, x))
      tip.style.left = x + 'px'
      tip.style.top = y + 'px'
      tip.classList.add('show')
    }, 550)
  })
  document.addEventListener('pointerdown', hide, true)
  document.addEventListener('pointerout', (e) => {
    if ((e.target as HTMLElement | null)?.closest?.('[data-tip]') === cur) hide()
  })
}
