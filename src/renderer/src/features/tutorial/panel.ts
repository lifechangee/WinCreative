import { onLangChange, t, tk } from '../../i18n'
import { h, icon } from '../../ui/dom'
import { hub } from './hub'
import { mountIllustration } from './illus'
import { LESSONS, lessonKey } from './lessons'
import { cardSearchText, REF_CARDS, REF_GROUPS } from './reference'
import type { RefCard } from './reference'
import { runner } from './runner'
import { store } from './store'

export type TutorialTab = 'lessons' | 'guide'

let back: HTMLElement | null = null
let tab: TutorialTab = 'lessons'
let query = ''
let offLang: (() => void) | null = null
let offStore: (() => void) | null = null

export const isTutorialOpen = (): boolean => !!back

export function closeTutorial(): void {
  back?.remove()
  back = null
  offLang?.()
  offStore?.()
  offLang = offStore = null
  window.removeEventListener('keydown', onKey, true)
}

function onKey(e: KeyboardEvent): void {
  if (e.key === 'Escape') {
    e.stopPropagation()
    closeTutorial()
  }
}

/** Open the tutorial hub: the lesson list or the searchable Gestures & Pen guide. */
export function openTutorial(which: TutorialTab = 'lessons'): void {
  tab = which
  if (back) return render()
  back = h('div', { class: 'tt-back' })
  back.addEventListener('pointerdown', (e) => e.target === back && closeTutorial())
  document.body.append(back)
  window.addEventListener('keydown', onKey, true)
  offLang = onLangChange(() => render())
  offStore = store.events.on('change', () => tab === 'lessons' && render())
  render()
}

function render(): void {
  if (!back) return
  const keepSearch = document.activeElement?.classList.contains('tt-search')
  const tabs = h(
    'div',
    { class: 'tt-tabs' },
    h('button', { class: tab === 'lessons' ? 'sel' : '', text: tk('tutorial.tab.lessons'), onclick: () => ((tab = 'lessons'), render()) }),
    h('button', { class: tab === 'guide' ? 'sel' : '', text: tk('tutorial.tab.guide'), onclick: () => ((tab = 'guide'), render()) })
  )
  const head = h('div', { class: 'tt-dhead' }, h('h2', { text: tk('tutorial.title') }), tabs, h('span', { class: 'tt-grow' }), h('button', { class: 'tt-ib big', onclick: closeTutorial, 'aria-label': tk('tutorial.btn.close') }, icon('clear', 16)))
  const body = tab === 'lessons' ? lessonsView() : guideView()
  const dlg = h('div', { class: 'tt-dialog', role: 'dialog' }, head, body)
  back.replaceChildren(dlg)
  if (keepSearch) (dlg.querySelector('.tt-search') as HTMLInputElement | null)?.focus()
}

// ------------------------------------------------------------------ lessons
function lessonsView(): HTMLElement {
  const total = LESSONS.length
  const done = LESSONS.filter((l) => store.isDone(l.id)).length
  const nextId = LESSONS.find((l) => !store.isDone(l.id))?.id
  const pct = Math.round((done / total) * 100)
  const pen = hub.devices.has('pen')
  const top = h(
    'div',
    { class: 'tt-progress' },
    h('div', { class: 'tt-pinfo' }, h('b', { text: t('tutorial.progress', { done, total }) }), h('span', { class: 'tt-sub', text: t('tutorial.intro') })),
    h('div', { class: 'tt-pbar' }, h('i', { style: `width:${pct}%` })),
    h('span', { class: 'tt-chip' + (pen ? ' on' : ''), text: pen ? t('tutorial.pen.seen') : t('tutorial.pen.unseen') })
  )
  const grid = h('div', { class: 'tt-grid' })
  LESSONS.forEach((l, i) => {
    const isDone = store.isDone(l.id)
    const c = h(
      'button',
      { class: 'tt-lcard' + (isDone ? ' done' : '') + (l.id === nextId ? ' next' : ''), onclick: () => start(l.id) },
      h('span', { class: 'tt-lico' }, isDone ? icon('check', 18) : h('span', { text: String(i + 1) })),
      h(
        'span',
        { class: 'tt-lmain' },
        h('b', { text: t(lessonKey(l, 'title')) }),
        h('span', { class: 'tt-ldesc', text: t(lessonKey(l, 'desc')) }),
        h(
          'span',
          { class: 'tt-lmeta' },
          h('span', { text: t('tutorial.steps', { count: l.steps.length }) }),
          l.pen ? h('span', { class: 'tt-badge', text: t('tutorial.badge.pen') }) : null,
          l.id === nextId ? h('span', { class: 'tt-badge acc', text: t('tutorial.badge.start') }) : null
        )
      ),
      h('span', { class: 'tt-lgo', text: isDone ? t('tutorial.btn.repeat') : t('tutorial.btn.start') })
    )
    grid.append(c)
  })
  const foot = h(
    'div',
    { class: 'tt-dfoot' },
    h('label', { class: 'tt-tips' }, tipsToggle(), h('span', { text: tk('tutorial.tips.toggle') })),
    h('span', { class: 'tt-grow' }),
    h('button', { class: 'tt-btn', text: tk('tutorial.btn.guide'), onclick: () => ((tab = 'guide'), render()) }),
    h('button', { class: 'tt-btn', text: tk('tutorial.btn.reset'), onclick: () => store.resetProgress() })
  )
  return h('div', { class: 'tt-dbody' }, top, h('div', { class: 'tt-scroll' }, grid), foot)
}

export function tipsToggle(): HTMLElement {
  const b = h('button', { class: 'toggle' + (store.showTips ? ' on' : ''), role: 'switch', 'aria-checked': String(store.showTips) })
  b.addEventListener('click', (e) => {
    e.preventDefault()
    store.showTips = !store.showTips
    b.classList.toggle('on', store.showTips)
  })
  return b
}

function start(id: string): void {
  closeTutorial()
  runner.start(id)
}

// ------------------------------------------------------------------ gestures & pen guide
function guideView(): HTMLElement {
  const input = h('input', { class: 'tt-search', type: 'text', placeholder: tk('tutorial.search.placeholder'), value: query }) as HTMLInputElement
  const list = h('div', { class: 'tt-scroll' })
  const fill = (): void => {
    const qy = query.trim().toLowerCase()
    list.replaceChildren()
    let shown = 0
    for (const g of REF_GROUPS) {
      const cards = REF_CARDS.filter((c) => c.group === g && (!qy || cardSearchText(c).includes(qy)))
      if (!cards.length) continue
      shown += cards.length
      list.append(h('h4', { class: 'tt-gh', text: t('tutorial.ref.group.' + g) }), h('div', { class: 'tt-rgrid' }, ...cards.map(refCard)))
    }
    if (!shown) list.append(h('div', { class: 'tt-empty', text: t('tutorial.search.empty') }))
  }
  input.addEventListener('input', () => {
    query = input.value
    fill()
  })
  fill()
  return h('div', { class: 'tt-dbody' }, h('div', { class: 'tt-searchrow' }, input, h('span', { class: 'tt-sub', text: t('tutorial.guide.hint') })), list)
}

function refCard(c: RefCard): HTMLElement {
  const ill = h('div', { class: 'tt-rill' })
  mountIllustration(ill, c.anim)
  const now = c.now?.()
  const keys = c.keys?.() ?? []
  const meta = h('div', { class: 'tt-rmeta' })
  if (now !== undefined && now !== null) meta.append(h('span', { class: 'tt-now', text: t('tutorial.ref.now', { action: now }) }))
  for (const k of keys) meta.append(h('kbd', { class: 'kchip', text: k }))
  return h(
    'div',
    { class: 'tt-rcard' },
    ill,
    h('b', { text: t(`tutorial.ref.${c.id}.t`) }),
    h('p', { text: t(`tutorial.ref.${c.id}.d`) }),
    meta.childElementCount ? meta : null,
    c.lesson ? h('button', { class: 'tt-link', text: t('tutorial.ref.practice'), onclick: () => start(c.lesson!) }) : null
  )
}
