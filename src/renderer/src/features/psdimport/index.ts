import type { App } from '../../app/app'
import { t } from '../../i18n'
import type { Document } from '../../doc/document'
import { applyFilter } from '../../gl/filters'
import { psdPost, PsdPost } from '../../io/docPsd'
import { runAdjustment } from '../adjustments/session'
import type { TextManager } from '../guides/text/install'

/**
 * Feature module 'psdimport': finishes what io/docPsd cannot do without the running app when a PSD document becomes
 * current - PSD text layers become editable Brushwork text layers, and PSD adjustment layers with a Brushwork
 * equivalent (Hue/Saturation, Color Balance, Curves, Levels, Brightness/Contrast, Invert) are applied to the layers
 * beneath them as one undo step.
 */
export function install(app: App, ui: unknown): void {
  void ui
  app.events.on('doc', (doc) => {
    const post = psdPost.get(doc)
    if (!post) return
    psdPost.delete(doc)
    // let the document finish switching (gallery bookkeeping, thumbnails) first
    setTimeout(() => {
      if (app.doc === doc) finishPsdImport(app, doc, post)
    }, 0)
  })
}

export function finishPsdImport(app: App, doc: Document, post: PsdPost): { text: number; applied: number; skipped: string[] } {
  const tm = (app as unknown as { textLayers?: TextManager }).textLayers
  let applied = 0
  if (post.adjustments.length) {
    const active = doc.activeId
    doc.transaction('PSD adjustment layers', 'filter', null, () => {
      for (const a of post.adjustments) {
        let did = false
        for (const id of a.targets) {
          const l = doc.getLayer(id)
          if (!l || l.isGroup || l.locked) continue
          doc.setActive(id)
          if (a.adj.id === 'invert') did = applyFilter(doc, 'invert') || did
          else did = runAdjustment(app, a.adj.id, a.adj.params, a.adj.curves ? { curves: a.adj.curves } : undefined) || did
        }
        if (did) applied++
      }
    })
    if (doc.getLayer(active)) doc.setActive(active)
  }
  // text last: pixel edits (the adjustments above) would otherwise turn text layers back into plain pixels
  let text = 0
  if (post.text.size && tm) {
    tm.adopt(doc, Object.fromEntries(post.text))
    text = post.text.size
  }
  const parts: string[] = []
  if (text) parts.push(t('animio.psd.text', { count: text }))
  if (applied) parts.push(t('animio.psd.adjustments', { count: applied }))
  if (post.skipped.length) parts.push(t('animio.psd.unsupported', { list: post.skipped.join(', ') }))
  if (parts.length) app.notify(t('animio.psd.notice', { parts: parts.join('; ') }))
  return { text, applied, skipped: post.skipped }
}
