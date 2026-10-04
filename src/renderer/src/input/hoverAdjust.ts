import { t } from '../i18n'
import type { App } from '../app/app'
import { sizeFromSlider, sliderFromSize } from '../app/state'
import { prefs } from './prefs'

/** Brush size after moving a hovering pen `dx` css px sideways (moves along the size slider curve, so it feels even). */
export function hoverSize(size: number, dx: number): number {
  const next = Math.round(sizeFromSlider(sliderFromSize(size) + dx / 500))
  // small brushes: make sure a tiny move still changes the value
  if (dx > 0 && next <= size) return size + 1
  if (dx < 0 && next >= size) return Math.max(1, size - 1)
  return next
}

/** Opacity (0..1) after moving a hovering pen `dx` css px sideways. */
export function hoverOpacity(opacity: number, dx: number): number {
  return Math.min(1, Math.max(0.01, opacity + dx / 400))
}

/**
 * Equivalents of the Apple Pencil Pro hover "pinch" and "slide" gestures for pens that report hover (Windows Ink):
 * while the pen hovers, Shift + moving sideways changes the brush size, Ctrl+Shift + moving sideways changes opacity.
 */
export function installHoverAdjust(app: App): void {
  let last: { x: number; id: number } | null = null
  const bubble = document.createElement('div')
  bubble.className = 'hover-adjust-bubble'
  bubble.style.cssText = 'position:fixed;z-index:500;pointer-events:none;display:none;background:#000c;color:#fff;font:600 12px system-ui;padding:3px 9px;border-radius:10px'
  document.body.append(bubble)
  let hide = 0
  const say = (x: number, y: number, text: string): void => {
    bubble.textContent = text
    bubble.style.left = x + 18 + 'px'
    bubble.style.top = y + 18 + 'px'
    bubble.style.display = 'block'
    clearTimeout(hide)
    hide = window.setTimeout(() => (bubble.style.display = 'none'), 700)
  }
  app.canvas.addEventListener(
    'pointermove',
    (e) => {
      if (e.pointerType !== 'pen' || e.buttons !== 0 || !e.shiftKey || !prefs.v.pen.hoverAdjust) {
        last = null
        return
      }
      const prev = last
      last = { x: e.clientX, id: e.pointerId }
      if (!prev || prev.id !== e.pointerId) return
      const dx = e.clientX - prev.x
      if (!dx) return
      const st = app.state
      if (e.ctrlKey) {
        st.setOpacity(hoverOpacity(st.settings.opacity, dx))
        say(e.clientX, e.clientY, t('core.hover.opacity', { n: Math.round(st.settings.opacity * 100) }))
      } else {
        st.setSize(hoverSize(st.settings.size, dx))
        say(e.clientX, e.clientY, t('core.hover.size', { n: Math.round(st.settings.size) }))
      }
    },
    { passive: true }
  )
}
