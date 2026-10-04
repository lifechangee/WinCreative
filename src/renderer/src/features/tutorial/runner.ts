import type { App } from '../../app/app'
import { Emitter } from '../../core/events'
import { has, onLangChange, t } from '../../i18n'
import { closeCheatSheet } from '../interface/cheatsheet'
import { closeQuickMenu } from '../interface/quickMenu'
import type { UIContext } from '../../ui/registry'
import { Coach } from './coach'
import { hub } from './hub'
import type { HubEvents } from './hub'
import { LESSONS, lessonById, lessonKey, stepKey } from './lessons'
import { Practice } from './practice'
import { store } from './store'
import type { LessonDef, StepCtx, StepDef } from './types'

const AUTO_ADVANCE_MS = 1100
const STUCK_MS = 20000

export interface RunnerEvents {
  /** lesson started / step changed / finished / stopped */
  state: { lesson: string | null; step: number }
  /** a step reached its success condition (also fired for the selftest) */
  pass: { lesson: string; step: string }
  done: { lesson: string }
}

/** Runs one lesson at a time on the practice canvas: step engine + auto-detection + coach mark. */
export class Runner {
  readonly events = new Emitter<RunnerEvents>()
  readonly coach = new Coach()
  private practice!: Practice
  private app!: App
  private ui!: UIContext
  lesson: LessonDef | null = null
  index = 0
  private marks: ('done' | 'skip' | '')[] = []
  private cleanups: (() => void)[] = []
  private passed = false
  private advTimer = 0
  private stuckTimer = 0
  openList: (() => void) | null = null

  install(app: App, ui: UIContext): void {
    this.app = app
    this.ui = ui
    this.practice = new Practice(app)
    this.practice.onAbandon = () => this.stop(false)
    onLangChange(() => this.lesson && this.renderStep())
  }

  get active(): boolean {
    return !!this.lesson
  }
  get practiceDoc(): ReturnType<Practice['enter']> | null {
    return this.practice.doc
  }

  // ------------------------------------------------------------------ lifecycle
  start(id: string): boolean {
    const lesson = lessonById(id)
    if (!lesson) return false
    if (this.lesson) this.stop(false, true)
    // a modal (Preferences, cheat sheet, help) or popover from before would sit on top of the practice canvas
    this.ui.popovers.close()
    closeQuickMenu()
    closeCheatSheet()
    this.lesson = lesson
    this.marks = lesson.steps.map(() => '')
    this.practice.enter() // a second call just gives a fresh blank canvas
    lesson.setup?.(this.practice, this.app)
    this.app.fit()
    this.goto(0)
    return true
  }

  /** Leave the lesson and put the user's document back. `quiet` = keep the practice canvas (switching lessons). */
  stop(restore = true, quiet = false): void {
    this.endStep()
    const was = this.lesson
    this.lesson = null
    this.coach.hide()
    if (!quiet) {
      if (restore) this.practice.leave()
      this.ui.popovers.close()
      closeQuickMenu() // steps may have opened these; they must not outlive the lesson
      closeCheatSheet()
    }
    if (was) this.events.emit('state', { lesson: null, step: 0 })
  }

  private endStep(): void {
    for (const c of this.cleanups.splice(0)) {
      try {
        c()
      } catch (e) {
        console.error('[tutorial] cleanup', e)
      }
    }
    clearTimeout(this.advTimer)
    clearTimeout(this.stuckTimer)
    this.passed = false
  }

  get step(): StepDef | null {
    return this.lesson?.steps[this.index] ?? null
  }

  goto(i: number): void {
    const l = this.lesson
    if (!l) return
    this.endStep()
    if (i >= l.steps.length) return this.finish()
    this.index = Math.max(0, i)
    const step = l.steps[this.index]
    this.renderStep()
    this.events.emit('state', { lesson: l.id, step: this.index })
    const ctx = this.makeCtx(l, step)
    try {
      step.prepare?.(ctx)
      step.watch?.(ctx)
    } catch (e) {
      console.error('[tutorial] step failed', l.id, step.id, e)
    }
    if (step.watch) this.stuckTimer = window.setTimeout(() => !this.passed && this.coach.setStatus('stuck'), STUCK_MS)
  }

  private makeCtx(l: LessonDef, step: StepDef): StepCtx {
    const own: (() => void)[] = this.cleanups
    const guard = <T,>(fn: (p: T) => void) => (p: T): void => {
      if (this.lesson !== l || this.step !== step) return
      try {
        fn(p)
      } catch (e) {
        console.error('[tutorial] detector', e)
      }
    }
    const ctx: StepCtx = {
      app: this.app,
      ui: this.ui,
      hub,
      practice: this.practice,
      data: {},
      pass: () => this.pass(l, step),
      poll: (fn, ms = 120) => {
        const id = window.setInterval(
          guard(() => {
            if (!this.passed && fn()) ctx.pass()
          }),
          ms
        )
        own.push(() => clearInterval(id))
      },
      on: <K extends keyof HubEvents>(type: K, fn: (p: HubEvents[K]) => void): void => {
        own.push(hub.on(type, guard(fn)))
      }
    }
    return ctx
  }

  private pass(l: LessonDef, step: StepDef): void {
    if (this.lesson !== l || this.step !== step || this.passed) return
    this.passed = true
    this.marks[this.index] = 'done'
    this.coach.setStatus('done')
    this.events.emit('pass', { lesson: l.id, step: step.id })
    clearTimeout(this.stuckTimer)
    const i = this.index
    this.advTimer = window.setTimeout(() => this.lesson === l && this.index === i && this.goto(i + 1), AUTO_ADVANCE_MS)
  }

  next(): void {
    if (!this.lesson) return
    if (!this.marks[this.index]) this.marks[this.index] = this.step?.watch ? 'skip' : 'done'
    this.goto(this.index + 1)
  }
  back(): void {
    if (this.lesson && this.index > 0) this.goto(this.index - 1)
  }
  skip(): void {
    if (!this.lesson) return
    this.marks[this.index] = 'skip'
    this.goto(this.index + 1)
  }

  private finish(): void {
    const l = this.lesson
    if (!l) return
    store.setDone(l.id)
    this.events.emit('done', { lesson: l.id })
    const i = LESSONS.findIndex((x) => x.id === l.id)
    const nxt = LESSONS.slice(i + 1).find((x) => !store.isDone(x.id)) ?? null
    this.coach.showComplete({
      lessonTitle: t(lessonKey(l, 'title')),
      title: t('tutorial.complete.title'),
      body: t('tutorial.complete.body', { done: LESSONS.filter((x) => store.isDone(x.id)).length, total: LESSONS.length }),
      nextLabel: nxt ? t('tutorial.complete.next', { lesson: t(lessonKey(nxt, 'title')) }) : undefined,
      onNext: () => nxt && this.start(nxt.id),
      onList: () => {
        this.stop(true)
        this.openList?.()
      },
      onClose: () => this.stop(true)
    })
  }

  private text(l: LessonDef, s: StepDef, part: 't' | 'b' | 'c'): string {
    const k = stepKey(l, s, part)
    const params = s.params ? s.params(this.app) : undefined
    return has(k) ? t(k, params) : k
  }

  renderStep(): void {
    const l = this.lesson
    const s = this.step
    if (!l || !s) return
    this.coach.render(
      {
        lessonTitle: t(lessonKey(l, 'title')),
        index: this.index,
        total: l.steps.length,
        marks: this.marks,
        title: this.text(l, s, 't'),
        body: this.text(l, s, 'b'),
        anim: s.anim,
        live: s.live,
        penNote: !!s.needsPen,
        ctaLabel: s.cta ? this.text(l, s, 'c') : undefined,
        target: s.target,
        manual: !s.watch
      },
      {
        back: () => this.back(),
        skip: () => this.skip(),
        next: () => this.next(),
        exit: () => this.stop(true),
        cta: () => s.cta?.(this.makeCtx(l, s))
      }
    )
    if (this.passed) this.coach.setStatus('done')
  }
}

export const runner = new Runner()
