import { t } from '../i18n'
import type { Compositor } from '../gl/compositor'
import type { Document } from '../doc/document'
import { encodeJpeg, encodePng, saveBwk, loadBwk } from './bwk'
import type { GPU } from '../gl/gpu'
import { embedDocProfile } from '../features/animio/docMeta'

/** Thin wrappers over the Electron preload API (window.brushwork). */
const api = (): NonNullable<Window['brushwork']> => {
  if (!window.brushwork) throw new Error('Electron bridge unavailable')
  return window.brushwork
}

export async function exportPng(doc: Document, comp: Compositor, transparent = true): Promise<string | null> {
  const px = comp.readFlattened(!transparent)
  const data = embedDocProfile(doc, 'png', await encodePng(px, doc.width, doc.height))
  return api().saveFile({ defaultName: doc.name + '.png', filters: [{ name: t('core.filter.png'), extensions: ['png'] }], data })
}

export async function exportJpg(doc: Document, comp: Compositor, quality = 0.92): Promise<string | null> {
  const px = comp.readFlattened(true)
  // JPEG has no alpha: if the background is hidden, flatten onto white
  if (!doc.background.visible) {
    for (let i = 0; i < px.length; i += 4) {
      const a = px[i + 3] / 255
      px[i] = px[i] * a + 255 * (1 - a)
      px[i + 1] = px[i + 1] * a + 255 * (1 - a)
      px[i + 2] = px[i + 2] * a + 255 * (1 - a)
      px[i + 3] = 255
    }
  }
  const data = embedDocProfile(doc, 'jpeg', await encodeJpeg(px, doc.width, doc.height, quality))
  return api().saveFile({ defaultName: doc.name + '.jpg', filters: [{ name: t('core.filter.jpeg'), extensions: ['jpg', 'jpeg'] }], data })
}

export async function saveDocument(doc: Document, comp: Compositor): Promise<string | null> {
  const data = await saveBwk(doc, comp)
  const path = await api().saveFile({ defaultName: doc.name + '.bwk', filters: [{ name: t('gallery.filter.doc'), extensions: ['bwk'] }], data })
  if (path) doc.name = path.replace(/^.*[\\/]/, '').replace(/\.bwk$/i, '')
  return path
}

export async function openDocument(gpu: GPU): Promise<Document | null> {
  const r = await api().openFile({ filters: [{ name: t('gallery.filter.doc'), extensions: ['bwk'] }] })
  if (!r) return null
  const doc = await loadBwk(r.data, gpu)
  doc.name = r.path.replace(/^.*[\\/]/, '').replace(/\.bwk$/i, '')
  return doc
}
