import { h } from '../../ui/dom'
import { onLangChange, t, tk } from '../../i18n'
import type { App } from '../../app/app'
import { TlEditorCore } from './tlEditorCore'
import type { TimelapseRecorder } from './timelapse'
import { PaneSched, PaneView, SyncMode, clockLength, makePane, panesAt, stepClock } from './tlVariants'
import { fadeAlpha, formatClock } from './tlModel'

/**
 * Compare mode of the time-lapse editor: the language versions side by side. Each pane plays its own edited schedule (own frames, own speed,
 * own length). One shared clock drives them in one of two sync modes:
 *   'moment' - by drawing moment (default): the longest video leads, every other pane shows its latest frame captured at or before the same
 *              moment of the session, so a common stroke appears in all panes together whatever each video's speed;
 *   'time'   - by video time: every pane plays its own schedule from the same second.
 * All lookups are binary searches (tlVariants.ts), so scrubbing stays instant with thousands of frames.
 */
interface Pane {
  code: string
  name: string
  core: TlEditorCore
  sched: PaneSched
  canvas: HTMLCanvasElement
  ctx: CanvasRenderingContext2D
  fade: HTMLElement
  title: HTMLElement
  clock: HTMLElement
  shown: number
  token: number
}

export class CompareView {
  readonly el: HTMLElement
  private panes: Pane[] = []
  private mode: SyncMode = 'moment'
  private time = 0
  private playing = false
  private raf = 0
  private lastTick = 0
  private slider = h('input', { type: 'range', min: '0', max: '1000', step: '1', class: 'tle-cmp-slider' })
  private playBtn!: HTMLButtonElement
  private modeBtns = new Map<SyncMode, HTMLButtonElement>()
  private readout = h('span', { class: 'tle-time' })
  private grid = h('div', { class: 'tle-cmp-grid' })
  private closed = false
  private offLang: () => void

  constructor(
    private app: App,
    private rec: TimelapseRecorder,
    private onClose: () => void
  ) {
    const mk = (label: string | ReturnType<typeof tk>, fn: () => void, cls = ''): HTMLButtonElement => h('button', { class: 'tle-btn ' + cls, text: label, onclick: fn })
    this.playBtn = mk('', () => this.togglePlay(), 'tle-cmp-play')
    const modeBtn = (m: SyncMode, key: string): HTMLButtonElement => {
      const b = h('button', { class: 'tle-seg-btn', text: tk(key), onclick: () => this.setMode(m) })
      this.modeBtns.set(m, b)
      return b
    }
    const bar = h(
      'div',
      { class: 'tle-cmp-bar' },
      this.playBtn,
      mk('|<', () => this.setTime(0)),
      mk('<', () => this.step(-1)),
      mk('>', () => this.step(1)),
      mk('>|', () => this.setTime(this.length)),
      this.readout,
      h('div', { class: 'tle-spacer' }),
      h('span', { class: 'tle-dim', text: tk('langs.cmp.sync') }),
      h('div', { class: 'tle-seg' }, modeBtn('moment', 'langs.cmp.byMoment'), modeBtn('time', 'langs.cmp.byTime')),
      mk(tk('langs.cmp.close'), () => this.onClose(), 'tle-cmp-close')
    )
    this.slider.addEventListener('input', () => this.setTime((Number(this.slider.value) / 1000) * this.length, true))
    this.el = h('section', { class: 'tle-cmp' }, this.grid, h('div', { class: 'tle-cmp-ctl' }, this.slider, bar))
    this.offLang = onLangChange(() => {
      this.updatePlayUi()
      this.setTime(this.time, true)
    })
  }

  private get length(): number {
    return clockLength(this.panes.map((p) => p.sched))
  }

  async load(): Promise<void> {
    const doc = this.app.doc
    for (const code of this.rec.variants) {
      const core = new TlEditorCore(this.rec, code)
      await core.load()
      const canvas = h('canvas', { class: 'tle-canvas', width: 640, height: 360 })
      const fade = h('div', { class: 'tle-fade' })
      const title = h('b', { class: 'tle-cmp-name' })
      const clock = h('span', { class: 'tle-dim' })
      const name = doc.langs.find((l) => l.code === code)?.name ?? code
      this.grid.append(h('div', { class: 'tle-cmp-pane' }, h('div', { class: 'tle-cmp-head' }, title, clock), h('div', { class: 'tle-frame' }, canvas, fade)))
      title.textContent = `${code.toUpperCase()} - ${name}`
      this.panes.push({ code, name, core, sched: makePane(core.kept, core.schedule, core.tags), canvas, ctx: canvas.getContext('2d')!, fade, title, clock, shown: -1, token: 0 })
    }
    this.syncMode()
    this.setTime(0, true)
    this.updatePlayUi()
  }

  // ---------------------------------------------------------------- clock
  private views(): PaneView[] {
    return panesAt(
      this.panes.map((p) => p.sched),
      this.mode,
      this.time
    )
  }

  setMode(m: SyncMode): void {
    if (m === this.mode) return
    this.mode = m
    this.syncMode()
    this.setTime(this.time, true)
  }
  private syncMode(): void {
    for (const [m, b] of this.modeBtns) b.classList.toggle('on', m === this.mode)
  }

  setTime(time: number, fromSlider = false): void {
    this.time = Math.min(Math.max(0, time), this.length)
    if (!fromSlider) this.slider.value = String(this.length > 0 ? Math.round((this.time / this.length) * 1000) : 0)
    const views = this.views()
    this.panes.forEach((p, i) => this.show(p, views[i]))
    this.readout.textContent = t('langs.cmp.clock', { cur: formatClock(this.time, 1), total: formatClock(this.length, 1) })
  }

  private show(p: Pane, v: PaneView): void {
    const total = p.sched.schedule.total
    p.clock.textContent = t('animio.tle.time', { cur: formatClock(Math.min(this.time, total), 1), total: formatClock(total, 1) })
    if (this.mode === 'moment') p.clock.textContent = t('animio.tle.time', { cur: formatClock(v.time, 1), total: formatClock(total, 1) })
    const fin = p.core.edit.finale
    p.fade.style.opacity = String(fadeAlpha(this.mode === 'moment' ? v.time : this.time, total, fin.fadeIn, fin.fadeOut))
    if (v.item < 0 || v.frame === p.shown) return
    const tok = ++p.token
    void p.core.frame(v.frame).then((bmp) => {
      if (!bmp || this.closed || tok !== p.token) return
      p.shown = v.frame
      if (p.canvas.width !== bmp.width || p.canvas.height !== bmp.height) {
        p.canvas.width = bmp.width
        p.canvas.height = bmp.height
      }
      p.ctx.drawImage(bmp, 0, 0)
    })
  }

  /** frame (source index) each pane shows right now - read by the QA */
  shownFrames(): { code: string; frame: number; total: number; time: number }[] {
    const views = this.views()
    return this.panes.map((p, i) => ({ code: p.code, frame: views[i].frame, total: p.sched.schedule.total, time: views[i].time }))
  }

  step(dir: 1 | -1): void {
    this.pause()
    this.setTime(stepClock(this.panes.map((p) => p.sched), this.time, dir))
  }

  private updatePlayUi(): void {
    this.playBtn.textContent = this.playing ? t('langs.cmp.pause') : t('langs.cmp.play')
  }
  togglePlay(): void {
    if (this.playing) return this.pause()
    if (this.time >= this.length) this.time = 0
    this.playing = true
    this.lastTick = performance.now()
    this.updatePlayUi()
    const tick = (now: number): void => {
      if (!this.playing || this.closed) return
      this.setTime(this.time + (now - this.lastTick) / 1000)
      this.lastTick = now
      if (this.time >= this.length) return this.pause()
      this.raf = requestAnimationFrame(tick)
    }
    this.raf = requestAnimationFrame(tick)
  }
  pause(): void {
    this.playing = false
    cancelAnimationFrame(this.raf)
    this.updatePlayUi()
  }

  handleKey(e: KeyboardEvent): boolean {
    if (e.key === 'Escape') {
      this.onClose()
      return true
    }
    if (e.code === 'Space' || e.key === 'k') {
      this.togglePlay()
      return true
    }
    if (e.key === 'ArrowLeft' || e.key === ',') {
      this.step(-1)
      return true
    }
    if (e.key === 'ArrowRight' || e.key === '.') {
      this.step(1)
      return true
    }
    return false
  }

  dispose(): void {
    this.closed = true
    this.offLang()
    this.pause()
    for (const p of this.panes) p.core.dispose()
    this.el.remove()
  }
}
