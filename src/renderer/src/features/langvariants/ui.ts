import type { App } from '../../app/app'
import type { Document } from '../../doc/document'
import { h } from '../../ui/dom'
import { t, tk } from '../../i18n'
import { btn, confirmDialog, modal } from '../animio/ui'
import { LangError, MAX_LANGS, addLanguage, removeLanguage, renameLanguage } from './model'
import { createLanguageLayer } from './ops'

const CSS = `
.lg-seg{display:flex;gap:0;border:1px solid var(--line);border-radius:8px;overflow:hidden;flex:1;min-width:0}
.lg-seg button{flex:1;min-width:0;background:var(--panel2);color:var(--text);border:0;border-right:1px solid var(--line);padding:5px 6px;cursor:pointer;font-size:12px;overflow:hidden;text-overflow:ellipsis;white-space:nowrap}
.lg-seg button:last-child{border-right:0}
.lg-seg button.on{background:var(--accent);color:#fff;font-weight:600}
.lg-bar{display:flex;gap:6px;align-items:center;padding:2px 2px 6px}
.lg-chips{display:flex;gap:3px;flex-wrap:wrap;margin-top:2px}
.lg-chip{font-size:10px;line-height:1;padding:3px 5px;border-radius:5px;border:1px solid var(--line);background:var(--panel);color:var(--dim);cursor:pointer}
.lg-chip.full{color:var(--text);border-color:#8a93a8}
.lg-chip.cur{background:var(--accent);border-color:var(--accent);color:#fff}
.lg-list{display:flex;flex-direction:column;gap:6px;margin-bottom:8px}
.lg-item{display:grid;grid-template-columns:54px 1fr auto;gap:8px;align-items:center}
.lg-item .code{font-family:monospace;color:var(--dim)}
.lg-item input,.lg-add input{background:var(--panel2);color:var(--text);border:1px solid var(--line);border-radius:6px;padding:5px 7px;min-width:0;width:100%}
.lg-add{display:grid;grid-template-columns:54px 1fr auto;gap:8px;align-items:center}
`
let styled = false
export function ensureLangStyles(): void {
  if (styled) return
  styled = true
  document.head.append(h('style', { text: CSS }))
}

/** Segmented view-language switcher (EN | RU ...). */
export function langSwitcher(doc: Document): HTMLElement {
  ensureLangStyles()
  const seg = h('div', { class: 'lg-seg', role: 'group', title: tk('langs.switcher.tip') })
  for (const l of doc.langs) seg.append(h('button', { class: doc.viewLang === l.code ? 'on' : '', text: l.code.toUpperCase(), title: l.name, 'data-lang': l.code, onclick: () => doc.setViewLang(l.code) }))
  return seg
}

const errText = (e: LangError): string => t('langs.err.' + e, { max: MAX_LANGS })

/** Add / rename / remove the document's languages (2-4). Every change is one undo step. */
export function openLanguagesDialog(app: App, toast: (m: string) => void): void {
  ensureLangStyles()
  const doc = app.doc
  let off = (): void => {}
  const m = modal(tk('langs.dialog.title'), () => off())
  const list = h('div', { class: 'lg-list' })
  const code = h('input', { type: 'text', maxLength: 8, placeholder: tk('langs.dialog.codePh') })
  const name = h('input', { type: 'text', maxLength: 24, placeholder: tk('langs.dialog.namePh') })
  const paint = (): void => {
    list.replaceChildren(
      ...doc.langs.map((l) => {
        const nm = h('input', { type: 'text', value: l.name, maxLength: 24 })
        nm.addEventListener('change', () => {
          const r = renameLanguage(doc.langs, l.code, nm.value)
          if (r.error) {
            toast(errText(r.error))
            nm.value = l.name
          } else doc.editLangs(r.langs, 'Rename language')
        })
        const rm = btn(tk('core.common.remove'), () => void remove(l.code), 'small')
        rm.disabled = doc.langs.length <= 2
        return h('div', { class: 'lg-item' }, h('span', { class: 'code', text: l.code.toUpperCase() }), nm, rm)
      })
    )
  }
  const remove = async (c: string): Promise<void> => {
    const r = removeLanguage(doc.langs, c)
    if (r.error) return toast(errText(r.error))
    const has = doc.layers.some((l) => l.lang === c && doc.cellHasContent(l))
    if (has && !(await confirmDialog(tk('langs.dialog.removeTitle'), t('langs.dialog.removeText', { name: doc.langs.find((l) => l.code === c)?.name ?? c }), tk('core.common.remove')))) return
    doc.editLangs(r.langs, 'Remove language')
  }
  const add = (): void => {
    const r = addLanguage(doc.langs, code.value, name.value)
    if (r.error) return toast(errText(r.error))
    doc.editLangs(r.langs, 'Add language')
    code.value = ''
    name.value = ''
  }
  m.body.append(
    h('p', { class: 'an-note', text: tk('langs.dialog.note'), style: 'margin:0 0 10px' }),
    list,
    h('div', { class: 'an-h', text: tk('langs.dialog.addHeading') }),
    h('div', { class: 'lg-add' }, code, name, btn(tk('core.common.add'), add, 'small')),
    h('p', { class: 'an-note', text: tk('langs.dialog.codeNote') })
  )
  m.footer.append(btn(tk('core.common.done'), () => m.close(), 'primary'))
  paint()
  off = doc.events.on('lang', paint)
}

/** "New language layer" dialog: name + the language list; creates the layer on OK. */
export function openNewLanguageLayerDialog(app: App, toast: (m: string) => void): void {
  ensureLangStyles()
  const doc = app.doc
  let off = (): void => {}
  const m = modal(tk('langs.new.title'), () => off())
  const nm = h('input', { type: 'text', value: t('langs.layer.defaultName'), maxLength: 24 })
  const langs = h('p', { class: 'an-note' })
  const paint = (): void => {
    langs.textContent = t('langs.new.languages', { list: doc.langs.map((l) => l.name).join(', ') })
  }
  paint()
  m.onLang(paint)
  off = doc.events.on('lang', paint)
  m.body.append(
    h('div', { class: 'an-grid' }, h('label', { text: tk('langs.new.name') }), nm),
    langs,
    h('div', { style: 'margin-top:6px' }, btn(tk('langs.new.editLangs'), () => openLanguagesDialog(app, toast), 'small')),
    h('p', { class: 'an-note', text: tk('langs.new.note') })
  )
  const create = (): void => {
    try {
      createLanguageLayer(doc, nm.value)
      toast(t('langs.new.created'))
      // the layers panel closed under the dialog: bring it back, the language switcher lives there
      setTimeout(() => {
        if (!document.querySelector('.lp-top')) document.querySelector<HTMLElement>('.tb-layers')?.click()
      }, 0)
    } catch (e) {
      toast((e as Error).message || t('layers.toast.failed'))
    }
    m.close()
  }
  nm.addEventListener('keydown', (e) => e.key === 'Enter' && create())
  m.footer.append(btn(tk('core.common.cancel'), () => m.close()), btn(tk('core.common.create'), create, 'primary'))
  setTimeout(() => (nm.focus(), nm.select()), 0)
}
