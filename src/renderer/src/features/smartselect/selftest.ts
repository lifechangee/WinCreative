import type { App } from '../../app/app'
import { iou } from './imgops'
import { makeScene, type SynthKind, type SynthScene } from './synth'
import { ss } from './settings'
import type { SmartSelect } from './smart'
import { runCutAction } from './cutout'

/** Smart selection self-test (BW_SS_TEST=1 electron .): real bundled model, real pipeline, synthetic scenes with ground truth. Offline. */
export async function runSmartSelectSelfTest(app: App, c: SmartSelect, log: (s: string) => void): Promise<boolean> {
  let ok = true
  const check = (name: string, cond: boolean, extra = ''): void => {
    log((cond ? 'PASS ' : 'FAIL ') + name + ' ' + extra)
    if (!cond) ok = false
  }
  const idle = async (ms = 120000): Promise<void> => {
    const t0 = performance.now()
    await new Promise((r) => setTimeout(r, 60))
    while ((c.busy || c.pending > 0) && performance.now() - t0 < ms) await new Promise((r) => setTimeout(r, 40))
  }
  const scene = (kind: SynthKind): SynthScene => {
    const s = makeScene(kind, 640, 480)
    app.newDocument(s.w, s.h)
    app.gpu.uploadRGBA8(app.doc.activeLayer.pixels, 0, 0, s.w, s.h, s.rgba)
    return s
  }
  const selIou = (s: SynthScene): number => (app.selection.data ? iou(app.selection.data, s.gt.map((v) => v * 255), 128) : 0)
  try {
    // ---- AI Fast (bundled MobileSAM) on a clean object
    ss.mode = 'fast'
    ss.combine = 'replace'
    ss.negative = false
    ss.ep = 'auto'
    c.engine.ep = 'auto'
    let s = scene('clean')
    c.activate()
    await idle()
    const t0 = performance.now()
    c.addPoint(s.cx, s.cy, 1)
    await idle()
    log(`INFO click->selection ${(performance.now() - t0).toFixed(0)} ms, ep=${c.engine.stats.ep}/${c.engine.stats.decEp}, load ${c.engine.stats.loadMs.toFixed(0)} ms, encode ${c.engine.stats.lastEncodeMs.toFixed(0)} ms, decode ${c.engine.stats.lastDecodeMs.toFixed(0)} ms`)
    check('fast: model loaded from the bundle', c.engine.loadedModel === 'fast')
    check('fast: click selects the object (IoU >= 0.95)', selIou(s) >= 0.95, 'iou=' + selIou(s).toFixed(4))
    // edge quality: soft alpha ramp present, not a hard staircase
    const d = app.selection.data!
    let mid = 0
    let full = 0
    for (let i = 0; i < d.length; i++) {
      if (d[i] > 12 && d[i] < 243) mid++
      if (d[i] >= 243) full++
    }
    check('fast: anti-aliased soft edge', mid > 300 && mid < full * 0.05, `mid=${mid} full=${full}`)
    // one undo step
    c.finishSession(true)
    check('session commits as a selection', app.selection.hasSelection())
    app.doc.undo()
    check('one undo removes the whole smart selection', !app.selection.hasSelection())
    app.doc.redo()
    check('redo restores it', app.selection.hasSelection() && selIou(s) >= 0.95)

    // ---- negative point removes area; box prompt
    app.selection.clear()
    c.addPoint(s.cx, s.cy, 1)
    await idle()
    const area1 = app.selection.data!.reduce((t, v) => t + v, 0)
    c.addPoint(s.cx + s.w * 0.2, s.cy, 0)
    await idle()
    const area2 = app.selection.data ? app.selection.data.reduce((t, v) => t + v, 0) : 0
    check('a negative point never grows the selection', area2 <= area1 * 1.001, `${area1} -> ${area2}`)
    c.finishSession(false)
    c.addBox({ x: s.cx - s.w * 0.3, y: s.cy - s.h * 0.34, w: s.w * 0.6, h: s.h * 0.68 })
    await idle()
    check('box prompt selects the object (IoU >= 0.93)', selIou(s) >= 0.93, 'iou=' + selIou(s).toFixed(4))
    c.finishSession(true)

    // ---- combine modes
    ss.combine = 'subtract'
    c.addPoint(s.cx, s.cy, 1)
    await idle()
    c.finishSession(true)
    check('subtract mode removes the object from the selection', !app.selection.hasSelection() || app.selection.data!.reduce((t, v) => t + v, 0) < area1 * 0.1)
    ss.combine = 'replace'
    app.selection.clear()

    // ---- other scenes
    for (const [kind, min] of [['textured', 0.93], ['lowContrast', 0.9], ['hair', 0.88]] as const) {
      s = scene(kind)
      c.viewRegion = null
      c.resample()
      await idle()
      c.addPoint(s.cx, s.cy, 1)
      await idle()
      check(`fast: ${kind} scene IoU >= ${min}`, selIou(s) >= min, 'iou=' + selIou(s).toFixed(4))
      c.finishSession(false)
    }

    // ---- picture that does not start at 0,0 (layer content bounds) and sampling every visible layer
    {
      const o = makeScene('clean', 640, 480)
      app.newDocument(1100, 900)
      app.gpu.uploadRGBA8(app.doc.activeLayer.pixels, 230, 170, o.w, o.h, o.rgba)
      c.resample()
      await idle()
      c.addPoint(230 + o.cx, 170 + o.cy, 1)
      await idle()
      const W = 1100
      const gtFull = new Uint8Array(W * 900)
      for (let y = 0; y < o.h; y++) for (let x = 0; x < o.w; x++) gtFull[(y + 170) * W + x + 230] = o.gt[y * o.w + x] * 255
      check('offset picture: IoU >= 0.95 (document-space rects)', !!app.selection.data && iou(app.selection.data, gtFull, 128) >= 0.95, 'iou=' + (app.selection.data ? iou(app.selection.data, gtFull, 128) : 0).toFixed(4))
      check('offset picture: nothing selected outside the picture', !!app.selection.data && app.selection.bounds()!.x >= 220 && app.selection.bounds()!.y >= 160)
      c.finishSession(false)
      ss.sample = 'all'
      c.resample()
      await idle()
      c.addPoint(230 + o.cx, 170 + o.cy, 1)
      await idle()
      check('sample all visible layers: IoU >= 0.95', !!app.selection.data && iou(app.selection.data, gtFull, 128) >= 0.95, 'iou=' + (app.selection.data ? iou(app.selection.data, gtFull, 128) : 0).toFixed(4))
      c.finishSession(false)
      ss.sample = 'layer'
      c.resample()
    }

    // ---- cut-out actions (clean scene, object selected)
    s = scene('clean')
    c.resample()
    await idle()
    c.addPoint(s.cx, s.cy, 1)
    await idle()
    c.finishSession(true)
    const doc = app.doc
    const srcLayer = doc.activeLayer
    const n0 = doc.layers.length
    const px = (l: typeof srcLayer, x: number, y: number): number[] => [...app.gpu.readRGBA8(l.pixels, { x: Math.round(x), y: Math.round(y), w: 1, h: 1 })]
    await runCutAction(app, c.engine, 'copy')
    check('copy to new layer: one new layer above', doc.layers.length === n0 + 1 && doc.activeLayer !== srcLayer)
    const nl = doc.activeLayer
    check('copy: object opaque inside, transparent outside', px(nl, s.cx, s.cy)[3] === 255 && px(nl, 5, 5)[3] === 0)
    check('copy: source untouched', px(srcLayer, s.cx, s.cy)[3] === 255)
    doc.undo()
    check('copy undone in a single step', doc.layers.length === n0)
    await runCutAction(app, c.engine, 'cut')
    check('cut: new layer + hole in the source', doc.layers.length === n0 + 1 && px(srcLayer, s.cx, s.cy)[3] < 5)
    doc.undo()
    check('cut undone in a single step', doc.layers.length === n0 && px(srcLayer, s.cx, s.cy)[3] === 255)
    await runCutAction(app, c.engine, 'removeBg')
    check('remove background adds a layer mask', !!srcLayer.mask && doc.layers.length === n0)
    doc.undo()
    check('remove background undone in a single step', !srcLayer.mask)
    await runCutAction(app, c.engine, 'copyObject')
    let clipBytes = 0
    try {
      const items = await navigator.clipboard.read()
      for (const it of items) if (it.types.includes('image/png')) clipBytes = (await it.getType('image/png')).size
    } catch (e) {
      log('INFO clipboard read: ' + e)
    }
    check('copy object puts a PNG on the OS clipboard', clipBytes > 1000, 'bytes=' + clipBytes)

    // ---- infinite canvas: picture far from the origin (negative coords, across tile borders), selection window, all cut-outs, undo / redo
    {
      const o = makeScene('clean', 640, 480)
      const ox = -3137
      const oy = -2101
      const inf = app.newDocument(2048, 2048, { kind: 'infinite' })
      const layer = inf.activeLayer
      const surf = app.gpu.surface(o.w, o.h, inf.format)
      app.gpu.uploadRGBA8(surf, 0, 0, o.w, o.h, o.rgba)
      inf.writeRegion(layer, { x: ox, y: oy, w: o.w, h: o.h }, surf)
      surf.dispose()
      app.setView({ ...app.view, cx: ox + o.cx, cy: oy + o.cy, zoom: 1 })
      c.resample()
      await idle()
      c.addPoint(ox + o.cx, oy + o.cy, 1)
      await idle()
      const sel = app.selection.readRect({ x: ox, y: oy, w: o.w, h: o.h })
      const gt = Uint8Array.from(o.gt, (v) => v * 255)
      check('infinite: click selects the object (IoU >= 0.95, far from the origin)', !!sel && iou(sel, gt, 128) >= 0.95, 'iou=' + (sel ? iou(sel, gt, 128) : 0).toFixed(4))
      check('infinite: selection bounds are in document space', !!app.selection.bounds() && app.selection.bounds()!.x < -2000 && app.selection.bounds()!.y < -1500)
      c.finishSession(true)
      const layers0 = inf.layers.length
      const alphaAt = (l: typeof layer, x: number, y: number): number => inf.readRegionPixels(l, { x: Math.round(x), y: Math.round(y), w: 1, h: 1 })[3]
      await runCutAction(app, c.engine, 'copy')
      const cp = inf.activeLayer
      check('infinite: copy to new layer', inf.layers.length === layers0 + 1 && alphaAt(cp, ox + o.cx, oy + o.cy) === 255 && alphaAt(cp, ox + 3, oy + 3) === 0)
      inf.undo()
      check('infinite: copy undone in one step', inf.layers.length === layers0)
      inf.redo()
      check('infinite: copy redone', inf.layers.length === layers0 + 1 && alphaAt(inf.activeLayer, ox + o.cx, oy + o.cy) === 255)
      inf.undo()
      inf.setActive(layer.id)
      await runCutAction(app, c.engine, 'cut')
      check('infinite: cut leaves a hole and a new layer', inf.layers.length === layers0 + 1 && alphaAt(layer, ox + o.cx, oy + o.cy) < 5)
      inf.undo()
      check('infinite: cut undone in one step', inf.layers.length === layers0 && alphaAt(layer, ox + o.cx, oy + o.cy) === 255)
      inf.setActive(layer.id)
      await runCutAction(app, c.engine, 'removeBg')
      check('infinite: remove background adds a layer mask', !!layer.mask)
      inf.undo()
      check('infinite: remove background undone', !layer.mask)
      await runCutAction(app, c.engine, 'copyObject')
      let cb = 0
      try {
        for (const it of await navigator.clipboard.read()) if (it.types.includes('image/png')) cb = (await it.getType('image/png')).size
      } catch (e) {
        log('INFO clipboard read: ' + e)
      }
      check('infinite: copy object to the clipboard', cb > 1000, 'bytes=' + cb)
      app.selection.clear()
    }

    // ---- AI model switch is not needed offline; Brush mode
    app.selection.clear()
    s = scene('textured')
    c.setMode('brush')
    ss.brushSize = 24
    c.activate()
    await c.brushStrokeDone({ pts: [{ x: s.cx - 60, y: s.cy }, { x: s.cx + 60, y: s.cy + 10 }, { x: s.cx, y: s.cy - 40 }], radii: [8, 8, 8], label: 1 })
    await idle()
    check('brush: grows to the object edge (IoU >= 0.93)', selIou(s) >= 0.93, 'iou=' + selIou(s).toFixed(4))
    c.finishSession(true)

    // ---- idle behaviour: closing the tool frees the models and the workers
    c.deactivate(true)
    check('model stays loaded right after closing (quick re-open)', c.engine.active)
    c.engine.idleMinutes = 0.02 // 1.2 s
    await new Promise((r) => setTimeout(r, 2500))
    check('idle timeout frees the model and every worker', !c.engine.active && c.engine.state === 'unloaded')
    c.engine.idleMinutes = 5
    ss.mode = 'fast'
  } catch (e) {
    check('self-test exception', false, String((e as Error)?.stack ?? e))
  }
  return ok
}
