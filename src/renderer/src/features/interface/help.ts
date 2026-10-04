import { I18nText, tk } from '../../i18n'
import { h } from '../../ui/dom'
import { version, license, homepage } from '../../../../../package.json'

function dialog(title: I18nText, body: HTMLElement): void {
  const close = (): void => {
    back.remove()
    window.removeEventListener('keydown', esc, true)
  }
  const esc = (e: KeyboardEvent): void => {
    if (e.key === 'Escape') close()
  }
  const back = h(
    'div',
    { class: 'modal-back' },
    h('div', { class: 'modal', style: 'width:560px;max-height:82vh;overflow:auto' }, h('h3', { text: title }), body, h('div', { class: 'row end' }, h('button', { class: 'primary', text: tk('core.common.close'), onclick: close })))
  )
  back.addEventListener('pointerdown', (e) => e.target === back && close())
  window.addEventListener('keydown', esc, true)
  document.body.append(back)
}

const li = (key: string): HTMLElement => h('li', { text: tk(key) })

export function openHelp(): void {
  dialog(
    tk('interface.help.title'),
    h(
      'div',
      { class: 'help' },
      h('p', { text: tk('interface.help.intro') }),
      h('h4', { text: tk('interface.help.touchTitle') }),
      h('ul', null,
        li('interface.help.touch1'),
        li('interface.help.touch2'),
        li('interface.help.touch3'),
        li('interface.help.touch4')),
      h('h4', { text: tk('interface.help.penTitle') }),
      h('ul', null,
        li('interface.help.pen1'),
        li('interface.help.pen2'),
        li('interface.help.pen3')),
      h('h4', { text: tk('interface.help.kbTitle') }),
      h('ul', null,
        li('interface.help.kb1'),
        li('interface.help.kb2'))
    )
  )
}

export function openAbout(): void {
  const ua = navigator.userAgent
  const ver = (n: string): string => new RegExp(n + '/([\\d.]+)').exec(ua)?.[1] ?? '?'
  dialog(
    tk('interface.menu.about'),
    h(
      'div',
      { class: 'help' },
      h('p', { text: tk('interface.help.aboutText', { version }) }),
      h('p', { text: tk('interface.help.aboutLicense', { license }) }),
      h('p', null, h('span', { text: tk('interface.help.aboutSource') }), h('span', { text: `: ${homepage}`, style: 'user-select:text' })), // i18n-ignore
      h('p', { text: tk('interface.help.aboutNotices') }),
      h('p', { text: `Electron ${ver('Electron')} / Chromium ${ver('Chrome')} / devicePixelRatio ${window.devicePixelRatio}` }), // i18n-ignore
      h('p', { text: tk('interface.help.aboutTablet') })
    )
  )
}

export function openWhatsNew(): void {
  dialog(
    tk('interface.menu.whatsnew'),
    h(
      'div',
      { class: 'help' },
      h('ul', null,
        li('interface.help.new1'),
        li('interface.help.new2'),
        li('interface.help.new3'))
    )
  )
}
