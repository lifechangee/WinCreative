import type { App } from '../../app/app'
import { prefs } from '../../input/prefs'
import { openPrefs } from './prefsDialog'

const sleep = (ms: number): Promise<void> => new Promise((r) => setTimeout(r, ms))

/** Interface / input self-test (BW_INTERFACE_SELFTEST=1 together with BW_SELFTEST=1). Uses synthetic pointer + key events. */
export async function runInterfaceSelfTest(app: App): Promise<void> {
  let ok = true
  const check = (name: string, cond: boolean, extra = ''): void => {
    console.warn('[selftest-if] ' + (cond ? 'PASS ' : 'FAIL ') + name + ' ' + extra)
    if (!cond) ok = false
  }
  try {
    await sleep(600)
    const rect = app.canvas.getBoundingClientRect()
    const cx = rect.left + rect.width / 2
    const cy = rect.top + rect.height / 2
    let pid = 200
    const fire = (type: string, x: number, y: number, o: PointerEventInit = {}): void => {
      app.canvas.dispatchEvent(new PointerEvent(type, { pointerId: pid, pointerType: 'pen', isPrimary: true, clientX: x, clientY: y, pressure: 0.5, bubbles: true, cancelable: true, button: 0, buttons: type === 'pointerup' ? 0 : 1, ...o }))
    }
    const key = (type: 'keydown' | 'keyup', k: string, code: string, o: KeyboardEventInit = {}): void => {
      window.dispatchEvent(new KeyboardEvent(type, { key: k, code, bubbles: true, cancelable: true, ...o }))
    }

    app.input.calibrator.reset()
    // 1. pen stroke, then Ctrl+Z through the shortcut map
    app.state.setTool('brush')
    app.state.setColor({ h: 0, s: 1, v: 1 })
    pid++
    fire('pointerdown', cx - 100, cy, { pressure: 0.4 })
    for (let i = 1; i <= 30; i++) fire('pointermove', cx - 100 + i * 6, cy + Math.sin(i / 4) * 20, { pressure: 0.87 })
    fire('pointerup', cx + 80, cy, { pressure: 0 })
    await sleep(100)
    check('stroke committed (can undo)', app.doc.history.canUndo)
    check('pressure ceiling 0.87 auto-calibrated', Math.abs(app.input.calibrator.scale - 0.87) < 0.01, 'scale=' + app.input.calibrator.scale)
    key('keydown', 'z', 'KeyZ', { ctrlKey: true })
    await sleep(50)
    check('Ctrl+Z shortcut undoes', app.doc.history.canRedo)
    key('keydown', 'z', 'KeyZ', { ctrlKey: true, shiftKey: true })
    await sleep(50)
    check('Ctrl+Shift+Z shortcut redoes', !app.doc.history.canRedo)
    app.input.calibrator.reset()

    // 2. pen barrel button held while hovering = pan mode (default map: barrel -> eyedropper mode)
    pid++
    fire('pointermove', cx, cy, { buttons: 0, pressure: 0 })
    fire('pointerdown', cx, cy, { buttons: 2, button: 2, pressure: 0 })
    check('barrel button starts a hold mode', app.input.hasMode('eyedropper'))
    fire('pointerup', cx, cy, { buttons: 0, button: 2, pressure: 0 })
    await sleep(30)
    check('barrel release ends hold mode', !app.input.hasMode('eyedropper'))

    // 3. pen eraser end -> temp eraser during stroke
    pid++
    fire('pointerdown', cx, cy + 60, { buttons: 32, button: 5 })
    check('eraser end selects eraser', app.state.effectiveTool === 'eraser')
    fire('pointerup', cx, cy + 60, { buttons: 0, button: 5 })
    check('eraser end released', app.state.effectiveTool === 'brush')

    // 4. keyboard hold modes
    key('keydown', ' ', 'Space')
    check('Space holds pan mode', app.input.spaceDown)
    key('keyup', ' ', 'Space')
    check('Space release ends pan', !app.input.spaceDown)

    // 5. two-finger touch tap = undo
    const t = (type: string, id: number, x: number, y: number, ts: number): void => {
      app.canvas.dispatchEvent(new PointerEvent(type, { pointerId: id, pointerType: 'touch', isPrimary: id === 301, clientX: x, clientY: y, bubbles: true, cancelable: true, button: 0, buttons: type === 'pointerup' ? 0 : 1 }))
      void ts
    }
    await sleep(800) // clear pen-near palm rejection window
    const before = app.doc.history.canUndo
    t('pointerdown', 301, cx - 40, cy, 0)
    t('pointerdown', 302, cx + 40, cy, 5)
    t('pointerup', 301, cx - 40, cy, 60)
    t('pointerup', 302, cx + 40, cy, 65)
    await sleep(60)
    check('two-finger tap undoes', before && app.doc.history.canRedo)
    app.redo()

    // 6. QuickMenu via Q
    key('keydown', 'q', 'KeyQ')
    await sleep(100)
    check('QuickMenu opens with 6 slots', document.querySelectorAll('.qm .qm-slot').length === 6)
    key('keydown', 'Escape', 'Escape')
    await sleep(120)
    check('QuickMenu closes with Esc', !document.querySelector('.qm'))

    // 7. prefs: theme / handedness
    prefs.set('theme', 'light')
    check('light theme applied', document.documentElement.dataset.theme === 'light')
    prefs.set('theme', 'dark')
    prefs.set('rightHandInterface', true)
    check('right-hand class', document.body.classList.contains('rh'))
    prefs.set('rightHandInterface', false)

    // 8. preferences dialog & every tab render
    openPrefs(app)
    for (const id of ['interface', 'pressure', 'gestures', 'pen', 'shortcuts', 'quickmenu', 'diagnostics']) {
      ;(document.querySelector(`.prefs-tabs button[data-id="${id}"]`) as HTMLElement).click()
      await sleep(30)
      check('prefs tab ' + id, (document.querySelector('.prefs-pane')?.children.length ?? 0) > 1)
    }
    document.querySelector<HTMLElement>('.prefs .prefs-head button')!.click()
    check('prefs closes', !document.querySelector('.prefs'))

    // 9. canvas fills the stage after native window changes (maximize / restore / resize / snap-like bounds / fullscreen / zoom)
    const stage = app.canvas.parentElement!
    const verifyFill = async (label: string): Promise<void> => {
      let bad = ''
      for (let i = 0; i < 20; i++) {
        await sleep(150)
        const sr = stage.getBoundingClientRect()
        const dpr = window.devicePixelRatio || 1
        bad = ''
        for (const c of Array.from(stage.querySelectorAll('canvas'))) {
          const r = c.getBoundingClientRect()
          if (Math.abs(r.width - sr.width) > 1 || Math.abs(r.height - sr.height) > 1) bad += ' css:' + (c.id || c.className)
          if (Math.abs(c.width - sr.width * dpr) > 1.5 * dpr || Math.abs(c.height - sr.height * dpr) > 1.5 * dpr) bad += ' px:' + (c.id || c.className) + '=' + c.width + 'x' + c.height + '/' + Math.round(sr.width * dpr) + 'x' + Math.round(sr.height * dpr)
        }
        app.renderNow()
        const gl = app.gpu.gl
        const vp = gl.getParameter(gl.VIEWPORT) as Int32Array
        if (Math.abs(vp[2] - sr.width * dpr) > 1.5 * dpr || Math.abs(vp[3] - sr.height * dpr) > 1.5 * dpr) bad += ' viewport:' + vp[2] + 'x' + vp[3]
        if (Math.abs(sr.width - window.innerWidth) > 1) bad += ' stage-vs-window'
        if (!bad) break
      }
      check('canvases fill stage: ' + label, !bad, bad + ' stage=' + Math.round(stage.clientWidth) + 'x' + Math.round(stage.clientHeight))
    }
    const win = (op: string): Promise<void> | undefined => window.brushwork?.selfTestWindow(op)
    // the page viewport must equal the native window content area (regression: UI drawn smaller than the window, e.g. via page zoom)
    const verifyContent = async (label: string): Promise<void> => {
      let msg = ''
      for (let i = 0; i < 20; i++) {
        await sleep(150)
        const c = await window.brushwork?.selfTestContent()
        if (!c) return
        msg = `content=${c.w}x${c.h} zoom=${c.zoom} inner=${window.innerWidth}x${window.innerHeight}`
        if (c.zoom === 1 && Math.abs(window.innerWidth * c.zoom - c.w) <= 2 && Math.abs(window.innerHeight * c.zoom - c.h) <= 2) { msg = ''; break }
      }
      check('viewport matches window content: ' + label, !msg, msg)
    }
    await verifyContent('initial')
    await verifyFill('initial')
    await win('maximize'); await verifyFill('maximize'); await verifyContent('maximize')
    await win('unmaximize'); await verifyFill('unmaximize'); await verifyContent('unmaximize')
    for (const ev of [new KeyboardEvent('keydown', { key: '-', ctrlKey: true, cancelable: true }), new KeyboardEvent('keydown', { key: '=', ctrlKey: true, cancelable: true }), new WheelEvent('wheel', { deltaY: -120, ctrlKey: true, cancelable: true })]) document.body.dispatchEvent(ev)
    await verifyContent('after ctrl+wheel / ctrl+- / ctrl+=')
    await win('zoom:0.9'); await window.brushwork?.syncContent?.(); await verifyContent('leaked page zoom is reset')
    await win('size:1100x700'); await verifyFill('size 1100x700')
    await win('size:1500x950'); await verifyFill('size 1500x950')
    await win('bounds:0,0,960,900'); await verifyFill('snap-like bounds')
    await win('fullscreen:on'); await verifyFill('fullscreen on')
    await win('fullscreen:off'); await verifyFill('fullscreen off')
  } catch (e) {
    console.warn('[selftest-if] EXCEPTION', e)
    ok = false
  }
  console.warn('[selftest-if] done ok=' + ok)
  await window.brushwork?.selfTestDone({ ok })
}
