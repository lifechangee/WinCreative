import type { App } from '../../app/app'
import { t, tk } from '../../i18n'
import { h } from '../../ui/dom'
import { btn, modal, select } from '../animio/ui'
import { FRAME_PRESETS } from './model'
import { frameRect } from './workRect'

/**
 * Animation Assist / Page Assist on an INFINITE canvas work inside the frame (frames / pages = layers or groups shown over the frame
 * rectangle, exported by it). Without a frame this offers to create one instead of a dead end; `then` runs once a frame exists.
 */
export function requireFrame(app: App, kind: 'anim' | 'page', then: () => void): void {
  if (!app.doc.isInfinite || frameRect(app.doc)) return then()
  let pick = kind === 'anim' ? 'hd' : 'a4p'
  const m = modal(tk(kind === 'anim' ? 'animio.anim.title' : 'animio.page.title'))
  const sel = select<string>(
    FRAME_PRESETS.map((p) => [p.id, tk('frame.preset.' + p.id)] as [string, ReturnType<typeof tk>]),
    pick,
    (v) => (pick = v)
  )
  m.body.append(h('p', { class: 'an-note', text: tk(kind === 'anim' ? 'frame.need.anim' : 'frame.need.page') }), h('div', { class: 'an-grid' }, h('label', { text: tk('frame.need.size') }), sel))
  m.footer.append(
    btn(tk('core.common.cancel'), () => m.close()),
    btn(
      tk('frame.need.create'),
      () => {
        const p = FRAME_PRESETS.find((x) => x.id === pick) ?? FRAME_PRESETS[0]
        ;(window as unknown as { brushwork_frame: { createFrame(w: number, h: number, preset?: string): void } }).brushwork_frame.createFrame(p.w, p.h, p.id)
        m.close()
        app.notify(t('frame.need.created'))
        then()
      },
      'primary'
    )
  )
}
