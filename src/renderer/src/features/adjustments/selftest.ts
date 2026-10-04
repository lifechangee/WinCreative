import type { App } from '../../app/app'
import { Document } from '../../doc/document'
import type { Sample } from '../../core/types'
import { ADJUSTMENTS } from './defs'
import { runAdjustment, AdjustmentSession } from './session'
import type { Params } from './types'

const S = (x: number, y: number, p = 0.8): Sample => ({ x, y, pressure: p, tiltX: 0, tiltY: 0, twist: 0, t: performance.now() })

/** Synchronous smoke test on a private 256x256 document: every adjustment must change pixels, be undoable and raise no GL error. */
export function runAdjustmentsSelfTest(app: App): { ok: boolean; failures: string[] } {
  const failures: string[] = []
  const gl = app.gpu.gl
  const check = (name: string, cond: boolean, extra = ''): void => {
    console.log('[adjselftest]', cond ? 'PASS' : 'FAIL', name, extra)
    if (!cond) failures.push(name)
  }
  const saved = app.doc
  const W = 256
  const doc = Document.create(app.gpu, W, W, { background: { color: [1, 1, 1], visible: true } })
  app.doc = doc
  try {
    gl.getError()
    // test image: colourful gradient + a bright disc + transparent border
    const img = new Uint8ClampedArray(W * W * 4)
    for (let y = 0; y < W; y++)
      for (let x = 0; x < W; x++) {
        const i = (y * W + x) * 4
        const inside = x > 16 && x < W - 16 && y > 16 && y < W - 16
        const d = Math.hypot(x - 128, y - 128)
        img[i] = d < 50 ? 250 : (x / W) * 255
        img[i + 1] = d < 50 ? 245 : (y / W) * 200 + 30
        img[i + 2] = d < 50 ? 230 : 255 - (x / W) * 200
        img[i + 3] = inside ? 255 : 0
      }
    const fill = (): void => app.gpu.uploadRGBA8(doc.activeLayer.surface, 0, 0, W, W, img)
    const read = (): Uint8ClampedArray => app.gpu.readRGBA8(doc.activeLayer.surface, { x: 0, y: 0, w: W, h: W })
    const diff = (a: Uint8ClampedArray, b: Uint8ClampedArray): number => {
      let s = 0
      for (let i = 0; i < a.length; i++) s += Math.abs(a[i] - b[i])
      return s / a.length
    }
    const maxd = (a: Uint8ClampedArray, b: Uint8ClampedArray): number => {
      let m = 0
      for (let i = 0; i < a.length; i++) m = Math.max(m, Math.abs(a[i] - b[i]))
      return m
    }
    const commits: string[] = []
    doc.events.on('commit', (e) => commits.push(e.type))

    const strong: Record<string, Params> = {
      hsb: { hue: 80, sat: 90, bri: 60 },
      colorBalance: { miCR: 80, miYB: -60, shCR: 50, hiMG: 40 },
      gradientMap: { amount: 100 },
      recolor: { amount: 100, color: 0x2c41e8 },
      gaussian: { radius: 30 },
      motion: { amount: 40, angle: 30 },
      perspective: { amount: 60, mode: 0, px: 0.5, py: 0.5 },
      noise: { amount: 60 },
      sharpen: { amount: 100, radius: 30 },
      bloom: { transition: 40, size: 40, opacity: 90, burn: 40 },
      glitch: { amount: 80, distance: 60 },
      halftone: { size: 30 },
      chromatic: { amount: 80, distance: 80 }
    }
    for (const def of ADJUSTMENTS) {
      if (def.custom === 'liquify' || def.custom === 'clone') continue
      const variants: Params[] =
        def.id === 'glitch'
          ? [0, 1, 2, 3, 4, 5].map((t) => ({ ...strong.glitch, type: t }))
          : def.id === 'halftone'
            ? [0, 1, 2].map((t) => ({ ...strong.halftone, type: t }))
            : def.id === 'noise'
              ? [0, 1, 2, 3].map((t) => ({ ...strong.noise, type: t }))
              : def.id === 'chromatic'
                ? [0, 1].map((m) => ({ ...strong.chromatic, mode: m }))
                : def.id === 'perspective'
                  ? [0, 1].map((m) => ({ ...strong.perspective, mode: m }))
                  : [strong[def.id] ?? {}]
      for (const [vi, p] of variants.entries()) {
        fill()
        const before = read()
        const n = doc.history.undoCount
        const extra =
          def.id === 'curves'
            ? {
                curves: {
                  master: [[0, 0], [0.5, 0.25], [1, 1]] as [number, number][],
                  r: [[0, 0], [1, 1]] as [number, number][],
                  g: [[0, 0], [1, 1]] as [number, number][],
                  b: [[0, 0], [1, 0.6]] as [number, number][]
                }
              }
            : undefined
        const ok = runAdjustment(app, def.id, p, extra)
        const after = read()
        const d = diff(before, after)
        const tag = def.id + (variants.length > 1 ? '#' + vi : '')
        check(`${tag} applies`, ok && d > 0.05, `meanDiff=${d.toFixed(3)}`)
        check(`${tag} one undo step`, doc.history.undoCount === n + 1)
        doc.undo()
        check(`${tag} undo exact`, diff(before, read()) < 0.01)
        check(`${tag} no GL error`, gl.getError() === 0)
      }
    }
    check('filter commit events', commits.filter((c) => c === 'filter').length >= 20, String(commits.length))

    // Layer-mode drag: horizontal drag changes the main value
    fill()
    {
      const orig0 = read()
      const s = new AdjustmentSession(app, 'gaussian')
      const r0 = s.params.radius
      s.dragBegin(100)
      s.dragMove(300)
      s.dragEnd()
      check('drag changes main value', s.params.radius !== r0, `${r0} -> ${s.params.radius}`)
      s.flush()
      check('live preview differs from original', diff(read(), orig0) > 0.05)
      s.setPreview(false)
      s.flush()
      check('preview off shows original', diff(read(), app.gpu.readRGBA8(s.orig, { x: 0, y: 0, w: W, h: W })) < 0.01)
      s.setPreview(true)
      s.undo()
      check('session undo restores value', s.params.radius === r0)
      s.cancel()
      check('cancel restores pixels', diff(orig0, read()) < 0.01)
      check('cancel adds no history', doc.history.undoCount === 0)
    }

    // Pencil mode: only painted region changes
    fill()
    {
      const before = read()
      const s = new AdjustmentSession(app, 'hsb', { hue: 90, sat: 50, bri: 50 })
      s.setMode('pencil')
      s.flush()
      check('pencil: nothing changes before painting', diff(read(), before) < 0.01)
      app.state.setTool('brush')
      app.state.setSize(40)
      s.toolBegin(S(100, 128))
      for (let i = 1; i <= 20; i++) s.toolMove([S(100 + i * 3, 128)])
      s.toolEnd()
      s.flush()
      const painted = read()
      const px = (a: Uint8ClampedArray, x: number, y: number): number[] => Array.from(a.slice((y * W + x) * 4, (y * W + x) * 4 + 3))
      check('pencil: painted spot changed', Math.abs(px(painted, 130, 128)[0] - px(before, 130, 128)[0]) + Math.abs(px(painted, 130, 128)[2] - px(before, 130, 128)[2]) > 10)
      check('pencil: far spot unchanged', px(painted, 40, 40).every((v, i) => v === px(before, 40, 40)[i]))
      s.undo()
      s.flush()
      check('pencil: session undo removes stroke', diff(read(), before) < 0.01)
      s.toolBegin(S(60, 60))
      for (let i = 1; i <= 10; i++) s.toolMove([S(60 + i * 4, 60)])
      s.toolEnd()
      const n = doc.history.undoCount
      check('pencil apply', s.apply())
      check('pencil apply is one undo step', doc.history.undoCount === n + 1)
      doc.undo()
      check('pencil undo exact', diff(read(), before) < 0.01)
    }

    // Liquify
    fill()
    {
      const before = read()
      const s = new AdjustmentSession(app, 'liquify', { tool: 0, size: 70, distortion: 100, momentum: 0 })
      s.toolBegin(S(100, 128))
      for (let i = 1; i <= 20; i++) s.toolMove([S(100 + i * 3, 128)])
      s.toolEnd()
      s.flush()
      check('liquify warps pixels', diff(read(), before) > 0.05 && maxd(read(), before) > 40, diff(read(), before).toFixed(3) + ' max=' + maxd(read(), before))
      for (const t of [1, 2, 3, 4, 5, 6, 7]) {
        s.params.tool = t
        s.toolBegin(S(128, 128))
        s.toolMove([S(130, 128)])
        s.toolEnd()
      }
      s.flush()
      check('liquify all tools no GL error', gl.getError() === 0)
      s.reset()
      s.flush()
      check('liquify reset restores', diff(read(), before) < 0.01)
      s.undo()
      s.flush()
      check('liquify undo of reset', maxd(read(), before) > 40)
      const ok = s.apply()
      check('liquify apply', ok)
      doc.undo()
      check('liquify undo exact', diff(read(), before) < 0.01)
    }

    // Clone
    fill()
    {
      const before = read()
      const s = new AdjustmentSession(app, 'clone')
      const t = s.tool as unknown as { setSource(x: number, y: number): void }
      check('clone needs source', s.toolBegin(S(200, 200)) === false)
      t.setSource(128, 128)
      s.toolBegin(S(40, 40))
      for (let i = 1; i <= 15; i++) s.toolMove([S(40 + i * 2, 40)])
      s.toolEnd()
      s.flush()
      const after = read()
      const pxi = (44 * W + 40) * 4
      check('clone copies source pixels', Math.abs(after[pxi] - before[pxi]) + Math.abs(after[pxi + 2] - before[pxi + 2]) > 10)
      check('clone apply', s.apply())
      doc.undo()
      check('clone undo exact', diff(read(), before) < 0.01)
    }
    check('no GL error (final)', gl.getError() === 0)
  } catch (e) {
    console.error('[adjselftest] exception', e)
    failures.push('exception ' + String(e))
  } finally {
    app.doc = saved
    doc.dispose()
  }
  console.log('[adjselftest] DONE', failures.length ? 'FAILURES: ' + failures.join(', ') : 'all passed')
  return { ok: failures.length === 0, failures }
}
