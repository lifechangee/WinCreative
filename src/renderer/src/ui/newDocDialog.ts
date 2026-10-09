import type { App } from '../app/app'
import { galleryRef } from '../features/color/galleryRef'
import { ensureColorStyles } from '../features/color/styles'
import { askText } from '../features/color/dialogs'
import { PROFILE_LABELS } from '../io/colorProfile'
import { getLang, I18nText, resolveText, t, tk } from '../i18n'
import { h } from './dom'
import { createFrame } from '../features/frame'
import { FRAME_PRESETS, presetById } from '../features/frame/model'

export type Unit = 'px' | 'in' | 'cm' | 'mm'
export interface CanvasPreset {
  id: string
  /** built-in presets: i18n ref; user presets: the literal name */
  label: I18nText
  w: number
  h: number
  /** dimensions in px at `dpi` */
  dpi: number
  custom?: boolean
}

const PRESETS: CanvasPreset[] = [
  { id: 'screen', label: tk('ui.newdoc.preset.screen'), w: 1920, h: 1080, dpi: 132 },
  { id: 'square', label: tk('ui.newdoc.preset.square'), w: 2048, h: 2048, dpi: 132 },
  { id: '4k', label: tk('ui.newdoc.preset.4k'), w: 3840, h: 2160, dpi: 132 },
  { id: 'a4', label: tk('ui.newdoc.preset.a4'), w: 2480, h: 3508, dpi: 300 },
  { id: '4x6', label: tk('ui.newdoc.preset.photo'), w: 1800, h: 1200, dpi: 300 },
  { id: 'hd', label: tk('ui.newdoc.preset.hd'), w: 1920, h: 1080, dpi: 132 }
]
const KEY = 'bw.canvasPresets.v1'
const PROFILES = PROFILE_LABELS
const TL_QUALITY = ['Max', 'HD', 'Small'] // values consumed by features/animio; display text: ui.newdoc.tl.<value>

const loadCustom = (): CanvasPreset[] => {
  try {
    const v = JSON.parse(localStorage.getItem(KEY) ?? '[]')
    return Array.isArray(v) ? v.filter((p) => p && typeof p.w === 'number' && typeof p.h === 'number') : []
  } catch {
    return []
  }
}
const saveCustom = (l: CanvasPreset[]): void => {
  try {
    localStorage.setItem(KEY, JSON.stringify(l))
  } catch {
    /* storage unavailable */
  }
}

const PER_UNIT: Record<Unit, number> = { px: 0, in: 1, cm: 1 / 2.54, mm: 1 / 25.4 }
/** value in `unit` -> pixels at `dpi` */
export const toPx = (v: number, unit: Unit, dpi: number): number => (unit === 'px' ? v : v * PER_UNIT[unit] * dpi)
export const fromPx = (px: number, unit: Unit, dpi: number): number => (unit === 'px' ? px : px / (PER_UNIT[unit] * dpi))

/** How many full-canvas layers fit in a ~1.5 GB GPU budget (RGBA16F up to 6 Mpx, else RGBA8). */
export function maxLayers(w: number, h: number): number {
  const bytes = w * h * (w * h <= 6_000_000 ? 8 : 4)
  return Math.max(1, Math.floor(1.5e9 / bytes) - 2)
}

export interface NewCanvasOptions {
  name: string
  w: number
  h: number
  dpi: number
  profile: string
  background: [number, number, number]
  transparent: boolean
  timelapse: string
  /** unbounded canvas (docs/INFINITE_CANVAS.md); w / h are then ignored */
  infinite?: boolean
  /** frame preset id (features/frame); omitted = no frame */
  frame?: string
}

/** Create the document, register it as a gallery artwork and make it current. */
export async function createCanvas(app: App, o: NewCanvasOptions): Promise<void> {
  const store = galleryRef.store
  await store?.flush()
  const doc = app.newDocument(o.w, o.h, { background: { color: o.background, visible: !o.transparent }, ...(o.infinite ? { kind: 'infinite' as const } : {}) })
  doc.name = o.name
  const fp = o.frame ? presetById(o.frame) : undefined
  if (fp) createFrame(app, fp.w, fp.h, fp.id)
  ;(window as any).brushwork_animio?.applyCanvasOptions?.(doc, o) // time-lapse quality, DPI, colour profile (features/animio)
  if (store) await store.addDocument(doc, { name: o.name, profile: o.profile, dpi: o.dpi })
  galleryRef.hide?.()
}

/** Modal "new canvas" dialog: presets, custom size with units and DPI, colour profile, background, name. */
export function showNewDocumentDialog(app: App, root: HTMLElement): void {
  ensureColorStyles()
  let unit: Unit = 'px'
  let custom = loadCustom()
  const nameIn = h('input', { type: 'text', value: t('ui.newdoc.defaultName'), class: 'bw-text-input' })
  const wIn = h('input', { type: 'number', min: 1, step: 'any', value: 2048 })
  const hIn = h('input', { type: 'number', min: 1, step: 'any', value: 2048 })
  const dpiIn = h('input', { type: 'number', min: 1, max: 1200, value: 132 })
  const unitSel = h('select', {}, ...(['px', 'in', 'cm', 'mm'] as Unit[]).map((u) => h('option', { value: u, text: t('ui.unit.' + u) })))
  const profSel = h('select', {}, ...PROFILES.map((p) => h('option', { value: p, text: p })))
  const tlSel = h('select', {}, ...TL_QUALITY.map((p) => h('option', { value: p, text: tk('ui.newdoc.tl.' + p) })))
  const bg = h('input', { type: 'color', value: '#ffffff' })
  const transparent = h('input', { type: 'checkbox' })
  const infiniteChk = h('input', { type: 'checkbox' })
  const frameSel = h('select', {}, h('option', { value: '', text: tk('frame.preset.none') }), ...FRAME_PRESETS.map((p) => h('option', { value: p.id, text: tk('frame.preset.' + p.id) })))
  const infiniteHint = h('div', { class: 'bw-hint', text: tk('ui.newdoc.infiniteHint') })
  const info = h('div', { class: 'bw-hint' })
  const presetBox = h('div', { class: 'presets' })
  const close = (): void => back.remove()

  const pxSize = (): { w: number; h: number } => {
    const dpi = Math.max(1, Number(dpiIn.value) || 132)
    return { w: Math.round(toPx(Number(wIn.value), unit, dpi)), h: Math.round(toPx(Number(hIn.value), unit, dpi)) }
  }
  const refreshInfo = (): void => {
    for (const el of [wIn, hIn, unitSel, dpiIn]) (el as HTMLInputElement).disabled = infiniteChk.checked
    presetBox.style.opacity = infiniteChk.checked ? '0.4' : ''
    infiniteHint.style.display = infiniteChk.checked ? '' : 'none'
    if (infiniteChk.checked) {
      info.textContent = t('ui.newdoc.infiniteInfo', { layers: maxLayers(4096, 4096) })
      info.style.color = ''
      return
    }
    const s = pxSize()
    const ok = s.w >= 16 && s.h >= 16 && s.w <= app.gpu.maxTexture && s.h <= app.gpu.maxTexture
    info.textContent = ok ? t('ui.newdoc.info', { w: s.w, h: s.h, layers: maxLayers(s.w, s.h), mp: ((s.w * s.h) / 1e6).toFixed(1) }) : t('ui.newdoc.sizeRange', { max: app.gpu.maxTexture })
    info.style.color = ok ? '' : '#ff6b62'
  }
  const setPx = (w: number, hh: number, dpi: number): void => {
    dpiIn.value = String(dpi)
    const dec = unit === 'px' ? 0 : 2
    wIn.value = String(+fromPx(w, unit, dpi).toFixed(dec))
    hIn.value = String(+fromPx(hh, unit, dpi).toFixed(dec))
    refreshInfo()
  }
  unitSel.addEventListener('change', () => {
    const s = pxSize()
    unit = unitSel.value as Unit
    setPx(s.w, s.h, Number(dpiIn.value) || 132)
  })
  for (const el of [wIn, hIn, dpiIn]) el.addEventListener('input', refreshInfo)
  infiniteChk.addEventListener('change', refreshInfo)

  const drawPresets = (): void => {
    presetBox.replaceChildren(
      ...[...PRESETS, ...custom].map((p) => {
        const b = h('button', {
          class: 'preset',
          title: p.custom ? t('ui.newdoc.presetDelete') : '',
          text: `${resolveText(p.label)} (${p.w}${getLang() === 'ru' ? '×' : 'x'}${p.h})`,
          onclick: () => setPx(p.w, p.h, p.dpi)
        })
        if (p.custom)
          b.addEventListener('contextmenu', (e) => {
            e.preventDefault()
            custom = custom.filter((c) => c.id !== p.id)
            saveCustom(custom)
            drawPresets()
          })
        return b
      })
    )
  }
  const savePreset = async (): Promise<void> => {
    const s = pxSize()
    const label = await askText(t('ui.newdoc.savePreset'), `${s.w}x${s.h}`, t('core.common.save'))
    if (!label) return
    custom.push({ id: 'c' + Date.now().toString(36), label, w: s.w, h: s.h, dpi: Number(dpiIn.value) || 132, custom: true })
    saveCustom(custom)
    drawPresets()
  }

  const create = h('button', {
    class: 'primary',
    text: tk('core.common.create'),
    onclick: () => {
      const s = infiniteChk.checked ? { w: 4096, h: 4096 } : pxSize()
      if (!infiniteChk.checked && !(s.w >= 16 && s.h >= 16 && s.w <= app.gpu.maxTexture && s.h <= app.gpu.maxTexture)) {
        app.notify(t('ui.newdoc.sizeRange', { max: app.gpu.maxTexture }))
        return
      }
      const c = bg.value.match(/[0-9a-f]{2}/gi)!.map((x) => parseInt(x, 16) / 255) as [number, number, number]
      close()
      void createCanvas(app, {
        name: nameIn.value.trim() || t('ui.newdoc.defaultName'),
        w: s.w,
        h: s.h,
        dpi: Number(dpiIn.value) || 132,
        profile: profSel.value,
        background: c,
        transparent: transparent.checked,
        timelapse: tlSel.value,
        infinite: infiniteChk.checked,
        frame: frameSel.value || undefined
      }).catch((e) => app.notify(t('ui.newdoc.createFailed', { error: (e as Error).message })))
    }
  })
  const back = h(
    'div',
    { class: 'modal-back' },
    h(
      'div',
      { class: 'modal bw-newdoc' },
      h('h3', { text: tk('ui.newdoc.title') }),
      nameIn,
      h('label', { class: 'chk' }, infiniteChk, tk('ui.newdoc.infinite')),
      infiniteHint,
      presetBox,
      h('div', { class: 'row' }, h('span', { class: 'lbl', text: tk('ui.newdoc.width') }), wIn, h('span', { class: 'lbl', text: tk('ui.newdoc.height') }), hIn),
      h('div', { class: 'row' }, h('span', { class: 'lbl', text: tk('ui.newdoc.units') }), unitSel, h('span', { class: 'lbl', text: tk('ui.newdoc.dpi') }), dpiIn),
      info,
      h('div', { class: 'row' }, h('span', { class: 'lbl', text: tk('frame.newdoc.label') }), frameSel),
      h('div', { class: 'row' }, h('span', { class: 'lbl', text: tk('ui.newdoc.colour') }), profSel, tlSel),
      h('div', { class: 'row' }, h('span', { class: 'lbl', text: tk('ui.newdoc.background') }), bg, h('label', { class: 'chk' }, transparent, tk('ui.newdoc.transparent'))),
      h('div', { class: 'row end' }, h('button', { text: tk('ui.newdoc.saveAsPreset'), onclick: () => void savePreset() }), h('button', { text: tk('core.common.cancel'), onclick: close }), create)
    )
  )
  back.addEventListener('pointerdown', (e) => e.target === back && close())
  nameIn.addEventListener('keydown', (e) => e.stopPropagation())
  drawPresets()
  setPx(2048, 2048, 132)
  refreshInfo()
  root.append(back)
  nameIn.focus()
  nameIn.select()
}
