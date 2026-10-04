import { I18nText, onLangChange, resolveText } from '../i18n'
import { h } from './dom'

type Build = (body: HTMLElement, close: () => void) => (() => void) | void

export interface PopoverOptions {
  align?: 'left' | 'right'
  width?: number
  /** i18n key, `tk()` ref, resolver or literal */
  title?: I18nText
}

/**
 * Single-open popover host. Anchor a popover to any button:
 *   popovers.toggle('layers', buttonEl, (body) => { ...fill body...; return () => cleanup }, {align:'right'})
 * The build function may return a dispose callback that runs when the popover closes.
 */
export class PopoverHost {
  private el: HTMLElement
  private bodyEl: HTMLElement
  private titleEl: HTMLElement
  private openId: string | null = null
  private anchor: HTMLElement | null = null
  private dispose: (() => void) | void = undefined
  private last: { id: string; anchor: HTMLElement; build: Build; opts: PopoverOptions } | null = null

  constructor(root: HTMLElement) {
    this.titleEl = h('div', { class: 'pop-title' })
    this.bodyEl = h('div', { class: 'pop-body' })
    this.el = h('div', { class: 'popover', style: 'display:none' }, this.titleEl, this.bodyEl)
    root.append(this.el)
    document.addEventListener(
      'pointerdown',
      (e) => {
        if (!this.openId) return
        const t = e.target as Node
        if (this.el.contains(t) || this.anchor?.contains(t)) return
        this.close()
      },
      true
    )
    window.addEventListener('keydown', (e) => e.key === 'Escape' && this.close())
    // language switched while open: rebuild so the content is rendered in the new language
    onLangChange(() => {
      const l = this.last
      if (this.openId && l) this.open(l.id, l.anchor, l.build, l.opts)
    })
  }

  get current(): string | null {
    return this.openId
  }

  toggle(id: string, anchor: HTMLElement, build: (body: HTMLElement, close: () => void) => (() => void) | void, opts: PopoverOptions = {}): void {
    if (this.openId === id) return this.close()
    this.open(id, anchor, build, opts)
  }

  open(id: string, anchor: HTMLElement, build: (body: HTMLElement, close: () => void) => (() => void) | void, opts: PopoverOptions = {}): void {
    this.close()
    this.openId = id
    this.anchor = anchor
    this.last = { id, anchor, build, opts }
    this.bodyEl.replaceChildren()
    const title = resolveText(opts.title)
    this.titleEl.textContent = title
    this.titleEl.style.display = title ? 'block' : 'none'
    this.el.style.display = 'block'
    this.el.style.width = (opts.width ?? 280) + 'px'
    this.dispose = build(this.bodyEl, () => this.close())
    const r = anchor.getBoundingClientRect()
    const w = this.el.offsetWidth
    const left = opts.align === 'right' ? Math.max(8, r.right - w) : Math.min(window.innerWidth - w - 8, r.left)
    this.el.style.left = Math.max(8, left) + 'px'
    this.el.style.top = r.bottom + 8 + 'px'
    this.el.style.maxHeight = window.innerHeight - r.bottom - 24 + 'px'
    anchor.classList.add('active')
  }

  close(): void {
    if (!this.openId) return
    this.openId = null
    this.el.style.display = 'none'
    this.anchor?.classList.remove('active')
    this.anchor = null
    const d = this.dispose
    this.dispose = undefined
    d?.()
    this.bodyEl.replaceChildren()
  }
}
