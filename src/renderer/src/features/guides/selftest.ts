import type { App } from '../../app/app'
import { loadBwk, saveBwk } from '../../io/bwk'
import type { GuideManager } from './guideManager'
import type { QuickShape } from './quickshape'

const sleep = (ms: number): Promise<void> => new Promise((r) => setTimeout(r, ms))

/** Exposes window.brushwork_guides_test(): drives the real pointer path for guides, QuickShape, text and save/load. Returns a log. */
export function registerGuidesSelfTest(app: App, mgr: GuideManager, qs: QuickShape): void {
  ;(window as any).brushwork_guides_test = async (): Promise<string[]> => {
    const log: string[] = []
    const check = (n: string, c: boolean, x = ''): void => void log.push((c ? 'PASS ' : 'FAIL ') + n + ' ' + x)
    const canvas = app.canvas
    const client = (dx: number, dy: number): { x: number; y: number } => {
      const r = canvas.getBoundingClientRect()
      const v = app.view
      const s = app.cssSize()
      const c = Math.cos(v.rot)
      const sn = Math.sin(v.rot)
      const px = dx - v.cx
      const py = dy - v.cy
      return { x: r.left + s.w / 2 + v.zoom * (c * px - sn * py), y: r.top + s.h / 2 + v.zoom * (sn * px + c * py) }
    }
    let id = 500
    const fire = (type: string, x: number, y: number): void => {
      const c = client(x, y)
      canvas.dispatchEvent(new PointerEvent(type, { pointerId: id, pointerType: 'pen', isPrimary: true, clientX: c.x, clientY: c.y, pressure: type === 'pointerup' ? 0 : 0.8, bubbles: true, cancelable: true, button: 0, buttons: type === 'pointerup' ? 0 : 1 }))
    }
    const draw = async (pts: [number, number][], holdMs = 0): Promise<void> => {
      id++
      fire('pointerdown', pts[0][0], pts[0][1])
      for (let i = 1; i < pts.length; i++) {
        fire('pointermove', pts[i][0], pts[i][1])
        if (i % 8 === 0) await sleep(8)
      }
      if (holdMs) await sleep(holdMs)
      fire('pointerup', pts[pts.length - 1][0], pts[pts.length - 1][1])
      await sleep(60)
    }
    const alphaAt = (x: number, y: number, r = 6): number => {
      const l = app.doc.activeLayer
      const px = app.doc.gpu.readRGBA8(l.pixels, { x: Math.round(x - r), y: Math.round(y - r), w: r * 2, h: r * 2 })
      let m = 0
      for (let i = 3; i < px.length; i += 4) m = Math.max(m, px[i])
      return m
    }
    try {
      const W = app.doc.width
      // ---- symmetry
      app.doc.addLayer({ name: 'sym' })
      mgr.set({ enabled: true, type: 'symmetry', symKind: 'vertical', symCenter: { x: W / 2, y: 1000 }, symAngle: 0 })
      mgr.setAssist(app.doc.activeId, true)
      const line: [number, number][] = []
      for (let i = 0; i <= 40; i++) line.push([300 + i * 5, 400 + i * 5])
      await draw(line)
      check('symmetry original', alphaAt(400, 500) > 200)
      check('symmetry mirror', alphaAt(W - 400, 500) > 200, 'mirror at x=' + (W - 400))
      check('symmetry not elsewhere', alphaAt(W / 2, 200) === 0)
      // radial
      app.doc.addLayer({ name: 'rad' })
      mgr.set({ symKind: 'radial', symSegments: 4, symRotational: true, symCenter: { x: W / 2, y: 1500 } })
      mgr.setAssist(app.doc.activeId, true)
      await draw([[W / 2 + 200, 1500], [W / 2 + 260, 1500], [W / 2 + 320, 1500]].flatMap((p, i, a) => (i ? [[p[0], p[1]] as [number, number]] : [[p[0], p[1]] as [number, number], [(p[0] + a[1][0]) / 2, p[1]] as [number, number]])))
      check('radial rotated copy', alphaAt(W / 2, 1500 + 260) > 200)
      check('radial opposite copy', alphaAt(W / 2 - 260, 1500) > 200)
      // ---- assist grid lock
      app.doc.addLayer({ name: 'grid' })
      mgr.set({ type: 'grid', gridSize: 100, gridRotation: 0 })
      mgr.setAssist(app.doc.activeId, true)
      const wob: [number, number][] = []
      for (let i = 0; i <= 40; i++) wob.push([200 + i * 10, 1830 + Math.sin(i) * 12])
      await draw(wob)
      check('grid assist snaps y to 1800', alphaAt(500, 1800, 3) > 200 && alphaAt(500, 1840, 3) === 0)
      mgr.set({ enabled: false })
      // ---- QuickShape circle
      app.doc.addLayer({ name: 'qs' })
      const circ: [number, number][] = []
      for (let i = 0; i <= 70; i++) {
        const t = (i / 70) * Math.PI * 2 * 1.03
        circ.push([1200 + Math.cos(t) * 200 + Math.sin(i * 3) * 4, 600 + Math.sin(t) * 200 + Math.cos(i * 2) * 4])
      }
      await draw(circ, 900)
      check('quickshape snapped circle', alphaAt(1400, 600, 4) > 200 && alphaAt(1200, 400, 4) > 200 && alphaAt(1200, 800, 4) > 200)
      check('quickshape handles active', !!qs.active && qs.active.shape.kind === 'ellipse')
      qs.finish()
      // ---- text
      const tm = (window as any).brushwork_text
      tm.addText('Hello')
      await sleep(150)
      const tid = app.doc.activeId
      check('text layer created', tm.isText(tid))
      const t = tm.get(tid)
      const cx = t.x + t.w / 2
      let found = false
      for (let y = t.y; y < t.y + 200 && !found; y += 6) if (alphaAt(t.x + 60, y, 30) > 0) found = true
      check('text pixels rendered', found)
      tm.setStyle({ size: 200, color: '#ff0000' })
      await sleep(100)
      tm.stopEditing()
      await sleep(900)
      const bytes = await saveBwk(app.doc, app.compositor)
      const doc2 = await loadBwk(bytes, app.gpu)
      check('guide state persisted', mgr.exportState(doc2).type === mgr.state.type && mgr.exportState(doc2).symKind === 'radial', mgr.exportState(doc2).type)
      const tm2 = tm.store.get(doc2)
      check('text saved in bwk', !!tm2 && tm2.get(tid)?.text === 'Hello', 'style size=' + tm2?.get(tid)?.style.size)
      doc2.dispose()
      tm.rasterize(tid)
      check('rasterize removes text data', !tm.isText(tid))
      void cx
      // undo rasterize brings text back
      app.doc.undo()
      check('undo rasterize restores text', tm.isText(tid))
      app.doc.redo()
      let still = false
      for (let y = t.y; y < t.y + 240 && !still; y += 6) if (alphaAt(t.x + 60, y, 30) > 0) still = true
      check('rasterize keeps pixels after redo', still)
      app.doc.undo()
    } catch (e) {
      log.push('EXCEPTION ' + (e as Error).stack)
    }
    return log
  }
}
