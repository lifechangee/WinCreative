import type { App } from '../../app/app'
import { LayerLimitError } from '../../doc/document'
import type { Layer } from '../../doc/layer'
import { decodePsd } from '../../io/psd'
import { decodeImage, encodePng } from '../../io/bwk'
import { clipMask } from '../../gl/clipMask'
import { t } from '../../i18n'
import { cropToAlpha, eraseSelected, insertAndTransform, layerFromImage, notifyInserted, PixelImage, readLayerImage, selectionToNewLayer } from './ops'

declare global {
  interface Window {
    brushworkClip?: {
      writeImage(png: Uint8Array): Promise<boolean>
      readImage(): Promise<Uint8Array | null>
      testMode(): Promise<boolean>
      testLog(s: string): Promise<void>
      testDone(ok: boolean): Promise<void>
    }
  }
}

interface Clip {
  img: PixelImage
  /** what the OS clipboard held right after we wrote it (to tell our own copy from a foreign one) */
  osPng: Uint8Array | null
}
let clip: Clip | null = null

const same = (a: Uint8Array | null, b: Uint8Array | null): boolean => {
  if (!a || !b || a.length !== b.length) return false
  for (let i = 0; i < a.length; i++) if (a[i] !== b[i]) return false
  return true
}

/** true when the app has copied pixels internally */
export const hasInternalClip = (): boolean => clip !== null

/** PNG (with alpha) to the OS clipboard: main-process clipboard first (no focus / permission needed), async Clipboard API as the fallback. */
export async function writeClipboardPng(png: Uint8Array): Promise<void> {
  if (window.brushworkClip) {
    try {
      await window.brushworkClip.writeImage(png)
      return
    } catch (e) {
      console.warn('[clipboard] main write failed', e)
    }
  }
  await navigator.clipboard.write([new ClipboardItem({ 'image/png': new Blob([png as BlobPart], { type: 'image/png' }) })])
}

async function store(img: PixelImage): Promise<void> {
  clip = { img, osPng: null }
  try {
    const png = await encodePng(img.data, img.w, img.h)
    await writeClipboardPng(png)
    clip.osPng = (await window.brushworkClip?.readImage()) ?? null
  } catch (e) {
    console.warn('[layers] OS clipboard write failed', e)
  }
}

const guard = (app: App, fn: () => void): void => {
  try {
    fn()
  } catch (e) {
    app.notify(e instanceof LayerLimitError ? e.message : t('layers.toast.failed') + (e as Error).message)
  }
}

function activePaint(app: App): Layer | null {
  const l = app.doc.activeLayer
  if (!l || l.isGroup) {
    app.notify(t('layers.toast.selectLayerPaint'))
    return null
  }
  return l
}

export async function copy(app: App): Promise<boolean> {
  const l = activePaint(app)
  if (!l) return false
  const img = readLayerImage(app.doc, l)
  if (!img) {
    app.notify(t('layers.toast.nothingToCopy'))
    return false
  }
  await store(img)
  app.notify(clipMask.tex ? t('layers.toast.selectionCopied') : t('layers.toast.layerCopied'))
  return true
}

export async function cut(app: App): Promise<boolean> {
  const l = activePaint(app)
  if (!l) return false
  if (l.locked) {
    app.notify(t('layers.toast.layerLocked'))
    return false
  }
  if (!(await copy(app))) return false
  eraseSelected(app.doc, l, 'Cut')
  return true
}

/** Copy the composite of all visible layers (inside the selection when there is one). */
export async function copyAll(app: App): Promise<boolean> {
  const doc = app.doc
  if (doc.isInfinite) {
    const sb = clipMask.tex ? app.selection.bounds() : null
    const b = sb ?? doc.contentBounds({ tight: true, visibleOnly: true })
    if (!b) {
      app.notify(t('layers.toast.nothingToCopy'))
      return false
    }
    const max = Math.min(8192, app.gpu.maxTexture)
    const r = { x: b.x, y: b.y, w: Math.min(b.w, max), h: Math.min(b.h, max) }
    const flat = app.compositor.readFlattened(r, 1, false)
    const cov = sb ? app.selection.readRect(r) : null
    if (cov) for (let i = 0; i < cov.length; i++) flat.px[i * 4 + 3] = (flat.px[i * 4 + 3] * cov[i]) / 255
    const c = cropToAlpha(flat.px, flat.w, flat.h)
    if (!c) {
      app.notify(t('layers.toast.nothingToCopy'))
      return false
    }
    await store({ ...c, x: c.x + r.x, y: c.y + r.y })
    app.notify(t('layers.toast.canvasCopied'))
    return true
  }
  const px = app.compositor.readFlattened(false)
  const sel = (app as any).selection as { data: Uint8Array | null } | undefined
  if (clipMask.tex && sel?.data) for (let i = 0, n = doc.width * doc.height; i < n; i++) px[i * 4 + 3] = (px[i * 4 + 3] * sel.data[i]) / 255
  const img = clipMask.tex ? cropToAlpha(px, doc.width, doc.height) : { x: 0, y: 0, w: doc.width, h: doc.height, data: px }
  if (!img) {
    app.notify(t('layers.toast.nothingToCopy'))
    return false
  }
  await store(img)
  app.notify(t('layers.toast.canvasCopied'))
  return true
}

/** Duplicate: selection (or whole layer) into a new layer, in place. */
export function duplicate(app: App): void {
  const l = activePaint(app)
  if (!l) return
  guard(app, () => {
    selectionToNewLayer(app.doc, l, false)
  })
}

/** Cut & Paste: move the selection to a new layer in place. */
export function cutAndPaste(app: App): void {
  const l = activePaint(app)
  if (!l) return
  if (!clipMask.tex) {
    app.notify(t('layers.toast.makeSelection'))
    return
  }
  if (l.locked) return void app.notify(t('layers.toast.layerLocked'))
  guard(app, () => {
    selectionToNewLayer(app.doc, l, true)
  })
}

/** Scale an ImageData-like bitmap to fit inside the canvas (never upscales). */
async function fitToCanvas(app: App, w: number, h: number, data: Uint8ClampedArray | Uint8Array): Promise<PixelImage> {
  const doc = app.doc
  const k = doc.isInfinite ? 1 : Math.min(1, doc.width / w, doc.height / h)
  let outW = w
  let outH = h
  let out = new Uint8ClampedArray(data.buffer.slice(data.byteOffset, data.byteOffset + data.byteLength) as ArrayBuffer)
  if (k < 1) {
    outW = Math.max(1, Math.round(w * k))
    outH = Math.max(1, Math.round(h * k))
    const src = new OffscreenCanvas(w, h)
    src.getContext('2d')!.putImageData(new ImageData(out as unknown as Uint8ClampedArray<ArrayBuffer>, w, h), 0, 0)
    const dst = new OffscreenCanvas(outW, outH)
    const c = dst.getContext('2d', { willReadFrequently: true })!
    c.imageSmoothingQuality = 'high'
    c.drawImage(src, 0, 0, outW, outH)
    out = c.getImageData(0, 0, outW, outH).data
  }
  return { x: Math.round(app.view.cx - outW / 2), y: Math.round(app.view.cy - outH / 2), w: outW, h: outH, data: out }
}

export async function pasteImageData(app: App, name: string, w: number, h: number, data: Uint8ClampedArray | Uint8Array): Promise<void> {
  const img = await fitToCanvas(app, w, h, data)
  guard(app, () => pasted(app, insertAndTransform(app.doc, layerFromImage(app.doc, img, name), 'Paste')))
}

/** A paste next to a language layer that already has writing in the shown language is an ordinary layer: say so (it shows in every language). */
const pasted = (app: App, r: ReturnType<typeof insertAndTransform>): void => {
  if (r === 'common-over-language') app.notify(t('langs.toast.pastedCommon'))
}

/** Paste as a new layer: OS clipboard bitmap when it is foreign, else our internal clip. */
export async function paste(app: App): Promise<boolean> {
  let os: Uint8Array | null = null
  try {
    os = (await window.brushworkClip?.readImage()) ?? null
  } catch {
    os = null
  }
  if (os && !(clip && same(os, clip.osPng))) {
    const d = await decodeImage(os)
    await pasteImageData(app, t('core.doc.pastedImage'), d.width, d.height, d.data)
    return true
  }
  if (clip) {
    const img = clip.img
    guard(app, () => pasted(app, insertAndTransform(app.doc, layerFromImage(app.doc, img, t('core.doc.pastedLayer')), 'Paste')))
    return true
  }
  app.notify(t('layers.toast.clipboardEmpty'))
  return false
}

// ---------------------------------------------------------------- Add > Insert a file / photo
const IMG_EXT = ['png', 'jpg', 'jpeg', 'gif', 'bmp', 'webp', 'avif']
const MIME: Record<string, string> = { png: 'image/png', jpg: 'image/jpeg', jpeg: 'image/jpeg', gif: 'image/gif', bmp: 'image/bmp', webp: 'image/webp', avif: 'image/avif' }

export async function insertFile(app: App, photosOnly = false): Promise<boolean> {
  const api = window.brushwork
  if (!api) return false
  const filters = photosOnly
    ? [{ name: t('layers.filter.images'), extensions: IMG_EXT }]
    : [
        { name: t('layers.filter.imagesPsd'), extensions: [...IMG_EXT, 'psd'] },
        { name: t('layers.filter.all'), extensions: ['*'] }
      ]
  const r = await api.openFile({ filters })
  if (!r) return false
  const ext = (r.path.split('.').pop() ?? '').toLowerCase()
  const base = r.path.replace(/^.*[\\/]/, '').replace(/\.[^.]+$/, '')
  try {
    if (ext === 'psd') insertPsd(app, r.data)
    else {
      const d = await decodeImage(r.data, MIME[ext] ?? 'image/png')
      await pasteImageData(app, base, d.width, d.height, d.data)
    }
  } catch (e) {
    app.notify(t('layers.toast.insertFileError') + (e as Error).message)
    return false
  }
  return true
}

/** PSD as layers (groups preserved). Placed centred on the canvas, layer pixels cropped to it. */
function insertPsd(app: App, bytes: Uint8Array): void {
  const doc = app.doc
  const psd = decodePsd(bytes)
  const ox = doc.isInfinite ? Math.round(app.view.cx - psd.width / 2) : Math.round((doc.width - psd.width) / 2)
  const oy = doc.isInfinite ? Math.round(app.view.cy - psd.height / 2) : Math.round((doc.height - psd.height) / 2)
  const made: Layer[] = []
  const build = (list: ReturnType<typeof decodePsd>['layers'], parent: Layer | null): void => {
    let last: Layer | null = null
    for (const l of list) {
      const isGroup = !!l.children
      const nl = isGroup ? doc.createLayer({ name: l.name, isGroup: true, visible: l.visible, opacity: l.opacity, collapsed: l.open === false }) : l.pixels ? layerFromImage(doc, { x: l.pixels.x + ox, y: l.pixels.y + oy, w: l.pixels.width, h: l.pixels.height, data: l.pixels.data instanceof Uint8ClampedArray ? l.pixels.data : new Uint8ClampedArray(l.pixels.data) }, l.name) : doc.createLayer({ name: l.name })
      if (!isGroup) Object.assign(nl, { visible: l.visible, opacity: l.opacity, blendMode: l.blendMode, clipping: l.clipping, alphaLock: !!l.alphaLock })
      made.push(nl)
      const ref: { id: string; where: 'above' | 'into' } | null = last ? { id: last.id, where: 'above' } : parent ? { id: parent.id, where: 'into' } : doc.getLayer(doc.activeId) && !parent ? { id: doc.activeId, where: 'above' } : null
      doc.insertLayer(nl, ref, 'Insert PSD', 'layer-paste')
      if (isGroup) build(l.children!, nl)
      last = nl
    }
  }
  try {
    doc.transaction('Insert PSD', 'layer-paste', null, () => build(psd.layers, null))
  } catch (e) {
    for (const l of made) if (!doc.layers.includes(l)) l.dispose()
    throw e
  }
  if (made[0]) notifyInserted(made[made.length - 1])
}
