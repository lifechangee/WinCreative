import type { App } from '../../app/app'
import { rgbToHex, rgbToHsv, hsvToRgb } from '../../app/state'
import { h } from '../../ui/dom'

/** Sample the composited canvas colour (straight sRGB 0..1) at a document pixel; null outside the canvas. */
export function sampleDocColor(app: App, dx: number, dy: number): [number, number, number] | null {
  const x = Math.floor(dx)
  const y = Math.floor(dy)
  const doc = app.doc
  if (doc.isInfinite) {
    const px = app.compositor.readFlattened({ x, y, w: 1, h: 1 }, 1, false).px // straight RGBA8, no paper
    const a8 = px[3] / 255
    if (a8 <= 0 && !doc.background.visible) return null
    const bgc = doc.background.visible ? doc.background.color : [1, 1, 1]
    const k = (v: number, b: number): number => Math.min(1, Math.max(0, (v / 255) * a8 + b * (1 - a8)))
    return [k(px[0], bgc[0]), k(px[1], bgc[1]), k(px[2], bgc[2])]
  }
  if (x < 0 || y < 0 || x >= doc.width || y >= doc.height) return null
  const cl = app.compositor.cleanLang() // language ghost: never sampled
  const f = app.gpu.readPremultFloat(cl ? app.compositor.renderLang(cl) : app.compositor.composite, { x, y, w: 1, h: 1 })
  const a = f[3]
  let r = a > 0 ? f[0] / a : 0
  let g = a > 0 ? f[1] / a : 0
  let b = a > 0 ? f[2] / a : 0
  if (a < 1 && doc.background.visible) {
    const bg = doc.background.color
    r = r * a + bg[0] * (1 - a)
    g = g * a + bg[1] * (1 - a)
    b = b * a + bg[2] * (1 - a)
  } else if (a <= 0) return null
  const c = (v: number): number => Math.min(1, Math.max(0, v))
  return [c(r), c(g), c(b)]
}

/** Eyedropper with loupe. Wire with `app.input.hooks.eyedrop = createEyedropper(app)`. */
export function createEyedropper(app: App): (phase: 'start' | 'move' | 'end', pos: { x: number; y: number }, doc: { x: number; y: number }) => void {
  const stage = app.canvas.parentElement!
  const nw = h('i', { class: 'new' })
  const old = h('i', { class: 'old' })
  const lbl = h('div', { class: 'hexlbl' })
  const loupe = h('div', { class: 'loupe' }, h('div', { class: 'ring' }, nw, old), lbl)
  stage.append(loupe)
  let before = rgbToHex(hsvToRgb(app.state.color))
  let last: [number, number, number] | null = null
  return (phase, pos, doc) => {
    if (phase === 'end') {
      loupe.style.display = 'none'
      if (last) app.state.setColor(rgbToHsv(last[0], last[1], last[2]), true)
      last = null
      return
    }
    if (phase === 'start') {
      before = rgbToHex(hsvToRgb(app.state.color))
      old.style.background = before
    }
    const c = sampleDocColor(app, doc.x, doc.y)
    loupe.style.display = 'block'
    loupe.style.left = pos.x + 'px'
    loupe.style.top = pos.y - 70 + 'px'
    if (c) {
      last = c
      const hex = rgbToHex(c)
      nw.style.background = hex
      lbl.textContent = hex
      const hsv = rgbToHsv(c[0], c[1], c[2])
      app.state.setColor(hsv, false)
    }
  }
}
