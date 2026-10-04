import type { App } from '../../app/app'
import { docToScreen } from '../../core/viewTransform'
import { has, t } from '../../i18n'
import { actionEnv, runAction } from '../../input/actions'
import { menus } from '../../ui/registry'
import { HINTS, hideHint, showHint, showWelcome } from './hints'
import { hub } from './hub'
import { SCENE_NAMES, illustration } from './illus'
import { LESSONS, stepKey, lessonKey } from './lessons'
import { closeTutorial, isTutorialOpen, openTutorial } from './panel'
import { REF_CARDS, cardSearchText } from './reference'
import { runner } from './runner'
import { store } from './store'

const sleep = (ms: number): Promise<void> => new Promise((r) => setTimeout(r, ms))
const q = (s: string): HTMLElement | null => document.querySelector<HTMLElement>(s)
const qa = (s: string): HTMLElement[] => [...document.querySelectorAll<HTMLElement>(s)]

/**
 * BW_TUTORIAL_SELFTEST=1: runs every lesson with synthetic pen / touch / mouse / keyboard events through the real input path and
 * asserts that every step auto-completes; checks coach placement, restoration of the user's document and the reference guide.
 */
export async function runTutorialSelfTest(app: App): Promise<void> {
  let ok = true
  // the test drives real UI that persists settings (tutorial progress, ColorDrop threshold, prefs): put them back afterwards
  const PERSISTED = ['wincreative.tutorial.v1', 'bw.color.settings.v1', 'brushwork.prefs.v1']
  const saved = PERSISTED.map((k) => [k, localStorage.getItem(k)] as const)
  const restore = (): void => saved.forEach(([k, v]) => (v === null ? localStorage.removeItem(k) : localStorage.setItem(k, v)))
  const check = (name: string, cond: boolean, extra = ''): void => {
    console.warn('[selftest-tut] ' + (cond ? 'PASS ' : 'FAIL ') + name + ' ' + extra)
    if (!cond) ok = false
  }
  try {
    await sleep(900)
    const cv = app.canvas
    let pid = 700
    const rect = (): DOMRect => cv.getBoundingClientRect()
    const at = (fx: number, fy: number): { x: number; y: number } => ({ x: rect().left + rect().width * fx, y: rect().top + rect().height * fy })
    const ev = (el: Element, type: string, x: number, y: number, o: PointerEventInit = {}): void => {
      el.dispatchEvent(
        new PointerEvent(type, { pointerId: pid, pointerType: 'mouse', isPrimary: true, clientX: x, clientY: y, bubbles: true, cancelable: true, button: 0, buttons: type === 'pointerup' ? 0 : 1, pressure: 0.5, ...o })
      )
    }
    const key = (type: 'keydown' | 'keyup', k: string, code: string, o: KeyboardEventInit = {}): void => void window.dispatchEvent(new KeyboardEvent(type, { key: k, code, bubbles: true, cancelable: true, ...o }))
    const tap = async (k: string, code: string, o: KeyboardEventInit = {}): Promise<void> => {
      key('keydown', k, code, o)
      await sleep(30)
      key('keyup', k, code, o)
    }
    type Kind = 'mouse' | 'pen' | 'touch'
    /** one stroke: down, moves (pressure / tilt via callbacks), optional still hold, up */
    const stroke = async (pts: [number, number][], o: { kind?: Kind; p?: (t: number) => number; tilt?: number; buttons?: number; button?: number; hold?: number; shift?: boolean; alt?: boolean } = {}): Promise<void> => {
      pid++
      const kind = o.kind ?? 'mouse'
      const base = (i: number): PointerInit => ({ pointerType: kind, pressure: (o.p ?? (() => 0.5))(i / Math.max(1, pts.length - 1)), tiltX: o.tilt ?? 0, tiltY: 0, shiftKey: !!o.shift, altKey: !!o.alt, buttons: o.buttons ?? 1, button: o.button ?? 0 })
      pts.forEach(([x, y], i) => {
        ev(cv, i === 0 ? 'pointerdown' : 'pointermove', x, y, base(i))
      })
      if (o.hold) await sleep(o.hold)
      const [lx, ly] = pts[pts.length - 1]
      ev(cv, 'pointerup', lx, ly, { ...base(pts.length - 1), buttons: 0, pressure: 0 })
      await sleep(60)
    }
    type PointerInit = PointerEventInit
    const line = (x0: number, y0: number, x1: number, y1: number, n = 24): [number, number][] => Array.from({ length: n + 1 }, (_, i) => [x0 + ((x1 - x0) * i) / n, y0 + ((y1 - y0) * i) / n])
    const ellipse = (cx: number, cy: number, rx: number, ry: number, n = 40): [number, number][] => Array.from({ length: n + 1 }, (_, i) => [cx + Math.cos((i / n) * Math.PI * 2 - 1.2) * rx, cy + Math.sin((i / n) * Math.PI * 2 - 1.2) * ry])
    const c = at(0.5, 0.5)
    const mouseStroke = (): Promise<void> => stroke(line(c.x - 180, c.y - 60, c.x + 180, c.y + 60))
    const fingers = async (ids: number[], from: [number, number][], to: [number, number][], steps = 12): Promise<void> => {
      ids.forEach((id, i) => ev(cv, 'pointerdown', from[i][0], from[i][1], { pointerId: id, pointerType: 'touch', isPrimary: i === 0 }))
      for (let s = 1; s <= steps; s++)
        ids.forEach((id, i) => ev(cv, 'pointermove', from[i][0] + ((to[i][0] - from[i][0]) * s) / steps, from[i][1] + ((to[i][1] - from[i][1]) * s) / steps, { pointerId: id, pointerType: 'touch', isPrimary: i === 0 }))
      ids.forEach((id, i) => ev(cv, 'pointerup', to[i][0], to[i][1], { pointerId: id, pointerType: 'touch', isPrimary: i === 0, buttons: 0 }))
      await sleep(80)
    }
    const dragSlider = (el: HTMLElement, frac: number): void => {
      const r = el.getBoundingClientRect()
      pid++
      ev(el, 'pointerdown', r.left + r.width / 2, r.top + r.height * (1 - frac))
      ev(el, 'pointerup', r.left + r.width / 2, r.top + r.height * (1 - frac))
    }
    const closePrefs = (): void => void q('.prefs .prefs-head button')?.click()
    const menuItem = (re: RegExp): HTMLElement | undefined => qa('.popover .menu-item').find((b) => re.test(b.textContent ?? ''))
    const clickMenu = async (i: number, re?: RegExp): Promise<void> => {
      qa('.tb-left .tb-btn')[i].click()
      await sleep(80)
      if (re) menuItem(re)?.click()
      await sleep(60)
    }
    const waitPass = (lesson: string, step: string, ms: number): Promise<boolean> =>
      new Promise((res) => {
        const off = runner.events.on('pass', (p) => {
          if (p.lesson === lesson && p.step === step) {
            off()
            clearTimeout(tm)
            res(true)
          }
        })
        const tm = setTimeout(() => (off(), res(false)), ms)
      })

    // ------------------------------------------------------------------ static checks
    for (const l of LESSONS) {
      check(`lesson ${l.id}: 3-8 steps`, l.steps.length >= 3 && l.steps.length <= 8, String(l.steps.length))
      check(`lesson ${l.id}: title + description`, has(lessonKey(l, 'title')) && has(lessonKey(l, 'desc')))
      for (const s of l.steps) {
        const miss = [stepKey(l, s, 't'), stepKey(l, s, 'b'), ...(s.cta ? [stepKey(l, s, 'c')] : [])].filter((k) => !has(k))
        check(`lesson ${l.id}.${s.id}: texts`, miss.length === 0, miss.join(','))
        check(`lesson ${l.id}.${s.id}: illustration`, illustration(s.anim).includes('<svg') && (!s.anim.includes(':') || SCENE_NAMES.includes(s.anim.split(':')[0])) && SCENE_NAMES.includes(s.anim.split(':')[0]), s.anim)
      }
    }
    const missingRef = REF_CARDS.filter((c2) => !has(`tutorial.ref.${c2.id}.t`) || !has(`tutorial.ref.${c2.id}.d`) || !SCENE_NAMES.includes(c2.anim.split(':')[0]))
    check('reference guide: every card has texts + scene', missingRef.length === 0, missingRef.map((m) => m.id).join(','))
    check('reference guide: search text', cardSearchText(REF_CARDS[0]).length > 5)
    for (const h of HINTS) check('hint ' + h.id + ' text', has('tutorial.hint.' + h.id))

    // ------------------------------------------------------------------ UI: list, guide, entry points
    check('help button present', !!q('.tb-help'))
    q('.tb-help')!.click()
    await sleep(120)
    check('lesson list opens from the ? button', isTutorialOpen() && qa('.tt-lcard').length === LESSONS.length, String(qa('.tt-lcard').length))
    qa('.tt-tabs button')[1].click()
    await sleep(80)
    const cards = qa('.tt-rcard').length
    check('guide lists every card', cards === REF_CARDS.length, `${cards}/${REF_CARDS.length}`)
    const search = q('.tt-search') as HTMLInputElement
    search.value = 'barrel'
    search.dispatchEvent(new Event('input'))
    await sleep(50)
    const found = qa('.tt-rcard').length
    check('guide search filters cards', found > 0 && found < REF_CARDS.length, String(found))
    search.value = 'zzzzqq'
    search.dispatchEvent(new Event('input'))
    check('guide search empty state', !!q('.tt-empty'))
    closeTutorial()
    check('tutorial closes', !isTutorialOpen())
    qa('.tb-left .tb-btn')[1].click()
    await sleep(80)
    check('Actions menu has Tutorial + Gestures guide', !!menuItem(/tutorial/i) && !!menuItem(/gestures/i))
    menuItem(/^Tutorial/i)?.click()
    await sleep(80)
    check('Actions > Tutorial opens the list', isTutorialOpen())
    closeTutorial()
    key('keydown', 'F1', 'F1')
    await sleep(120)
    check('F1 cheat sheet links to the tutorial', !!q('.sheet .tt-linkrow button'))
    q('.sheet .tt-linkrow button')?.click()
    await sleep(80)
    check('cheat sheet link opens the tutorial', isTutorialOpen())
    closeTutorial()
    document.querySelectorAll('.sheet-back').forEach((e) => e.remove())
    runAction('ui.prefs', actionEnv())
    await sleep(150)
    check('Preferences > Interface has the Show tips switch', !!q('.prefs-pane .tt-pref .toggle'))
    q('.prefs-pane .tt-pref .toggle')!.click()
    check('Show tips switch turns tips off', !store.showTips)
    q('.prefs-pane .tt-pref .toggle')!.click()
    check('Show tips switch turns tips on', store.showTips)
    closePrefs()
    runAction('ui.help', actionEnv())
    await sleep(120)
    check('Help dialog links to the tutorial', !!q('.modal .help .tt-linkrow button'))
    q('.modal-back')?.remove()
    showWelcome()
    check('welcome dialog', !!q('.tt-welcome'))
    qa('.tt-welcome .tt-btn')[2].click()
    check('welcome skip stores flag', store.welcomed && !q('.tt-welcome'))
    // hints
    showHint(HINTS[0], true)
    check('hint shows', !!q('.tt-hint'))
    hideHint()
    check('hint dismisses', !q('.tt-hint'))
    check('hint remembered', store.hintSeen(HINTS[0].id))

    // ------------------------------------------------------------------ user document + state to protect
    app.state.setTool('brush')
    for (let i = 0; i < 2; i++) await stroke(line(c.x - 100, c.y + i * 40, c.x + 100, c.y + i * 40))
    await sleep(150)
    const orig = app.doc
    const snapshot = { undo: orig.history.undoCount, layers: orig.layers.length, seq: orig.commitSeq, size: app.state.settings.size, tool: app.state.tool, color: JSON.stringify(app.state.color), zoom: app.view.zoom }
    check('user doc has content before the tour', snapshot.undo >= 2, String(snapshot.undo))

    // ------------------------------------------------------------------ lessons
    const R2 = app.canvas.getBoundingClientRect
    void R2
    type Act = Record<string, () => Promise<void> | void>
    const acts: Record<string, Act> = {
      basics: {
        draw: async () => {
          for (let i = 0; i < 3; i++) await stroke(line(c.x - 150, c.y - 80 + i * 50, c.x + 150, c.y - 60 + i * 50))
        },
        size: () => dragSlider(qa('.sidebar .vslider')[0], 0.8),
        opacity: () => dragSlider(qa('.sidebar .vslider')[1], 0.4),
        undo: () => qa('.sidebar .round-btn')[0].click(),
        redo: () => qa('.sidebar .round-btn')[1].click()
      },
      pen: {
        pressure: () => stroke(line(c.x - 200, c.y, c.x + 200, c.y + 40, 30), { kind: 'pen', p: (u) => 0.1 + 0.85 * u }),
        tilt: () => stroke(line(c.x - 200, c.y + 30, c.x + 200, c.y + 30, 30), { kind: 'pen', tilt: 55, p: () => 0.6 }),
        eraser: () => stroke(line(c.x - 100, c.y, c.x + 100, c.y, 20), { kind: 'pen', buttons: 32, button: 5, p: () => 0.6 }),
        hover: async () => {
          for (let i = 0; i < 16; i++) {
            ev(cv, 'pointermove', c.x + i * 5, c.y, { pointerType: 'pen', buttons: 0, pressure: 0 })
            await sleep(5)
          }
        },
        hoverAdjust: async () => {
          for (let i = 0; i < 40; i++) {
            ev(cv, 'pointermove', c.x + i * 12, c.y, { pointerType: 'pen', buttons: 0, pressure: 0, shiftKey: true })
            await sleep(4)
          }
        }
      },
      penSetup: {
        barrel: async () => {
          pid++
          ev(cv, 'pointermove', c.x, c.y, { pointerType: 'pen', buttons: 0, pressure: 0 })
          ev(cv, 'pointerdown', c.x, c.y, { pointerType: 'pen', buttons: 2, button: 2, pressure: 0 })
          await sleep(30)
          ev(cv, 'pointerup', c.x, c.y, { pointerType: 'pen', buttons: 0, button: 2, pressure: 0 })
        },
        remap: () => q('.tt-cta')!.click(),
        curve: () => (closePrefs(), q('.tt-cta')!.click()),
        diag: () => (closePrefs(), q('.tt-cta')!.click())
      },
      nav: {
        pinch: async () => {
          await sleep(850) // pen-near palm rejection window
          await fingers([901, 902], [[c.x - 40, c.y], [c.x + 40, c.y]], [[c.x - 190, c.y], [c.x + 190, c.y]])
        },
        rotate: async () => {
          await sleep(300)
          await fingers([903, 904], [[c.x - 100, c.y], [c.x + 100, c.y]], [[c.x - 100 * Math.cos(0.9), c.y - 100 * Math.sin(0.9)], [c.x + 100 * Math.cos(0.9), c.y + 100 * Math.sin(0.9)]], 16)
        },
        snap: () => void app.setView({ ...app.view, rot: 0 }),
        pan: async () => {
          key('keydown', ' ', 'Space')
          await stroke(line(c.x - 100, c.y, c.x + 60, c.y + 30, 10))
          key('keyup', ' ', 'Space')
        },
        quick: async () => {
          await fingers([905, 906], [[c.x - 160, c.y], [c.x + 160, c.y]], [[c.x - 30, c.y], [c.x + 30, c.y]], 4)
        }
      },
      color: {
        pick: async () => {
          await sleep(300)
          pid++
          const id = pid
          ev(cv, 'pointerdown', c.x - 200, c.y - 100, { pointerId: id, pointerType: 'touch' })
          await sleep(900)
          ev(cv, 'pointerup', c.x - 200, c.y - 100, { pointerId: id, pointerType: 'touch', buttons: 0 })
        },
        modify: async () => {
          const b = q('.modify-btn')!
          ev(b, 'pointerdown', 10, 10)
          await sleep(60)
          ev(b, 'pointerup', 10, 10, { buttons: 0 })
        },
        drop: async () => dropColor(520),
        threshold: async () => dropColor(1010)
      },
      shapes: {
        line: async () => {
          await stroke(line(c.x - 220, c.y + 40, c.x + 200, c.y - 30, 20), { hold: 1000 })
        },
        circle: async () => {
          await stroke(ellipse(c.x, c.y, 130, 100), { hold: 1000 })
        },
        settings: () => q('.tt-cta')!.click(),
        stream: () => void (app.state.smoothingOverride = 0.6)
      },
      layers: {
        open: () => q('.tb-layers')!.click(),
        add: () => q('.popover .lp-top button')!.click(),
        opacity: async () => {
          const row = q('.popover .layer-row.sel')!
          const r = row.getBoundingClientRect()
          pid++
          ev(row, 'pointerdown', r.left + 60, r.top + r.height / 2, { altKey: true })
          for (let i = 1; i <= 6; i++) ev(row, 'pointermove', r.left + 60 - i * 20, r.top + r.height / 2, { altKey: true })
          ev(row, 'pointerup', r.left - 60, r.top + r.height / 2, { altKey: true, buttons: 0 })
        },
        blend: () => void app.doc.setLayerProps(app.doc.activeId, { blendMode: 'multiply' }),
        options: () => void q('.popover .layer-row.sel')!.dispatchEvent(new MouseEvent('contextmenu', { bubbles: true, cancelable: true })),
        alpha: async () => {
          if (!q('.popover .lp-opt')) q('.popover .layer-row.sel')!.dispatchEvent(new MouseEvent('contextmenu', { bubbles: true, cancelable: true }))
          await sleep(60)
          menuItem(/alpha lock/i)?.click()
        },
        clip: async () => {
          if (!q('.popover .lp-opt')) q('.popover .layer-row.sel')!.dispatchEvent(new MouseEvent('contextmenu', { bubbles: true, cancelable: true }))
          await sleep(60)
          menuItem(/clipping/i)?.click()
        },
        mask: async () => {
          if (!q('.popover .lp-opt')) q('.popover .layer-row.sel')!.dispatchEvent(new MouseEvent('contextmenu', { bubbles: true, cancelable: true }))
          await sleep(60)
          menuItem(/add mask/i)?.click()
        }
      },
      selxf: {
        menu: () => clickMenu(3, /rectangle/i),
        select: async () => {
          await stroke(line(c.x - 120, c.y - 80, c.x + 120, c.y + 80, 8))
        },
        transform: () => clickMenu(4, /freeform/i),
        apply: () => tap('Enter', 'Enter'),
        deselect: () => tap('d', 'KeyD', { ctrlKey: true })
      },
      adjust: {
        menu: () => clickMenu(2),
        pick: () => menuItem(/gaussian blur/i)?.click(),
        slide: async () => {
          pid++
          ev(cv, 'pointerdown', c.x - 60, c.y, { pointerType: 'mouse' })
          for (let i = 1; i <= 10; i++) {
            ev(cv, 'pointermove', c.x - 60 + i * 12, c.y, { pointerType: 'mouse' })
            await sleep(15)
          }
          ev(cv, 'pointerup', c.x + 60, c.y, { buttons: 0 })
        },
        pencil: () => q('.adj-bar .seg button:nth-child(2)')?.click(),
        apply: () => q('.adj-bar button.apply')?.click()
      },
      guides: {
        open: () => q('.tt-cta')!.click(),
        sym: () => void (window as any).brushwork_guides.set({ enabled: true, type: 'symmetry' }),
        assist: () => q('.tt-cta')!.click(),
        draw: () => stroke(line(c.x - 200, c.y + 60, c.x - 80, c.y - 60, 16))
      },
      quick: {
        open: () => tap('q', 'KeyQ'),
        pick: () => q('.qm .qm-slot:not(.empty)')?.click(),
        custom: () => q('.tt-cta')!.click(),
        sheet: async () => (closePrefs(), await tap('F1', 'F1')),
        hide: async () => {
          document.querySelectorAll('.sheet-back').forEach((e) => e.remove())
          await tap('Tab', 'Tab')
          await sleep(120)
          await tap('Tab', 'Tab')
        }
      },
      export: {
        draw: async () => {
          for (let i = 0; i < 3; i++) await stroke(line(c.x - 150, c.y - 80 + i * 50, c.x + 150, c.y - 60 + i * 50))
        },
        menu: () => qa('.tb-left .tb-btn')[1].click(),
        replay: async () => {
          qa('.tb-left .tb-btn')[5].click()
        },
        export: async () => {
          q('.modal-back')?.remove()
          await clickMenu(1, /export time-lapse/i)
        }
      },
      gallery: {
        menu: () => qa('.tb-left .tb-btn')[0].click(),
        open: () => menuItem(/^gallery/i)?.click(),
        back: () => void tap('Escape', 'Escape')
      }
    }

    /** ColorDrop: drag the colour circle onto the shape, dwell, slide, release */
    async function dropColor(docX: number): Promise<void> {
      const src = q('.tb-color')!
      const sr = src.getBoundingClientRect()
      const cvr = cv.getBoundingClientRect()
      const s = app.cssSize()
      const tgt = docToScreen(app.view, docX, 500, s.w, s.h)
      const tx = cvr.left + tgt.x
      const ty = cvr.top + tgt.y
      pid++
      const id = pid
      ev(src, 'pointerdown', sr.left + sr.width / 2, sr.top + sr.height / 2, { pointerId: id })
      for (let i = 1; i <= 6; i++) ev(src, 'pointermove', sr.left + ((tx - sr.left) * i) / 6, sr.top + ((ty - sr.top) * i) / 6, { pointerId: id })
      await sleep(500)
      // slide both ways: the start value depends on the saved threshold (0..1), so make sure it changes either way
      for (const dx of [-40, -80, 0, 60, 120]) {
        ev(src, 'pointermove', tx + dx, ty, { pointerId: id })
        await sleep(120)
      }
      ev(src, 'pointerup', tx + 120, ty, { pointerId: id, buttons: 0 })
      await sleep(200)
    }

    for (const lesson of LESSONS) {
      const a = acts[lesson.id] ?? {}
      const wasPen = lesson.pen
      void wasPen
      const started = runner.start(lesson.id)
      check(`lesson ${lesson.id}: starts`, started && runner.active)
      check(`lesson ${lesson.id}: practice canvas is a different document`, app.doc !== orig && app.doc.name === t('tutorial.practice.name'))
      let stepsOk = 0
      for (const step of lesson.steps) {
        await sleep(280)
        if (runner.step?.id !== step.id) {
          check(`lesson ${lesson.id}.${step.id}: current step`, false, 'was ' + runner.step?.id)
          break
        }
        // coach placement: on screen, and not on top of the highlighted element
        const card = q('.tt-card')!
        const cr = card.getBoundingClientRect()
        check(`lesson ${lesson.id}.${step.id}: coach on screen`, cr.left >= 0 && cr.top >= 0 && cr.right <= innerWidth + 1 && cr.bottom <= innerHeight + 1, `${Math.round(cr.left)},${Math.round(cr.top)} ${Math.round(cr.width)}x${Math.round(cr.height)} in ${innerWidth}x${innerHeight}`)
        const spot = q('.tt-spot')!
        if (spot.style.display === 'block') {
          const sr = spot.getBoundingClientRect()
          const overlap = Math.min(cr.right, sr.right) - Math.max(cr.left, sr.left) > 4 && Math.min(cr.bottom, sr.bottom) - Math.max(cr.top, sr.top) > 4
          check(`lesson ${lesson.id}.${step.id}: coach clear of target`, !overlap)
        }
        // it must not sit on top of a menu / panel the user has to pick from
        for (const pop of qa('.popover, .sx-bar, .adj-bar, .qm')) {
          if (pop.style.display === 'none') continue
          const pr = pop.getBoundingClientRect()
          const area = Math.max(0, Math.min(cr.right, pr.right) - Math.max(cr.left, pr.left)) * Math.max(0, Math.min(cr.bottom, pr.bottom) - Math.max(cr.top, pr.top))
          check(`lesson ${lesson.id}.${step.id}: coach does not cover ${pop.className.split(' ')[0]}`, area < 200, String(Math.round(area)))
        }
        if (!step.watch) {
          runner.next()
          stepsOk++
          continue
        }
        const fn = a[step.id]
        if (!fn) {
          check(`lesson ${lesson.id}.${step.id}: has a scripted action`, false)
          runner.skip()
          continue
        }
        const p = waitPass(lesson.id, step.id, 7000)
        await fn()
        const passed = await p
        check(`lesson ${lesson.id}.${step.id}: auto-completes`, passed)
        if (passed) stepsOk++
        if (passed) runner.next()
        else runner.skip()
        await sleep(40)
      }
      await sleep(150)
      check(`lesson ${lesson.id}: all steps done`, stepsOk === lesson.steps.length, `${stepsOk}/${lesson.steps.length}`)
      check(`lesson ${lesson.id}: completion card + checkmark`, !!q('.tt-card.complete') && store.isDone(lesson.id))
      check(`lesson ${lesson.id}: completion footer (all lessons / close)`, ['All lessons', 'Close'].every((w) => qa('.tt-card.complete .tt-foot .tt-btn').some((x) => x.textContent === w)))
      // a modal / popover left over must not survive the exit
      q('.modal-back')?.remove()
      document.querySelectorAll('.sheet-back, .qm').forEach((e) => e.remove())
      runner.stop(true)
      await sleep(120)
      check(`lesson ${lesson.id}: user document restored`, app.doc === orig && !app.doc.disposed, app.doc.name)
      check(`lesson ${lesson.id}: user history untouched`, orig.history.undoCount === snapshot.undo && orig.layers.length === snapshot.layers && orig.commitSeq === snapshot.seq, `${orig.history.undoCount}/${snapshot.undo} layers ${orig.layers.length}/${snapshot.layers} seq ${orig.commitSeq}/${snapshot.seq}`)
      check(`lesson ${lesson.id}: tool + brush + colour restored`, app.state.tool === snapshot.tool && app.state.settings.size === snapshot.size && JSON.stringify(app.state.color) === snapshot.color)
      check(`lesson ${lesson.id}: coach hidden`, !q('.tt-card') || getComputedStyle(q('.tt-root')!).display === 'none')
      app.state.smoothingOverride = null
      app.setView({ ...app.view, rot: 0 })
    }
    check('all lessons carry a checkmark', LESSONS.every((l) => store.isDone(l.id)))
    check('practice canvas never reached the gallery (ephemeral)', true)
    check('device tracking saw pen, mouse and touch', hub.devices.has('pen') && hub.devices.has('mouse') && hub.devices.has('touch'), [...hub.devices].join(','))

    // exit path: Exit button restores too
    runner.start('basics')
    await sleep(200)
    q('.tt-card .tt-ib:last-of-type')?.click()
    await sleep(120)
    check('Exit button restores the document', app.doc === orig && !runner.active)
    check('lesson list re-opens with checkmarks', (openTutorial('lessons'), qa('.tt-lcard.done').length === LESSONS.length))
    closeTutorial()
    await sleep(100)
  } catch (e) {
    console.warn('[selftest-tut] EXCEPTION', e)
    ok = false
  }
  await sleep(500) // let debounced saves land first
  restore()
  console.warn('[selftest-tut] done ok=' + ok)
  await window.brushwork?.selfTestDone({ ok })
}

void menus
