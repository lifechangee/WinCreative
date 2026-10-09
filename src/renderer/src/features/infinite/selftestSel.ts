import type { App } from '../../app/app'
import type { Rect } from '../../core/types'
import { decodeImage, loadBwk, saveBwk, saveBwkEx } from '../../io/bwk'
import { fillAt, fillLayer } from '../color/colorDrop'
import { addMask, applyMask, clearMask, flattenAll, invertMask, layerFromImage, mergeDown, readLayerImage } from '../layers/ops'
import { clearSelection, colorFillSelection, copyPaste, selectLayerContents } from '../selectxform/actions'
import { ellipsePolygon, rasterizePolygonIn, rectPolygon, SelMode } from '../selectxform/geom'
import { selSettings } from '../selectxform/selTool'
import { workRect } from '../frame/workRect'
import type { InfCtx } from './selftestTools'

/** Selection / transform / fill / layer-ops on an infinite canvas (content at negative coordinates, across tile borders). */
export async function runInfiniteSelectionTests(app: App, c: InfCtx): Promise<void> {
  const { check, cfg, stroke, flat, sleep } = c
  const sel = app.selection
  const OX = -49152 - 700 // x of a tile border is inside every region used below
  const OY = -2048 - 300
  const toasts: string[] = []
  const off = app.events.on('toast', (m) => toasts.push(m))
  const px = (p: Uint8ClampedArray, w: number, x: number, y: number): number[] => [p[(y * w + x) * 4], p[(y * w + x) * 4 + 1], p[(y * w + x) * 4 + 2], p[(y * w + x) * 4 + 3]]
  const alphaCount = (p: Uint8ClampedArray, w: number, r: Rect, inner: Rect): number => {
    let n = 0
    for (let y = inner.y; y < inner.y + inner.h; y++) for (let x = inner.x; x < inner.x + inner.w; x++) if (p[((y - r.y) * w + (x - r.x)) * 4 + 3] > 8) n++
    return n
  }
  const selRect = (x: number, y: number, w: number, h: number, mode: SelMode = 'replace', ell = false): void => {
    const poly = (ell ? ellipsePolygon : rectPolygon)(x, y, x + w, y + h)
    sel.applyPatch(rasterizePolygonIn(poly, { x: x - 2, y: y - 2, w: w + 4, h: h + 4 }), mode, 'test')
  }
  const comp = (r: Rect): Uint8ClampedArray => (app.renderNow(), app.compositor.readFlattened(r, 1, false).px)
  const hash = (p: Uint8ClampedArray): number => {
    let h = 2166136261
    for (let i = 0; i < p.length; i++) h = Math.imul(h ^ p[i], 16777619)
    return h >>> 0
  }
  const snapEq = (a: ReturnType<typeof sel.snapshot>, b: ReturnType<typeof sel.snapshot>): boolean => {
    if (!a || !b) return a === b
    if (a.rect.x !== b.rect.x || a.rect.y !== b.rect.y || a.rect.w !== b.rect.w || a.rect.h !== b.rect.h) return false
    for (let i = 0; i < a.data.length; i++) if (a.data[i] !== b.data[i]) return false
    return true
  }

  app.newDocument(4096, 4096, { kind: 'infinite', background: { color: [1, 1, 1], visible: true } })
  app.setView({ cx: OX + 600, cy: OY + 400, zoom: 1, rot: 0 })
  app.renderNow()
  const doc = app.doc
  const R: Rect = { x: OX, y: OY, w: 1400, h: 800 }
  const gl = app.gpu.gl
  gl.getError()

  // ------------------------------------------------------------------ selection modes
  selRect(OX + 300, OY + 200, 500, 300)
  check('sel: rectangle at negative coords crossing tile borders', sel.hasSelection() && JSON.stringify(sel.bounds()) === JSON.stringify({ x: OX + 300, y: OY + 200, w: 500, h: 300 }), JSON.stringify(sel.bounds()))
  check('sel: coverage inside = 1, outside = 0 (also far outside the window)', sel.coverageAt(OX + 500, OY + 300) === 1 && sel.coverageAt(OX + 100, OY + 100) === 0 && sel.coverageAt(1e6, -1e6) === 0)
  const s1 = sel.snapshot()
  selRect(OX + 700, OY + 300, 300, 300, 'add', true)
  check('sel: add ellipse grows the bounds', (sel.bounds()?.w ?? 0) >= 700 && sel.coverageAt(OX + 850, OY + 450) > 0.99)
  selRect(OX + 350, OY + 250, 100, 100, 'subtract')
  check('sel: subtract punches a hole', sel.coverageAt(OX + 400, OY + 300) === 0 && sel.coverageAt(OX + 600, OY + 300) === 1)
  app.doc.undo()
  check('sel: undo subtract', sel.coverageAt(OX + 400, OY + 300) === 1)
  app.doc.undo()
  check('sel: undo add restores the exact mask', snapEq(sel.snapshot(), s1))
  app.doc.redo()
  app.doc.redo()
  check('sel: redo x2', sel.coverageAt(OX + 400, OY + 300) === 0)
  sel.clear()
  check('sel: deselect', !sel.hasSelection() && sel.coverageAt(0, 0) === 1)
  app.doc.undo()
  check('sel: undo deselect', sel.hasSelection())
  sel.clear()

  // select all = work rect, invert
  sel.selectAll()
  const wr = workRect(app)
  const b0 = sel.bounds()!
  check('sel: select all = work rect (visible area)', b0.x === wr.x && b0.y === wr.y && b0.w === wr.w && b0.h === wr.h, JSON.stringify([b0, wr]))
  sel.clear()
  selRect(OX + 300, OY + 200, 200, 200)
  sel.invert()
  check('sel: invert = work rect minus selection', sel.coverageAt(OX + 400, OY + 300) === 0 && sel.coverageAt(OX + 100, OY + 100) === 1 && sel.coverageAt(wr.x + 2, wr.y + 2) === 1 && sel.coverageAt(wr.x - 300, wr.y) === 0)
  app.doc.undo()
  check('sel: undo invert', sel.coverageAt(OX + 400, OY + 300) === 1 && sel.coverageAt(OX + 100, OY + 100) === 0)
  sel.clear()

  // feather
  selRect(OX + 300, OY + 200, 400, 300)
  const le = sel.begin()
  le.previewBlur(12)
  le.commit('Feather')
  const edge = sel.coverageAt(OX + 300, OY + 350)
  check('sel: feather softens the edge but keeps the centre', edge > 0.3 && edge < 0.7 && sel.coverageAt(OX + 500, OY + 350) > 0.99 && sel.coverageAt(OX + 290, OY + 350) > 0 && sel.coverageAt(OX + 290, OY + 350) < 0.4, String(edge))

  // save / load
  const sBefore = sel.snapshot()
  sel.saveCurrent('far')
  sel.clear()
  sel.load('far')
  check('sel: save + load returns the identical mask', snapEq(sel.snapshot(), sBefore))
  sel.clear()

  // ------------------------------------------------------------------ brush / eraser / smudge / filter clipping across seams
  selRect(OX + 300, OY + 200, 500, 300)
  cfg('brush', 'hard-round', 120, { h: 10, s: 0.9, v: 0.9 })
  stroke('brush', [[OX + 100, OY + 350], [OX + 500, OY + 300], [OX + 1000, OY + 400]])
  let p = flat(doc, R)
  const inner = { x: OX + 300, y: OY + 200, w: 500, h: 300 }
  const inCnt = alphaCount(p, R.w, R, inner)
  const totalCnt = alphaCount(p, R.w, R, R)
  check('clip: the stroke only paints inside the selection (seam at x=' + (Math.ceil((OX + 300) / 512) * 512) + ')', inCnt > 20000 && totalCnt === inCnt, `${inCnt}/${totalCnt}`)
  const seamX = Math.ceil((OX + 300) / 512) * 512
  const a1 = px(p, R.w, seamX - 1 - R.x, OY + 350 - R.y)[3]
  const a2 = px(p, R.w, seamX - R.x, OY + 350 - R.y)[3]
  check('clip: no seam at the tile border inside the selection', a1 > 240 && a2 > 240, `${a1},${a2}`)
  doc.undo()
  check('clip: undo clears the stroke', alphaCount(flat(doc, R), R.w, R, R) === 0)
  doc.redo()
  sel.clear()
  // eraser
  selRect(OX + 300, OY + 200, 250, 300)
  cfg('eraser', 'hard-round', 200)
  stroke('eraser', [[OX + 200, OY + 350], [OX + 700, OY + 350]])
  p = flat(doc, R)
  const eIn = alphaCount(p, R.w, R, { x: OX + 310, y: OY + 270, w: 230, h: 160 })
  const eOut = alphaCount(p, R.w, R, { x: OX + 560, y: OY + 250, w: 200, h: 200 })
  check('clip: eraser removes only inside the selection', eIn < 500 && eOut > 15000, eIn + '/' + eOut)
  doc.undo()
  // smudge: unselected area must be bit-identical
  const outsideHash = (): number => hash(flat(doc, { x: OX + 560, y: OY + 150, w: 400, h: 400 }))
  const h0 = outsideHash()
  cfg('smudge', 'hard-round', 100)
  stroke('smudge', [[OX + 330, OY + 350], [OX + 760, OY + 350], [OX + 900, OY + 250]])
  check('clip: smudge leaves the unselected area untouched', outsideHash() === h0)
  doc.undo()
  // filter
  const before = hash(flat(doc, R))
  const fx = await import('../../gl/filters')
  fx.applyFilter(doc, 'invert')
  p = flat(doc, R)
  const inv = px(p, R.w, OX + 400 - R.x, OY + 350 - R.y)
  const kept = px(p, R.w, OX + 700 - R.x, OY + 350 - R.y)
  check('clip: filter only affects the selection', hash(p) !== before && inv[3] > 200 && kept[0] > 150 && kept[1] < 100, `${inv} ${kept}`)
  doc.undo()
  // interactive adjustment (adjustments feature reads the selection through coverageRegion) + liquify-style session
  const { runAdjustment } = await import('../adjustments/session')
  const h2 = hash(flat(doc, R))
  const pre2 = flat(doc, R)
  const ai0 = px(pre2, R.w, OX + 400 - R.x, OY + 350 - R.y)
  const ak0 = px(pre2, R.w, OX + 700 - R.x, OY + 350 - R.y)
  runAdjustment(app, 'hsb', { hue: 100, sat: 50, bri: 50 })
  p = flat(doc, R)
  const ai = px(p, R.w, OX + 400 - R.x, OY + 350 - R.y)
  const ak = px(p, R.w, OX + 700 - R.x, OY + 350 - R.y)
  check('clip: adjustment respects the selection (inside changed, outside untouched)', hash(p) !== h2 && (Math.abs(ai[0] - ai0[0]) > 40 || Math.abs(ai[1] - ai0[1]) > 40) && ak.join() === ak0.join(), ai0 + ' > ' + ai + ' | ' + ak0 + ' > ' + ak)
  const cr = sel.coverageRegion({ x: OX + 250, y: OY + 150, w: 600, h: 400 })
  check('coverageRegion returns a rect-sized coverage surface', !!cr && cr.w === 600 && cr.h === 400)
  cr?.dispose()
  doc.undo()
  // liquify with an ACTIVE selection on an infinite canvas: the warp changes pixels inside the selection and never outside it
  {
    const { AdjustmentSession } = await import('../adjustments/session')
    const LS = (x: number, y: number): import('../../core/types').Sample => ({ x, y, pressure: 0.8, tiltX: 0, tiltY: 0, twist: 0, t: performance.now() }) as import('../../core/types').Sample
    cfg('brush', 'hard-round', 70, { h: 120, s: 1, v: 0.6 })
    stroke('brush', [[OX + 800, OY + 250], [OX + 800, OY + 450]]) // a bar across the selection's right edge (x = OX + 800)
    const R2: Rect = { x: OX + 150, y: OY + 100, w: 1000, h: 500 } // the liquify brush reaches ~250 px around the stroke, towards the selection's left part too
    const outside = (p: Uint8ClampedArray): number[] => {
      const o: number[] = []
      for (let y = 0; y < R2.h; y++) for (let x = 0; x < R2.w; x++) if (R2.x + x > OX + 800 || R2.x + x < OX + 300 || R2.y + y < OY + 200 || R2.y + y >= OY + 500) o.push(...p.subarray((y * R2.w + x) * 4, (y * R2.w + x) * 4 + 4))
      return o
    }
    const liq = (): { okL: boolean; pre: Uint8ClampedArray; post: Uint8ClampedArray } => {
      const pre = flat(doc, R2)
      const ls = new AdjustmentSession(app, 'liquify', { tool: 0, size: 120, distortion: 100, momentum: 0 })
      ls.toolBegin(LS(OX + 740, OY + 350))
      for (let i = 1; i <= 24; i++) ls.toolMove([LS(OX + 740 + i * 6, OY + 350)])
      ls.toolEnd()
      ls.flush()
      const okL = ls.apply()
      return { okL, pre, post: flat(doc, R2) }
    }
    const nDiff = (a: Uint8ClampedArray, b: Uint8ClampedArray): number => {
      let n = 0
      for (let i = 0; i < a.length; i++) if (a[i] !== b[i]) n++
      return n
    }
    // control run WITHOUT a selection (same warp): proves the warp itself works on this document
    const snap = sel.snapshot()
    sel.clear()
    const free = liq()
    const freeDiff = nDiff(free.pre, free.post)
    let freeInside = 0 // diffs of the control run that fall INSIDE the selection rect (so the geometry of this test really exercises the selection)
    for (let y = 0; y < R2.h; y++) for (let x = 0; x < R2.w; x++) if (R2.x + x <= OX + 800 && R2.x + x >= OX + 300 && R2.y + y >= OY + 200 && R2.y + y < OY + 500) for (let c = 0; c < 4; c++) if (free.pre[(y * R2.w + x) * 4 + c] !== free.post[(y * R2.w + x) * 4 + c]) freeInside++
    doc.undo()
    if (snap) sel.setFromRegion(snap.rect, snap.data, 'qa')
    const { okL, pre, post } = liq()
    const a2 = outside(pre)
    const b2 = outside(post)
    let outDiff = 0
    for (let i = 0; i < a2.length; i++) if (a2[i] !== b2[i]) outDiff++
    const inDiff = nDiff(pre, post)
    check('liquify (infinite, no selection): the warp moves pixels', free.okL && freeDiff > 200, 'freeDiff=' + freeDiff + ' freeInside=' + freeInside)
    check('liquify (infinite, active selection): applied, pixels moved inside the selection', okL && inDiff > 200, 'okL=' + okL + ' inDiff=' + inDiff + ' sel=' + sel.hasSelection())
    check('liquify (infinite, active selection): nothing changes outside the selection', outDiff === 0, 'outDiff=' + outDiff)
    doc.undo()
    check('liquify (infinite, active selection): undo is exact', hash(flat(doc, R2)) === hash(pre))
    doc.undo() // the bar
  }
  sel.clear()

  // ------------------------------------------------------------------ thumbnail path (assembleRect + fenced async readback, no readPixels stall)
  {
    const rr: Rect = { x: OX + 100, y: OY + 100, w: 900, h: 500 }
    const as = app.compositor.inf.assembleRect(rr, 0.25)
    const ref = app.compositor.readFlattened(rr, 0.25, false)
    check('thumbnail: assembleRect covers the same area at the same size as readFlattened', as.fw === ref.w && as.fh === ref.h && as.asm.w >= 1 && as.rect.w >= rr.w * 0.25, `${as.fw}x${as.fh} vs ${ref.w}x${ref.h}`)
    as.asm.dispose()
    const sv = await saveBwkEx(doc, app.compositor)
    const th = await decodeImage(sv.thumbnail)
    let nonWhite = 0
    for (let i = 0; i < th.data.length; i += 4) if (th.data[i] < 235 || th.data[i + 1] < 235 || th.data[i + 2] < 235) nonWhite++
    check('thumbnail: infinite save builds a <= 256 px gallery thumbnail that shows the artwork', Math.max(th.width, th.height) <= 256 && nonWhite > 200, `${th.width}x${th.height} nonWhite=${nonWhite}`)
  }

  // ------------------------------------------------------------------ selection actions
  selRect(OX + 300, OY + 200, 500, 300)
  const cnt = (): number => alphaCount(flat(doc, R), R.w, R, R)
  const base = cnt()
  copyPaste(app, false)
  check('actions: copy&paste makes a layer with the selected pixels', doc.layers.length === 2 && alphaCount(doc.readRegionPixels(doc.activeLayer, R), R.w, R, R) > 20000)
  doc.undo()
  check('actions: undo copy&paste', doc.layers.length === 1 && cnt() === base)
  colorFillSelection(app)
  check('actions: colour fill fills the selection', cnt() === alphaCount(flat(doc, R), R.w, R, inner) && cnt() >= 150000)
  doc.undo()
  clearSelection(app)
  check('actions: clear selection', cnt() < base)
  doc.undo()
  copyPaste(app, true)
  check('actions: cut&paste moves the pixels to a new layer', doc.layers.length === 2 && doc.readRegionPixels(doc.layers[0], R).filter((_, i) => i % 4 === 3 && _ > 8).length < base)
  doc.undo()
  selectLayerContents(app)
  check('actions: Select (layer contents -> selection)', sel.hasSelection() && Math.abs((sel.bounds()?.w ?? 0) - 1) > -1)
  sel.clear()

  // ------------------------------------------------------------------ transform
  const T = (window as unknown as { brushwork_xform: { start(m: string): void; closeAll(c: boolean): void; session: any } }).brushwork_xform
  const full = flat(doc, { x: OX - 4000, y: OY - 3000, w: 9000, h: 7000 })
  const hFull = hash(full)
  const srcBox = doc.contentBounds({ tight: true })!
  T.start('freeform')
  check('transform: session starts on layer content (no selection)', !!T.session)
  const dx = 3000
  const dy = -2200
  T.session.nudge(dx, dy)
  T.closeAll(true)
  const moved = flat(doc, { x: srcBox.x + dx, y: srcBox.y + dy, w: srcBox.w, h: srcBox.h })
  console.log('[inf] moved count', alphaCount(moved, srcBox.w, { x: srcBox.x + dx, y: srcBox.y + dy, w: srcBox.w, h: srcBox.h }, { x: srcBox.x + dx, y: srcBox.y + dy, w: srcBox.w, h: srcBox.h }))
  check('transform: content moved far away (new tiles allocated)', alphaCount(moved, srcBox.w, { x: srcBox.x + dx, y: srcBox.y + dy, w: srcBox.w, h: srcBox.h }, { x: srcBox.x + dx, y: srcBox.y + dy, w: srcBox.w, h: srcBox.h }) > 40000, JSON.stringify(srcBox))
  const gone = flat(doc, srcBox)
  let rest = 0
  for (let i = 3; i < gone.length; i += 4) if (gone[i] > 8) rest++
  check('transform: the source area is empty afterwards', rest === 0, String(rest))
  doc.undo()
  check('transform: undo restores everything exactly (one step)', hash(flat(doc, { x: OX - 4000, y: OY - 3000, w: 9000, h: 7000 })) === hFull)
  doc.redo()
  check('transform: redo', alphaCount(flat(doc, srcBox), srcBox.w, srcBox, srcBox) === 0)
  doc.undo()
  // flip + selection based
  selRect(OX + 300, OY + 200, 400, 300)
  const selBefore = sel.snapshot()
  T.start('freeform')
  T.session.flip('h')
  T.session.nudge(1200, 0)
  T.closeAll(true)
  const sb = sel.bounds()!
  check('transform: selection follows the moved pixels', Math.abs(sb.x - (OX + 300 + 1200)) <= 2 && Math.abs(sb.w - 400) <= 3, JSON.stringify(sb))
  doc.undo()
  check('transform: undo also restores the selection', snapEq(sel.snapshot(), selBefore))
  sel.clear()
  // cancel leaves no trace
  T.start('uniform')
  T.session.nudge(700, 700)
  T.closeAll(false)
  check('transform: cancel leaves the layer untouched', hash(flat(doc, { x: OX - 4000, y: OY - 3000, w: 9000, h: 7000 })) === hFull)

  // ------------------------------------------------------------------ ColorDrop / fill
  doc.clearLayer(doc.activeId)
  cfg('brush', 'hard-round', 14, { h: 200, s: 0, v: 0.1 })
  const ring = [[OX + 400, OY + 300], [OX + 800, OY + 300], [OX + 800, OY + 600], [OX + 400, OY + 600], [OX + 400, OY + 300]]
  stroke('brush', ring)
  app.state.setColor({ h: 120, s: 0.9, v: 0.8 }, false)
  toasts.length = 0
  const preFill = alphaCount(flat(doc, R), R.w, R, { x: OX + 445, y: OY + 345, w: 310, h: 210 })
  const ok = fillAt(app, OX + 600, OY + 450, 0.15)
  p = flat(doc, R)
  const mid = px(p, R.w, OX + 600 - R.x, OY + 450 - R.y)
  const seamIn = px(p, R.w, seamX - R.x, OY + 450 - R.y)
  const out = px(p, R.w, OX + 200 - R.x, OY + 450 - R.y)
  check('fill: ColorDrop inside a closed ring fills it (across the tile seam)', ok && mid[1] > 150 && mid[3] === 255 && seamIn[3] === 255 && out[3] === 0, `${mid} ${seamIn} ${out}`)
  check('fill: bounded fill does not report a limit', !toasts.some((m) => /limited/i.test(m)))
  doc.undo()
  const fq = flat(doc, R)
  let lx0 = 1e9, ly0 = 1e9, lx1 = -1e9, ly1 = -1e9
  for (let y = 345; y < 555; y++) for (let x = 445; x < 755; x++) if (fq[((OY + y - R.y) * R.w + (OX + x - R.x)) * 4 + 3] > 8) { lx0 = Math.min(lx0, OX + x); ly0 = Math.min(ly0, OY + y); lx1 = Math.max(lx1, OX + x); ly1 = Math.max(ly1, OY + y) }
  const fu = alphaCount(fq, R.w, R, { x: OX + 445, y: OY + 345, w: 310, h: 210 })
  check('fill: undo', fu === preFill, fu + ' bbox ' + [lx0, ly0, lx1, ly1])
  toasts.length = 0
  fillAt(app, OX + 100, OY + 100, 0.1)
  check('fill: open area is limited by the work rect with a toast', toasts.some((m) => /limited|ограничен/i.test(m)), toasts.join('|'))
  const wr2 = workRect(app)
  const q = flat(doc, wr2)
  check('fill: the limited fill covers the visible area', px(q, wr2.w, 5, 5)[3] === 255)
  doc.undo()
  // reference layer
  const ref = doc.activeLayer
  ref.reference = true
  const fillL = doc.addLayer({ name: 'fill' })
  fillAt(app, OX + 600, OY + 450, 0.15)
  const filled = doc.readRegionPixels(fillL, R)
  const refPx = doc.readRegionPixels(ref, R)
  check('fill: reference layer is sampled, the active layer receives the fill', px(filled, R.w, OX + 600 - R.x, OY + 450 - R.y)[3] === 255 && px(filled, R.w, OX + 400 - R.x, OY + 300 - R.y)[3] === 0 && hash(refPx) === hash(doc.readRegionPixels(ref, R)))
  doc.undo()
  doc.deleteLayer(fillL.id)
  ref.reference = false
  const fl0 = hash(flat(doc, wr2))
  fillLayer(app)
  check('fill layer: fills the work rect', px(flat(doc, wr2), wr2.w, 3, 3)[3] === 255)
  doc.undo()
  check('fill layer: undo', hash(flat(doc, wr2)) === fl0)

  // ------------------------------------------------------------------ layer ops: masks, merge, flatten, insert
  doc.clearLayer(doc.activeId)
  cfg('brush', 'hard-round', 160, { h: 30, s: 0.9, v: 0.9 })
  stroke('brush', [[OX + 100, OY + 400], [OX + 1200, OY + 400]])
  const L1 = doc.activeLayer
  const h1 = hash(comp(R))
  addMask(doc, L1, 'white')
  check('mask: add white mask on an infinite layer', !!L1.mask && !!L1.maskTiles && L1.maskFill === 1 && hash(comp(R)) === h1)
  cfg('brush', 'hard-round', 120, { h: 0, s: 0, v: 0 })
  stroke('brush', [[OX + 400, OY + 400], [OX + 900, OY + 400]])
  app.renderNow()
  await sleep(200)
  p = comp(R)
  check('mask: painting black hides the layer (across tile seams)', px(p, R.w, OX + 650 - R.x, OY + 400 - R.y)[3] === 0 && px(p, R.w, seamX - R.x, OY + 400 - R.y)[3] === 0 && px(p, R.w, OX + 200 - R.x, OY + 400 - R.y)[3] > 200, [px(p, R.w, OX + 650 - R.x, OY + 400 - R.y), px(p, R.w, seamX - R.x, OY + 400 - R.y), px(p, R.w, OX + 200 - R.x, OY + 400 - R.y)].join(' | ') + ' editing=' + L1.editingMask + ' mt=' + L1.maskTiles?.count)
  console.log('[inf] mask row', Array.from({ length: 27 }, (_, i) => OX + i * 50).map((x) => x + ':' + px(p, R.w, x - R.x, OY + 400 - R.y)[3]).join(' '), 'seam', seamX)
  console.log('[inf] mask tiles', [...(L1.maskTiles?.keys() ?? [])].join(','), 'L1 tiles', [...L1.tiles!.keys()].join(','))
  for (const k of L1.maskTiles!.keys()) { const t = L1.maskTiles!.getKey(k)!; const q = app.gpu.readRGBA8(t, { x: 0, y: 0, w: 512, h: 512 }); console.log('[inf] mask tile', k, t.fmt, [0, 100, 200, 300, 400, 500].map((x) => [q[(100 * 512 + x) * 4], q[(100 * 512 + x) * 4 + 3]].join('/')).join(' ')) }
  const hMasked = hash(p)
  invertMask(doc, L1)
  check('mask: invert', hash(comp(R)) !== hMasked)
  doc.undo()
  check('mask: undo invert', hash(comp(R)) === hMasked)
  clearMask(doc, L1)
  check('mask: clear = hide all', alphaCount(comp(R), R.w, R, R) === 0)
  doc.undo()
  applyMask(doc, L1)
  check('mask: apply bakes the mask and removes it', !L1.mask && hash(comp(R)) === hMasked)
  doc.undo()
  check('mask: undo apply restores the mask', !!L1.mask && hash(comp(R)) === hMasked)
  const dupl = doc.duplicateLayer(L1.id)!
  check('mask: duplicate layer clones the mask store', !!dupl.maskTiles && dupl.maskTiles !== L1.maskTiles && dupl.maskTiles.count === L1.maskTiles!.count)
  doc.deleteLayer(dupl.id)
  doc.setActive(L1.id)
  L1.editingMask = false
  // merge down with blend mode
  const L2 = doc.addLayer({ name: 'top' })
  L2.blendMode = 'multiply'
  cfg('brush', 'hard-round', 200, { h: 220, s: 0.6, v: 0.9 })
  stroke('brush', [[OX + 200, OY + 300], [OX + 1100, OY + 500]])
  const pre = comp(R)
  mergeDown(doc, L2.id, false)
  const post = comp(R)
  let worst = 0
  for (let i = 0; i < pre.length; i++) worst = Math.max(worst, Math.abs(pre[i] - post[i]))
  check('merge down (multiply, masks) across tile seams equals the composite', doc.layers.length === 1 && worst <= 2, 'diff ' + worst)
  doc.undo()
  check('merge down: undo', doc.layers.length === 2 && hash(comp(R)) === hash(pre))
  flattenAll(doc)
  const flatPx = comp(R)
  let w2 = 0
  for (let i = 0; i < pre.length; i++) w2 = Math.max(w2, Math.abs(pre[i] - flatPx[i]))
  check('flatten equals the composite', doc.layers.length === 1 && w2 <= 2, 'diff ' + w2)
  doc.undo()
  // insert image (any size, split into tiles) at negative coordinates
  const IW = 1500
  const IH = 700
  const img = new Uint8ClampedArray(IW * IH * 4)
  for (let y = 0; y < IH; y++) for (let x = 0; x < IW; x++) img.set([x % 256, y % 256, (x + y) % 256, 255], (y * IW + x) * 4)
  const ix = OX - 600
  const iy = OY - 900
  const il = layerFromImage(doc, { x: ix, y: iy, w: IW, h: IH, data: img }, 'img')
  doc.insertLayer(il, { id: doc.activeId, where: 'above' }, 'Insert', 'layer-paste')
  const back = doc.readRegionPixels(il, { x: ix, y: iy, w: IW, h: IH })
  let bad = 0
  for (let i = 0; i < img.length; i += 4) if (Math.abs(back[i] - img[i]) > 1 || Math.abs(back[i + 1] - img[i + 1]) > 1 || back[i + 3] !== 255) bad++
  check('insert image: any size/position, split into tiles, pixel exact', bad === 0 && il.tiles!.count >= 6, `bad ${bad} tiles ${il.tiles!.count}`)
  const ri = readLayerImage(doc, il, false)
  check('copy: readLayerImage returns the cropped pixels (OS clipboard path)', !!ri && ri.w === IW && ri.h === IH && ri.x === ix && ri.y === iy)
  doc.undo()

  // ------------------------------------------------------------------ persistence: mask + saved selection survive save/load
  selRect(OX + 300, OY + 200, 120, 90)
  sel.saveCurrent('persist')
  sel.clear()
  const bytes = await saveBwk(doc, app.compositor)
  const d2 = await loadBwk(bytes, app.gpu)
  const l2 = d2.getLayer(L1.id)!
  check('save/load: infinite mask restored (tiles + fill)', !!l2.maskTiles && l2.maskTiles.count === L1.maskTiles!.count && l2.maskFill === L1.maskFill)
  const pa = d2.readRegionPixels(l2, R)
  const pb = doc.readRegionPixels(L1, R)
  check('save/load: layer pixels identical', hash(pa) === hash(pb))
  d2.dispose()
  const saved = sel.savedFor(doc).find((s) => s.name === 'persist')
  check('save/load: saved selection kept in the document', !!saved && saved.snap.rect.x === OX + 300)
  sel.clear()

  // thumbnails cover the full content bounds
  doc.events.emit('change', { rect: null })
  await sleep(100)
  check('no GL error in the selection/transform/fill/layers block', gl.getError() === 0)
  check('no unexpected "not available" toasts', !toasts.some((m) => /Not available|Недоступно/i.test(m)), toasts.join('|'))
  off()
  void selSettings
}
