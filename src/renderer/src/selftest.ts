import type { App } from './app/app'
import { loadBwk, saveBwk } from './io/bwk'
import { applyFilter } from './gl/filters'

const sleep = (ms: number): Promise<void> => new Promise((r) => setTimeout(r, ms))
const raf = (): Promise<void> => new Promise((r) => { requestAnimationFrame(() => r()); setTimeout(r, 40) })

/**
 * Headless-ish smoke test (BW_SELFTEST=1 npm run dev / electron .). Drives the REAL input path with
 * synthetic pen PointerEvents, then verifies undo/redo, save/load, events, GL errors and performance.
 */
export async function runSelfTest(app: App): Promise<void> {
  const log = (...a: unknown[]): void => console.log('[selftest]', ...a)
  let ok = true
  const check = (name: string, cond: boolean, extra = ''): void => {
    log((cond ? 'PASS ' : 'FAIL ') + name + ' ' + extra)
    if (!cond) ok = false
  }
  try {
    await sleep(400)
    const gl = app.gpu.gl
    log('GL renderer:', gl.getParameter(gl.RENDERER), 'half-float:', app.gpu.half, 'format:', app.doc.format)
    const commits: string[] = []
    app.doc.events.on('commit', (e) => commits.push(e.type))

    const rect = app.canvas.getBoundingClientRect()
    const toClient = (dx: number, dy: number): { x: number; y: number } => {
      const s = app.view.zoom
      const c = Math.cos(app.view.rot)
      const sn = Math.sin(app.view.rot)
      const px = dx - app.view.cx
      const py = dy - app.view.cy
      const sw = app.cssSize()
      return { x: rect.left + sw.w / 2 + s * (c * px - sn * py), y: rect.top + sw.h / 2 + s * (sn * px + c * py) }
    }
    let ptrId = 10
    const fire = (type: string, x: number, y: number, pressure: number, extra: PointerEventInit = {}): void => {
      const c = toClient(x, y)
      app.canvas.dispatchEvent(
        new PointerEvent(type, { pointerId: ptrId, pointerType: 'pen', isPrimary: true, clientX: c.x, clientY: c.y, pressure, tiltX: 20, tiltY: 10, bubbles: true, cancelable: true, button: 0, buttons: type === 'pointerup' ? 0 : 1, ...extra })
      )
    }
    const stroke = async (pts: [number, number, number][], extra: PointerEventInit = {}): Promise<void> => {
      ptrId++
      fire('pointerdown', pts[0][0], pts[0][1], pts[0][2], extra)
      for (let i = 1; i < pts.length; i++) {
        fire('pointermove', pts[i][0], pts[i][1], pts[i][2], extra)
        if (i % 6 === 0) await raf()
      }
      fire('pointerup', pts[pts.length - 1][0], pts[pts.length - 1][1], 0, extra)
      await raf()
    }
    const wave = (x0: number, x1: number, y: number, amp: number): [number, number, number][] => {
      const out: [number, number, number][] = []
      const n = 90
      for (let i = 0; i <= n; i++) {
        const t = i / n
        out.push([x0 + (x1 - x0) * t, y + Math.sin(t * Math.PI * 3) * amp, Math.sin(t * Math.PI) * 0.9 + 0.05])
      }
      return out
    }
    const layerPx = (x: number, y: number): number[] => Array.from(app.gpu.readPremultFloat(app.doc.activeLayer.surface, { x, y, w: 1, h: 1 }))

    // ---- each default brush
    const brushes = ['soft-airbrush', 'hard-round', 'pencil-6b', 'ink-pen', 'watercolor-wet', 'chalk']
    const colors = [
      { h: 215, s: 0.85, v: 0.6 },
      { h: 350, s: 0.8, v: 0.75 },
      { h: 30, s: 0.1, v: 0.15 },
      { h: 260, s: 0.5, v: 0.2 },
      { h: 170, s: 0.7, v: 0.7 },
      { h: 45, s: 0.9, v: 0.9 }
    ]
    const W = app.doc.width
    for (let i = 0; i < brushes.length; i++) {
      app.state.setTool('brush')
      app.state.setPreset('brush', brushes[i])
      app.state.setColor(colors[i])
      if (brushes[i] === 'ink-pen' || brushes[i] === 'pencil-6b') app.state.setSize(brushes[i] === 'ink-pen' ? 22 : 14)
      await stroke(wave(W * 0.1, W * 0.9, 250 + i * 230, 80))
    }
    const hardBefore = layerPx(Math.round(W * 0.5), 250 + 230 + Math.round(Math.sin(Math.PI * 1.5) * 80))
    check('strokes deposit paint', app.doc.history.undoCount === brushes.length, 'undoCount=' + app.doc.history.undoCount)
    check('stroke commit events', commits.filter((c) => c === 'stroke').length === brushes.length, JSON.stringify(commits))

    app.fit()
    app.renderNow()
    await sleep(150)
    await window.brushwork!.selfTestShot("brushes")
    log("step: eraser")
    // ---- eraser via pen eraser button (buttons & 32)
    const before = app.doc.history.undoCount
    await stroke(wave(W * 0.2, W * 0.8, 250 + 230 * 1, 20), { buttons: 1 | 32, button: 0 })
    check('pen eraser end erases', commits.includes('erase'))
    check('temp eraser restored', app.state.tempEraser === false)
    check('erase in history', app.doc.history.undoCount === before + 1)

    log("step: smudge")
    // ---- smudge
    app.state.setTool('smudge')
    await stroke(wave(W * 0.3, W * 0.7, 250 + 230 * 4, 90))
    check('smudge commit', commits.includes('smudge'))
    app.state.setTool('brush')

    log("step: undo")
    // ---- undo / redo pixel exactness
    const probe = { x: Math.round(W * 0.5), y: 250 }
    const cnt = (): number => layerPx(probe.x, probe.y)[3]
    const aEnd = cnt()
    const n0 = app.doc.history.undoCount
    while (app.doc.history.canUndo) app.doc.undo()
    check('undo all clears layer', cnt() === 0 && layerPx(400, 480)[3] === 0)
    while (app.doc.history.canRedo) app.doc.redo()
    check('redo all restores', Math.abs(cnt() - aEnd) < 1e-3 && app.doc.history.undoCount === n0)

    log("step: layers")
    // ---- layers, blend modes
    const l2 = app.doc.addLayer({ blendMode: 'multiply', name: 'Multiply' })
    app.state.setPreset('brush', 'hard-round')
    app.state.setColor({ h: 50, s: 1, v: 1 })
    app.state.setSize(220)
    await stroke(wave(W * 0.15, W * 0.85, 700, 120))
    check('layer count', app.doc.layers.length === 2 && app.doc.activeId === l2.id)
    applyFilter(app.doc, 'desaturate')
    check('filter commit', commits.includes('filter'))
    // clipping layer
    app.doc.addLayer({ clipping: true, blendMode: 'normal', name: 'Clip' })
    app.state.setColor({ h: 0, s: 1, v: 1 })
    await stroke(wave(W * 0.1, W * 0.9, 640, 60))

    log("step: save")
    // ---- save / load round-trip
    const t0 = performance.now()
    const bytes = await saveBwk(app.doc, app.compositor)
    const doc2 = await loadBwk(bytes, app.gpu)
    const px1 = app.gpu.readRGBA8(app.doc.layers[0].surface, { x: 300, y: 250, w: 8, h: 8 })
    const px2 = app.gpu.readRGBA8(doc2.layers[0].surface, { x: 300, y: 250, w: 8, h: 8 })
    let maxd = 0
    for (let i = 0; i < px1.length; i += 4) for (let k = 0; k < 3; k++) maxd = Math.max(maxd, Math.abs((px1[i + k] * px1[i + 3]) / 255 - (px2[i + k] * px2[i + 3]) / 255), Math.abs(px1[i + 3] - px2[i + 3]))
    check('bwk roundtrip', doc2.layers.length === app.doc.layers.length && maxd <= 3, `bytes=${bytes.length} maxdiff=${maxd} ms=${Math.round(performance.now() - t0)}`)
    check('bwk props', doc2.layers[1].blendMode === 'multiply' && doc2.layers[2].clipping === true)
    doc2.dispose()

    // ---- view: fit + render
    app.fit()
    app.renderNow()
    ;(document.querySelector('.tb-icon[title="Layers"]') as HTMLElement | null)?.click()
    await sleep(200)
    check('no GL error', gl.getError() === 0)

    // ---- performance on 4096x4096
    const big = app.newDocument(4096, 4096)
    await sleep(100)
    app.state.setPreset('brush', 'soft-airbrush')
    app.state.setSize(120)
    ptrId++
    const c0 = toClient(300, 2000)
    void c0
    const frames: number[] = []
    fire('pointerdown', 300, 2000, 0.6)
    for (let i = 1; i <= 240; i++) {
      const x = 300 + i * 14
      const y = 2000 + Math.sin(i / 12) * 500
      const t = performance.now()
      fire('pointermove', x, y, 0.3 + 0.6 * Math.abs(Math.sin(i / 30)))
      app.renderNow()
      app.gpu.readPremultFloat(app.compositor.composite, { x: 0, y: 0, w: 1, h: 1 }) // forces GPU sync
      frames.push(performance.now() - t)
    }
    fire('pointerup', 3600, 2000, 0)
    frames.sort((a, b) => a - b)
    const avg = frames.reduce((a, b) => a + b, 0) / frames.length
    log(`4K stroke frame cost ms: avg=${avg.toFixed(2)} p95=${frames[Math.floor(frames.length * 0.95)].toFixed(2)} max=${frames[frames.length - 1].toFixed(2)} (CPU+GPU synced via readPixels, includes compose + present)`)
    check('4K perf p95 < 16ms', frames[Math.floor(frames.length * 0.95)] < 16.6)
    const covered = Array.from(app.gpu.readPremultFloat(app.doc.layers[0].surface, { x: 720, y: 2299, w: 1, h: 1 }))
    log("4K probe alpha", covered[3].toFixed(3))
    check('4K doc', big.width === 4096 && big.format !== undefined, 'format=' + big.format)
    check('no GL error (4K)', gl.getError() === 0)
  } catch (e) {
    console.error('[selftest] exception', e)
    ok = false
  }
  await window.brushwork!.selfTestDone({ ok })
}
