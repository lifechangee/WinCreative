import type { App } from '../../app/app'
import { BrushPreset, normalizeBrush } from '../../core/brush'
import { StrokePipeline } from '../../core/pipeline'
import { listBrushPresets, getBrushPreset } from '../../brush/presets'
import type { UIContext } from '../../ui/registry'
import { editBrush } from './actions'
import { exportBrushFile, importBrushFile } from './brushFile'
import { library } from './library'
import { PreviewContext, brushThumbnail, previewSamples, renderPreview } from './preview'

const sleep = (ms: number): Promise<void> => new Promise((r) => setTimeout(r, ms))

/** Brush area self-test (BW_SELFTEST=1): previews of every shipped brush, AA of tiny brushes, taper, dual, wet mix, files, UI. */
export async function runBrushSelfTest(app: App, ctx: UIContext, alone = true): Promise<boolean> {
  const log = (...a: unknown[]): void => console.warn('[brushtest]', ...a)
  let ok = true
  const check = (name: string, cond: boolean, extra = ''): void => {
    log((cond ? 'PASS ' : 'FAIL ') + name + ' ' + extra)
    if (!cond) ok = false
  }
  try {
    await sleep(300)
    const gl = app.gpu.gl
    while (gl.getError() !== 0) {
      /* flush errors of other modules */
    }
    const all = listBrushPresets()
    check('library ships >= 40 brushes', all.length >= 40, 'count=' + all.length)
    check('library has sets', library.sets.length >= 14, 'sets=' + library.sets.length)

    // ---- every brush renders something (real engine)
    const pc = new PreviewContext(app.gpu, 240, 44)
    const empty: string[] = []
    for (const b of all) {
      renderPreview(pc, b)
      const px = pc.readLayer()
      let a = 0
      for (let i = 3; i < px.length; i += 4) a += px[i]
      if (a < 255 * 8) empty.push(b.id)
    }
    check('every shipped brush draws visible paint', empty.length === 0, empty.join(','))
    check('no GL error after previews', gl.getError() === 0)

    // ---- anti-aliasing of tiny brushes: soft coverage, no hard 0/255 stair-steps
    for (const size of [1, 2, 3]) {
      const b = normalizeBrush({ id: 'aa' + size, name: 'aa', hardness: 1, defaultSize: size, spacing: 0.06, dynamics: { pressureSize: 0 } })
      pc.clear()
      pc.begin(b, 'paint', [0, 0, 0])
      const eng = pc.engine
      const pipe = new StrokePipeline({ preset: b, size, mode: 'paint', color: [0, 0, 0], secondary: [1, 1, 1], curve: (p) => p, smoothing: { amount: 0, mode: 'exp', lazyRadius: 0 }, seed: 1 }, { stamp: (d, t) => eng.stamp(d, t), restart: () => eng.restart() })
      // a shallow diagonal line: stair-steps would show as few distinct alpha values
      for (let i = 0; i <= 200; i++) pipe.push({ x: 20 + i, y: 10 + i * 0.13, pressure: 1, tiltX: 0, tiltY: 0, twist: 0, t: i * 2 })
      pipe.end()
      eng.end()
      const px = pc.readLayer()
      const levels = new Set<number>()
      let partial = 0
      let full = 0
      for (let i = 3; i < px.length; i += 4) {
        if (px[i] > 0) levels.add(px[i] >> 3)
        if (px[i] > 8 && px[i] < 247) partial++
        if (px[i] >= 247) full++
      }
      check(`${size}px hard brush is anti-aliased`, partial >= 120 && levels.size >= 8, `partial=${partial} full=${full} levels=${levels.size}`)
    }

    // ---- end taper thins the end of the ink pen stroke
    {
      const b = getBrushPreset('ink-pen')!
      renderPreview(pc, { ...b, defaultSize: 12 }, { size: 12 })
      const px = pc.readLayer()
      const colSum = (x: number): number => {
        let s = 0
        for (let y = 0; y < 44; y++) s += px[(y * 240 + x) * 4 + 3]
        return s
      }
      const s = previewSamples(b, 240, 44)
      const x0 = s[0].x
      const x1 = s[s.length - 1].x
      const mid = colSum(Math.round((x0 + x1) / 2))
      const end = colSum(Math.round(x1 - 3))
      check('ink pen tapers at the end', end < mid * 0.75, `end=${end} mid=${mid}`)
    }

    // ---- dual brush + wet mix + blend-mode brushes render
    for (const id of ['abs-dual', 'ret-neon', 'paint-oil', 'paint-knife', 'lum-glow', 'smudge-soft', 'draw-marker', 'paint-impasto']) {
      const b = getBrushPreset(id)
      check('renders ' + id, !!b && !!brushThumbnail(app, b, 200, 40))
    }
    {
      const oil = getBrushPreset('paint-oil')!
      renderPreview(pc, oil)
      const a = pc.readLayer()
      const flat = new Set<string>()
      for (let i = 0; i < a.length; i += 4 * 97) flat.add(a[i] + ',' + a[i + 1] + ',' + a[i + 2])
      check('wet mix brush blends with the canvas colours', flat.size > 12, 'colors=' + flat.size)
    }

    // ---- files: .bwbrush round trip incl. custom texture
    {
      const src = normalizeBrush({ ...getBrushPreset('chalk')!, id: 'rt-test', name: 'Round trip' })
      const bytes = await exportBrushFile(src)
      const r = await importBrushFile(bytes, 'x.bwbrush')
      const b2 = r.brushes[0]
      check('bwbrush round trip keeps name and settings', b2.name === 'Round trip' && b2.grain.depth === src.grain.depth && b2.spacing === src.spacing)
      check('bwbrush round trip keeps textures', !!b2.tipTexture && !!b2.grain.texture)
    }

    // ---- real strokes through the app's input path (undo/redo exactness for every engine path)
    // (standalone only: it replaces the document, which would disturb the shared BW_SELFTEST run)
    if (alone) {
      const W = 1024
      app.newDocument(W, W)
      app.fit()
      await sleep(150)
      const commits: string[] = []
      app.doc.events.on('commit', (e) => commits.push(e.type))
      const rect = app.canvas.getBoundingClientRect()
      const toClient = (dx: number, dy: number): { x: number; y: number } => {
        const z = app.view.zoom
        const c = Math.cos(app.view.rot)
        const sn = Math.sin(app.view.rot)
        const px = dx - app.view.cx
        const py = dy - app.view.cy
        const sw = app.cssSize()
        return { x: rect.left + sw.w / 2 + z * (c * px - sn * py), y: rect.top + sw.h / 2 + z * (sn * px + c * py) }
      }
      let ptr = 50
      const fire = (type: string, x: number, y: number, pressure: number): void => {
        const c = toClient(x, y)
        app.canvas.dispatchEvent(new PointerEvent(type, { pointerId: ptr, pointerType: 'pen', isPrimary: true, clientX: c.x, clientY: c.y, pressure, tiltX: 20, tiltY: 10, bubbles: true, cancelable: true, button: 0, buttons: type === 'pointerup' ? 0 : 1 }))
      }
      const stroke = async (y: number): Promise<void> => {
        ptr++
        const pts: [number, number, number][] = []
        for (let i = 0; i <= 60; i++) pts.push([100 + i * 14, y + Math.sin(i / 8) * 25, Math.sin((i / 60) * Math.PI) * 0.9 + 0.05])
        fire('pointerdown', pts[0][0], pts[0][1], pts[0][2])
        for (let i = 1; i < pts.length; i++) {
          fire('pointermove', pts[i][0], pts[i][1], pts[i][2])
          if (i % 10 === 0) await sleep(16)
        }
        fire('pointerup', pts[60][0], pts[60][1], 0)
        await sleep(30)
      }
      const alphaAt = (x: number, y: number): number => app.gpu.readPremultFloat(app.doc.activeLayer.surface, { x, y, w: 1, h: 1 })[3]
      const sum = (): number => {
        const px = app.gpu.readRGBA8(app.doc.activeLayer.surface, { x: 0, y: 0, w: W, h: W })
        let a = 0
        for (let i = 3; i < px.length; i += 4) a += px[i]
        return a
      }
      // a base coat so smudge / mixing / blend brushes have something to work with
      app.state.setTool('brush')
      app.state.setPreset('brush', 'hard-round')
      app.state.setColor({ h: 200, s: 0.7, v: 0.8 })
      app.state.setSize(120)
      await stroke(150)
      const cases: [string, string, string][] = [
        ['brush', 'ink-pen', 'stroke'],
        ['brush', 'abs-dual', 'stroke'],
        ['brush', 'paint-oil', 'stroke'],
        ['brush', 'lum-glow', 'stroke'],
        ['brush', 'sketch-graphite', 'stroke'],
        ['smudge', 'smudge-soft', 'smudge'],
        ['eraser', 'eraser-soft', 'erase']
      ]
      const states: number[] = [sum()]
      let y = 300
      for (const [tool, id, type] of cases) {
        app.state.setTool(tool as 'brush')
        app.state.setPreset(tool as 'brush', id)
        app.state.setColor({ h: 20 + y / 10, s: 0.9, v: 0.9 })
        const before = commits.length
        await stroke(id === 'smudge-soft' || id === 'eraser-soft' ? 150 : y)
        check(`real stroke ${id} commits`, commits.slice(before).includes(type), commits.slice(before).join(','))
        states.push(sum())
        y += 110
      }
      check('paint brushes deposit pixels', states[1] > states[0] && states[2] > states[1] && states[3] > states[2])
      check('eraser removes pixels', states[7] < states[6])
      const finalSum = states[states.length - 1]
      const n = app.doc.history.undoCount
      while (app.doc.history.canUndo && app.doc.history.undoCount > n - cases.length) app.doc.undo()
      check('undo restores the state before the last stroke exactly (all engine paths)', Math.abs(sum() - states[0]) < 2, `${sum()} vs ${states[0]}`)
      while (app.doc.history.canRedo) app.doc.redo()
      check('redo restores the final state', Math.abs(sum() - finalSum) < 2, `${sum()} vs ${finalSum}`)
      void alphaAt
      check('no GL error after real strokes', gl.getError() === 0)
    }

    // ---- UI: library popover + Brush Studio (standalone only: it drives the shared toolbar / popovers)
    if (alone) {
    app.state.setTool('brush')
    ;(document.querySelector('.tb-icon[title^="Brush"]') as HTMLElement | null)?.click()
    await sleep(900)
    const panel = document.querySelector('.bl-panel')
    check('brush library panel opens', !!panel && panel.querySelectorAll('.bl-set').length >= 10, 'sets=' + panel?.querySelectorAll('.bl-set').length)
    ;(document.querySelector('.bl-set[data-set="set-inking"]') as HTMLElement | null)?.click()
    await sleep(1000)
    const rows = document.querySelectorAll('.bl-row').length
    check('library lists brushes with previews', rows >= 5, 'rows=' + rows)
    await window.brushwork?.selfTestShot('brushlib')
    ctx.popovers.close()

    const cur = app.state.preset
    editBrush(app, cur)
    await sleep(500)
    const win = document.querySelector('.bs-win')
    check('Brush Studio opens', !!win)
    {
      const pad = document.querySelector('.bs-pad canvas.pad') as HTMLCanvasElement | null
      check('Brush Studio has a drawing pad', !!pad)
      if (pad) {
        const r = pad.getBoundingClientRect()
        const ev = (type: string, x: number, y: number, pr: number): void =>
          void pad.dispatchEvent(new PointerEvent(type, { pointerId: 77, pointerType: 'pen', isPrimary: true, clientX: r.left + x, clientY: r.top + y, pressure: pr, bubbles: true, cancelable: true, button: 0, buttons: type === 'pointerup' ? 0 : 1 }))
        ev('pointerdown', 40, 120, 0.4)
        for (let i = 1; i <= 30; i++) ev('pointermove', 40 + i * 10, 120 + Math.sin(i / 4) * 40, 0.3 + (i % 10) / 15)
        ev('pointerup', 340, 120, 0)
        await sleep(100)
        const d = pad.getContext('2d')!.getImageData(0, 0, pad.width, pad.height).data
        let a = 0
        for (let i = 3; i < d.length; i += 4) a += d[i]
        check('drawing pad paints with the real engine', a > 255 * 300, 'alpha=' + a)
        const strip = document.querySelector('.bs-pad canvas.strip') as HTMLCanvasElement
        const sd = strip.getContext('2d')!.getImageData(0, 0, strip.width, strip.height).data
        let sa = 0
        for (let i = 3; i < sd.length; i += 4) sa += sd[i]
        check('preview strip shows the stroke', sa > 255 * 200, 'alpha=' + sa)
      }
    }
    await window.brushwork?.selfTestShot('brushpad')
    const navBtns = Array.from(document.querySelectorAll('.bs-nav button')) as HTMLElement[]
    check('Brush Studio lists all sections', navBtns.length >= 14, 'sections=' + navBtns.length)
    let shot = 0
    for (const b of navBtns) {
      b.click()
      await sleep(60)
      if (++shot === 4 || shot === 5) await window.brushwork?.selfTestShot('brushstudio' + shot)
    }
    check('no GL error in Brush Studio', gl.getError() === 0)
    ;(document.querySelector('.bs-head .bs-btn.primary') as HTMLElement | null)?.click()
    await sleep(100)
    check('Brush Studio closes on Done', !document.querySelector('.bs-win'))

    }

    // ---- montage of all shipped previews for visual review
    for (let part = 0; part * 48 < all.length && part < 3; part++) {
      const over = document.createElement('div')
      over.style.cssText = 'position:fixed;inset:44px 0 0 0;background:#1c1c1e;z-index:900;overflow:hidden;display:grid;grid-template-columns:repeat(4,1fr);gap:2px 10px;padding:6px;font:11px sans-serif;color:#aaa'
      for (const b of all.slice(part * 48, part * 48 + 48)) {
        const t = brushThumbnail(app, b as BrushPreset, 240, 44)
        const cell = document.createElement('div')
        cell.textContent = b.name
        if (t) {
          const c = document.createElement('canvas')
          c.width = 240
          c.height = 44
          c.getContext('2d')!.drawImage(t, 0, 0)
          cell.append(c)
        }
        over.append(cell)
      }
      document.body.append(over)
      await sleep(300)
      await window.brushwork?.selfTestShot('brushmontage' + part)
      over.remove()
    }
    pc.dispose()
    check('no GL error at end', gl.getError() === 0)
  } catch (e) {
    console.error('[brushtest] exception', e)
    ok = false
  }
  log(ok ? 'ALL PASS' : 'FAILURES')
  return ok
}
