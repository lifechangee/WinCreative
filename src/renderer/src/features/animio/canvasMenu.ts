import type { App } from '../../app/app'
import { Document } from '../../doc/document'
import { resample } from '../../io/gpuUtil'
import { flattenedBitmap } from '../../io/frameRender'
import { h } from '../../ui/dom'
import { I18nRef, t, tk } from '../../i18n'
import { registerMenuItem } from '../../ui/registry'
import type { UIContext } from '../../ui/registry'
import { animState } from './animation'
import { docMeta, profileListeners, setDocMeta } from './docMeta'
import { convertToFixedDialog, convertToInfinite, flipInfinite } from '../infinite/convert'
import { openProfileDialog } from '../profiles/dialog'
import { formatDuration } from './schedule'
import { getRecorder } from './timelapse'
import { btn, confirmDialog, fmtBytes, fx, modal, numberInput, select } from './ui'

const full = (d: Document): { x: number; y: number; w: number; h: number } => ({ x: 0, y: 0, w: d.width, h: d.height })

// ------------------------------------------------------------------ flip (content)
/**
 * Flip the whole canvas. Procreate mirrors only the VIEW; the view transform/pointer mapping are owned by other
 * modules, so this flips the pixels of every layer and mask instead (one undo step).
 */
export function flipCanvas(app: App, axis: 'h' | 'v'): void {
  if (app.doc.isInfinite) return flipInfinite(app, axis)
  const doc = app.doc
  const gpu = app.gpu
  const f = full(doc)
  doc.transaction(axis === 'h' ? 'Flip canvas horizontal' : 'Flip canvas vertical', 'filter', null, () => {
    const one = (layer: (typeof doc.layers)[number], mask: boolean): void => {
      const before = layer.editingMask
      layer.editingMask = mask
      const edit = doc.beginPixelEdit(layer, 'Flip')
      const surf = mask ? layer.mask! : layer.pixels
      edit.save(f)
      gpu.blit(surf, f, doc.scratch, 0, 0)
      resample(gpu, doc.scratch, surf, axis === 'h' ? { origin: [doc.width, 0], step: [-1, 1] } : { origin: [0, doc.height], step: [1, -1] })
      edit.finish()
      layer.editingMask = before
    }
    for (const l of doc.layers) {
      if (l.isGroup) continue
      one(l, false)
      if (l.mask) one(l, true)
    }
  })
}

// ------------------------------------------------------------------ crop & resize
export interface CropSpec {
  width: number
  height: number
  /** document-space position of the new canvas' top-left corner (crop mode) */
  x: number
  y: number
  /** true: scale the content to the new size (Resample Canvas) */
  resample: boolean
}

/** Build a new document from `doc` with the given crop/resize. Layer ids, props, masks and canvas metadata are kept. */
export function cropDocument(app: App, doc: Document, spec: CropSpec): Document {
  const gpu = app.gpu
  const nd = new Document(gpu, spec.width, spec.height, { background: { color: [...doc.background.color], visible: doc.background.visible } })
  nd.name = doc.name
  const map = spec.resample ? { origin: [0, 0] as [number, number], step: [doc.width / spec.width, doc.height / spec.height] as [number, number] } : { origin: [spec.x, spec.y] as [number, number], step: [1, 1] as [number, number] }
  for (const l of doc.layers) {
    const nl = nd.createLayer({ ...l.props, maskView: false }, l.id)
    if (!l.isGroup) {
      resample(gpu, l.pixels, nl.pixels, map)
      if (l.mask) {
        nl.mask = nd.createMaskSurface(false)
        // outside the old canvas a mask should reveal nothing new: keep white there for crop-grow
        resample(gpu, l.mask, nl.mask, map)
      }
    }
    nd.layers.push(nl)
  }
  nd.activeId = doc.activeId
  setDocMeta(nd, { ...docMeta(doc) })
  nd.emitCommit('load', null, null, 'Crop and resize')
  return nd
}

function cropDialog(app: App, ui: UIContext): void {
  const doc = app.doc
  const meta = docMeta(doc)
  const m = modal(tk('animio.crop.title'))
  const st = { w: doc.width, h: doc.height, x: 0, y: 0, constrain: true, resample: false, dpi: meta.dpi, unit: 'px' as 'px' | 'in' | 'cm' | 'mm' }
  const aspect = doc.width / doc.height
  const maxTex = app.gpu.maxTexture
  const info = h('p', { class: 'an-note' })
  const preview = h('canvas', { width: 420, height: 300, style: 'width:420px;height:300px;background:#111;border-radius:8px;touch-action:none;cursor:move;display:block;margin:0 auto 10px' })
  const pctx = preview.getContext('2d')!
  const thumb = document.createElement('canvas')
  {
    const b = flattenedBitmap(app.compositor, doc, true)
    const k = Math.min(1, 512 / Math.max(b.width, b.height))
    const src = document.createElement('canvas')
    src.width = b.width
    src.height = b.height
    src.getContext('2d')!.putImageData(new ImageData(b.data as unknown as Uint8ClampedArray<ArrayBuffer>, b.width, b.height), 0, 0)
    thumb.width = Math.round(b.width * k)
    thumb.height = Math.round(b.height * k)
    thumb.getContext('2d')!.drawImage(src, 0, 0, thumb.width, thumb.height)
  }
  const wIn = h('input', { type: 'number', min: '1', max: String(maxTex), value: String(st.w) })
  const hIn = h('input', { type: 'number', min: '1', max: String(maxTex), value: String(st.h) })
  const xIn = h('input', { type: 'number', value: '0' })
  const yIn = h('input', { type: 'number', value: '0' })
  const dpiIn = h('input', { type: 'number', min: '1', max: '2400', value: String(st.dpi) })
  const unitLbl = h('span', { class: 'an-note' })
  const layout = (): { s: number; ox: number; oy: number } => {
    const minX = Math.min(0, st.x)
    const minY = Math.min(0, st.y)
    const maxX = Math.max(doc.width, st.x + st.w)
    const maxY = Math.max(doc.height, st.y + st.h)
    const s = Math.min((preview.width - 20) / (maxX - minX), (preview.height - 20) / (maxY - minY))
    return { s, ox: 10 - minX * s + (preview.width - 20 - (maxX - minX) * s) / 2, oy: 10 - minY * s + (preview.height - 20 - (maxY - minY) * s) / 2 }
  }
  const draw = (): void => {
    const { s, ox, oy } = layout()
    pctx.clearRect(0, 0, preview.width, preview.height)
    pctx.fillStyle = '#111'
    pctx.fillRect(0, 0, preview.width, preview.height)
    const cx = st.resample ? 0 : st.x
    const cy = st.resample ? 0 : st.y
    pctx.drawImage(thumb, ox, oy, doc.width * s, doc.height * s)
    pctx.strokeStyle = '#ffffff55'
    pctx.strokeRect(ox, oy, doc.width * s, doc.height * s)
    pctx.fillStyle = '#00000088'
    pctx.beginPath()
    pctx.rect(0, 0, preview.width, preview.height)
    pctx.rect(ox + cx * s, oy + cy * s, (st.resample ? doc.width : st.w) * s, (st.resample ? doc.height : st.h) * s)
    pctx.fill('evenodd')
    pctx.strokeStyle = '#3b82f6'
    pctx.lineWidth = 2
    pctx.strokeRect(ox + cx * s, oy + cy * s, (st.resample ? doc.width : st.w) * s, (st.resample ? doc.height : st.h) * s)
    const inch = st.w / st.dpi
    info.textContent = t('animio.crop.info', { w: st.w, h: st.h, iw: fx(inch, 2), ih: fx(st.h / st.dpi, 2), cw: fx(inch * 2.54, 1), ch: fx((st.h / st.dpi) * 2.54, 1) })
    unitLbl.textContent = ''
  }
  const sync = (): void => {
    wIn.value = String(st.w)
    hIn.value = String(st.h)
    xIn.value = String(st.x)
    yIn.value = String(st.y)
    draw()
  }
  const clampSize = (): void => {
    st.w = Math.max(1, Math.min(maxTex, Math.round(st.w)))
    st.h = Math.max(1, Math.min(maxTex, Math.round(st.h)))
  }
  wIn.addEventListener('change', () => {
    st.w = Number(wIn.value) || 1
    if (st.constrain) st.h = Math.round(st.w / aspect)
    clampSize()
    sync()
  })
  hIn.addEventListener('change', () => {
    st.h = Number(hIn.value) || 1
    if (st.constrain) st.w = Math.round(st.h * aspect)
    clampSize()
    sync()
  })
  xIn.addEventListener('change', () => ((st.x = Math.round(Number(xIn.value) || 0)), sync()))
  yIn.addEventListener('change', () => ((st.y = Math.round(Number(yIn.value) || 0)), sync()))
  dpiIn.addEventListener('change', () => ((st.dpi = Math.max(1, Number(dpiIn.value) || 132)), draw()))
  const constrain = h('input', { type: 'checkbox', checked: true })
  constrain.addEventListener('change', () => (st.constrain = constrain.checked))
  const mode = select<'crop' | 'resample'>([['crop', tk('animio.crop.modeCrop')], ['resample', tk('animio.crop.modeResample')]], 'crop', (v) => {
    st.resample = v === 'resample'
    draw()
  })
  // drag inside the preview: move the crop window; drag near an edge: resize it
  let drag: { mode: string; sx: number; sy: number; x: number; y: number; w: number; h: number } | null = null
  preview.addEventListener('pointerdown', (e) => {
    if (st.resample) return
    const r = preview.getBoundingClientRect()
    const px = ((e.clientX - r.left) / r.width) * preview.width
    const py = ((e.clientY - r.top) / r.height) * preview.height
    const { s, ox, oy } = layout()
    const L = ox + st.x * s
    const T = oy + st.y * s
    const R = L + st.w * s
    const B = T + st.h * s
    const near = (a: number, b: number): boolean => Math.abs(a - b) < 9
    let md = 'move'
    if (near(px, L)) md = 'l'
    else if (near(px, R)) md = 'r'
    else if (near(py, T)) md = 't'
    else if (near(py, B)) md = 'b'
    drag = { mode: md, sx: px, sy: py, x: st.x, y: st.y, w: st.w, h: st.h }
    preview.setPointerCapture(e.pointerId)
  })
  preview.addEventListener('pointermove', (e) => {
    if (!drag) return
    const r = preview.getBoundingClientRect()
    const px = ((e.clientX - r.left) / r.width) * preview.width
    const py = ((e.clientY - r.top) / r.height) * preview.height
    const { s } = layout()
    const dx = Math.round((px - drag.sx) / s)
    const dy = Math.round((py - drag.sy) / s)
    if (drag.mode === 'move') {
      st.x = drag.x + dx
      st.y = drag.y + dy
    } else if (drag.mode === 'l') {
      st.x = drag.x + dx
      st.w = Math.max(1, drag.w - dx)
    } else if (drag.mode === 'r') st.w = Math.max(1, drag.w + dx)
    else if (drag.mode === 't') {
      st.y = drag.y + dy
      st.h = Math.max(1, drag.h - dy)
    } else st.h = Math.max(1, drag.h + dy)
    if (st.constrain && drag.mode !== 'move') {
      if (drag.mode === 'l' || drag.mode === 'r') st.h = Math.round(st.w / aspect)
      else st.w = Math.round(st.h * aspect)
    }
    clampSize()
    sync()
  })
  preview.addEventListener('pointerup', () => (drag = null))
  m.body.append(
    preview,
    h('div', { class: 'an-grid' }, h('label', { text: tk('animio.anim.mode') }), mode, h('label', { text: tk('animio.crop.width') }), wIn, h('label', { text: tk('animio.crop.height') }), hIn, h('label', { text: tk('animio.crop.constrain') }), h('label', { class: 'chk' }, constrain, h('span', { text: tk('animio.crop.constrainProportions') })), h('label', { text: tk('animio.crop.offsetX') }), xIn, h('label', { text: tk('animio.crop.offsetY') }), yIn, h('label', { text: 'DPI' }), dpiIn), // i18n-ignore
    info,
    unitLbl,
    h('p', { class: 'an-note', text: tk('animio.crop.note') })
  )
  m.onLang(draw)
  m.footer.append(
    btn(tk('core.common.reset'), () => {
      Object.assign(st, { w: doc.width, h: doc.height, x: 0, y: 0 })
      sync()
    }),
    btn(tk('core.common.cancel'), () => m.close()),
    btn(tk('core.common.done'), async () => {
      const unchanged = st.w === doc.width && st.h === doc.height && (st.resample || (st.x === 0 && st.y === 0))
      if (unchanged) {
        setDocMeta(doc, { dpi: st.dpi })
        m.close()
        return
      }
      if (!(await confirmDialog(tk('animio.crop.confirm.title'), tk('animio.crop.confirm.text'), tk('core.common.apply')))) return
      try {
        const nd = cropDocument(app, doc, { width: st.w, height: st.h, x: st.x, y: st.y, resample: st.resample })
        setDocMeta(nd, { dpi: st.dpi })
        migrateAnimState(doc, nd)
        app.setDocument(nd)
        m.close()
        ui.toast(t('animio.crop.done', { w: st.w, h: st.h }))
      } catch (e) {
        ui.toast(t('animio.common.failed', { error: (e as Error).message }))
      }
    }, 'primary')
  )
  sync()
}

/** Animation settings survive a canvas resize (layer ids are preserved). */
function migrateAnimState(from: Document, to: Document): void {
  Object.assign(animState(to), JSON.parse(JSON.stringify(animState(from))))
}

// ------------------------------------------------------------------ canvas information
/** Canvas Information rows of an infinite document: type, painted area, tile count + GPU memory. */
function infiniteRows(doc: App['doc'], stat: (k: string, v: string) => HTMLElement): HTMLElement[] {
  const b = doc.contentBounds({ tight: true })
  const s = doc.tileStats()
  return [
    stat(t('animio.info.kind'), t('animio.info.kindInfinite')),
    stat(t('animio.info.content'), b ? t('animio.info.contentValue', { w: Math.round(b.w), h: Math.round(b.h), x: Math.round(b.x), y: Math.round(b.y) }) : t('animio.info.contentNone')),
    stat(t('animio.info.tiles'), t('animio.info.tilesValue', { n: s.tiles, mb: Math.round(s.bytes / 1048576) })),
    stat(t('animio.info.tiers'), t('animio.info.tiersValue', { gpu: s.gpu, cpu: s.cpu, disk: s.disk, cmb: Math.round(s.cpuBytes / 1048576), dmb: Math.round(s.diskBytes / 1048576) }))
  ]
}

function infoDialog(app: App, ui: UIContext): void {
  const doc = app.doc
  const meta = docMeta(doc)
  const rec = getRecorder(doc)
  const m = modal(tk('animio.info.title'), () => profileListeners.delete(paint))
  const stat = (a: string, b: string): HTMLElement => h('div', { class: 'an-stat' }, h('span', { text: a }), h('span', { text: b }))
  const body = h('div')
  const paint = (): void => {
    body.replaceChildren(
      h('div', { class: 'an-h', text: t('animio.info.dimensions') }),
      ...(doc.isInfinite ? infiniteRows(doc, stat) : [
      stat(t('core.common.size'), t('animio.info.sizeValue', { w: doc.width, h: doc.height })),
      stat(t('animio.info.physical'), t('animio.info.physicalValue', { w: fx(doc.width / meta.dpi, 2), h: fx(doc.height / meta.dpi, 2), dpi: meta.dpi }))]),
      stat(t('animio.info.layers'), t('animio.info.layersValue', { used: doc.paintLayerCount, max: doc.maxLayers, groups: doc.layers.length - doc.paintLayerCount })),
      stat(t('animio.info.profile'), meta.profile),
      stat(t('animio.info.pixelFormat'), doc.format === 'rgba16f' ? t('animio.info.format16') : t('animio.info.format8')),
      h('div', { class: 'an-h', text: t('animio.info.stats') }),
      stat(t('animio.info.strokes'), String(rec?.strokes ?? 0)),
      stat(t('animio.info.timeSpent'), formatDuration(rec?.trackedMs ?? 0)),
      stat(t('animio.info.timelapse'), rec ? t('animio.info.timelapseValue', { state: rec.enabled ? t('animio.info.recording') : t('animio.info.paused'), count: rec.count, dur: formatDuration(rec.seconds * 1000) }) : t('animio.info.na')),
      stat(t('animio.info.timelapseSize'), rec ? fmtBytes(rec.bytes) : '0'),
      stat(t('animio.info.videoSettings'), rec ? t('animio.info.videoValue', { q: rec.quality.toUpperCase() }) : t('animio.info.na'))
    )
  }
  paint()
  m.onLang(paint)
  const author = h('input', { type: 'text', value: meta.author, placeholder: tk('animio.info.author') })
  author.addEventListener('change', () => setDocMeta(doc, { author: author.value }))
  const name = h('input', { type: 'text', value: doc.name })
  name.addEventListener('change', () => {
    doc.name = name.value || t('core.common.untitled')
    app.events.emit('doc', doc)
  })
  const profile = btn(tk('animio.info.assignConvert'), () => openProfileDialog(app))
  profileListeners.add(paint)
  const bg = h('input', { type: 'color', value: '#' + doc.background.color.map((v) => Math.round(v * 255).toString(16).padStart(2, '0')).join('') })
  const hideBg = h('input', { type: 'checkbox', checked: !doc.background.visible })
  const applyBg = (): void => {
    const n = parseInt(bg.value.slice(1), 16)
    doc.setBackground([((n >> 16) & 255) / 255, ((n >> 8) & 255) / 255, (n & 255) / 255], !hideBg.checked)
  }
  bg.addEventListener('input', applyBg)
  hideBg.addEventListener('change', applyBg)
  m.body.append(
    body,
    h('div', { class: 'an-h', text: tk('animio.info.meta') }),
    h('div', { class: 'an-grid' }, h('label', { text: tk('animio.info.canvasName') }), name, h('label', { text: tk('animio.info.author') }), author),
    h('div', { class: 'an-h', text: tk('animio.info.properties') }),
    h('div', { class: 'an-grid' }, h('label', { text: tk('animio.info.bgColor') }), bg, h('label', { text: tk('animio.info.background') }), h('label', { class: 'chk' }, hideBg, h('span', { text: tk('animio.info.hideBg') })), h('label', { text: tk('animio.info.profile') }), profile),
    h('p', { class: 'an-note', text: tk('animio.info.profileNote') })
  )
  m.footer.append(btn(tk('core.common.close'), () => m.close(), 'primary'))
  void ui
}

export function installCanvasMenu(app: App, ui: UIContext): void {
  const A = (id: string, label: I18nRef, run: () => void, separator = false): void => registerMenuItem('actions', { id, label, group: 'canvas', separator, run })
  registerMenuItem('actions', { id: 'canvas-crop', label: () => (app.doc.isInfinite ? t('ui.inf.menu.toFixed') : t('animio.menu.crop')), group: 'canvas', separator: true, run: () => (app.doc.isInfinite ? convertToFixedDialog(app) : cropDialog(app, ui)) })
  registerMenuItem('actions', { id: 'canvas-to-infinite', label: tk('ui.inf.menu.toInfinite'), group: 'canvas', run: () => (app.doc.isInfinite ? app.notify(t('ui.inf.toInfinite.done').split(';')[0]) : void convertToInfinite(app)) })
  A('canvas-mirror', tk('animio.menu.mirror'), () => app.toggleMirror(), true)
  A('canvas-flip-h', tk('animio.menu.flipH'), () => flipCanvas(app, 'h'))
  A('canvas-flip-v', tk('animio.menu.flipV'), () => flipCanvas(app, 'v'))
  A('canvas-info', tk('animio.menu.info'), () => infoDialog(app, ui))
}
