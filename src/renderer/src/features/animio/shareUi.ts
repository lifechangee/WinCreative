import type { App } from '../../app/app'
import { h } from '../../ui/dom'
import { I18nRef, resolveText, t, tk } from '../../i18n'
import { registerMenuItem } from '../../ui/registry'
import type { UIContext } from '../../ui/registry'
import { bitmapToDocument, exportPsdBytes, importPsdBytes, uploadBitmap } from '../../io/docPsd'
import { flattenedBitmap, layerBitmap } from '../../io/frameRender'
import { Bitmap, decodeBitmap, encodeJpegBitmap, encodePngBitmap, encodeTiff, encodeWebp, flattenOnto, sniffImage } from '../../io/imageFormats'
import { buildPdf } from '../../io/pdf'
import { loadBwk } from '../../io/bwk'
import { importProcreate } from '../../io/procreate'
import type { Document } from '../../doc/document'
import { animioApi } from './api'
import type { AnimAssist } from './animation'
import { openAnimExport } from './animExport'
import { docMeta, embedDocProfile } from './docMeta'
import { tagFromFile } from '../profiles/convert'
import { btn, modal, numberInput, select } from './ui'

type ImgFmt = 'png' | 'jpeg' | 'webp' | 'tiff' | 'psd'
const FMT: Record<ImgFmt, { label: I18nRef; ext: string[] }> = {
  png: { label: tk('animio.share.fmt.png'), ext: ['png'] },
  jpeg: { label: tk('animio.share.fmt.jpeg'), ext: ['jpg', 'jpeg'] },
  webp: { label: tk('animio.share.fmt.webp'), ext: ['webp'] },
  tiff: { label: tk('animio.share.fmt.tiff'), ext: ['tif', 'tiff'] },
  psd: { label: tk('animio.share.fmt.psd'), ext: ['psd'] }
}

const save = (defaultName: string, ext: string[], label: string, data: Uint8Array): Promise<string | null> => window.brushwork!.saveFile({ defaultName, filters: [{ name: label, extensions: ext }], data })

/** Encode the flattened canvas (or PSD with layers) in the given format. */
export async function encodeDocument(app: App, fmt: ImgFmt, opts: { quality: number; transparent: boolean }): Promise<Uint8Array> {
  const doc = app.doc
  if (fmt === 'psd') return embedDocProfile(doc, 'psd', await exportPsdBytes(app.gpu, doc, app.compositor))
  const noAlpha = fmt === 'jpeg'
  const bmp = flattenedBitmap(app.compositor, doc, !opts.transparent || noAlpha)
  if (noAlpha) flattenOnto(bmp)
  switch (fmt) {
    case 'png':
      return embedDocProfile(doc, 'png', await encodePngBitmap(bmp))
    case 'jpeg':
      return embedDocProfile(doc, 'jpeg', await encodeJpegBitmap(bmp, opts.quality))
    case 'webp':
      return encodeWebp(bmp, opts.quality)
    default:
      return encodeTiff(bmp)
  }
}

function exportImageDialog(app: App, ui: UIContext): void {
  const m = modal(tk('animio.share.image.title'))
  const st = { fmt: 'png' as ImgFmt, quality: 92, transparent: !app.doc.background.visible }
  const q = numberInput(st.quality, 1, 100, (v) => (st.quality = v))
  const tr = h('input', { type: 'checkbox', checked: st.transparent })
  tr.addEventListener('change', () => (st.transparent = tr.checked))
  const status = h('p', { class: 'an-note' })
  let statusFn: (() => string) | null = null
  const setStatus = (fn: () => string): void => {
    statusFn = fn
    status.textContent = fn()
  }
  m.onLang(() => statusFn && (status.textContent = statusFn()))
  m.body.append(
    h('div', { class: 'an-grid' }, h('label', { text: tk('animio.common.format') }), select<ImgFmt>((Object.keys(FMT) as ImgFmt[]).map((k) => [k, FMT[k].label] as [ImgFmt, I18nRef]), st.fmt, (v) => (st.fmt = v)), h('label', { text: tk('animio.share.image.quality') }), q, h('label', { text: tk('animio.common.transparency') }), h('label', { class: 'chk' }, tr, h('span', { text: tk('animio.share.image.keepTransparent') }))),
    status
  )
  m.footer.append(
    btn(tk('core.common.close'), () => m.close()),
    btn(tk('animio.common.exportEllipsis'), async () => {
      try {
        const data = await encodeDocument(app, st.fmt, { quality: st.quality / 100, transparent: st.transparent })
        const p = await save(`${app.doc.name}.${FMT[st.fmt].ext[0]}`, FMT[st.fmt].ext, resolveText(FMT[st.fmt].label), data)
        if (p) {
          setStatus(() => t('animio.common.savedTo', { path: p }))
          ui.toast(t('animio.share.image.done'))
        }
      } catch (e) {
        setStatus(() => t('animio.common.failed', { error: (e as Error).message }))
      }
    }, 'primary')
  )
}

async function exportLayersPng(app: App, ui: UIContext): Promise<void> {
  const dir = await animioApi().ff.pickDir(t('animio.share.layersPng.pickFolder'))
  if (!dir) return
  const files: { name: string; data: Uint8Array }[] = []
  let i = 0
  for (const l of app.doc.paintLayers) {
    i++
    files.push({ name: `${String(i).padStart(3, '0')}-${l.name}.png`, data: embedDocProfile(app.doc, 'png', await encodePngBitmap(layerBitmap(app.gpu, app.doc, l))) })
  }
  await animioApi().writeFiles(dir, files)
  ui.toast(t('animio.share.layersPng.done', { count: files.length }))
}

async function exportLayersPdf(app: App, ui: UIContext): Promise<void> {
  const pages = []
  for (const l of [...app.doc.paintLayers].reverse()) {
    const b = layerBitmap(app.gpu, app.doc, l)
    pages.push({ image: await encodePngBitmap(b), format: 'png' as const, width: b.width, height: b.height })
  }
  const meta = docMeta(app.doc)
  const data = await buildPdf(pages, meta.dpi, { title: app.doc.name, author: meta.author })
  if (await save(app.doc.name + '-layers.pdf', ['pdf'], 'PDF', data)) ui.toast(t('animio.share.layersPdf.done'))
}

async function copyCanvas(app: App, ui: UIContext): Promise<void> {
  const bmp = flattenedBitmap(app.compositor, app.doc, true)
  const png = await encodePngBitmap(bmp)
  await navigator.clipboard.write([new ClipboardItem({ 'image/png': new Blob([png as unknown as BlobPart], { type: 'image/png' }) })])
  ui.toast(t('animio.share.copied'))
}

/** Open any supported file into a NEW document: .bwk, .psd, .procreate, PNG/JPEG/WebP/TIFF/GIF/BMP. */
export async function openAnyFile(app: App, bytes: Uint8Array, fileName: string): Promise<Document> {
  const name = fileName.replace(/^.*[\\/]/, '').replace(/\.[^.]+$/, '')
  const kind = sniffImage(bytes)
  if (kind === 'psd') return importPsdBytes(app.gpu, bytes, name)
  if (kind === 'procreate') {
    if (/\.procreate$/i.test(fileName)) return importProcreate(app.gpu, bytes, name)
    const d = await loadBwk(bytes, app.gpu)
    d.name = name
    return d
  }
  if (kind === 'unknown') throw new Error('Unsupported file format')
  const doc = bitmapToDocument(app.gpu, await decodeBitmap(bytes), name)
  tagFromFile(doc, bytes)
  return doc
}

async function importFile(app: App, ui: UIContext): Promise<void> {
  const r = await window.brushwork!.openFile({
    filters: [
      { name: t('animio.share.filter.allSupported'), extensions: ['bwk', 'psd', 'procreate', 'png', 'jpg', 'jpeg', 'webp', 'tif', 'tiff', 'gif', 'bmp'] },
      { name: 'WinCreative', extensions: ['bwk'] },
      { name: 'Photoshop', extensions: ['psd'] },
      { name: 'Procreate', extensions: ['procreate'] },
      { name: t('animio.share.filter.images'), extensions: ['png', 'jpg', 'jpeg', 'webp', 'tif', 'tiff', 'gif', 'bmp'] }
    ]
  })
  if (!r) return
  const d = await openAnyFile(app, r.data, r.path)
  app.setDocument(d)
  ui.toast(t('animio.share.imported', { name: d.name }))
}

/** Insert an image (or a PSD's flattened composite) as a new layer, scaled down to fit and centred. */
async function insertImage(app: App, ui: UIContext): Promise<void> {
  const r = await window.brushwork!.openFile({ filters: [{ name: t('animio.share.filter.images'), extensions: ['png', 'jpg', 'jpeg', 'webp', 'tif', 'tiff', 'gif', 'bmp', 'psd'] }] })
  if (!r) return
  let bmp: Bitmap
  if (sniffImage(r.data) === 'psd') {
    const { decodePsd } = await import('../../io/psd')
    const p = decodePsd(r.data)
    if (!p.composite) throw new Error('PSD has no composite image')
    bmp = { width: p.composite.width, height: p.composite.height, data: new Uint8ClampedArray(p.composite.data) }
  } else bmp = await decodeBitmap(r.data)
  const doc = app.doc
  const k = Math.min(1, doc.width / bmp.width, doc.height / bmp.height)
  const w = Math.max(1, Math.round(bmp.width * k))
  const hh = Math.max(1, Math.round(bmp.height * k))
  let data = bmp.data
  if (k < 1) {
    const src = new OffscreenCanvas(bmp.width, bmp.height)
    src.getContext('2d')!.putImageData(new ImageData(bmp.data as unknown as Uint8ClampedArray<ArrayBuffer>, bmp.width, bmp.height), 0, 0)
    const dst = new OffscreenCanvas(w, hh)
    const c = dst.getContext('2d')!
    c.imageSmoothingQuality = 'high'
    c.drawImage(src, 0, 0, w, hh)
    data = c.getImageData(0, 0, w, hh).data
  }
  const layer = doc.createLayer({ name: r.path.replace(/^.*[\\/]/, '').replace(/\.[^.]+$/, '') })
  uploadBitmap(app.gpu, doc, layer, { x: Math.round((doc.width - w) / 2), y: Math.round((doc.height - hh) / 2), width: w, height: hh, data })
  doc.insertLayer(layer, doc.getLayer(doc.activeId) ? { id: doc.activeId, where: 'above' } : null, 'Insert image')
  ui.toast(t('animio.share.inserted'))
}

export function installShareMenu(app: App, ui: UIContext, anim: AnimAssist): void {
  // drag & drop a file onto the window: open it as a new document
  window.addEventListener('dragover', (e) => {
    if (e.dataTransfer?.types.includes('Files')) e.preventDefault()
  })
  window.addEventListener('drop', (e) => {
    const f = e.dataTransfer?.files[0]
    if (!f) return
    e.preventDefault()
    void f
      .arrayBuffer()
      .then((b) => openAnyFile(app, new Uint8Array(b), f.name))
      .then((d) => {
        app.setDocument(d)
        ui.toast(t('animio.share.opened', { name: d.name }))
      })
      .catch((err) => ui.toast(t('animio.common.failed', { error: (err as Error).message })))
  })
  const guard = (fn: () => Promise<unknown> | unknown): (() => void) => () => {
    Promise.resolve()
      .then(fn)
      .catch((e) => {
        console.error(e)
        ui.toast(t('animio.common.failed', { error: (e as Error).message }))
      })
  }
  const A = (id: string, label: I18nRef, run: () => unknown, separator = false, group?: string): void => registerMenuItem('actions', { id, label, group, separator, run: guard(run) })
  A('share-image', tk('animio.menu.shareImage'), () => exportImageDialog(app, ui), true, 'share')
  A('share-psd', tk('animio.menu.sharePsd'), async () => {
    const data = await encodeDocument(app, 'psd', { quality: 1, transparent: true })
    if (await save(app.doc.name + '.psd', ['psd'], 'Photoshop', data)) ui.toast(t('animio.share.psd.done'))
  }, false, 'share')
  A('share-layers-png', tk('animio.menu.shareLayersPng'), () => exportLayersPng(app, ui), false, 'share')
  A('share-layers-pdf', tk('animio.menu.shareLayersPdf'), () => exportLayersPdf(app, ui), false, 'share')
  A('share-layers-anim', tk('animio.menu.shareLayersAnim'), () => openAnimExport(app, ui, anim), false, 'share')
  A('share-copy', tk('animio.menu.shareCopy'), () => copyCanvas(app, ui), false, 'share')
  registerMenuItem('gallery', { id: 'import-file', label: tk('animio.menu.importFile'), run: guard(() => importFile(app, ui)) })
  A('insert-image', tk('animio.menu.insertImage'), () => insertImage(app, ui))
}
