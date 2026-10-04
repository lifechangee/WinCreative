import './tutorial.css'
import type { App } from '../../app/app'
import { registerAction } from '../../input/actions'
import { onLangChange, t, tAttr, tk } from '../../i18n'
import { h } from '../../ui/dom'
import { menus, registerMenuItem } from '../../ui/registry'
import type { UIContext } from '../../ui/registry'
import { installHints, scheduleWelcome, showHint, showWelcome, HINTS } from './hints'
import { hub } from './hub'
import { LESSONS } from './lessons'
import { closeTutorial, openTutorial, tipsToggle } from './panel'
import { runner } from './runner'
import { store } from './store'
import { runTutorialSelfTest } from './selftest'

/**
 * Feature module 'tutorial': interactive lessons on a practice canvas (with pen / touch gesture detection), the searchable
 * Gestures & Pen guide, "Did you know?" tips and the first-launch welcome. Entry points: top-bar "?" button, Actions menu,
 * the F1 cheat sheet and the Help dialog.
 */
export function install(app: App, ui: unknown): void {
  const uiCtx = ui as UIContext
  hub.start(app, uiCtx)
  runner.install(app, uiCtx)
  runner.openList = () => openTutorial('lessons')

  registerAction({ id: 'tutorial.open', label: tk('tutorial.action.open'), category: 'Interface', run: () => openTutorial('lessons') })
  registerAction({ id: 'tutorial.guide', label: tk('tutorial.action.guide'), category: 'Interface', run: () => openTutorial('guide') })
  registerMenuItem('actions', { id: 'tutorial', label: tk('tutorial.menu.tutorial'), run: () => openTutorial('lessons') })
  registerMenuItem('actions', { id: 'tutorial-guide', label: tk('tutorial.menu.guide'), run: () => openTutorial('guide') })
  // keep them right after "Help"
  const list = menus.actions
  const at = list.findIndex((m) => m.id === 'help')
  if (at >= 0) {
    const mine = list.filter((m) => m.id === 'tutorial' || m.id === 'tutorial-guide')
    for (const m of mine) list.splice(list.indexOf(m), 1)
    list.splice(at + 1, 0, ...mine)
  }

  installHelpButton()
  installInjections()
  installHints(app, uiCtx)
  scheduleWelcome()

  ;(window as any).brushwork_tutorial = { runner, hub, store, LESSONS, HINTS, open: openTutorial, close: closeTutorial, showHint, welcome: showWelcome }
  void window.bwGallery?.env('BW_TUTORIAL_SELFTEST').then((v) => {
    if (v === '1') void runTutorialSelfTest(app)
  })
}

/** The round "?" button at the right end of the top bar. */
function installHelpButton(): void {
  const right = document.querySelector('.topbar .tb-right')
  if (!right) return
  const b = h('button', { class: 'tb-help', text: '?' })
  tAttr(b, 'title', 'tutorial.help.tip')
  tAttr(b, 'aria-label', 'tutorial.help.tip')
  b.addEventListener('click', () => openTutorial('lessons'))
  right.append(b)
  // first launches: a gentle pulse so the entry point is noticed
  if (!store.welcomed) b.classList.add('attn')
}

const linkRow = (): HTMLElement => {
  const open = h('button', { text: tk('tutorial.link.open'), onclick: () => openTutorial('lessons') })
  const guide = h('button', { text: tk('tutorial.link.guide'), onclick: () => openTutorial('guide') })
  return h('div', { class: 'tt-linkrow' }, open, guide)
}

/**
 * Additive links in other modules' UI without editing their files: the F1 cheat sheet and the Help dialog get "Open the
 * tutorial" buttons, Preferences > Interface gets the "Show tips" switch.
 */
function installInjections(): void {
  const inject = (): void => {
    const sheet = document.querySelector('.sheet')
    if (sheet && !sheet.querySelector('.tt-linkrow')) sheet.append(linkRow())
    const help = document.querySelector('.modal .help')
    if (help && !help.querySelector('.tt-linkrow')) {
      const row = linkRow()
      row.querySelectorAll('button').forEach((b) => b.addEventListener('click', () => document.querySelector('.modal-back')?.remove()))
      help.append(row)
    }
    const pane = document.querySelector('.prefs-pane')
    const tab = document.querySelector('.prefs-tabs button.sel')
    if (pane && tab && (tab as HTMLElement).dataset.id === 'interface' && !pane.querySelector('.tt-pref')) {
      const row = h(
        'div',
        { class: 'prow tt-pref' },
        h('label', null, tk('tutorial.tips.toggle'), h('span', { class: 'hint', text: tk('tutorial.tips.hint') })),
        h('button', { class: 'btn small', text: tk('tutorial.link.open'), onclick: () => openTutorial('lessons') }),
        tipsToggle()
      )
      pane.append(h('h4', { class: 'tt-pref', text: tk('tutorial.title') }), row)
    }
  }
  let raf = 0
  new MutationObserver((muts) => {
    if (raf) return
    // only react to dialogs / panes appearing, not to every canvas overlay tweak
    const relevant = muts.some((m) => m.type === 'childList' && [...m.addedNodes].some((n) => n instanceof HTMLElement) && (m.target === document.body || (m.target as HTMLElement).classList?.contains('prefs-pane') || (m.target as HTMLElement).classList?.contains('modal-back')))
    if (!relevant) return
    raf = requestAnimationFrame(() => {
      raf = 0
      inject()
    })
  }).observe(document.body, { childList: true, subtree: true })
  onLangChange(() => requestAnimationFrame(inject))
  void t
}
