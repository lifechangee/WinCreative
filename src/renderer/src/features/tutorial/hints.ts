import type { App } from '../../app/app'
import { t, tk } from '../../i18n'
import { h, icon } from '../../ui/dom'
import type { UIContext } from '../../ui/registry'
import { hub } from './hub'
import { mountIllustration } from './illus'
import { openTutorial, isTutorialOpen, closeTutorial } from './panel'
import { runner } from './runner'
import { store } from './store'

interface Hint {
  id: string
  /** lesson that goes deeper ("Show me") */
  lesson: string
  /** true once the situation the hint is about has happened */
  when(app: App, ui: UIContext): boolean
}

const q = (s: string): HTMLElement | null => document.querySelector<HTMLElement>(s)

/** "Did you know?" tips: each is shown once, the first time the feature is used. Text = `tutorial.hint.<id>`. */
export const HINTS: Hint[] = [
  { id: 'adjust', lesson: 'adjust', when: () => !!q('.adj-bar') },
  { id: 'layers', lesson: 'layers', when: (_a, ui) => ui.popovers.current === 'layers' },
  { id: 'colorDrop', lesson: 'color', when: (_a, ui) => ui.popovers.current === 'color' },
  { id: 'selection', lesson: 'selxf', when: () => !!q('.sx-bar') && q('.sx-bar')!.style.display !== 'none' },
  { id: 'pen', lesson: 'penSetup', when: () => hub.devices.has('pen') },
  { id: 'touch', lesson: 'nav', when: () => hub.devices.has('touch') },
  { id: 'undo', lesson: 'basics', when: () => hub.strokeCount >= 4 },
  { id: 'quickShape', lesson: 'shapes', when: () => hub.strokeCount >= 8 },
  { id: 'eyedropper', lesson: 'color', when: () => hub.strokeCount >= 14 },
  { id: 'hoverAdjust', lesson: 'pen', when: () => hub.hoverCount >= 60 },
  { id: 'video', lesson: 'export', when: (_a, ui) => ui.popovers.current === 'menu-actions' },
  { id: 'gallery', lesson: 'gallery', when: (_a, ui) => ui.popovers.current === 'menu-gallery' }
]

const MIN_GAP_MS = 45000
const SHOW_MS = 16000
const START_QUIET_MS = 12000

let el: HTMLElement | null = null
let hideTimer = 0
let lastShown = -1e9
const startedAt = performance.now()

export function hideHint(): void {
  el?.remove()
  el = null
  clearTimeout(hideTimer)
}

/** Show a hint now (self-test / "show me" use `force` to skip the eligibility rules). */
export function showHint(hint: Hint, force = false): boolean {
  if (!force && !eligible()) return false
  hideHint()
  store.markHint(hint.id)
  lastShown = performance.now()
  const ill = h('div', { class: 'tt-illwrap', style: 'height:84px;margin:6px 0 8px' })
  const illName: Record<string, string> = { adjust: 'slideCanvas', layers: 'layerRow:altDrag', colorDrop: 'dragColor', selection: 'select', pen: 'penButton', touch: 'tap:2', undo: 'keys:Ctrl+Z', quickShape: 'quickShape', eyedropper: 'touchHold', hoverAdjust: 'penHoverAdjust', video: 'timelapse', gallery: 'gallery' }
  mountIllustration(ill, illName[hint.id] ?? 'penDraw')
  const closeBtn = h('button', { class: 'tt-ib', style: 'margin-left:auto', 'aria-label': tk('tutorial.btn.close'), onclick: hideHint }, icon('clear', 12))
  el = h(
    'div',
    { class: 'tt-hint', role: 'status' },
    h('h5', null, icon('info', 13), h('span', { text: tk('tutorial.hint.title') }), closeBtn),
    ill,
    h('p', { text: t('tutorial.hint.' + hint.id) }),
    h(
      'div',
      { class: 'tt-hrow' },
      h('button', { class: 'tt-btn primary', text: tk('tutorial.hint.gotit'), onclick: hideHint }),
      h('button', {
        class: 'tt-btn',
        text: tk('tutorial.hint.show'),
        onclick: () => {
          hideHint()
          runner.start(hint.lesson)
        }
      }),
      h('button', {
        class: 'tt-quiet',
        text: tk('tutorial.hint.off'),
        onclick: () => {
          store.showTips = false
          hideHint()
        }
      })
    )
  )
  el.addEventListener('pointerdown', (e) => e.stopPropagation())
  el.addEventListener('mousedown', (e) => e.preventDefault())
  el.addEventListener('pointerenter', () => clearTimeout(hideTimer))
  el.addEventListener('pointerleave', () => (hideTimer = window.setTimeout(hideHint, 4000)))
  document.body.append(el)
  hideTimer = window.setTimeout(hideHint, SHOW_MS)
  return true
}

function eligible(): boolean {
  if (!store.showTips || el) return false
  if (runner.active || isTutorialOpen()) return false
  if (document.querySelector('.modal-back, .qm, .sheet-back, .adj-bar')) return false
  const now = performance.now()
  if (now - startedAt < START_QUIET_MS || now - lastShown < MIN_GAP_MS) return false
  return true
}

/** Watches for the situations above (cheap 700 ms poll, edge triggered) and shows at most one hint per minute. */
export function installHints(app: App, ui: UIContext): void {
  if (window.brushwork?.bootLang) return // self-tests / forced language runs must not be interrupted by tips
  const prev = new Map<string, boolean>()
  window.setInterval(() => {
    if (!store.showTips || app.input.drawing) return
    for (const hint of HINTS) {
      if (store.hintSeen(hint.id)) continue
      let now = false
      try {
        now = hint.when(app, ui)
      } catch {
        now = false
      }
      const was = prev.get(hint.id) ?? false
      prev.set(hint.id, now)
      // the adjust hint fires while its own bar is open, so it is exempt from the "no adjustment open" rule
      if (now && !was && (hint.id === 'adjust' ? showAdjust(hint) : showHint(hint))) return
    }
  }, 700)
}

function showAdjust(hint: Hint): boolean {
  if (!store.showTips || el || runner.active || isTutorialOpen()) return false
  if (performance.now() - startedAt < START_QUIET_MS) return false
  return showHint(hint, true)
}

// ------------------------------------------------------------------ welcome
export function showWelcome(): void {
  if (isTutorialOpen()) return
  const done = (): void => {
    store.welcomed = true
    back.remove()
    window.removeEventListener('keydown', esc, true)
  }
  const esc = (e: KeyboardEvent): void => {
    if (e.key === 'Escape') done()
  }
  const art = h('div', { class: 'tt-wart' })
  mountIllustration(art, 'penDraw')
  const card = h(
    'div',
    { class: 'tt-dialog small tt-welcome', role: 'dialog' },
    art,
    h('h2', { text: tk('tutorial.welcome.title') }),
    h('p', { text: tk('tutorial.welcome.body') }),
    h('p', { class: 'tt-sub', text: tk('tutorial.welcome.where') }),
    h(
      'div',
      { class: 'tt-wbtns' },
      h('button', { class: 'tt-btn primary', text: tk('tutorial.welcome.tour'), onclick: () => (done(), runner.start('basics')) }),
      h('button', { class: 'tt-btn', text: tk('tutorial.welcome.lessons'), onclick: () => (done(), openTutorial('lessons')) }),
      h('button', { class: 'tt-btn', text: tk('tutorial.welcome.skip'), onclick: done })
    )
  )
  const back = h('div', { class: 'tt-back' }, card)
  back.addEventListener('pointerdown', (e) => e.target === back && done())
  window.addEventListener('keydown', esc, true)
  document.body.append(back)
}

/** First launch: offer the tour once (never in self-test / forced-language runs). */
export function scheduleWelcome(): void {
  if (store.welcomed || window.brushwork?.bootLang) return
  window.setTimeout(() => {
    if (store.welcomed || document.querySelector('.modal-back, .tt-back') || runner.active) return
    showWelcome()
  }, 1600)
}

void closeTutorial
