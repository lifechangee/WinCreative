import type { App } from '../../app/app'
import { BLEND_MODES } from '../../core/blend'
import {
  BrushPreset,
  BURNT_MODES,
  DUAL_BLENDS,
  GRAIN_BLENDS,
  RENDER_MODES,
  cloneBrush,
  clampBrushSize,
  isBlendingMode,
  normalizeBrush,
  toSecondary
} from '../../core/brush'
import { StrokePipeline, PaintMode } from '../../core/pipeline'
import type { Sample } from '../../core/types'
import { brushName, getBrushPreset, setName } from '../../brush/presets'
import { BrushTexture, getTextureDef, listTextures } from '../../brush/textures'
import { has, I18nText, resolveText, t, tk } from '../../i18n'

/** Built-in grain/tip textures are translated by id (brushes.texture.<id>); user textures keep their name. */
const texName = (x: { id: string; name?: string }): string | undefined => (has('brushes.texture.' + x.id) ? t('brushes.texture.' + x.id) : x.name)
import { h } from '../../ui/dom'
import { importImageTexture, registerGray } from './brushFile'
import { library } from './library'
import { PreviewContext, brushThumbnail, renderPreview, toCanvas } from './preview'
import { curveEditor, injectCss, roundnessGraph, selectRow, sliderRow, textRow, toggleRow, Fmt, cap } from './widgets'

type Obj = Record<string, any>

const getPath = (o: Obj, p: string): any => p.split('.').reduce((a, k) => (a === undefined || a === null ? undefined : a[k]), o)
function setPath(o: Obj, p: string, v: unknown): void {
  const ks = p.split('.')
  let a = o
  for (let i = 0; i < ks.length - 1; i++) a = a[ks[i]]
  a[ks[ks.length - 1]] = v
}

interface Ctx {
  app: App
  /** brush currently edited (primary or the dual secondary) */
  b(): BrushPreset
  root(): BrushPreset
  changed(): void
  rebuild(): void
  detail: HTMLElement
  secondary: boolean
  set editSecondary(v: boolean)
  tab: { taper: 'pressure' | 'touch'; color: string }
  anim: { on: boolean }
}

interface Section {
  id: string
  title: I18nText
  /** paths compared against the reset point for the modified badge */
  paths: string[]
  build(c: Ctx, into: HTMLElement): void
  /** not available while editing the secondary brush */
  primaryOnly?: boolean
  na?: boolean
}

// ------------------------------------------------------------------ control helpers
function slider(c: Ctx, into: HTMLElement, label: I18nText, path: string, min: number, max: number, fmt: Fmt = 'pct', o: { step?: number; log?: boolean; off?: () => boolean } = {}): void {
  const el = sliderRow(label, () => Number(getPath(c.b(), path) ?? 0), (v) => (setPath(c.b(), path, v), c.changed()), { min, max, fmt, step: o.step, log: o.log })
  if (o.off?.()) el.classList.add('off')
  into.append(el)
}
const toggle = (c: Ctx, into: HTMLElement, label: I18nText, path: string): void => void into.append(toggleRow(label, () => !!getPath(c.b(), path), (v) => (setPath(c.b(), path, v), c.changed())))
const select = (c: Ctx, into: HTMLElement, label: I18nText, path: string, opts: [string, I18nText][], after?: () => void): void =>
  void into.append(selectRow(label, opts, () => String(getPath(c.b(), path)), (v) => (setPath(c.b(), path, v), c.changed(), after?.())))
const head = (into: HTMLElement, label: I18nText): void => void into.append(h('h4', { text: label }))
const note = (into: HTMLElement, label: I18nText): void => void into.append(h('div', { class: 'bs-note', text: label }))
const FILTER_OPTS: [string, I18nText][] = [['none', tk('core.common.none')], ['classic', tk('brushes.studio.classic')], ['improved', tk('brushes.studio.improved')]]

function texCanvas(t: BrushTexture | undefined, size = 54): HTMLCanvasElement {
  const c = h('canvas', { width: size, height: size })
  const g = c.getContext('2d')!
  if (!t) {
    g.fillStyle = '#000'
    g.fillRect(0, 0, size, size)
    g.fillStyle = '#fff'
    g.beginPath()
    g.arc(size / 2, size / 2, size * 0.36, 0, 7)
    g.fill()
    return c
  }
  const img = g.createImageData(size, size)
  for (let y = 0; y < size; y++)
    for (let x = 0; x < size; x++) {
      const v = t.data[Math.floor((y / size) * t.size) * t.size + Math.floor((x / size) * t.size)]
      const o = (y * size + x) * 4
      img.data[o] = img.data[o + 1] = img.data[o + 2] = v
      img.data[o + 3] = 255
    }
  g.putImageData(img, 0, 0)
  return c
}

/** Pick a file through a hidden input (works in the sandboxed renderer). */
function pickFile(accept: string): Promise<File | null> {
  return new Promise((res) => {
    const i = h('input', { type: 'file', accept })
    i.addEventListener('change', () => res(i.files?.[0] ?? null))
    i.addEventListener('cancel', () => res(null))
    i.click()
  })
}

function openTextureEditor(kind: 'tip' | 'grain', initial: BrushTexture | undefined, onApply: (t: BrushTexture) => void): void {
  const S = 256
  const back = h('div', { class: 'bs-root', style: 'z-index:300' })
  const cv = h('canvas', { width: S, height: S })
  cv.style.cssText = 'width:384px;height:384px;background:#000;border-radius:8px;touch-action:none;cursor:crosshair;image-rendering:pixelated'
  const g = cv.getContext('2d', { willReadFrequently: true })!
  if (initial) g.drawImage(texCanvas(initial, S), 0, 0)
  else {
    g.fillStyle = kind === 'tip' ? '#000' : '#fff'
    g.fillRect(0, 0, S, S)
  }
  let color = kind === 'tip' ? '#fff' : '#000'
  let size = 24
  let soft = 0.6
  const dab = (x: number, y: number): void => {
    const gr = g.createRadialGradient(x, y, 0, x, y, size / 2)
    gr.addColorStop(0, color)
    gr.addColorStop(Math.max(0.01, soft), color)
    gr.addColorStop(1, color === '#fff' ? 'rgba(255,255,255,0)' : 'rgba(0,0,0,0)')
    g.fillStyle = gr
    g.beginPath()
    g.arc(x, y, size / 2, 0, 7)
    g.fill()
  }
  let last: [number, number] | null = null
  const pos = (e: PointerEvent): [number, number] => {
    const r = cv.getBoundingClientRect()
    return [((e.clientX - r.left) / r.width) * S, ((e.clientY - r.top) / r.height) * S]
  }
  cv.addEventListener('pointerdown', (e) => {
    cap(cv, e.pointerId)
    last = pos(e)
    dab(...last)
  })
  cv.addEventListener('pointermove', (e) => {
    if (!last) return
    const p = pos(e)
    const n = Math.ceil(Math.hypot(p[0] - last[0], p[1] - last[1]) / (size * 0.15)) || 1
    for (let i = 1; i <= n; i++) dab(last[0] + ((p[0] - last[0]) * i) / n, last[1] + ((p[1] - last[1]) * i) / n)
    last = p
  })
  cv.addEventListener('pointerup', () => (last = null))
  const btn = (label: I18nText, f: () => void): HTMLElement => h('button', { class: 'bs-btn sm', text: label, onclick: f })
  const fill = (col: string): void => void ((g.fillStyle = col), g.fillRect(0, 0, S, S))
  const tools = h(
    'div',
    { class: 'bs-padbar' },
    btn(tk('brushes.studio.paint'), () => (color = '#fff')),
    btn(tk('brushes.studio.erase'), () => (color = '#000')),
    btn(tk('brushes.studio.fillWhite'), () => fill('#fff')),
    btn(tk('brushes.studio.fillBlack'), () => fill('#000')),
    btn(tk('brushes.studio.invert'), () => {
      const d = g.getImageData(0, 0, S, S)
      for (let i = 0; i < d.data.length; i += 4) for (let k = 0; k < 3; k++) d.data[i + k] = 255 - d.data[i + k]
      g.putImageData(d, 0, 0)
    }),
    btn(tk('brushes.studio.blur'), () => {
      const c2 = h('canvas', { width: S, height: S })
      const g2 = c2.getContext('2d')!
      g2.filter = 'blur(3px)'
      g2.drawImage(cv, 0, 0)
      g.drawImage(c2, 0, 0)
    })
  )
  const sz = sliderRow(tk('brushes.studio.brushSize'), () => size, (v) => (size = v), { min: 2, max: 120, fmt: 'px', step: 1 })
  const so = sliderRow(tk('brushes.studio.softness'), () => 1 - soft, (v) => (soft = 1 - v), { min: 0, max: 1, fmt: 'pct' })
  const close = (): void => back.remove()
  const apply = h('button', {
    class: 'bs-btn primary',
    text: tk('brushes.studio.useTexture'),
    onclick: () => {
      const d = g.getImageData(0, 0, S, S)
      const gray = new Uint8Array(S * S)
      for (let i = 0; i < S * S; i++) gray[i] = d.data[i * 4]
      const tex = registerGray(gray, S, S, kind, t(kind === 'tip' ? 'brushes.studio.customShape' : 'brushes.studio.customGrain'))
      close()
      onApply(tex)
    }
  })
  back.append(
    h(
      'div',
      { class: 'bs-win', style: 'width:460px;height:auto;padding:14px;gap:8px' },
      h('h3', { text: kind === 'tip' ? tk('brushes.studio.editShapeWhitePaint') : tk('brushes.studio.editGrainWhitePaint'), style: 'margin:0' }),
      cv,
      tools,
      sz,
      so,
      h('div', { class: 'bs-padbar' }, apply, h('button', { class: 'bs-btn', text: tk('core.common.cancel'), onclick: close }))
    )
  )
  document.body.append(back)
}

function texturePicker(c: Ctx, into: HTMLElement, kind: 'tip' | 'grain'): void {
  const cur = (): string | null => (kind === 'tip' ? c.b().tipTexture : c.b().grain.texture)
  const setTex = (id: string | null): void => {
    if (kind === 'tip') c.b().tipTexture = id
    else {
      c.b().grain.texture = id
      if (id && c.b().grain.depth === 0) c.b().grain.depth = 0.7
    }
    c.changed()
    c.rebuild()
  }
  const wrap = h('div', { class: 'bs-tex' })
  const add = (id: string | null, t?: BrushTexture): void => {
    const cv = texCanvas(t)
    cv.title = (t ? texName(t) : null) ?? (id ? id : kind === 'tip' ? resolveText(tk('brushes.studio.roundProcedural')) : resolveText(tk('core.common.none')))
    if (cur() === id) cv.classList.add('sel')
    cv.addEventListener('click', () => setTex(id))
    wrap.append(cv)
  }
  if (kind === 'tip') add(null)
  else {
    const none = h('canvas', { width: 54, height: 54, title: tk('brushes.studio.noGrain') })
    const g = none.getContext('2d')!
    g.fillStyle = '#fff'
    g.fillRect(0, 0, 54, 54)
    if (cur() === null) none.classList.add('sel')
    none.addEventListener('click', () => setTex(null))
    wrap.append(none)
  }
  for (const t of listTextures(kind)) add(t.id, t)
  const bar = h(
    'div',
    { class: 'bs-padbar' },
    h('button', {
      class: 'bs-btn sm',
      text: tk('brushes.studio.importImage'),
      onclick: async () => {
        const f = await pickFile('image/*')
        if (!f) return
        try {
          setTex((await importImageTexture(f, kind, f.name.replace(/\.[^.]+$/, ''))).id)
        } catch (e) {
          alert(t('brushes.studio.imageError', { error: (e as Error).message }))
        }
      }
    }),
    h('button', { class: 'bs-btn sm', text: tk('brushes.studio.drawEdit'), onclick: () => openTextureEditor(kind, cur() ? getTextureDef(cur()!) : undefined, (t) => setTex(t.id)) })
  )
  into.append(wrap, bar)
}

// ------------------------------------------------------------------ sections
const pct = (v = 0): string => Math.round(v * 100) + '%'
void pct

function taperSection(c: Ctx, into: HTMLElement): void {
  const tabs = h('div', { class: 'bs-tabs' })
  for (const [k, l] of [['pressure', tk('brushes.studio.pressurePen')], ['touch', tk('brushes.studio.touchFingerMouse')]] as const) {
    tabs.append(h('button', { class: c.tab.taper === k ? 'sel' : '', text: l, onclick: () => ((c.tab.taper = k), c.rebuild()) }))
  }
  into.append(tabs)
  const p = 'taper.' + c.tab.taper + '.'
  toggle(c, into, tk('brushes.studio.linkTipSizes'), 'taper.linked')
  slider(c, into, tk('brushes.studio.startTaper'), p + 'start', 0, 1)
  if (!c.b().taper.linked) slider(c, into, tk('brushes.studio.endTaper'), p + 'end', 0, 1)
  slider(c, into, tk('brushes.studio.taperSize'), p + 'size', 0, 1)
  slider(c, into, tk('brushes.studio.taperOpacity'), p + 'opacity', 0, 1)
  slider(c, into, tk('brushes.studio.taperPressure'), p + 'pressure', 0, 1)
  slider(c, into, tk('brushes.studio.taperTipSharpChunky'), p + 'tip', 0, 1)
  toggle(c, into, tk('brushes.studio.classicTaper'), 'taper.classic')
  into.append(toggleRow(tk('brushes.studio.tipAnimationPreview'), () => c.anim.on, (v) => ((c.anim.on = v), c.changed())))
  note(into, tk('brushes.studio.theEndTaperIs'))
}

function shapeSection(c: Ctx, into: HTMLElement): void {
  head(into, tk('brushes.studio.shapeSource'))
  texturePicker(c, into, 'tip')
  toggle(c, into, tk('brushes.studio.invertShape'), 'shape.invert')
  slider(c, into, tk('brushes.studio.hardnessRoundTip'), 'hardness', 0, 1, 'pct', { off: () => !!c.b().tipTexture })
  head(into, tk('brushes.studio.orientation'))
  select(c, into, tk('brushes.studio.inputStyle'), 'shape.inputStyle', [['touch', tk('brushes.studio.touch')], ['azimuth', tk('brushes.studio.azimuth')], ['azimuthRoll', tk('brushes.studio.azimuthBarrelRoll')]])
  slider(c, into, tk('brushes.studio.rotationFollowsStroke'), 'shape.follow', 0, 1)
  slider(c, into, tk('brushes.studio.scatterRandomRotation'), 'dynamics.angleJitter', 0, 180, 'deg', { step: 1 })
  toggle(c, into, tk('brushes.studio.randomized'), 'shape.randomize')
  toggle(c, into, tk('brushes.studio.flipX'), 'shape.flipX')
  toggle(c, into, tk('brushes.studio.flipY'), 'shape.flipY')
  head(into, tk('brushes.studio.count'))
  slider(c, into, tk('brushes.studio.count'), 'shape.count', 1, 16, 'raw', { step: 1 })
  slider(c, into, tk('brushes.studio.countJitter'), 'shape.countJitter', 0, 1)
  head(into, tk('brushes.studio.roundness'))
  into.append(
    roundnessGraph(
      () => ({ roundness: c.b().roundness, angle: c.b().angle }),
      (r, a) => {
        c.b().roundness = Math.round(r * 100) / 100
        c.b().angle = Math.round(a)
        c.changed()
      }
    )
  )
  slider(c, into, tk('brushes.studio.roundness'), 'roundness', 0.05, 1)
  slider(c, into, tk('brushes.studio.angle'), 'angle', 0, 360, 'deg', { step: 1 })
  slider(c, into, tk('brushes.studio.pressureRoundness'), 'shape.pressureRoundness', 0, 1)
  slider(c, into, tk('brushes.studio.tiltRoundness'), 'dynamics.tiltRoundness', 0, 1)
  slider(c, into, tk('brushes.studio.roundnessJitterVertical'), 'shape.roundnessJitterV', 0, 1)
  slider(c, into, tk('brushes.studio.roundnessJitterHorizontal'), 'shape.roundnessJitterH', 0, 1)
  select(c, into, tk('brushes.studio.shapeFiltering'), 'shape.filtering', FILTER_OPTS)
}

function grainSection(c: Ctx, into: HTMLElement): void {
  head(into, tk('brushes.studio.grainSource'))
  texturePicker(c, into, 'grain')
  toggle(c, into, tk('brushes.studio.invertGrain'), 'grain.invert')
  head(into, tk('brushes.studio.behaviour'))
  into.append(
    selectRow(tk('brushes.studio.mode'), [['texturized', tk('brushes.studio.texturizedFixedToCanvas')], ['moving', tk('brushes.studio.movingDragsWithStroke')]], () => (c.b().grain.moving ? 'moving' : 'texturized'), (v) => {
      c.b().grain.moving = v === 'moving'
      c.changed()
      c.rebuild()
    })
  )
  if (c.b().grain.moving) slider(c, into, tk('brushes.studio.movement'), 'grain.movement', 0, 1)
  slider(c, into, tk('brushes.studio.scale'), 'grain.scale', 0.05, 8, 'x', { log: true })
  toggle(c, into, tk('brushes.studio.zoomCroppedFollowsBrush'), 'grain.zoomCropped')
  slider(c, into, tk('brushes.studio.rotation'), 'grain.rotation', 0, 360, 'deg', { step: 1 })
  head(into, tk('brushes.studio.strength'))
  slider(c, into, tk('brushes.studio.depth'), 'grain.depth', 0, 1)
  slider(c, into, tk('brushes.studio.depthMinimum'), 'grain.depthMin', 0, 1)
  slider(c, into, tk('brushes.studio.depthJitter'), 'grain.depthJitter', 0, 1)
  slider(c, into, tk('brushes.studio.offsetJitter'), 'grain.offsetJitter', 0, 1)
  select(c, into, tk('brushes.studio.blendMode'), 'grain.blend', GRAIN_BLENDS.map((m) => [m, tk('brushes.studio.blend.' + m)] as [string, I18nText]))
  slider(c, into, tk('brushes.studio.brightness'), 'grain.brightness', -1, 1, 'signed')
  slider(c, into, tk('brushes.studio.contrast'), 'grain.contrast', 0, 3, 'x')
  select(c, into, tk('brushes.studio.grainFiltering'), 'grain.filtering', FILTER_OPTS)
  note(into, tk('brushes.studio.grainFollowsCameraIs'))
}

function colorSection(c: Ctx, into: HTMLElement): void {
  const jit = (title: I18nText, p: string): void => {
    head(into, title)
    slider(c, into, tk('brushes.studio.hue'), `${p}.hue`, 0, 1)
    slider(c, into, tk('brushes.studio.saturation'), `${p}.saturation`, 0, 1)
    slider(c, into, tk('brushes.studio.lightness'), `${p}.lightness`, 0, 1)
    slider(c, into, tk('brushes.studio.darkness'), `${p}.darkness`, 0, 1)
    slider(c, into, tk('brushes.studio.secondaryColor'), `${p}.secondary`, 0, 1)
  }
  const inp = (title: I18nText, p: string): void => {
    head(into, title)
    slider(c, into, tk('brushes.studio.hue'), `${p}.hue`, -1, 1, 'signed')
    slider(c, into, tk('brushes.studio.saturation'), `${p}.saturation`, -1, 1, 'signed')
    slider(c, into, tk('brushes.studio.lightness'), `${p}.lightness`, -1, 1, 'signed')
    slider(c, into, tk('brushes.studio.secondaryColor'), `${p}.secondary`, 0, 1)
  }
  note(into, tk('brushes.studio.secondaryColorComesFrom'))
  jit(tk('brushes.studio.stampColorJitterPer'), 'color.stampJitter')
  jit(tk('brushes.studio.strokeColorJitterPer'), 'color.strokeJitter')
  inp(tk('brushes.studio.pressureColor'), 'color.pressure')
  inp(tk('brushes.studio.tiltColor'), 'color.tilt')
  inp(tk('brushes.studio.barrelRollColor'), 'color.roll')
}

function penSection(c: Ctx, into: HTMLElement): void {
  head(into, tk('brushes.studio.pressure'))
  into.append(curveEditor(() => c.b().dynamics.pressureCurve, (p) => ((c.b().dynamics.pressureCurve = p), c.changed()), 300, 170, tk('brushes.studio.pressure')))
  slider(c, into, tk('brushes.studio.pressureSize'), 'dynamics.pressureSize', 0, 1)
  slider(c, into, tk('brushes.studio.pressureOpacity'), 'dynamics.pressureOpacity', 0, 1)
  slider(c, into, tk('brushes.studio.pressureFlow'), 'dynamics.pressureFlow', 0, 1)
  slider(c, into, tk('brushes.studio.pressureBleed'), 'dynamics.pressureBleed', 0, 1)
  head(into, tk('brushes.studio.tilt'))
  slider(c, into, tk('brushes.studio.tiltGraphTriggerAngle'), 'dynamics.tiltTrigger', 0, 89, 'deg', { step: 1 })
  slider(c, into, tk('brushes.studio.tiltOpacity'), 'dynamics.tiltOpacity', 0, 1)
  slider(c, into, tk('brushes.studio.tiltGradation'), 'dynamics.tiltGradation', 0, 1)
  slider(c, into, tk('brushes.studio.tiltBleed'), 'dynamics.tiltBleed', 0, 1)
  slider(c, into, tk('brushes.studio.tiltSize'), 'dynamics.tiltSize', 0, 3)
  slider(c, into, tk('brushes.studio.sizeCompression'), 'dynamics.sizeCompression', 0, 1)
  head(into, tk('brushes.studio.barrelRollPenTwist'))
  slider(c, into, tk('brushes.studio.rollSize'), 'dynamics.rollSize', 0, 1)
  slider(c, into, tk('brushes.studio.rollOpacity'), 'dynamics.rollOpacity', 0, 1)
  slider(c, into, tk('brushes.studio.rollBleed'), 'dynamics.rollBleed', 0, 1)
  head(into, tk('brushes.studio.cursor'))
  select(c, into, tk('brushes.studio.cursorOutline'), 'cursor.outline', [['none', tk('core.common.none')], ['contrast', tk('brushes.studio.contrast')], ['active', tk('brushes.studio.activeColor')]])
  slider(c, into, tk('brushes.studio.hoverOpacity'), 'cursor.hoverOpacity', 0, 1)
  select(c, into, tk('brushes.studio.hoverFill'), 'cursor.hoverFill', [['none', tk('core.common.none')], ['shape', tk('brushes.studio.shape')], ['all', tk('brushes.studio.all')]])
}

function dualSection(c: Ctx, into: HTMLElement): void {
  const b = c.root()
  const d = b.dual
  into.append(
    toggleRow(tk('brushes.studio.dualBrush'), () => d.enabled, (v) => {
      d.enabled = v
      if (v && !d.brush) d.brush = toSecondary(getBrushPreset('sketch-graphite') ?? b)
      c.changed()
      c.rebuild()
    })
  )
  if (!d.enabled) return note(into, tk('brushes.studio.combineTwoBrushEngines'))
  head(into, tk('brushes.studio.secondaryBrush'))
  const cur = d.brush
  const row = h('div', { class: 'bs-padbar' })
  const th = cur ? brushThumbnail(c.app, cur, 160, 36) : null
  if (th) {
    const cc = h('canvas', { width: 160, height: 36, style: 'background:#1c1c1e;border-radius:6px' })
    cc.getContext('2d')!.drawImage(th, 0, 0)
    row.append(cc)
  }
  row.append(h('span', { text: cur ? brushName(cur) : t('core.common.none') }))
  row.append(h('button', { class: 'bs-btn sm', text: tk('brushes.studio.chooseFromLibrary'), onclick: () => pickSecondary(c) }))
  row.append(h('button', { class: 'bs-btn sm', text: tk('brushes.studio.editSecondaryBrush'), onclick: () => ((c.editSecondary = true), void 0) }))
  into.append(row)
  select(c, into, tk('brushes.studio.combineBlendMode'), 'dual.mode', DUAL_BLENDS.map((m) => [m, tk('brushes.studio.blend.' + m)] as [string, I18nText]))
  slider(c, into, tk('brushes.studio.dualSize'), 'dual.size', 0.1, 3, 'x', { log: true })
  slider(c, into, tk('brushes.studio.dualOpacity'), 'dual.opacity', 0, 1)
  slider(c, into, tk('brushes.studio.dualFlow'), 'dual.flow', 0, 1)
  toggle(c, into, tk('brushes.studio.orientationFollowsPrimary'), 'dual.followOrient')
  toggle(c, into, tk('brushes.studio.sizeScalesWithPrimary'), 'dual.scaleFollow')
  toggle(c, into, tk('brushes.studio.classicNormalCombineMode'), 'render.classicCombine')
}

function pickSecondary(c: Ctx): void {
  const back = h('div', { class: 'bs-root', style: 'z-index:320' })
  const list = h('div', { style: 'overflow:auto;padding:8px;flex:1' })
  const close = (): void => back.remove()
  for (const s of library.sets) {
    list.append(h('h4', { text: setName(s), style: 'margin:10px 0 4px;color:var(--dim);font-size:12px' }))
    for (const b of library.brushesOf(s.id)) {
      const cv = brushThumbnail(c.app, b, 200, 34)
      const row = h('div', { class: 'bl-row', style: 'margin-bottom:3px', onclick: () => {
        c.root().dual.brush = toSecondary(b)
        c.changed()
        close()
        c.rebuild()
      } }, h('div', { class: 'info' }, h('div', { class: 'nm', text: brushName(b) })))
      if (cv) {
        const cc = h('canvas', { width: 200, height: 34 })
        cc.getContext('2d')!.drawImage(cv, 0, 0)
        row.append(cc)
      }
      list.append(row)
    }
  }
  back.append(h('div', { class: 'bs-win', style: 'width:420px;height:min(620px,90vh)' }, h('div', { class: 'bs-head' }, h('h3', { text: tk('brushes.studio.chooseSecondaryBrush') }), h('button', { class: 'bs-btn', text: tk('core.common.cancel'), onclick: close })), list))
  document.body.append(back)
}

function aboutSection(c: Ctx, into: HTMLElement, st: StudioState): void {
  const b = c.root()
  into.append(textRow(tk('brushes.studio.brushName'), () => brushName(b), (v) => ((b.name = v), c.changed())))
  into.append(textRow(tk('brushes.studio.author'), () => b.about.author, (v) => ((b.about.author = v), c.changed())))
  into.append(h('div', { class: 'bs-ctl' }, h('span', { class: 'lbl', text: tk('brushes.studio.dateCreated') }), h('span', { text: b.about.created || tk('brushes.studio.unknown') })))
  into.append(textRow(tk('brushes.studio.notes'), () => b.about.notes, (v) => ((b.about.notes = v), c.changed())))
  head(into, tk('brushes.studio.authorPicture'))
  const pic = h('img', { style: 'width:64px;height:64px;border-radius:50%;object-fit:cover;background:var(--panel2)' }) as HTMLImageElement
  if (b.about.authorPicture) pic.src = b.about.authorPicture
  into.append(
    h(
      'div',
      { class: 'bs-padbar' },
      pic,
      h('button', {
        class: 'bs-btn sm',
        text: tk('brushes.studio.chooseImage'),
        onclick: async () => {
          const f = await pickFile('image/*')
          if (!f) return
          const bmp = await createImageBitmap(f)
          const cv = h('canvas', { width: 96, height: 96 })
          const s = Math.min(bmp.width, bmp.height)
          cv.getContext('2d')!.drawImage(bmp, (bmp.width - s) / 2, (bmp.height - s) / 2, s, s, 0, 0, 96, 96)
          b.about.authorPicture = cv.toDataURL('image/jpeg', 0.85)
          pic.src = b.about.authorPicture
          c.changed()
        }
      })
    )
  )
  head(into, tk('brushes.studio.signature'))
  const sig = h('canvas', { class: 'bs-sig', width: 300, height: 90 })
  const g = sig.getContext('2d')!
  const paintSig = (src: string): void => {
    const im = new Image()
    im.onload = () => g.drawImage(im, 0, 0)
    im.src = src
  }
  if (b.about.signature) paintSig(b.about.signature)
  let last: [number, number] | null = null
  const pp = (e: PointerEvent): [number, number] => {
    const r = sig.getBoundingClientRect()
    return [((e.clientX - r.left) / r.width) * 300, ((e.clientY - r.top) / r.height) * 90]
  }
  sig.addEventListener('pointerdown', (e) => ((last = pp(e)), cap(sig, e.pointerId)))
  sig.addEventListener('pointermove', (e) => {
    if (!last) return
    const p = pp(e)
    g.strokeStyle = '#111'
    g.lineWidth = 2 + e.pressure * 1.5
    g.lineCap = 'round'
    g.beginPath()
    g.moveTo(...last)
    g.lineTo(...p)
    g.stroke()
    last = p
  })
  sig.addEventListener('pointerup', () => {
    last = null
    b.about.signature = sig.toDataURL('image/png')
    c.changed()
  })
  into.append(sig, h('div', { class: 'bs-padbar' }, h('button', { class: 'bs-btn sm', text: tk('brushes.studio.clearSignature'), onclick: () => (g.clearRect(0, 0, 300, 90), (b.about.signature = ''), c.changed()) })))
  head(into, tk('brushes.studio.resetPoints'))
  into.append(
    h(
      'div',
      { class: 'bs-padbar' },
      h('button', {
        class: 'bs-btn',
        text: tk('brushes.studio.createNewResetPoint'),
        onclick: () => {
          const snap = cloneBrush(b)
          delete snap.resetPoint
          b.resetPoint = JSON.stringify(snap)
          st.baseline = snap
          c.changed()
          st.toast(t('brushes.studio.resetPointSaved'))
        }
      }),
      h('button', {
        class: 'bs-btn',
        text: tk('brushes.studio.resetBrush'),
        onclick: () => {
          const base = cloneBrush(st.baseline)
          base.name = b.name
          base.id = b.id
          if (b.resetPoint) base.resetPoint = b.resetPoint
          st.replaceWorking(base)
        }
      })
    )
  )
  note(into, tk('brushes.studio.resetReturnsEverySetting'))
}

const SECTIONS: Section[] = [
  {
    id: 'path',
    title: tk('brushes.studio.strokePath'),
    paths: ['spacing', 'path', 'dynamics.scatter'],
    build(c, into) {
      slider(c, into, tk('brushes.studio.spacing'), 'spacing', 0.01, 3, 'pct', { log: true })
      slider(c, into, tk('brushes.studio.spacingJitter'), 'path.spacingJitter', 0, 1)
      slider(c, into, tk('brushes.studio.jitterLateral'), 'path.lateralJitter', 0, 4)
      slider(c, into, tk('brushes.studio.jitterLinear'), 'path.linearJitter', 0, 4)
      slider(c, into, tk('brushes.studio.scatterAnyDirection'), 'dynamics.scatter', 0, 3)
      slider(c, into, tk('brushes.studio.fallOff'), 'path.fallOff', 0, 1)
      slider(c, into, tk('brushes.studio.fallOffDistance'), 'path.fallOffLength', 20, 4000, 'px', { log: true })
      note(into, tk('brushes.studio.highSpacingMakesDotted'))
    }
  },
  {
    id: 'stab',
    title: tk('brushes.studio.stabilization'),
    paths: ['streamline', 'stab'],
    build(c, into) {
      slider(c, into, tk('brushes.studio.streamlineAmount'), 'streamline', 0, 1)
      slider(c, into, tk('brushes.studio.streamlinePressure'), 'stab.streamlinePressure', 0, 1)
      slider(c, into, tk('brushes.studio.stabilizationAmount'), 'stab.stabilization', 0, 1)
      slider(c, into, tk('brushes.studio.motionFilteringAmount'), 'stab.motionFiltering', 0, 1)
      slider(c, into, tk('brushes.studio.motionFilteringExpression'), 'stab.motionExpression', 0, 1)
      note(into, tk('brushes.studio.motionFilteringSmoothsWithout'))
    }
  },
  { id: 'taper', title: tk('brushes.studio.taper'), paths: ['taper', 'dynamics.taperStart'], build: (c, into) => taperSection(c, into) },
  { id: 'shape', title: tk('brushes.studio.shape'), paths: ['tipTexture', 'hardness', 'roundness', 'angle', 'shape', 'dynamics.angleJitter', 'dynamics.tiltRoundness'], build: (c, into) => shapeSection(c, into) },
  { id: 'grain', title: tk('brushes.studio.grain'), paths: ['grain'], build: (c, into) => grainSection(c, into) },
  {
    id: 'render',
    title: tk('brushes.studio.rendering'),
    paths: ['render', 'flow', 'wetEdge'],
    build(c, into) {
      select(c, into, tk('brushes.studio.renderingMode'), 'render.mode', RENDER_MODES.map((m) => [m, tk('brushes.studio.render.' + m)] as [string, I18nText]), () => c.rebuild())
      slider(c, into, tk('brushes.studio.flow'), 'flow', 0, 1)
      slider(c, into, tk('brushes.studio.wetEdges'), 'wetEdge', 0, 1)
      slider(c, into, tk('brushes.studio.burntEdges'), 'render.burnt', 0, 1)
      select(c, into, tk('brushes.studio.burntEdgesMode'), 'render.burntMode', BURNT_MODES.map((m) => [m, tk('brushes.studio.blend.' + m)] as [string, I18nText]))
      select(c, into, tk('brushes.studio.brushBlendMode'), 'render.blendMode', BLEND_MODES.map((m) => [m, tk('brushes.studio.blendmode.' + m)] as [string, I18nText]))
      toggle(c, into, tk('brushes.studio.luminanceBlending'), 'render.luminance')
      slider(c, into, tk('brushes.studio.alphaThreshold'), 'render.alphaThreshold', 0, 1)
      note(into, tk('brushes.studio.glazeModesBuildPaint'))
    }
  },
  {
    id: 'wet',
    title: tk('brushes.studio.wetMix'),
    paths: ['wet'],
    build(c, into) {
      const on = isBlendingMode(c.b().render.mode)
      if (!on) {
        into.append(h('div', { class: 'bs-banner' }, h('span', { text: tk('brushes.studio.wetMixActsWhen') }), h('button', { class: 'bs-btn sm', text: tk('brushes.studio.switchNow'), onclick: () => ((c.b().render.mode = 'uniformBlending'), c.changed(), c.rebuild()) })))
      }
      const off = (): boolean => !on
      slider(c, into, tk('brushes.studio.dilution'), 'wet.dilution', 0, 1, 'pct', { off })
      slider(c, into, tk('brushes.studio.charge'), 'wet.charge', 0, 1, 'pct', { off })
      slider(c, into, tk('brushes.studio.attack'), 'wet.attack', 0, 1, 'pct', { off })
      slider(c, into, tk('brushes.studio.pull'), 'wet.pull', 0, 1, 'pct', { off })
      slider(c, into, tk('brushes.studio.grade'), 'wet.grade', 0, 1, 'pct', { off })
      slider(c, into, tk('brushes.studio.blur'), 'wet.blur', 0, 1)
      slider(c, into, tk('brushes.studio.blurJitter'), 'wet.blurJitter', 0, 1)
      slider(c, into, tk('brushes.studio.wetnessJitter'), 'wet.wetnessJitter', 0, 1, 'pct', { off })
    }
  },
  { id: 'color', title: tk('brushes.studio.colorDynamics'), paths: ['color'], build: (c, into) => colorSection(c, into) },
  {
    id: 'dyn',
    title: tk('brushes.studio.dynamics'),
    paths: ['dynamics.speedSize', 'dynamics.speedOpacity', 'dynamics.speedSpacing', 'dynamics.sizeJitter', 'dynamics.opacityJitter'],
    build(c, into) {
      slider(c, into, tk('brushes.studio.speedSize'), 'dynamics.speedSize', -1, 1, 'signed')
      slider(c, into, tk('brushes.studio.speedOpacity'), 'dynamics.speedOpacity', -1, 1, 'signed')
      slider(c, into, tk('brushes.studio.speedSpacing'), 'dynamics.speedSpacing', -1, 1, 'signed')
      slider(c, into, tk('brushes.studio.jitterSize'), 'dynamics.sizeJitter', 0, 1)
      slider(c, into, tk('brushes.studio.jitterOpacity'), 'dynamics.opacityJitter', 0, 1)
      note(into, tk('brushes.studio.negativeSpeedValuesShrink'))
    }
  },
  {
    id: 'pen',
    title: tk('brushes.studio.penApplePencil'),
    paths: ['dynamics.pressureSize', 'dynamics.pressureOpacity', 'dynamics.pressureFlow', 'dynamics.pressureBleed', 'dynamics.pressureCurve', 'dynamics.tiltSize', 'dynamics.tiltOpacity', 'dynamics.tiltGradation', 'dynamics.tiltBleed', 'dynamics.tiltTrigger', 'dynamics.sizeCompression', 'dynamics.rollSize', 'dynamics.rollOpacity', 'dynamics.rollBleed', 'cursor'],
    build: (c, into) => penSection(c, into)
  },
  {
    id: 'props',
    title: tk('brushes.studio.properties'),
    paths: ['props.orientToScreen', 'props.usePreviewStamp', 'props.previewSize', 'props.maxSize', 'props.minSize', 'props.maxOpacity', 'props.minOpacity', 'smudgeStrength', 'defaultSize'],
    build(c, into) {
      toggle(c, into, tk('brushes.studio.useStampPreview'), 'props.usePreviewStamp')
      toggle(c, into, tk('brushes.studio.orientToScreen'), 'props.orientToScreen')
      slider(c, into, tk('brushes.studio.previewSize'), 'props.previewSize', 0.2, 3, 'x', { log: true })
      slider(c, into, tk('brushes.studio.defaultSize'), 'defaultSize', 1, 600, 'px', { log: true })
      slider(c, into, tk('brushes.studio.smudgePull'), 'smudgeStrength', 0, 1)
      slider(c, into, tk('brushes.studio.maximumSize'), 'props.maxSize', 1, 600, 'px', { log: true })
      slider(c, into, tk('brushes.studio.minimumSize'), 'props.minSize', 1, 600, 'px', { log: true })
      slider(c, into, tk('brushes.studio.maximumOpacity'), 'props.maxOpacity', 0, 1)
      slider(c, into, tk('brushes.studio.minimumOpacity'), 'props.minOpacity', 0, 1)
    }
  },
  {
    id: 'materials',
    title: tk('brushes.studio.materials'),
    paths: [],
    na: true,
    build(_c, into) {
      note(into, tk('brushes.studio.materialsMetallicRoughnessOnly'))
    }
  },
  { id: 'dual', title: tk('brushes.studio.dualBrush2'), paths: ['dual'], primaryOnly: true, build: (c, into) => dualSection(c, into) },
  {
    id: 'preview',
    title: tk('brushes.studio.preview'),
    paths: ['preview'],
    build(c, into) {
      slider(c, into, tk('brushes.studio.pressureMinimum'), 'preview.pressureMin', 0, 1)
      slider(c, into, tk('brushes.studio.pressureScale'), 'preview.pressureScale', 0.2, 2, 'x')
      slider(c, into, tk('brushes.studio.tiltAngle'), 'preview.tiltAngle', 0, 90, 'deg', { step: 1 })
      toggle(c, into, tk('brushes.studio.wetMix2'), 'preview.wetMix')
      note(into, tk('brushes.studio.theseOnlyChangeThe'))
    }
  },
  { id: 'about', title: tk('brushes.studio.aboutThisBrush'), paths: ['name', 'about'], primaryOnly: true, build: () => {} }
]

interface StudioState {
  baseline: BrushPreset
  toast(m: string): void
  replaceWorking(b: BrushPreset): void
}

// ------------------------------------------------------------------ the window
export interface StudioOptions {
  onDone(b: BrushPreset): void
  /** Procreate-style: extra note in the title */
  isNew?: boolean
}

let openWin: HTMLElement | null = null

export function openBrushStudio(app: App, source: BrushPreset, opts: StudioOptions): void {
  injectCss()
  openWin?.remove()
  const initial = cloneBrush(source)
  let working = cloneBrush(source)
  if (!working.about.created) working.about.created = new Date().toISOString().slice(0, 10)
  let editSecondary = false
  const state: StudioState = {
    baseline: (() => {
      if (source.resetPoint) {
        try {
          return normalizeBrush(JSON.parse(source.resetPoint))
        } catch {
          /* fall through */
        }
      }
      return initial
    })(),
    toast: (m) => app.notify(m),
    replaceWorking: (b) => {
      working = b
      editSecondary = false
      rebuildAll()
      refresh()
    }
  }
  const tab = { taper: 'pressure' as 'pressure' | 'touch', color: 'stamp' }
  const anim = { on: false }
  let sel = 'path'

  const root = h('div', { class: 'bs-root' })
  openWin = root
  const nameInput = h('input', { class: 'bs-name', type: 'text', value: brushName(working) })
  nameInput.addEventListener('input', () => (working.name = nameInput.value))
  const title = h('h3', { text: opts.isNew ? tk('brushes.studio.newBrush') : tk('brushes.studio.brushStudio') })
  const nav = h('div', { class: 'bs-nav' })
  const detail = h('div', { class: 'bs-detail' })
  const padCol = h('div', { class: 'bs-pad' })
  const done = h('button', { class: 'bs-btn primary', text: tk('core.common.done') })
  const cancel = h('button', { class: 'bs-btn', text: tk('core.common.cancel') })
  root.append(
    h(
      'div',
      { class: 'bs-win' },
      h('div', { class: 'bs-head' }, title, nameInput, cancel, done),
      h('div', { class: 'bs-body' }, nav, detail, padCol)
    )
  )
  document.body.append(root)

  const ctx: Ctx = {
    app,
    b: () => (editSecondary && working.dual.brush ? working.dual.brush : working),
    root: () => working,
    changed: () => refresh(),
    rebuild: () => buildDetail(),
    detail,
    secondary: false,
    set editSecondary(v: boolean) {
      editSecondary = v
      rebuildAll()
      refresh()
    },
    tab,
    anim
  }

  // ---------------- preview strip + drawing pad
  const PW = 396
  const strip = h('canvas', { class: 'strip', width: PW, height: 84 })
  const pad = h('canvas', { class: 'pad', width: PW, height: 300 })
  const gpu = app.gpu
  const stripCtx = new PreviewContext(gpu, PW, 84)
  const padCtx = new PreviewContext(gpu, PW, 300)
  const padMode = h('select', null, h('option', { value: 'paint', text: tk('brushes.studio.paint') }), h('option', { value: 'smudge', text: tk('brushes.studio.smudge') }), h('option', { value: 'erase', text: tk('brushes.studio.erase') }))
  const padSize = h('input', { type: 'range', min: 1, max: 600, value: working.defaultSize, style: 'flex:1;accent-color:var(--accent)' })
  const padSizeVal = h('span', { text: Math.round(working.defaultSize) + 'px', style: 'width:48px;text-align:right;color:var(--dim)' })
  padSize.addEventListener('input', () => (padSizeVal.textContent = padSize.value + 'px'))
  let padDirty = false
  const clearPad = (): void => {
    padCtx.clear()
    padCtx.present(null)
    const g = pad.getContext('2d')!
    g.clearRect(0, 0, PW, 300)
    padDirty = false
  }
  padCol.append(
    h('div', { class: 'bs-padbar' }, h('b', { text: tk('brushes.studio.drawingPad') }), padMode, h('button', { class: 'bs-btn sm', text: tk('brushes.studio.clear'), onclick: clearPad })),
    pad,
    h('div', { class: 'bs-padbar' }, h('span', { text: tk('core.common.size'), style: 'color:var(--dim)' }), padSize, padSizeVal),
    h('div', { class: 'bs-padbar' }, h('b', { text: tk('brushes.studio.preview') })),
    strip
  )

  let raf = 0
  const drawStrip = (progress?: number): void => {
    const b = working
    renderPreview(stripCtx, b, { stamp: b.props.usePreviewStamp, progress })
    const g = strip.getContext('2d')!
    g.clearRect(0, 0, PW, 84)
    g.drawImage(toCanvas(stripCtx.readLayer(), PW, 84), 0, 0)
  }
  const schedule = (): void => {
    if (raf) return
    raf = requestAnimationFrame(() => {
      raf = 0
      try {
        if (!anim.on) drawStrip()
      } catch (e) {
        console.error(e)
      }
    })
  }
  let animT = 0
  const animTimer = window.setInterval(() => {
    if (!anim.on) return
    animT = (animT + 0.04) % 1.4
    try {
      drawStrip(Math.min(1, animT))
    } catch (e) {
      console.error(e)
    }
  }, 60)

  // pad interaction
  let pipe: StrokePipeline | null = null
  let activePtr = -1
  const padSample = (e: PointerEvent): Sample => {
    const r = pad.getBoundingClientRect()
    return {
      x: ((e.clientX - r.left) / r.width) * PW,
      y: ((e.clientY - r.top) / r.height) * 300,
      pressure: e.pointerType === 'pen' ? Math.max(0.03, e.pressure) : e.pointerType === 'touch' ? 0.7 : 0.75,
      tiltX: e.tiltX || 0,
      tiltY: e.tiltY || 0,
      twist: e.twist || 0,
      t: e.timeStamp,
      pointerType: e.pointerType === 'pen' || e.pointerType === 'touch' ? e.pointerType : 'mouse'
    }
  }
  const showRect = (rect: import('../../core/types').Rect | null): void => {
    const pr = padCtx.present(rect)
    if (!pr) return
    pad.getContext('2d')!.putImageData(new ImageData(pr.data as Uint8ClampedArray<ArrayBuffer>, pr.rect.w, pr.rect.h), pr.rect.x, pr.rect.y)
  }
  pad.addEventListener('pointerdown', (e) => {
    if (activePtr >= 0) return
    e.preventDefault()
    activePtr = e.pointerId
    cap(pad, e.pointerId)
    const mode = padMode.value as PaintMode
    const b = cloneBrush(working)
    const size = clampBrushSize(b, Number(padSize.value))
    if (!padDirty && mode !== 'paint') {
      padCtx.backdrop()
      showRect(null)
    }
    padDirty = true
    const color = app.state.rgb
    padCtx.begin(b, mode, color)
    const eng = padCtx.engine
    pipe = new StrokePipeline(
      {
        preset: b,
        size,
        mode,
        color,
        secondary: app.state.secondaryRgb ?? [1, 1, 1],
        curve: (p) => p,
        smoothing: { amount: app.state.smoothingOverride ?? b.streamline, mode: app.state.smoothing.mode, lazyRadius: app.state.smoothing.lazyRadius },
        seed: (performance.now() * 1000) | 0
      },
      { stamp: (d, t) => eng.stamp(d, t), restart: () => eng.restart() }
    )
    pipe.push(padSample(e))
    showRect(eng.takeDirty())
  })
  pad.addEventListener('pointermove', (e) => {
    if (e.pointerId !== activePtr || !pipe) return
    const list = typeof e.getCoalescedEvents === 'function' ? e.getCoalescedEvents() : []
    for (const ev of list.length ? list : [e]) pipe.push(padSample(ev))
    showRect(padCtx.engine.takeDirty())
  })
  const endPad = (): void => {
    if (activePtr < 0 || !pipe) return
    activePtr = -1
    pipe.end()
    padCtx.engine.end()
    pipe = null
    padCtx.engine.takeDirty()
    showRect(null)
  }
  pad.addEventListener('pointerup', endPad)
  pad.addEventListener('pointercancel', endPad)

  // ---------------- navigation + detail
  const badgeEls = new Map<string, HTMLElement>()
  const buildNav = (): void => {
    nav.replaceChildren()
    badgeEls.clear()
    for (const s of SECTIONS) {
      if (editSecondary && s.primaryOnly) continue
      const badge = h('span', { class: 'bs-badge', style: 'display:none' })
      badgeEls.set(s.id, badge)
      nav.append(h('button', { class: (sel === s.id ? 'sel ' : '') + (s.na ? 'na' : ''), onclick: () => ((sel = s.id), buildNav(), buildDetail(), updateBadges()) }, h('span', { text: s.title }), badge))
    }
  }
  const updateBadges = (): void => {
    const base = editSecondary ? state.baseline.dual.brush ?? state.baseline : state.baseline
    for (const s of SECTIONS) {
      const el = badgeEls.get(s.id)
      if (!el) continue
      const cur = ctx.b()
      const mod = s.paths.some((p) => JSON.stringify(getPath(cur, p)) !== JSON.stringify(getPath(base, p)))
      el.style.display = mod ? 'block' : 'none'
    }
  }
  const buildDetail = (): void => {
    const y = detail.scrollTop
    detail.replaceChildren()
    if (editSecondary) {
      detail.append(
        h('div', { class: 'bs-banner' }, h('span', { text: t('brushes.studio.editingSecondary', { name: working.dual.brush ? brushName(working.dual.brush) : '' }) }), h('button', { class: 'bs-btn sm', text: tk('brushes.studio.backToPrimaryBrush'), onclick: () => ((ctx.editSecondary = false), void 0) }))
      )
    }
    const s = SECTIONS.find((x) => x.id === sel) ?? SECTIONS[0]
    detail.append(h('h3', { text: s.title, style: 'margin:6px 0' }))
    if (s.id === 'about') aboutSection(ctx, detail, state)
    else s.build(ctx, detail)
    detail.scrollTop = y
  }
  const rebuildAll = (): void => {
    nameInput.value = brushName(working)
    if (editSecondary && sel === 'about') sel = 'path'
    buildNav()
    buildDetail()
    updateBadges()
  }
  const refresh = (): void => {
    updateBadges()
    schedule()
  }
  rebuildAll()
  schedule()

  const close = (): void => {
    clearInterval(animTimer)
    cancelAnimationFrame(raf)
    stripCtx.dispose()
    padCtx.dispose()
    root.remove()
    if (openWin === root) openWin = null
  }
  cancel.addEventListener('click', close)
  done.addEventListener('click', () => {
    const out = normalizeBrush(working)
    close()
    opts.onDone(out)
  })
  root.addEventListener('pointerdown', (e) => e.stopPropagation())
  window.addEventListener(
    'keydown',
    function esc(e) {
      if (!root.isConnected) return window.removeEventListener('keydown', esc)
      if (e.key === 'Escape' && !document.querySelector('.bs-root ~ .bs-root')) close()
    },
    false
  )
}
