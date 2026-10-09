import type { App } from '../../app/app'
import type { Document } from '../../doc/document'
import type { Rect, Sample } from '../../core/types'
import { loadBwk, saveBwk } from '../../io/bwk'
import { AdjustmentSession, runAdjustment } from '../adjustments/session'
import { applyFilter } from '../../gl/filters'
import { workRect } from '../frame/workRect'

export interface InfCtx {
  check(name: string, cond: boolean, extra?: string): void
  cfg(tool: 'brush' | 'smudge' | 'eraser', preset: string, size: number, hsv?: { h: number; s: number; v: number }): void
  stroke(tool: 'brush' | 'smudge' | 'eraser', pts: number[][]): void
  flat(doc: Document, r: Rect): Uint8ClampedArray
  sleep(ms: number): Promise<void>
}

const sm = (x: number, y: number, p = 0.7): Sample => ({ x, y, pressure: p, tiltX: 0, tiltY: 0, twist: 0, t: 0 }) as Sample

/** mean and max premultiplied 8-bit difference inside `inset` px of the borders */
function cmp(a: Uint8ClampedArray, b: Uint8ClampedArray, w: number, h: number, inset: number): { mean: number; max: number } {
  let sum = 0
  let max = 0
  let n = 0
  for (let y = inset; y < h - inset; y++)
    for (let x = inset; x < w - inset; x++) {
      const i = (y * w + x) * 4
      let d = Math.abs(a[i + 3] - b[i + 3])
      for (let c = 0; c < 3; c++) d = Math.max(d, Math.abs((a[i + c] * a[i + 3]) / 255 - (b[i + c] * b[i + 3]) / 255))
      sum += d
      n++
      if (d > max) max = d
    }
  return { mean: sum / Math.max(1, n), max }
}
const opaqueCount = (px: Uint8ClampedArray): number => {
  let n = 0
  for (let i = 3; i < px.length; i += 4) if (px[i] > 8) n++
  return n
}

/** Adjustments / liquify / clone / text / guides on an infinite canvas (content far from the origin, across tile borders). */
export async function runInfiniteToolsTests(app: App, c: InfCtx): Promise<void> {
  const { check, cfg, stroke, flat } = c
  const OFF = 49152 + 300 // content straddles tile borders (x and y multiples of 512 fall inside)
  const content = (ox: number, oy: number, W: number, H: number): void => {
    cfg('brush', 'hard-round', 90, { h: 20, s: 0.9, v: 0.9 })
    stroke('brush', [[ox + W * 0.1, oy + H * 0.3], [ox + W * 0.5, oy + H * 0.7], [ox + W * 0.9, oy + H * 0.3]])
    cfg('brush', 'hard-round', 60, { h: 200, s: 0.8, v: 0.7 })
    stroke('brush', [[ox + W * 0.2, oy + H * 0.8], [ox + W * 0.5, oy + H * 0.2], [ox + W * 0.8, oy + H * 0.8]])
  }
  const events: string[] = []

  // ------------------------------------------------------------------ interactive adjustments: fixed vs infinite
  app.newDocument(4096, 4096, { kind: 'infinite' })
  app.setView({ cx: OFF, cy: OFF, zoom: 1, rot: 0 })
  app.renderNow()
  const vr = workRect(app)
  check('workRect on an infinite document is the visible area', vr.w > 100 && vr.h > 100 && vr.x < OFF && vr.x + vr.w > OFF, JSON.stringify(vr))
  const W = vr.w
  const H = vr.h
  const cases: [string, Record<string, number>, number][] = [
    ['hsb', { hue: 70, sat: 80, bri: 60 }, 0],
    ['colorBalance', { miCR: 40, miYB: -30, shMG: 20 }, 0],
    ['curves', {}, 0],
    ['gradientMap', { amount: 90 }, 0],
    ['recolor', { amount: 80 }, 0],
    ['gaussian', { radius: 6 }, 90],
    ['motion', { amount: 20, angle: 30 }, 130],
    ['perspective', { amount: 40 }, 0],
    ['noise', { amount: 40, type: 3 }, 0],
    ['sharpen', { amount: 60, radius: 20 }, 40],
    ['bloom', { opacity: 70, size: 10 }, 120],
    ['glitch', { type: 1, amount: 50 }, 0],
    ['halftone', { size: 40 }, 0],
    ['chromatic', { amount: 60 }, 0]
  ]
  for (const [id, params, inset] of cases) {
    // reference: same content on a fixed document whose size equals the infinite work area
    app.newDocument(W, H, { format: 'rgba8', background: { color: [1, 1, 1], visible: false } })
    content(0, 0, W, H)
    runAdjustment(app, id, params)
    const ref = flat(app.doc, { x: 0, y: 0, w: W, h: H })
    app.newDocument(4096, 4096, { kind: 'infinite' })
    const cx = vr.x
    const cy = vr.y
    app.setView({ cx: OFF, cy: OFF, zoom: 1, rot: 0 })
    app.renderNow()
    const wr = workRect(app)
    content(cx, cy, W, H)
    const doc = app.doc
    const nHist = doc.history.undoCount
    const before = flat(doc, { x: cx, y: cy, w: W, h: H })
    const off = doc.events.on('commit', (e) => events.push(e.type))
    const ok = runAdjustment(app, id, params)
    off()
    const after = flat(doc, { x: cx, y: cy, w: W, h: H })
    // the infinite work rect is the view (larger than the content): compare the content area, away from the work rect border
    const d = cmp(ref, after, W, H, inset)
    const changed = cmp(before, after, W, H, 0).mean > 0.05 || id === 'curves'
    check(`infinite adjustment '${id}' equals the fixed canvas result`, ok && d.mean < (inset ? 1.5 : 0.6) && d.max < (inset ? 40 : 20) && changed, `mean=${d.mean.toFixed(3)} max=${d.max} work=${wr.w}x${wr.h}`)
    check(`'${id}' is ONE undo step with a filter commit event`, doc.history.undoCount === nHist + 1 && events.includes('filter'))
    doc.undo()
    check(`'${id}' undo restores the pixels`, cmp(before, flat(doc, { x: cx, y: cy, w: W, h: H }), W, H, 0).max === 0)
    events.length = 0
  }

  // ------------------------------------------------------------------ blur continuity across a tile border
  app.newDocument(4096, 4096, { kind: 'infinite' })
  app.setView({ cx: OFF, cy: OFF, zoom: 1, rot: 0 })
  app.renderNow()
  {
    // one hard vertical edge exactly on the tile border x = k*512, blurred: the profile must be a smooth ramp (no step at the border)
    const bx = Math.floor(OFF / 512) * 512
    cfg('brush', 'hard-round', 300, { h: 0, s: 0, v: 0 })
    stroke('brush', [[bx - 400, OFF - 100], [bx - 100, OFF], [bx - 400, OFF + 100]])
    stroke('brush', [[bx - 100, OFF - 100], [bx - 100, OFF + 100]])
    runAdjustment(app, 'gaussian', { radius: 12 })
    const row = flat(app.doc, { x: bx - 40, y: OFF, w: 80, h: 1 })
    let worst = 0
    for (let i = 1; i < 80; i++) worst = Math.max(worst, Math.abs(row[i * 4 + 3] - row[(i - 1) * 4 + 3]))
    const st = (i: number): number => row[(i + 1) * 4 + 3] - row[i * 4 + 3]
    const bump = Math.abs(st(40) - (st(37) + st(43)) / 2)
    check('gaussian blur is continuous across a tile border', bump < 4 && worst > 0, `step bump ${bump}, max step ${worst}`)
  }

  // ------------------------------------------------------------------ pixel-local adjustment covers EVERY tile; preview limited to the view
  {
    app.newDocument(4096, 4096, { kind: 'infinite' })
    app.setView({ cx: 0, cy: 0, zoom: 1, rot: 0 })
    app.renderNow()
    cfg('brush', 'hard-round', 120, { h: 0, s: 1, v: 1 }) // red
    stroke('brush', [[-100, -100], [100, 100]])
    stroke('brush', [[90000, 90000], [90200, 90100]])
    stroke('brush', [[-70000, 50000], [-70200, 50100]])
    const doc = app.doc
    const nHist = doc.history.undoCount
    const far = (): number[] => Array.from(doc.readRegionPixels(doc.activeLayer, { x: 90100, y: 90050, w: 1, h: 1 }))
    const was = far()
    const s = new AdjustmentSession(app, 'hsb', { hue: 80, sat: 50, bri: 50 })
    check('hsb session on an infinite canvas limits the preview and says so', s.limit === 'viewAll')
    const farPreview = far()
    const ok = s.apply()
    const now = far()
    check('hsb Apply recolours tiles far outside the view', ok && now[3] > 200 && (Math.abs(now[0] - was[0]) > 60 || Math.abs(now[1] - was[1]) > 60) && farPreview[0] === was[0], `${was} -> ${now}`)
    check('hsb whole-layer apply is one undo step', doc.history.undoCount === nHist + 1)
    doc.undo()
    check('hsb whole-layer undo restores far tiles', far().join() === was.join())
    applyFilter(doc, 'invert')
    const inv = far()
    check('invert covers every tile of an infinite layer', inv[3] > 200 && Math.abs(inv[0] - was[0]) > 100, `${was} -> ${inv}`)
    doc.undo()
  }

  // ------------------------------------------------------------------ Pencil mode (brush-painted coverage)
  {
    app.newDocument(4096, 4096, { kind: 'infinite' })
    app.setView({ cx: OFF, cy: OFF, zoom: 1, rot: 0 })
    app.renderNow()
    cfg('brush', 'hard-round', 400, { h: 0, s: 1, v: 1 })
    stroke('brush', [[OFF - 300, OFF], [OFF + 300, OFF]])
    const doc = app.doc
    const px = (x: number): number[] => Array.from(doc.readRegionPixels(doc.activeLayer, { x, y: OFF, w: 1, h: 1 }))
    const l = px(OFF - 200)
    const r = px(OFF + 200)
    const s = new AdjustmentSession(app, 'hsb', { hue: 80, sat: 50, bri: 50 })
    s.setMode('pencil')
    cfg('brush', 'hard-round', 120, { h: 0, s: 0, v: 0 })
    app.state.setTool('brush')
    s.toolBegin(sm(OFF + 150, OFF))
    s.toolMove([sm(OFF + 200, OFF), sm(OFF + 250, OFF)])
    s.toolEnd()
    const ok = s.apply()
    const l2 = px(OFF - 200)
    const r2 = px(OFF + 200)
    check('pencil mode changes only the painted part', ok && l2.join() === l.join() && r2.join() !== r.join(), `${r} -> ${r2}`)
    doc.undo()
    check('pencil-mode apply is undoable', px(OFF + 200).join() === r.join())
  }

  // ------------------------------------------------------------------ liquify + clone
  {
    app.newDocument(4096, 4096, { kind: 'infinite' })
    app.setView({ cx: OFF, cy: OFF, zoom: 1, rot: 0 })
    app.renderNow()
    cfg('brush', 'hard-round', 100, { h: 0, s: 1, v: 1 })
    stroke('brush', [[OFF - 150, OFF], [OFF + 150, OFF]])
    const doc = app.doc
    const R: Rect = { x: OFF - 300, y: OFF - 200, w: 600, h: 400 }
    const before = flat(doc, R)
    const s = new AdjustmentSession(app, 'liquify', { tool: 0, size: 40, distortion: 100, pressure: 0, momentum: 0 })
    s.toolBegin(sm(OFF - 60, OFF, 1))
    s.toolMove([sm(OFF - 40, OFF + 40, 1), sm(OFF - 20, OFF + 80, 1), sm(OFF, OFF + 120, 1)])
    s.toolEnd()
    const ok = s.apply()
    const after = flat(doc, R)
    check('liquify works on an infinite canvas (pixels move)', ok && cmp(before, after, R.w, R.h, 0).max > 30)
    doc.undo()
    check('liquify undo is exact', cmp(before, flat(doc, R), R.w, R.h, 0).max === 0)

    // clone: source on the red bar, paint onto empty space 300 px below
    const cs = new AdjustmentSession(app, 'clone', { aligned: 1 })
    cfg('brush', 'hard-round', 80, { h: 0, s: 0, v: 0 })
    app.state.setTool('brush')
    cs.setCloneSource(OFF, OFF)
    const began = cs.toolBegin(sm(OFF, OFF + 300))
    cs.toolMove([sm(OFF + 30, OFF + 300), sm(OFF + 60, OFF + 300)])
    cs.toolEnd()
    const dbg = `began=${began} dirty=${cs.hasEffect} src=${JSON.stringify((cs.tool as any)?.source)} rect=${JSON.stringify(cs.rect)}`
    const cok = cs.apply()
    const p = Array.from(doc.readRegionPixels(doc.activeLayer, { x: OFF + 20, y: OFF + 300, w: 1, h: 1 }))
    check('clone paints the copied pixels onto empty infinite space', cok && p[3] > 200 && p[0] > 150 && p[1] < 80, String(p) + ' ' + dbg)
    doc.undo()
    check('clone undo removes the painted pixels', doc.readRegionPixels(doc.activeLayer, { x: OFF + 20, y: OFF + 300, w: 1, h: 1 })[3] === 0)
    {
      // the same clone on a fixed canvas must keep its result after Apply too
      app.newDocument(1200, 800, { format: 'rgba8' })
      cfg('brush', 'hard-round', 100, { h: 0, s: 1, v: 1 })
      stroke('brush', [[400, 300], [700, 300]])
      const fs = new AdjustmentSession(app, 'clone', { aligned: 1 })
      cfg('brush', 'hard-round', 80, { h: 0, s: 0, v: 0 })
      app.state.setTool('brush')
      fs.setCloneSource(400, 300)
      fs.toolBegin(sm(400, 600))
      fs.toolMove([sm(430, 600), sm(460, 600)])
      fs.toolEnd()
      fs.apply()
      const q = Array.from(app.doc.readRegionPixels(app.doc.activeLayer, { x: 420, y: 600, w: 1, h: 1 }))
      check('clone keeps its result after Apply (fixed canvas)', q[3] > 200 && q[0] > 150, String(q))
    }
  }

  // ------------------------------------------------------------------ text
  {
    app.newDocument(4096, 4096, { kind: 'infinite' })
    const TX = 70000
    const TY = -30000
    app.setView({ cx: TX, cy: TY, zoom: 1, rot: 0 })
    app.renderNow()
    const tm = (app as unknown as { textLayers: { addText(t?: string): void; mutate(id: string, fn: (t: any) => void): void; flush(): void; stopEditing(): void; isText(id: string): boolean; get(id: string): any } }).textLayers
    tm.addText('Hello infinite')
    tm.stopEditing()
    const doc = app.doc
    const id = doc.activeId
    const area: Rect = { x: TX - 400, y: TY - 200, w: 800, h: 400 }
    const n0 = opaqueCount(doc.readRegionPixels(doc.activeLayer, area))
    check('text is rasterised into tiles far from the origin', tm.isText(id) && n0 > 200, String(n0))
    tm.mutate(id, (t) => {
      t.x += 3000
      t.y += 1500
    })
    tm.flush()
    const n1 = opaqueCount(doc.readRegionPixels(doc.activeLayer, area))
    const moved: Rect = { x: area.x + 3000, y: area.y + 1500, w: 800, h: 400 }
    const n2 = opaqueCount(doc.readRegionPixels(doc.activeLayer, moved))
    check('moving text clears the old pixels and draws the new ones', n1 === 0 && n2 > 200, `${n1} ${n2}`)
    const bytes = await saveBwk(doc, app.compositor)
    const d2 = await loadBwk(bytes, app.gpu)
    const n3 = opaqueCount(d2.readRegionPixels(d2.getLayer(id)!, moved))
    check('text layer pixels survive save -> load (.bwk v2)', d2.isInfinite && n3 === n2, `${n3} vs ${n2}`)
    d2.dispose()
    doc.undo()
    check('text move is undoable', opaqueCount(doc.readRegionPixels(doc.activeLayer, area)) > 200)
  }

  // ------------------------------------------------------------------ guides: grid, symmetry (far from the origin), perspective
  {
    const mgr = (window as unknown as { brushwork_guides: any }).brushwork_guides
    app.newDocument(4096, 4096, { kind: 'infinite' })
    const GX = -65000
    const GY = 41000
    app.setView({ cx: GX, cy: GY, zoom: 1, rot: 0 })
    app.renderNow()
    const doc = app.doc
    mgr.set({ enabled: true, type: 'symmetry', symKind: 'vertical' })
    const g = mgr.state
    check('symmetry centre defaults to the view centre on an infinite canvas', Math.abs(g.symCenter.x - GX) < 5 && Math.abs(g.symCenter.y - GY) < 5, JSON.stringify(g.symCenter))
    mgr.setAssist(doc.activeId, true)
    // axis through a tile border so mirrored strokes straddle tiles
    const ax = Math.round(g.symCenter.x / 512) * 512
    mgr.set({ symCenter: { x: ax, y: GY } })
    cfg('brush', 'hard-round', 30, { h: 120, s: 1, v: 0.8 })
    stroke('brush', [[ax + 150, GY - 80], [ax + 300, GY], [ax + 150, GY + 80]])
    const a = opaqueCount(doc.readRegionPixels(doc.activeLayer, { x: ax + 100, y: GY - 120, w: 250, h: 240 }))
    const b = opaqueCount(doc.readRegionPixels(doc.activeLayer, { x: ax - 350, y: GY - 120, w: 250, h: 240 }))
    check('symmetry mirrors strokes across tile borders at any position', a > 500 && Math.abs(a - b) < a * 0.05, `${a} vs ${b}`)
    // grid: assist snaps the stroke onto the nearest line through the origin
    mgr.set({ type: 'grid', gridSize: 64, gridRotation: 0, gridOrigin: { x: GX - 1000, y: GY - 1000 } })
    const gy = GY - 1000 + 64 * 20
    stroke('brush', [[GX - 200, gy + 9], [GX + 100, gy + 14]])
    const row = opaqueCount(doc.readRegionPixels(doc.activeLayer, { x: GX - 150, y: gy - 3, w: 200, h: 6 }))
    check('grid assist snaps strokes to an infinite grid anchored at its origin', row > 700, String(row))
    mgr.set({ type: 'perspective', enabled: true })
    check('perspective vanishing point exists near the view', mgr.state.vps.length >= 1 && Math.abs(mgr.state.vps[0].x - GX) < 5000)
    mgr.set({ enabled: false })
  }
  void c.sleep
}
