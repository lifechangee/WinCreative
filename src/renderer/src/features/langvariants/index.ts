import type { App } from '../../app/app'
import type { Document } from '../../doc/document'
import { registerAction } from '../../input/actions'
import { registerBwkExtension } from '../../io/bwk'
import { tk, t } from '../../i18n'
import { registerMenuItem } from '../../ui/registry'
import type { UIContext } from '../../ui/registry'
import { galleryRef } from '../color/galleryRef'
import { DEFAULT_LANGS, nextLang, normalizeLangs, validLang } from './model'
import { openLanguagesDialog, openNewLanguageLayerDialog } from './ui'
import { clearCell, copyCell, createLanguageLayer } from './ops'
import { confirmDialog } from '../animio/ui'
import { actionsFor } from '../layers/actions'

/**
 * Feature module 'langvariants' (docs/LANGUAGE_VARIANTS.md): language layers, the view language and the language list of a document.
 * The feature is active exactly when a document has a language layer; without one nothing here costs anything.
 */
interface LangExtra {
  langs: { code: string; name: string }[]
  view: string
  ghost?: boolean
}

export function install(app: App, uiArg: unknown): void {
  const ui = uiArg as UIContext

  // ---- persistence: documents without language layers (and default settings) write nothing, so old files stay byte-compatible
  registerBwkExtension({
    id: 'langvariants',
    save(doc) {
      const def = doc.langs.length === DEFAULT_LANGS.length && doc.langs.every((l, i) => l.code === DEFAULT_LANGS[i].code && l.name === DEFAULT_LANGS[i].name)
      if (!doc.hasLangLayers && def && doc.viewLang === 'en' && !doc.langGhost) return
      const extra: LangExtra = { langs: doc.langs.map((l) => ({ ...l })), view: doc.viewLang, ...(doc.langGhost ? { ghost: true } : {}) }
      return { extra }
    },
    load(doc, extra) {
      const e = (extra ?? {}) as Partial<LangExtra>
      doc.langs = normalizeLangs(e.langs)
      doc.viewLang = validLang(doc.langs, e.view)
      doc.langGhost = !!e.ghost
      // fixed canvases cannot tell an empty cell from a painted one cheaply: loaded cells count as painted (cells are only created on a first write)
      for (const l of doc.layers) if (l.lang && !l.isGroup) doc.painted.add(l.id)
    }
  })

  // ---- the view language / list is saved with the document: arm the autosave when it changes
  let off: (() => void) | null = null
  const bind = (d: Document): void => {
    off?.()
    off = d.events.on('lang', () => galleryRef.store?.touchDoc(d))
  }
  bind(app.doc)
  app.events.on('doc', bind)

  const cycle = (dir: 1 | -1 = 1): void => {
    const d = app.doc
    if (!d.hasLangLayers) return ui.toast(t('langs.toast.noLangLayer'))
    d.setViewLang(nextLang(d.langs, d.viewLang, dir))
    ui.toast(t('langs.toast.viewing', { name: d.langs.find((l) => l.code === d.viewLang)?.name ?? d.viewLang }))
  }
  registerAction({ id: 'lang.cycle', label: tk('langs.action.cycle'), category: 'Layers', defaultKeys: ['Ctrl+Alt+L'], run: () => cycle(1) })
  registerAction({ id: 'lang.cycleBack', label: tk('langs.action.cycleBack'), category: 'Layers', run: () => cycle(-1) })
  registerAction({ id: 'lang.newLayer', label: tk('langs.action.newLayer'), category: 'Layers', run: () => openNewLanguageLayerDialog(app, (m) => ui.toast(m)) })
  registerAction({ id: 'lang.ghost', label: tk('langs.action.ghost'), category: 'Layers', run: () => app.doc.setLangGhost(!app.doc.langGhost) })
  registerAction({ id: 'lang.edit', label: tk('langs.action.edit'), category: 'Layers', run: () => openLanguagesDialog(app, (m) => ui.toast(m)) })
  registerMenuItem('actions', { id: 'add-lang-layer', group: 'add', label: tk('langs.menu.add'), run: () => openNewLanguageLayerDialog(app, (m) => ui.toast(m)) })

  // flatten everything into the view language (the plain "Flatten" refuses on documents with language layers)
  registerMenuItem('actions', {
    id: 'layer-flatten-lang',
    label: tk('langs.menu.flattenCurrent'),
    run: () => {
      const d = app.doc
      if (!d.hasLangLayers) return ui.toast(t('langs.toast.noLangLayer'))
      void confirmDialog(tk('langs.flatten.title'), t('langs.flatten.text', { name: d.langs.find((l) => l.code === d.viewLang)?.name ?? d.viewLang }), tk('layers.panel.flattenBtn')).then((ok) => {
        if (ok) actionsFor(app, (m) => ui.toast(m)).flattenCurrentLanguage()
      })
    }
  })

  ;(window as unknown as { brushwork_lang: unknown }).brushwork_lang = {
    cycle,
    newLayer: (name: string) => createLanguageLayer(app.doc, name),
    copyCell: (g: string, from: string, to: string) => copyCell(app.doc, g, from, to),
    clearCell: (g: string, lang: string) => clearCell(app.doc, g, lang),
    setView: (c: string) => app.doc.setViewLang(c),
    editLangs: (l: { code: string; name: string }[]) => app.doc.editLangs(l)
  }
}
