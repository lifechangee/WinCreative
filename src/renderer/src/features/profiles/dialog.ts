import type { App } from '../../app/app'
import { PROFILE_LABELS, SPACES } from '../../io/colorProfile'
import { t, tk } from '../../i18n'
import { h } from '../../ui/dom'
import { docMeta } from '../animio/docMeta'
import { btn, modal, select } from '../animio/ui'
import { assignProfile, convertDocument, docSpace, importIccProfile } from './convert'

/** "Color profile" dialog: Assign (retag), Convert (transform pixels) and ICC import. */
export function openProfileDialog(app: App): void {
  const m = modal(tk('color.profile.title'))
  const cur = h('div', { class: 'an-stat' })
  const paint = (): void => {
    const meta = docMeta(app.doc)
    cur.replaceChildren(h('span', { text: t('color.profile.current') }), h('span', { text: meta.profile + (meta.icc ? t('color.profile.importedIcc') : '') }))
  }
  paint()
  let assignTo = docSpace(app.doc).label
  let convertTo = PROFILE_LABELS.find((l) => l !== assignTo) ?? PROFILE_LABELS[0]
  const status = h('p', { class: 'an-note' })
  const assignSel = select<string>(PROFILE_LABELS.map((l) => [l, l] as [string, string]), assignTo, (v) => (assignTo = v))
  const convSel = select<string>(PROFILE_LABELS.map((l) => [l, l] as [string, string]), convertTo, (v) => (convertTo = v))
  let sayFn: (() => string) | null = null
  const say = (fn: () => string): void => {
    sayFn = fn
    status.textContent = fn()
    paint()
  }
  m.onLang(() => {
    paint()
    if (sayFn) status.textContent = sayFn()
  })
  m.body.append(
    cur,
    h('div', { class: 'an-h', text: tk('color.profile.assign') }),
    h('div', { class: 'an-grid' }, h('label', { text: tk('color.profile.profile') }), assignSel),
    h('p', { class: 'an-note', text: tk('color.profile.assign.note') }),
    h('div', { class: 'an-h', text: tk('color.profile.convert') }),
    h('div', { class: 'an-grid' }, h('label', { text: tk('color.profile.convertTo') }), convSel),
    h('p', { class: 'an-note', text: tk('color.profile.convert.note') }),
    h('div', { class: 'an-h', text: tk('color.profile.icc') }),
    status
  )
  m.footer.append(
    btn(tk('color.profile.importIcc'), async () => {
      const r = await window.brushwork?.openFile({ filters: [{ name: t('color.profile.iccFilter'), extensions: ['icc', 'icm'] }] })
      if (!r) return
      const msg = importIccProfile(app, r.data).message
      say(() => msg)
    }),
    btn(tk('color.profile.assign'), () => {
      assignProfile(app, assignTo)
      const to = assignTo
      say(() => t('color.profile.assigned', { label: to }))
    }),
    btn(tk('color.profile.convert'), () => {
      const to = SPACES.find((s) => s.label === convertTo)!
      const label = convertTo
      const done = convertDocument(app, to)
      say(() => t(done ? 'color.profile.converted' : 'color.profile.already', { label }))
    }, 'primary'),
    btn(tk('core.common.close'), () => m.close())
  )
}
