import { t, tAttr, tEl, tk } from '../../i18n'
import { h, icon } from '../../ui/dom'
import { hub } from './hub'
import type { PenLive } from './hub'
import { mountIllustration } from './illus'
import type { LiveMeter } from './types'

export interface CoachView {
  lessonTitle: string
  index: number
  total: number
  /** per step: done / skipped */
  marks: ('done' | 'skip' | '')[]
  title: string
  body: string
  anim: string
  live?: LiveMeter
  penNote: boolean
  ctaLabel?: string
  target?: string | (() => HTMLElement | null)
  /** information step: no auto-detection, user presses Next */
  manual: boolean
}

export interface CoachHandlers {
  back(): void
  skip(): void
  next(): void
  exit(): void
  cta(): void
}

export interface CompleteView {
  lessonTitle: string
  title: string
  body: string
  nextLabel?: string
  onNext?: () => void
  onList(): void
  onClose(): void
}

const MARGIN = 12
const GAP = 18

/**
 * The coach mark: a floating card with an animated illustration + instruction, a spotlight ring (the dim backdrop is a huge
 * box-shadow, so pointer events pass straight through to the app) and an arrow towards the highlighted element.
 * It repositions on resize / layout changes and never captures pointer events outside the card itself.
 */
export class Coach {
  readonly root: HTMLElement
  private spot = h('div', { class: 'tt-spot' })
  private card: HTMLElement
  private arrow = h('div', { class: 'tt-arrow' })
  private lessonEl = h('span', { class: 'tt-lesson' })
  private dots = h('span', { class: 'tt-dots' })
  private ill = h('div', { class: 'tt-illwrap' })
  private titleEl = h('h3', { class: 'tt-title' })
  private bodyEl = h('p', { class: 'tt-body' })
  private live = h('div', { class: 'tt-live' })
  private note = h('div', { class: 'tt-note' })
  private ctaBtn = h('button', { class: 'tt-cta' })
  private status = h('div', { class: 'tt-status' })
  private foot = h('div', { class: 'tt-foot' })
  private backBtn: HTMLElement
  private skipBtn: HTMLElement
  private nextBtn: HTMLElement
  private dockSide: 'left' | 'right' = 'right'
  private minimized = false
  private view: CoachView | null = null
  private handlers: CoachHandlers | null = null
  private poll = 0
  private lastKey = ''
  private liveOff: (() => void)[] = []
  visible = false

  constructor() {
    this.backBtn = h('button', { class: 'tt-btn', text: tk('tutorial.btn.back'), onclick: () => this.handlers?.back() })
    this.skipBtn = h('button', { class: 'tt-btn', text: tk('tutorial.btn.skip'), onclick: () => this.handlers?.skip() })
    this.nextBtn = h('button', { class: 'tt-btn primary', text: tk('tutorial.btn.next'), onclick: () => this.handlers?.next() })
    const dockBtn = h('button', { class: 'tt-ib', onclick: () => this.flipDock() }, icon('chevr', 14))
    tAttr(dockBtn, 'title', 'tutorial.btn.move')
    const minBtn = h('button', { class: 'tt-ib tt-min', onclick: () => this.setMin(!this.minimized) }, icon('minus', 14))
    tAttr(minBtn, 'title', 'tutorial.btn.collapse')
    const exitBtn = h('button', { class: 'tt-ib', onclick: () => this.handlers?.exit() }, icon('clear', 14))
    tAttr(exitBtn, 'title', 'tutorial.btn.exit')
    this.ctaBtn.addEventListener('click', () => this.handlers?.cta())
    this.foot.append(this.backBtn, h('span', { class: 'tt-grow' }), this.skipBtn, this.nextBtn)
    // the arrow lives outside the scrolling part so it is never clipped
    this.card = h(
      'div',
      { class: 'tt-card', role: 'dialog' },
      this.arrow,
      h('div', { class: 'tt-inner' }, h('div', { class: 'tt-head' }, this.lessonEl, this.dots, dockBtn, minBtn, exitBtn), this.ill, this.titleEl, this.bodyEl, this.live, this.note, this.ctaBtn, this.status, this.foot)
    )
    // clicks on the card must not steal keyboard focus (Space = pan, Alt, ... keep working right after a click)
    this.card.addEventListener('pointerdown', (e) => e.stopPropagation())
    this.card.addEventListener('mousedown', (e) => e.preventDefault())
    this.root = h('div', { class: 'tt-root', style: 'display:none' }, this.spot, this.card)
    document.body.append(this.root)
    window.addEventListener('resize', () => this.layout())
    new ResizeObserver(() => this.layout()).observe(this.card)
  }

  private flipDock(): void {
    this.dockSide = this.dockSide === 'right' ? 'left' : 'right'
    this.layout(true)
  }

  private setMin(v: boolean): void {
    this.minimized = v
    this.layout(true)
  }

  // ------------------------------------------------------------------ content
  render(view: CoachView, handlers: CoachHandlers): void {
    this.view = view
    this.handlers = handlers
    this.card.classList.remove('done', 'complete')
    this.card.dataset.kind = 'step'
    this.lessonEl.textContent = view.lessonTitle
    this.dots.replaceChildren(
      ...view.marks.map((m, i) => h('i', { class: 'tt-dot' + (i === view.index ? ' cur' : '') + (m ? ' ' + m : '') }))
    )
    const key = view.anim
    if (key !== this.lastKey) {
      mountIllustration(this.ill, view.anim)
      this.lastKey = key
    }
    this.titleEl.textContent = view.title
    this.bodyEl.textContent = view.body
    this.ctaBtn.style.display = view.ctaLabel ? '' : 'none'
    if (view.ctaLabel) this.ctaBtn.textContent = view.ctaLabel
    this.note.style.display = view.penNote && !hub.devices.has('pen') ? '' : 'none'
    this.note.textContent = t('tutorial.note.noPen')
    this.buildLive(view.live)
    this.ensureStdFoot()
    this.setStatus(view.manual ? 'info' : 'wait')
    this.backBtn.style.visibility = view.index > 0 ? 'visible' : 'hidden'
    this.skipBtn.style.display = view.manual ? 'none' : ''
    this.nextBtn.style.display = view.manual ? '' : 'none'
    this.nextBtn.classList.toggle('primary', true)
    this.show()
    this.layout(true)
  }

  setStatus(kind: 'wait' | 'done' | 'info' | 'stuck'): void {
    this.status.className = 'tt-status ' + kind
    this.status.replaceChildren()
    if (kind === 'info') {
      this.status.style.display = 'none'
      return
    }
    this.status.style.display = ''
    this.status.append(kind === 'done' ? icon('check', 16) : h('i', { class: 'tt-spin' }), h('span', { text: t('tutorial.status.' + kind) }))
    this.card.classList.toggle('done', kind === 'done')
    if (kind === 'done') {
      this.nextBtn.style.display = ''
      this.skipBtn.style.display = 'none'
    } else if (this.view && !this.view.manual) {
      this.nextBtn.style.display = 'none'
      this.skipBtn.style.display = ''
    }
  }

  showComplete(v: CompleteView): void {
    this.view = null
    this.handlers = null
    this.card.dataset.kind = 'complete'
    this.card.classList.add('complete')
    this.card.classList.remove('done')
    this.lessonEl.textContent = v.lessonTitle
    this.dots.replaceChildren()
    mountIllustration(this.ill, 'done')
    this.lastKey = ''
    this.titleEl.textContent = v.title
    this.bodyEl.textContent = v.body
    this.ctaBtn.style.display = 'none'
    this.note.style.display = 'none'
    this.status.style.display = 'none'
    this.buildLive(undefined)
    this.foot.replaceChildren(
      h('button', { class: 'tt-btn', text: tk('tutorial.btn.lessons'), onclick: v.onList }),
      h('span', { class: 'tt-grow' }),
      h('button', { class: 'tt-btn', text: tk('tutorial.btn.close'), onclick: v.onClose }),
      ...(v.nextLabel ? [h('button', { class: 'tt-btn primary', text: v.nextLabel, onclick: () => v.onNext?.() })] : [])
    )
    this.footIsComplete = true
    this.setTarget(undefined)
    this.show()
    this.layout(true)
  }
  private footIsComplete = false

  /** restore the standard footer after a completion card */
  private ensureStdFoot(): void {
    if (!this.footIsComplete) return
    this.footIsComplete = false
    this.foot.replaceChildren(this.backBtn, h('span', { class: 'tt-grow' }), this.skipBtn, this.nextBtn)
  }

  // ------------------------------------------------------------------ live meters
  private buildLive(kind: LiveMeter | undefined): void {
    for (const o of this.liveOff) o()
    this.liveOff = []
    this.live.replaceChildren()
    this.live.style.display = kind ? '' : 'none'
    if (!kind) return
    if (kind === 'pressure') {
      const fill = h('i', { class: 'tt-fill' })
      const peak = h('b', { class: 'tt-peak' })
      const num = h('span', { class: 'tt-num', text: '0.00' })
      const range = h('span', { class: 'tt-range' })
      this.live.append(h('div', { class: 'tt-meter' }, h('div', { class: 'tt-bar' }, fill, peak), num), range)
      let lo = 1
      let hi = 0
      let was = false
      const upd = (p: PenLive): void => {
        if (p.contact && !was) {
          lo = 1
          hi = 0
        }
        was = p.contact
        if (p.contact) {
          lo = Math.min(lo, p.pressure)
          hi = Math.max(hi, p.pressure)
        }
        fill.style.width = p.pressure * 100 + '%'
        peak.style.left = hi * 100 + '%'
        peak.style.display = hi > 0 ? '' : 'none'
        num.textContent = p.pressure.toFixed(2)
        range.textContent = hi > 0 ? t('tutorial.live.range', { min: lo.toFixed(2), max: hi.toFixed(2) }) : t('tutorial.live.pressureHint')
      }
      upd(hub.pen)
      this.liveOff.push(hub.on('pen', upd))
    } else if (kind === 'tilt') {
      const dot = h('i', { class: 'tt-tdot' })
      const dial = h('div', { class: 'tt-dial' }, dot)
      const txt = h('span', { class: 'tt-range' })
      this.live.append(h('div', { class: 'tt-tiltrow' }, dial, txt))
      const upd = (p: PenLive): void => {
        const mag = Math.hypot(p.tiltX, p.tiltY)
        const k = mag > 0 ? Math.min(1, mag / 90) / mag : 0
        dot.style.transform = `translate(${p.tiltX * k * 24}px, ${p.tiltY * k * 24}px)`
        txt.textContent = t('tutorial.live.tilt', { x: Math.round(p.tiltX), y: Math.round(p.tiltY) })
      }
      upd(hub.pen)
      this.liveOff.push(hub.on('pen', upd))
    } else if (kind === 'buttons') {
      const chips = [
        ['tip', 1, 'tutorial.live.tip'],
        ['barrel', 2, 'tutorial.live.barrel'],
        ['barrel2', 4, 'tutorial.live.barrel2'],
        ['eraser', 32, 'tutorial.live.eraser']
      ] as const
      const els = chips.map(([, , k]) => h('span', { class: 'tt-chip', text: tk(k) }))
      this.live.append(h('div', { class: 'tt-chips' }, ...els))
      const upd = (p: PenLive): void => chips.forEach(([, bit], i) => els[i].classList.toggle('on', (p.buttons & bit) !== 0))
      upd(hub.pen)
      this.liveOff.push(hub.on('pen', upd))
    } else {
      const chips = [
        ['pen', 'tutorial.live.pen'],
        ['mouse', 'tutorial.live.mouse'],
        ['touch', 'tutorial.live.touch']
      ] as const
      const els = chips.map(([, k]) => h('span', { class: 'tt-chip', text: tk(k) }))
      this.live.append(h('div', { class: 'tt-chips' }, ...els))
      const upd = (): void => chips.forEach(([d], i) => els[i].classList.toggle('on', hub.devices.has(d)))
      upd()
      this.liveOff.push(hub.on('device', upd))
    }
  }

  // ------------------------------------------------------------------ show / hide / layout
  private show(): void {
    if (this.visible) return
    this.visible = true
    this.root.style.display = ''
    this.poll = window.setInterval(() => this.layout(), 250)
  }

  hide(): void {
    if (!this.visible) return
    this.visible = false
    this.root.style.display = 'none'
    clearInterval(this.poll)
    for (const o of this.liveOff) o()
    this.liveOff = []
    this.ill.replaceChildren()
    this.lastKey = ''
    this.footIsComplete = false
    this.foot.replaceChildren(this.backBtn, h('span', { class: 'tt-grow' }), this.skipBtn, this.nextBtn)
    this.spot.style.display = 'none'
  }

  private target: CoachView['target']
  setTarget(t: CoachView['target']): void {
    this.target = t
  }

  private targetRect(): DOMRect | null {
    const tg = this.view?.target ?? this.target
    if (!tg) return null
    const el = typeof tg === 'string' ? document.querySelector<HTMLElement>(tg) : tg()
    if (!el || !el.isConnected) return null
    const r = el.getBoundingClientRect()
    if (r.width < 2 || r.height < 2 || r.bottom < 0 || r.top > innerHeight || r.right < 0 || r.left > innerWidth) return null
    return r
  }

  /** Things on screen the card must not cover (the popover the user is picking from, tool bars, QuickMenu...). */
  private obstacles(): DOMRect[] {
    const out: DOMRect[] = []
    for (const el of document.querySelectorAll<HTMLElement>('.popover, .sx-bar, .ss-bar, .adj-bar, .adj-panel, .qm, .op-popup')) {
      if (el.style.display === 'none') continue
      const r = el.getBoundingClientRect()
      if (r.width > 4 && r.height > 4) out.push(r)
    }
    return out
  }

  /** Place the spotlight and the card; cheap enough to run every 250 ms (skips work when nothing moved). */
  layout(force = false): void {
    if (!this.visible) return
    // a big dialog (Preferences, cheat sheet, help) is open: shrink to the essentials so it does not hide the dialog
    const dialog = !!document.querySelector('.modal-back:not(.tt-back), .sheet-back')
    const min = this.minimized || dialog
    if (this.card.classList.contains('min') !== min) this.card.classList.toggle('min', min)
    const T = this.view || this.target ? this.targetRect() : null
    const cw = this.card.offsetWidth
    const ch = this.card.offsetHeight
    const obs = this.obstacles()
    const key = [T ? [T.left, T.top, T.width, T.height].map(Math.round).join(',') : '-', cw, ch, innerWidth, innerHeight, this.dockSide, min, obs.map((o) => [o.left, o.top, o.width, o.height].map(Math.round).join(',')).join(';')].join('|')
    if (!force && key === this.posKey) return
    this.posKey = key
    const vw = innerWidth
    const vh = innerHeight
    const clampX = (x: number): number => Math.max(MARGIN, Math.min(vw - cw - MARGIN, x))
    const clampY = (y: number): number => Math.max(MARGIN + 44, Math.min(vh - ch - MARGIN, y))
    const overlap = (x: number, y: number, r: DOMRect): number => Math.max(0, Math.min(x + cw, r.right) - Math.max(x, r.left)) * Math.max(0, Math.min(y + ch, r.bottom) - Math.max(y, r.top))
    const covered = (x: number, y: number): number => obs.reduce((a, r) => a + overlap(x, y, r), 0) + (T ? overlap(x, y, T) : 0)
    let x = 0
    let y = 0
    let side: 'left' | 'right' | 'top' | 'bottom' | '' = ''
    if (T) {
      const pad = 6
      this.spot.style.display = 'block'
      this.spot.style.left = T.left - pad + 'px'
      this.spot.style.top = T.top - pad + 'px'
      this.spot.style.width = T.width + pad * 2 + 'px'
      this.spot.style.height = T.height + pad * 2 + 'px'
      const cx = T.left + T.width / 2
      const cy = T.top + T.height / 2
      const spots: Record<'right' | 'left' | 'bottom' | 'top', [number, number]> = {
        right: [T.right + GAP, clampY(cy - ch / 2)],
        left: [T.left - GAP - cw, clampY(cy - ch / 2)],
        bottom: [clampX(cx - cw / 2), T.bottom + GAP],
        top: [clampX(cx - cw / 2), T.top - GAP - ch]
      }
      const inView = (s: 'right' | 'left' | 'bottom' | 'top'): boolean => {
        const [sx, sy] = spots[s]
        return sx >= MARGIN - 1 && sy >= 44 && sx + cw <= vw - MARGIN + 1 && sy + ch <= vh - MARGIN + 1
      }
      const nearTop = T.top < 70
      const order: ('right' | 'left' | 'bottom' | 'top')[] = nearTop ? ['bottom', cx < vw / 2 ? 'right' : 'left', 'left', 'right', 'top'] : cx < vw / 2 ? ['right', 'bottom', 'top', 'left'] : ['left', 'bottom', 'top', 'right']
      // the first side that is fully on screen and hides nothing (target, open popover, tool bars)
      const pick = order.find((s) => inView(s) && covered(spots[s][0], spots[s][1]) < 16)
      // a huge target (the popover, the whole canvas) leaves no room next to it: dock instead of covering it
      if (pick && !(T.width > vw * 0.6 && T.height > vh * 0.6)) {
        side = pick
        ;[x, y] = spots[pick]
      }
    } else this.spot.style.display = 'none'
    if (!side) {
      const rightDock = this.dockSide === 'right'
      // keep clear of the tool sidebar (left, or right in the right-hand interface)
      const sb = 72
      const rh = document.body.classList.contains('rh')
      const xr = vw - cw - MARGIN - (rh ? sb : 0)
      const xl = MARGIN + (rh ? 0 : sb)
      const yb = vh - ch - MARGIN
      // the preferred bottom corner unless another corner hides clearly less (a wide tool bar sits at the bottom centre)
      const yt = MARGIN + 44
      const corners: [number, number][] = rightDock ? [[xr, yb], [xl, yb], [xr, yt], [xl, yt]] : [[xl, yb], [xr, yb], [xl, yt], [xr, yt]]
      let best = corners[0]
      let bestCov = covered(best[0], best[1])
      for (const c of corners.slice(1)) {
        const cov = covered(c[0], c[1])
        if (cov + 16 < bestCov) {
          best = c
          bestCov = cov
        }
      }
      ;[x, y] = best
    }
    this.card.style.left = Math.round(x) + 'px'
    this.card.style.top = Math.round(y) + 'px'
    this.card.dataset.side = side
    if (side && T) {
      const ay = Math.max(18, Math.min(ch - 18, T.top + T.height / 2 - y))
      const ax = Math.max(18, Math.min(cw - 18, T.left + T.width / 2 - x))
      this.arrow.style.setProperty('--ay', ay + 'px')
      this.arrow.style.setProperty('--ax', ax + 'px')
    }
  }
  private posKey = ''

  /** Language changed: labels of the standard buttons are `tk` refs already; only redraw dynamic text via the runner. */
  isShowing(): boolean {
    return this.visible
  }
}

void tEl
