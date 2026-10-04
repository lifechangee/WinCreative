import type { HSV } from '../app/state'
import { getLang, t } from '../i18n'
import { attachColorDrag } from '../features/color/colorDrop'
import {
  HARMONY_LABELS,
  HarmonyScheme,
  harmonyBaseFromHandle,
  harmonyColors,
  hexToHsv,
  hsvToHex,
  hsvToRgb,
  normalizeHex,
  rgbToHex,
  rgbToHsv
} from '../features/color/colorMath'
import { getActiveColor, setActiveColor, target } from '../features/color/colorTarget'
import { confirmDialog, askText, contextMenu, onLongPress } from '../features/color/dialogs'
import { ensureColorStyles } from '../features/color/styles'
import { exportPalette, importPalettesFromDialog } from '../features/color/paletteIO'
import { paletteStore } from '../features/color/paletteStore'
import { makePalette, paletteName } from '../features/color/palettes'
import { shared } from '../features/color/shared'
import { h, icon } from './dom'
import type { UIContext } from './registry'

type Tab = 'disc' | 'classic' | 'harmony' | 'value' | 'palettes'
const TABS: Tab[] = ['disc', 'classic', 'harmony', 'value', 'palettes']
let lastTab: Tab = 'disc'
let lastScheme: HarmonyScheme = 'complementary'

const dec = (s: string): string => (getLang() === 'ru' ? s.replace('.', ',') : s)
const clamp01 = (v: number): number => Math.min(1, Math.max(0, v))
const dprOf = (): number => window.devicePixelRatio || 1

/** Generic drag helper: calls `fn` with pointer position relative to `el` (px) on down/move, `end` on release. */
function dragOn(el: HTMLElement, fn: (x: number, y: number, r: DOMRect, first: boolean) => void, end?: () => void): void {
  el.addEventListener('pointerdown', (e) => {
    if (e.button !== 0) return
    e.preventDefault()
    el.setPointerCapture(e.pointerId)
    let first = true
    const go = (ev: PointerEvent): void => {
      const r = el.getBoundingClientRect()
      fn(ev.clientX - r.left, ev.clientY - r.top, r, first)
      first = false
    }
    go(e)
    const mv = (ev: PointerEvent): void => go(ev)
    const up = (): void => {
      el.removeEventListener('pointermove', mv)
      el.removeEventListener('pointerup', up)
      el.removeEventListener('pointercancel', up)
      end?.()
    }
    el.addEventListener('pointermove', mv)
    el.addEventListener('pointerup', up)
    el.addEventListener('pointercancel', up)
  })
}

interface SliderOpts {
  label: string
  min: number
  max: number
  get(): number
  set(v: number, commit: boolean): void
  /** CSS background of the track */
  track(): string
  numeric?: boolean
  digits?: number
}

function slider(o: SliderOpts): { el: HTMLElement; update(): void } {
  const track = h('div', { class: 'bw-slider-track' })
  const knob = h('div', { class: 'knob' })
  track.append(knob)
  const fmt = (v: number): string => (o.digits ? v.toFixed(o.digits) : String(Math.round(v)))
  const num = h('input', { class: 'bw-num', type: 'text', inputMode: 'numeric', spellcheck: false })
  const val = h('span', { class: 'val', text: '' })
  const update = (): void => {
    const v = o.get()
    track.style.background = o.track()
    knob.style.left = ((v - o.min) / (o.max - o.min)) * 100 + '%'
    if (o.numeric) {
      if (document.activeElement !== num) num.value = fmt(v)
    } else val.textContent = fmt(v)
  }
  dragOn(
    track,
    (x, _y, r) => o.set(o.min + clamp01(x / r.width) * (o.max - o.min), false),
    () => o.set(o.get(), true)
  )
  if (o.numeric) {
    const apply = (commit: boolean): void => {
      const v = parseFloat(num.value)
      if (Number.isFinite(v)) o.set(Math.min(o.max, Math.max(o.min, v)), commit)
    }
    num.addEventListener('input', () => apply(false))
    num.addEventListener('change', () => apply(true))
    num.addEventListener('keydown', (e) => {
      e.stopPropagation()
      if (e.key === 'Enter') num.blur()
    })
    num.addEventListener('blur', update)
  }
  const el = h('div', { class: 'bw-slider' }, h('span', { class: 'lbl', text: o.label }), track, o.numeric ? num : val)
  update()
  return { el, update }
}

/** Working colour picker: Disc / Classic / Harmony / Value / Palettes + swatches, history, eyedropper. */
export function renderColorPanel(body: HTMLElement, ctx: UIContext): () => void {
  ensureColorStyles()
  const app = ctx.app
  const st = app.state
  const store = paletteStore()
  const pname = paletteName
  const cur = (): HSV => getActiveColor(st)
  const put = (c: HSV, commit = false): void => setActiveColor(st, c, commit)
  /** keep the hue when the new colour is grey (rgb/hex input lose it) */
  const putRgb = (rgb: [number, number, number], commit = false): void => {
    const c = rgbToHsv(...rgb)
    if (c.s === 0 || c.v === 0) c.h = cur().h
    put(c, commit)
  }
  const updaters: (() => void)[] = []
  const disposers: (() => void)[] = []

  // ------------------------------------------------------------------ header: swatches, swap, eyedropper
  const primary = h('button', { class: 'bw-swatch-big', title: t('color.panel.primary.tip') })
  const secondary = h('button', { class: 'bw-swatch-big small', title: t('color.panel.secondary.tip') })
  primary.addEventListener('click', () => {
    target.secondary = false
    refresh()
  })
  secondary.addEventListener('click', () => {
    target.secondary = true
    refresh()
  })
  attachColorDrag(app, primary, () => hsvToHex(st.color), () => st.rgb)
  attachColorDrag(app, secondary, () => hsvToHex(st.secondaryColor), () => st.secondaryRgb)
  const swap = h('button', { class: 'bw-icon-btn', title: t('color.panel.swap.tip'), onclick: () => st.swapColors() }, icon('redo', 16))
  const eye = h(
    'button',
    {
      class: 'bw-icon-btn',
      title: t('color.panel.eyedropper.tip'),
      onclick: () => {
        shared.eyedropper?.arm()
        if (shared.eyedropper?.armed) ctx.popovers.close()
      }
    },
    icon('pipette', 18)
  )
  const hexTop = h('span', { class: 'bw-hex-label' })
  const header = h('div', { class: 'bw-color-head' }, h('div', { class: 'bw-swatch-stack' }, secondary, primary), h('div', { class: 'bw-head-mid' }, hexTop), swap, eye)

  const history = h('div', { class: 'bw-history' })
  const tabsEl = h('div', { class: 'bw-tabs' })
  const content = h('div', { class: 'bw-tab-content' })
  body.append(header, history, tabsEl, content)
  body.classList.add('bw-color-body')

  const settingsBox = buildSettings(ctx)

  let tabDisposers: (() => void)[] = []
  const showTab = (tab: Tab): void => {
    lastTab = tab
    for (const d of tabDisposers) d()
    tabDisposers = []
    updaters.length = 0
    content.replaceChildren()
    tabsEl.querySelectorAll('button').forEach((b) => b.classList.toggle('sel', b.dataset.tab === tab))
    const view = tab === 'disc' ? discTab() : tab === 'classic' ? classicTab() : tab === 'harmony' ? harmonyTab() : tab === 'value' ? valueTab() : palettesTab()
    content.append(view)
    content.append(settingsBox)
    refresh()
  }
  for (const id of TABS) tabsEl.append(h('button', { class: 'bw-tab', 'data-tab': id, text: t('color.tab.' + id), onclick: () => showTab(id) }))

  // ------------------------------------------------------------------ shared sliders
  const hsbSliders = (): HTMLElement => {
    const hs = slider({
      label: 'H',
      min: 0,
      max: 360,
      get: () => cur().h,
      set: (v, c) => put({ ...cur(), h: v }, c),
      track: () => 'linear-gradient(90deg,#f00,#ff0,#0f0,#0ff,#00f,#f0f,#f00)'
    })
    const ss = slider({
      label: 'S',
      min: 0,
      max: 100,
      get: () => cur().s * 100,
      set: (v, c) => put({ ...cur(), s: v / 100 }, c),
      track: () => `linear-gradient(90deg,${hsvToHex({ ...cur(), s: 0 })},${hsvToHex({ ...cur(), s: 1 })})`
    })
    const bs = slider({
      label: 'B',
      min: 0,
      max: 100,
      get: () => cur().v * 100,
      set: (v, c) => put({ ...cur(), v: v / 100 }, c),
      track: () => `linear-gradient(90deg,#000,${hsvToHex({ ...cur(), v: 1 })})`
    })
    updaters.push(hs.update, ss.update, bs.update)
    return h('div', { class: 'bw-sliders' }, hs.el, ss.el, bs.el)
  }

  // ------------------------------------------------------------------ Disc
  function discTab(): HTMLElement {
    const SIZE = 244
    const cv = h('canvas', { class: 'bw-disc', width: Math.round(SIZE * dprOf()), height: Math.round(SIZE * dprOf()), style: `width:${SIZE}px;height:${SIZE}px` })
    const ringKnob = h('div', { class: 'knob' })
    const discKnob = h('div', { class: 'knob big' })
    const wrap = h('div', { class: 'bw-disc-wrap', style: `width:${SIZE}px;height:${SIZE}px` }, cv, ringKnob, discKnob)
    const RING_IN = 0.8
    const DISC_R = 0.72
    let drawnHue = -1
    const draw = (hue: number): void => {
      const N = cv.width
      const c = cv.getContext('2d')!
      const img = c.createImageData(N, N)
      const R = N / 2
      for (let y = 0; y < N; y++)
        for (let x = 0; x < N; x++) {
          const dx = x + 0.5 - R
          const dy = y + 0.5 - R
          const d = Math.hypot(dx, dy)
          const o = (y * N + x) * 4
          let rgb: [number, number, number] | null = null
          let a = 0
          if (d <= R && d >= R * RING_IN - 1) {
            let ang = (Math.atan2(dy, dx) * 180) / Math.PI
            if (ang < 0) ang += 360
            rgb = hsvToRgb({ h: ang, s: 1, v: 1 })
            a = Math.min(1, R - d, d - (R * RING_IN - 1))
          } else if (d <= R * DISC_R + 1) {
            const rr = R * DISC_R
            rgb = hsvToRgb({ h: hue, s: clamp01(dx / (2 * rr) + 0.5), v: clamp01(0.5 - dy / (2 * rr)) })
            a = Math.min(1, R * DISC_R + 1 - d)
          }
          if (rgb) {
            img.data[o] = rgb[0] * 255
            img.data[o + 1] = rgb[1] * 255
            img.data[o + 2] = rgb[2] * 255
            img.data[o + 3] = Math.max(0, a) * 255
          }
        }
      c.putImageData(img, 0, 0)
    }
    let mode: 'ring' | 'disc' = 'disc'
    dragOn(
      wrap,
      (x, y, r, first) => {
        const dx = x - r.width / 2
        const dy = y - r.height / 2
        const d = Math.hypot(dx, dy) / (r.width / 2)
        if (first) mode = d >= (RING_IN + DISC_R) / 2 ? 'ring' : 'disc'
        if (mode === 'ring') {
          let ang = (Math.atan2(dy, dx) * 180) / Math.PI
          if (ang < 0) ang += 360
          put({ ...cur(), h: ang })
        } else {
          const rr = (r.width / 2) * DISC_R
          put({ ...cur(), s: clamp01(dx / (2 * rr) + 0.5), v: clamp01(0.5 - dy / (2 * rr)) })
        }
      },
      () => put(cur(), true)
    )
    updaters.push(() => {
      const c = cur()
      if (Math.round(c.h) !== drawnHue) {
        draw(c.h)
        drawnHue = Math.round(c.h)
      }
      const R = SIZE / 2
      const a = (c.h * Math.PI) / 180
      const rm = R * (1 + RING_IN) * 0.5
      ringKnob.style.left = R + Math.cos(a) * rm + 'px'
      ringKnob.style.top = R + Math.sin(a) * rm + 'px'
      ringKnob.style.background = `hsl(${c.h},100%,50%)`
      const rr = R * DISC_R
      discKnob.style.left = R + (c.s - 0.5) * 2 * rr + 'px'
      discKnob.style.top = R + (0.5 - c.v) * 2 * rr + 'px'
      discKnob.style.background = hsvToHex(c)
    })
    return h('div', { class: 'bw-tab-page' }, wrap, hsbSliders())
  }

  // ------------------------------------------------------------------ Classic
  function classicTab(): HTMLElement {
    const SIZE = 244
    const sv = h('canvas', { class: 'sv-canvas', width: SIZE, height: SIZE / 1.3, style: `width:${SIZE}px;height:${Math.round(SIZE / 1.3)}px` })
    const knob = h('div', { class: 'knob big' })
    const wrap = h('div', { class: 'sv-wrap', style: `width:${SIZE}px;height:${Math.round(SIZE / 1.3)}px;margin:4px auto` }, sv, knob)
    let drawnHue = -1
    const draw = (hue: number): void => {
      const c = sv.getContext('2d')!
      const w = sv.width
      const hh = sv.height
      c.fillStyle = `hsl(${hue}, 100%, 50%)`
      c.fillRect(0, 0, w, hh)
      let g = c.createLinearGradient(0, 0, w, 0)
      g.addColorStop(0, '#fff')
      g.addColorStop(1, 'rgba(255,255,255,0)')
      c.fillStyle = g
      c.fillRect(0, 0, w, hh)
      g = c.createLinearGradient(0, 0, 0, hh)
      g.addColorStop(0, 'rgba(0,0,0,0)')
      g.addColorStop(1, '#000')
      c.fillStyle = g
      c.fillRect(0, 0, w, hh)
    }
    dragOn(
      wrap,
      (x, y, r) => put({ ...cur(), s: clamp01(x / r.width), v: 1 - clamp01(y / r.height) }),
      () => put(cur(), true)
    )
    const hue = h('div', { class: 'hue-strip bw-hue' })
    const hueKnob = h('div', { class: 'knob' })
    hue.append(hueKnob)
    dragOn(
      hue,
      (x, _y, r) => put({ ...cur(), h: clamp01(x / r.width) * 360 }),
      () => put(cur(), true)
    )
    updaters.push(() => {
      const c = cur()
      if (Math.round(c.h) !== drawnHue) {
        draw(c.h)
        drawnHue = Math.round(c.h)
      }
      const r = { w: SIZE, h: Math.round(SIZE / 1.3) }
      knob.style.left = c.s * r.w + 'px'
      knob.style.top = (1 - c.v) * r.h + 'px'
      knob.style.background = hsvToHex(c)
      hueKnob.style.left = (c.h / 360) * 100 + '%'
      hueKnob.style.background = `hsl(${c.h},100%,50%)`
    })
    return h('div', { class: 'bw-tab-page' }, wrap, hue, hsbSliders())
  }

  // ------------------------------------------------------------------ Harmony
  function harmonyTab(): HTMLElement {
    const SIZE = 244
    const cv = h('canvas', { class: 'bw-disc', width: Math.round(SIZE * dprOf()), height: Math.round(SIZE * dprOf()), style: `width:${SIZE}px;height:${SIZE}px` })
    const svgNS = 'http://www.w3.org/2000/svg'
    const svg = document.createElementNS(svgNS, 'svg')
    svg.setAttribute('viewBox', `0 0 ${SIZE} ${SIZE}`)
    svg.setAttribute('class', 'bw-harm-svg')
    const wrap = h('div', { class: 'bw-disc-wrap', style: `width:${SIZE}px;height:${SIZE}px` }, cv, svg as unknown as Node as HTMLElement)
    let scheme = lastScheme
    let base: HSV = { ...cur() }
    const R = SIZE / 2 - 4
    let drawnV = -1
    const draw = (v: number): void => {
      const N = cv.width
      const c = cv.getContext('2d')!
      const img = c.createImageData(N, N)
      const r = N / 2
      for (let y = 0; y < N; y++)
        for (let x = 0; x < N; x++) {
          const dx = x + 0.5 - r
          const dy = y + 0.5 - r
          const d = Math.hypot(dx, dy)
          if (d > r) continue
          let ang = (Math.atan2(dy, dx) * 180) / Math.PI
          if (ang < 0) ang += 360
          const rgb = hsvToRgb({ h: ang, s: Math.min(1, d / (r - 4 * dprOf())), v })
          const o = (y * N + x) * 4
          img.data[o] = rgb[0] * 255
          img.data[o + 1] = rgb[1] * 255
          img.data[o + 2] = rgb[2] * 255
          img.data[o + 3] = Math.min(1, r - d) * 255
        }
      c.putImageData(img, 0, 0)
    }
    const pos = (c: HSV): { x: number; y: number } => {
      const a = (c.h * Math.PI) / 180
      return { x: SIZE / 2 + Math.cos(a) * c.s * R, y: SIZE / 2 + Math.sin(a) * c.s * R }
    }
    const swatches = h('div', { class: 'bw-harm-swatches' })
    const schemeRow = h('div', { class: 'bw-chips' })
    for (const s of Object.keys(HARMONY_LABELS) as HarmonyScheme[])
      schemeRow.append(
        h('button', {
          class: 'bw-chip' + (s === scheme ? ' sel' : ''),
          text: t('color.harmony.' + s),
          'data-scheme': s,
          onclick: () => {
            scheme = lastScheme = s
            schemeRow.querySelectorAll('button').forEach((b) => b.classList.toggle('sel', b.dataset.scheme === s))
            put(harmonyColors(base, s)[0], true)
            renderHandles()
          }
        })
      )
    let handleIdx = 0
    const renderHandles = (): void => {
      const cols = harmonyColors(base, scheme)
      const pts = cols.map(pos)
      svg.replaceChildren()
      const poly = document.createElementNS(svgNS, 'polygon')
      poly.setAttribute('points', pts.map((p) => `${p.x},${p.y}`).join(' '))
      poly.setAttribute('class', 'bw-harm-poly')
      if (pts.length > 2) svg.append(poly)
      else {
        const l = document.createElementNS(svgNS, 'line')
        l.setAttribute('x1', String(pts[0].x))
        l.setAttribute('y1', String(pts[0].y))
        l.setAttribute('x2', String(pts[1].x))
        l.setAttribute('y2', String(pts[1].y))
        l.setAttribute('class', 'bw-harm-poly')
        svg.append(l)
      }
      cols.forEach((c, i) => {
        const g = document.createElementNS(svgNS, 'circle')
        g.setAttribute('cx', String(pts[i].x))
        g.setAttribute('cy', String(pts[i].y))
        g.setAttribute('r', i === 0 ? '11' : '9')
        g.setAttribute('fill', hsvToHex(c))
        g.setAttribute('class', 'bw-harm-handle' + (i === 0 ? ' base' : ''))
        svg.append(g)
      })
      swatches.replaceChildren(
        ...cols.map((c, i) =>
          h('button', {
            class: 'bw-harm-sw' + (hsvToHex(c) === hsvToHex(cur()) ? ' sel' : ''),
            style: `background:${hsvToHex(c)}`,
            title: i === 0 ? t('color.harmony.baseTip', { hex: hsvToHex(c) }) : hsvToHex(c),
            onclick: () => put(c, true)
          })
        )
      )
    }
    dragOn(
      wrap,
      (x, y, r, first) => {
        const dx = x - r.width / 2
        const dy = y - r.height / 2
        let ang = (Math.atan2(dy, dx) * 180) / Math.PI
        if (ang < 0) ang += 360
        const s = clamp01(Math.hypot(dx, dy) / R)
        if (first) {
          const pts = harmonyColors(base, scheme).map(pos)
          let best = 0
          let bd = Infinity
          pts.forEach((p, i) => {
            const d = Math.hypot(p.x - x, p.y - y)
            if (d < bd) (bd = d), (best = i)
          })
          handleIdx = best
        }
        base = harmonyBaseFromHandle(base, scheme, handleIdx, ang, s)
        put(harmonyColors(base, scheme)[handleIdx])
        renderHandles()
      },
      () => put(cur(), true)
    )
    const bright = slider({
      label: 'B',
      min: 0,
      max: 100,
      get: () => base.v * 100,
      set: (v, c) => {
        base = { ...base, v: v / 100 }
        put({ ...cur(), v: v / 100 }, c)
      },
      track: () => `linear-gradient(90deg,#000,${hsvToHex({ ...base, v: 1 })})`
    })
    updaters.push(() => {
      const c = cur()
      // follow external colour changes unless the colour is one of the current harmony members
      const members = harmonyColors(base, scheme).map(hsvToHex)
      if (!members.includes(hsvToHex(c))) base = { ...c }
      else if (hsvToHex(c) !== hsvToHex(harmonyColors(base, scheme)[0]) && (c.v !== base.v)) base = { ...base, v: c.v }
      const vq = Math.round(base.v * 20)
      if (vq !== drawnV) {
        draw(Math.max(0.12, base.v))
        drawnV = vq
      }
      bright.update()
      renderHandles()
    })
    return h('div', { class: 'bw-tab-page' }, wrap, schemeRow, swatches, h('div', { class: 'bw-sliders' }, bright.el))
  }

  // ------------------------------------------------------------------ Value
  function valueTab(): HTMLElement {
    const rgbOf = (): [number, number, number] => hsvToRgb(cur())
    const mkRgb = (label: string, i: number): { el: HTMLElement; update(): void } =>
      slider({
        label,
        min: 0,
        max: 255,
        numeric: true,
        get: () => rgbOf()[i] * 255,
        set: (v, c) => {
          const rgb = rgbOf()
          rgb[i] = v / 255
          putRgb(rgb, c)
        },
        track: () => {
          const a = rgbOf()
          const b = [...a] as [number, number, number]
          a[i] = 0
          b[i] = 1
          return `linear-gradient(90deg,${rgbToHex(a)},${rgbToHex(b)})`
        }
      })
    const hs = slider({ label: 'H', min: 0, max: 360, numeric: true, get: () => cur().h, set: (v, c) => put({ ...cur(), h: v }, c), track: () => 'linear-gradient(90deg,#f00,#ff0,#0f0,#0ff,#00f,#f0f,#f00)' })
    const ss = slider({ label: 'S', min: 0, max: 100, numeric: true, get: () => cur().s * 100, set: (v, c) => put({ ...cur(), s: v / 100 }, c), track: () => `linear-gradient(90deg,${hsvToHex({ ...cur(), s: 0 })},${hsvToHex({ ...cur(), s: 1 })})` })
    const bs = slider({ label: 'B', min: 0, max: 100, numeric: true, get: () => cur().v * 100, set: (v, c) => put({ ...cur(), v: v / 100 }, c), track: () => `linear-gradient(90deg,#000,${hsvToHex({ ...cur(), v: 1 })})` })
    const r = mkRgb('R', 0)
    const g = mkRgb('G', 1)
    const b = mkRgb('B', 2)
    const hex = h('input', { class: 'bw-hex', type: 'text', maxLength: 9, spellcheck: false, placeholder: '#rrggbb' })
    const applyHex = (commit: boolean): void => {
      const n = normalizeHex(hex.value)
      if (!n) return
      const c = hexToHsv(n, cur().h)
      if (c) put(c, commit)
    }
    hex.addEventListener('input', () => applyHex(false))
    hex.addEventListener('change', () => applyHex(true))
    hex.addEventListener('keydown', (e) => {
      e.stopPropagation()
      if (e.key === 'Enter') hex.blur()
    })
    hex.addEventListener('blur', () => (hex.value = hsvToHex(cur())))
    const paste = h('button', {
      class: 'bw-btn',
      text: t('core.common.paste'),
      title: t('color.value.paste.tip'),
      onclick: async () => {
        try {
          hex.value = await navigator.clipboard.readText()
          applyHex(true)
        } catch {
          ctx.toast(t('color.value.clipboardUnavailable'))
        }
      }
    })
    const copy = h('button', {
      class: 'bw-btn',
      text: t('core.common.copy'),
      onclick: () => void navigator.clipboard.writeText(hsvToHex(cur())).then(() => ctx.toast(t('color.value.copied', { hex: hsvToHex(cur()) })), () => ctx.toast(t('color.value.clipboardUnavailable')))
    })
    updaters.push(hs.update, ss.update, bs.update, r.update, g.update, b.update, () => {
      if (document.activeElement !== hex) hex.value = hsvToHex(cur())
    })
    return h(
      'div',
      { class: 'bw-tab-page' },
      h('div', { class: 'bw-group-title', text: 'HSB' }), // i18n-ignore
      h('div', { class: 'bw-sliders' }, hs.el, ss.el, bs.el),
      h('div', { class: 'bw-group-title', text: 'RGB' }), // i18n-ignore
      h('div', { class: 'bw-sliders' }, r.el, g.el, b.el),
      h('div', { class: 'bw-group-title', text: 'Hex' }), // i18n-ignore
      h('div', { class: 'row' }, hex, paste, copy)
    )
  }

  // ------------------------------------------------------------------ Palettes
  function palettesTab(): HTMLElement {
    const page = h('div', { class: 'bw-tab-page' })
    const build = (): void => {
      const p = store.current
      const sel = h('select', { class: 'bw-select' })
      for (const q of store.palettes) sel.append(h('option', { value: q.id, text: q.id === store.defaultId ? t('color.palette.optionDefault', { name: pname(q) }) : pname(q), selected: q.id === p.id }))
      sel.addEventListener('change', () => store.select(sel.value))
      const view = h('button', {
        class: 'bw-icon-btn',
        title: store.settings.paletteView === 'compact' ? t('color.palette.cardView') : t('color.palette.compactView'),
        icon: store.settings.paletteView === 'compact' ? 'grid' : 'list',
        onclick: () => {
          store.settings.paletteView = store.settings.paletteView === 'compact' ? 'card' : 'compact'
          store.saveSettings()
        }
      })
      const add = h('button', { class: 'bw-icon-btn', title: t('color.palette.addCurrent'), onclick: () => store.addColor(p.id, hsvToHex(cur())) }, icon('plus', 16))
      const more = h('button', { class: 'bw-icon-btn', title: t('color.palette.actions'), icon: 'more' })
      more.addEventListener('click', () => {
        const r = more.getBoundingClientRect()
        contextMenu(r.left - 150, r.bottom + 4, [
          { label: t('color.palette.newEmpty'), run: () => void askText(t('color.palette.new.title'), t('color.palette.untitled'), t('core.common.create')).then((n) => n && store.createEmpty(n)) },
          { label: t('color.palette.newFromDefault'), run: () => store.createFromDefault() },
          { label: t('color.palette.newFromFile'), run: () => void importInto() },
          { label: t('color.palette.import'), run: () => void importInto('palette') },
          { label: t('core.common.duplicate'), run: () => void store.duplicate(p.id) },
          { label: t('color.palette.rename'), run: () => void askText(t('color.palette.rename.title'), pname(p), t('core.common.rename')).then((n) => n && store.rename(p.id, n)) },
          { label: t('color.palette.setDefault'), disabled: store.defaultId === p.id, run: () => store.setDefault(p.id) },
          { label: t('color.palette.shareSwatches'), run: () => void share(p, 'swatches') },
          { label: t('color.palette.exportAse'), run: () => void share(p, 'ase') },
          {
            label: t('color.palette.delete'),
            danger: true,
            disabled: store.palettes.length <= 1,
            run: () => void confirmDialog(t('color.palette.delete'), t('color.palette.delete.confirm', { name: pname(p) })).then((ok) => ok && store.remove(p.id))
          }
        ])
      })
      const grid = h('div', { class: 'bw-swatch-grid ' + store.settings.paletteView })
      const card = store.settings.paletteView === 'card'
      p.colors.forEach((hex, i) => {
        if (!hex) {
          grid.append(h('button', { class: 'bw-slot empty', title: t('color.palette.addHere'), icon: 'plus', onclick: () => store.setSwatch(p.id, i, hsvToHex(cur())) }))
          return
        }
        const b = h('button', { class: 'bw-slot' + (hex === hsvToHex(cur()) ? ' sel' : ''), title: hex, style: `--c:${hex}` }, h('span', { class: 'bw-slot-c' }), card ? h('span', { class: 'bw-slot-t', text: hex.toUpperCase() }) : null)
        b.addEventListener('click', () => {
          const c = hexToHsv(hex, cur().h)!
          put(c, true)
        })
        const rgbv = hsvToRgb(hexToHsv(hex, 0)!)
        attachColorDrag(app, b, () => hex, () => rgbv)
        onLongPress(b, (x, y) =>
          contextMenu(x, y, [
            { label: t('color.palette.setSwatch'), run: () => store.setSwatch(p.id, i, hsvToHex(cur())) },
            { label: t('core.common.delete'), danger: true, run: () => store.deleteSwatch(p.id, i) }
          ])
        )
        grid.append(b)
      })
      page.replaceChildren(
        h('div', { class: 'bw-pal-head' }, sel, view, add, more),
        h('div', { class: 'bw-pal-sub', text: t('color.palette.count', { count: p.colors.filter(Boolean).length }) + (p.id === store.defaultId ? t('color.palette.defaultSuffix') : '') }),
        grid,
        h('div', { class: 'bw-hint', text: t('color.palette.hint') })
      )
    }
    const importInto = async (kind: 'any' | 'palette' = 'any'): Promise<void> => {
      try {
        const list = await importPalettesFromDialog(kind)
        if (!list) return
        for (const q of list) store.add(makePalette(q.name, q.colors))
        ctx.toast(t('color.palette.imported', { count: list.length }))
      } catch (e) {
        ctx.toast(t('color.palette.importFailed', { error: (e as Error).message }))
      }
    }
    const share = async (p: (typeof store.palettes)[number], f: 'swatches' | 'ase'): Promise<void> => {
      try {
        if (await exportPalette(p, f)) ctx.toast(t('color.palette.saved'))
      } catch (e) {
        ctx.toast(t('color.palette.exportFailed', { error: (e as Error).message }))
      }
    }
    build()
    tabDisposers.push(store.events.on('change', build))
    updaters.push(() => {
      // only the selected-swatch highlight depends on the colour
      const hex = hsvToHex(cur())
      page.querySelectorAll<HTMLElement>('.bw-slot:not(.empty)').forEach((b) => b.classList.toggle('sel', b.title === hex))
    })
    return page
  }

  // ------------------------------------------------------------------ refresh
  function refresh(): void {
    const c = cur()
    const hex = hsvToHex(c)
    primary.style.background = hsvToHex(st.color)
    secondary.style.background = hsvToHex(st.secondaryColor)
    primary.classList.toggle('active', !target.secondary)
    secondary.classList.toggle('active', target.secondary)
    hexTop.textContent = t(target.secondary ? 'color.panel.hexSecondary' : 'color.panel.hexPrimary', { hex: hex.toUpperCase() })
    eye.classList.toggle('active', !!shared.eyedropper?.armed)
    history.replaceChildren(
      ...Array.from({ length: 10 }, (_, i) => {
        const hx = st.recentColors[i]
        if (!hx) return h('span', { class: 'bw-hist empty' })
        return h('button', {
          class: 'bw-hist',
          style: `background:${hx}`,
          title: hx,
          onclick: () => {
            const n = hexToHsv(hx, cur().h)
            if (n) put(n, true)
          }
        })
      })
    )
    for (const u of updaters) u()
  }

  disposers.push(st.events.on('color', refresh))
  if (shared.eyedropper) disposers.push(shared.eyedropper.onChange(refresh))
  showTab(lastTab)
  return () => {
    for (const d of tabDisposers) d()
    for (const d of disposers) d()
    body.classList.remove('bw-color-body')
  }
}

function buildSettings(ctx: UIContext): HTMLElement {
  const store = paletteStore()
  const s = store.settings
  const sel = <T extends string | number>(opts: [T, string][], get: () => T, set: (v: T) => void): HTMLSelectElement => {
    const el = h('select', { class: 'bw-select small' })
    for (const [v, l] of opts) el.append(h('option', { value: String(v), text: l, selected: v === get() }))
    el.addEventListener('change', () => {
      const raw = el.value
      set((typeof get() === 'number' ? Number(raw) : raw) as T)
      store.saveSettings()
    })
    return el
  }
  const thr = h('input', { type: 'range', min: 0, max: 100, value: Math.round(s.fillThreshold * 100), class: 'bw-range' })
  const thrVal = h('span', { class: 'val', text: Math.round(s.fillThreshold * 100) + '%' })
  thr.addEventListener('input', () => {
    s.fillThreshold = Number(thr.value) / 100
    thrVal.textContent = thr.value + '%'
    store.saveSettings()
  })
  const aa = h('input', { type: 'checkbox', checked: s.fillAntialias })
  aa.addEventListener('change', () => {
    s.fillAntialias = aa.checked
    store.saveSettings()
  })
  void ctx
  return h(
    'details',
    { class: 'bw-settings' },
    h('summary', { text: t('color.settings.title') }),
    h('div', { class: 'row' }, h('span', { class: 'lbl', text: t('color.settings.sample') }), sel<'composite' | 'layer'>([['composite', t('color.settings.composite')], ['layer', t('color.settings.currentLayer')]], () => s.eyeSource, (v) => (s.eyeSource = v))),
    h('div', { class: 'row' }, h('span', { class: 'lbl', text: t('core.common.size') }), sel<number>([[1, '1 px'], [3, t('color.settings.avg', { n: 3 })], [5, t('color.settings.avg', { n: 5 })], [9, t('color.settings.avg', { n: 9 })], [17, t('color.settings.avg', { n: 17 })]], () => s.eyeSize, (v) => (s.eyeSize = v as 1))),
    h('div', { class: 'row' }, h('span', { class: 'lbl', text: t('color.settings.longPress') }), sel<number>([[0, t('core.common.off')], [300, t('color.settings.seconds', { n: dec('0.3') })], [500, t('color.settings.seconds', { n: dec('0.5') })], [800, t('color.settings.seconds', { n: dec('0.8') })], [1200, t('color.settings.seconds', { n: dec('1.2') })]], () => s.longPressMs, (v) => (s.longPressMs = v))),
    h('div', { class: 'row' }, h('span', { class: 'lbl', text: t('color.settings.fillThreshold') }), thr, thrVal),
    h('label', { class: 'chk' }, aa, t('color.settings.antialias'))
  )
}
