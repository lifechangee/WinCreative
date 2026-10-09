import type { App } from '../../app/app'
import { loadBwk, saveBwk } from '../../io/bwk'
import { flatForExport } from '../../io/exporters'
import { getRecorder } from '../animio/timelapse'
import { setExportArea } from './exportArea'
import { editFrame, getFrame } from './state'
import { frameRect, workRect } from './workRect'
import { toggleFrame } from './index'
import { layerFromImage } from '../layers/ops'
import { menus } from '../../ui/registry'
import { t } from '../../i18n'

/** BW_FRAME_SELFTEST=1 (`node scripts/selftest.mjs --out <build> frame`): frame clipping, undo, .bwk round trip, export areas, workRect, time-lapse area. */
export async function runFrameSelfTest(app: App): Promise<boolean> {
  const failures: string[] = []
  const check = (name: string, cond: boolean, extra = ''): void => {
    console.warn('[frame]', cond ? 'PASS' : 'FAIL', name, extra)
    if (!cond) failures.push(name)
  }
  const sleep = (ms: number): Promise<void> => new Promise((r) => setTimeout(r, ms))
  await sleep(800)
  const stroke = (pts: number[][]): void => {
    const s = pts.map((p, i) => ({ x: p[0], y: p[1], pressure: 0.7, tiltX: 0, tiltY: 0, twist: 0, t: 1000 + i * 8, pointerType: 'pen' as const }))
    const t = app.tools.get('brush')!
    if (!t.begin(s[0], app)) throw new Error('stroke refused')
    for (let i = 1; i < s.length; i += 8) t.move(s.slice(i, i + 8), app)
    t.end(app)
  }
  const alphaCount = (rect: { x: number; y: number; w: number; h: number }): number => {
    const px = app.doc.readRegionPixels(app.doc.activeLayer, rect)
    let n = 0
    for (let i = 3; i < px.length; i += 4) if (px[i] > 0) n++
    return n
  }
  for (const kind of ['fixed', 'infinite'] as const) {
    app.state.setTool('brush')
    app.state.settings.size = 60
    app.state.settings.opacity = 1
    app.newDocument(1200, 900, kind === 'infinite' ? { kind: 'infinite', background: { color: [1, 1, 1], visible: true } } : { background: { color: [1, 1, 1], visible: true } })
    const doc = app.doc
    const o = kind === 'infinite' ? -600 : 0
    check(`${kind}: no frame -> workRect`, !frameRect(doc) && (kind === 'infinite' ? workRect(app).w > 0 : workRect(app).w === 1200))
    editFrame(doc, { x: 300 + o, y: 200 + o, w: 400, h: 300, enabled: true, visible: true }, 'Frame')
    const R = frameRect(doc)!
    check(`${kind}: workRect`, kind === 'fixed' ? workRect(app).w === 1200 : workRect(app).x === R.x && workRect(app).w === 400)
    stroke([[R.x - 100, R.y + 150], [R.x + 500, R.y + 150]])
    check(`${kind}: nothing outside`, alphaCount({ x: R.x - 150, y: R.y, w: 150, h: 300 }) === 0 && alphaCount({ x: R.x + 400, y: R.y, w: 150, h: 300 }) === 0)
    check(`${kind}: painted inside`, alphaCount(R) > 1000)
    toggleFrame(app)
    check(`${kind}: toggled off`, getFrame(doc)?.enabled === false)
    stroke([[R.x - 100, R.y + 250], [R.x - 20, R.y + 250]])
    check(`${kind}: off paints outside`, alphaCount({ x: R.x - 150, y: R.y + 200, w: 150, h: 100 }) > 500)
    toggleFrame(app)
    // export areas
    setExportArea(doc, 'frame')
    const fe = flatForExport(doc, app.compositor, true)
    check(`${kind}: export frame size`, fe.w === 400 && fe.h === 300, `${fe.w}x${fe.h}`)
    // undo of the frame edit
    editFrame(doc, { w: 500 }, 'Frame')
    check(`${kind}: resized`, getFrame(doc)!.w === 500)
    app.undo()
    check(`${kind}: undo restores size`, getFrame(doc)!.w === 400)
    // .bwk round trip
    const bytes = await saveBwk(doc, app.compositor)
    const d2 = await loadBwk(bytes, app.gpu)
    const f2 = getFrame(d2)
    check(`${kind}: frame persisted`, !!f2 && f2.x === R.x && f2.y === R.y && f2.w === 400 && f2.h === 300 && f2.enabled)
  }
  // time-lapse records the frame area
  app.newDocument(1000, 1000, { background: { color: [1, 1, 1], visible: true } })
  const rec = getRecorder(app.doc)
  if (rec) {
    editFrame(app.doc, { x: 100, y: 100, w: 540, h: 960, enabled: true, visible: true }, 'Frame')
    await sleep(600)
    stroke([[200, 300], [500, 500]])
    await rec.flush()
    check('timelapse: frame-shaped output', !!rec.out && Math.abs(rec.out.w / rec.out.h - 540 / 960) < 0.02, JSON.stringify(rec.out))
    check('timelapse: frames recorded', rec.count >= 1, String(rec.count))
  }

  /** frame ON + selection + adjustment + smart cut-out on an infinite doc: everything lands in frame x selection, and survives save / load */
  async function composeChecks(): Promise<void> {
    app.state.setTool('brush')
    app.state.settings.size = 120
    app.state.settings.opacity = 1
    app.newDocument(1200, 900, { kind: 'infinite', background: { color: [1, 1, 1], visible: false } })
    const doc = app.doc
    for (let y = -100; y <= 600; y += 90) stroke([[-150, y], [900, y]])
    const layer = doc.activeLayer
    const F = { x: 100, y: 50, w: 400, h: 300 }
    const S = { x: 250, y: 150, w: 400, h: 300 }
    editFrame(doc, { ...F, enabled: true, visible: true }, 'Frame')
    app.selection.setFromRegion(S, new Uint8Array(S.w * S.h).fill(255), 'Test')
    const px = (l: typeof layer, x: number, y: number): number[] => Array.from(doc.readRegionPixels(l, { x, y, w: 1, h: 1 }))
    const A = [350, 250], B = [150, 100], C = [600, 400], D = [-50, -50]
    const before = [A, B, C, D].map(([x, y]) => px(layer, x, y))
    check('compose: layer filled everywhere', before.every((p) => p[3] > 200), JSON.stringify(before))
    const adj = (app as unknown as { adjustments: { run(id: string, p?: Record<string, number>): boolean } }).adjustments
    check('compose: adjustment applied', adj.run('hsb', { hue: 100, sat: 50, bri: 50 }))
    const after = [A, B, C, D].map(([x, y]) => px(layer, x, y))
    const changed = after.map((p, i) => Math.abs(p[0] - before[i][0]) > 60)
    check('compose: adjustment only in frame x selection', changed[0] && !changed[1] && !changed[2] && !changed[3], JSON.stringify({ changed, before: before[0], after: after[0] }))
    const ss = (window as unknown as { brushwork_smartselect?: { cut(a: string): Promise<boolean> } }).brushwork_smartselect
    const n0 = doc.layers.length
    const ok = ss ? await ss.cut('copy') : false
    check('compose: cut-out made a layer', ok && doc.layers.length === n0 + 1, String(doc.layers.length))
    const cut = doc.layers.find((l) => l.name.endsWith(t('smartselect.layerSuffix')))
    if (cut) {
      const a = [A, B, C, D].map(([x, y]) => px(cut, x, y)[3])
      check('compose: cut-out clipped to frame x selection', a[0] > 200 && a[1] === 0 && a[2] === 0 && a[3] === 0, a.join(','))
    } else check('compose: cut-out layer found', false)
    // save / reload: identical pixels + frame
    const R = { x: -250, y: -250, w: 1200, h: 900 }
    const snap = doc.layers.filter((l) => !l.isGroup).map((l) => doc.readRegionPixels(l, R))
    const d2 = await loadBwk(await saveBwk(doc, app.compositor), app.gpu)
    const lay2 = d2.layers.filter((l) => !l.isGroup)
    let same = lay2.length === snap.length
    for (let i = 0; same && i < snap.length; i++) {
      const b = d2.readRegionPixels(lay2[i], R)
      for (let k = 0; k < b.length; k++)
        if (b[k] !== snap[i][k]) {
          same = false
          break
        }
    }
    check('compose: save / reload identical', same)
    const f2 = getFrame(d2)
    check('compose: frame persisted', !!f2 && f2.x === F.x && f2.w === F.w && f2.enabled)
    app.selection.clear()
  }

  /** per-frame source rectangle in the time-lapse index */
  async function tlRectChecks(): Promise<void> {
    app.newDocument(1000, 1000, { background: { color: [1, 1, 1], visible: true } })
    const rec = getRecorder(app.doc)
    if (!rec) return check('timelapse rect: recorder', false)
    editFrame(app.doc, { x: 100, y: 100, w: 540, h: 960, enabled: true, visible: true }, 'Frame')
    await sleep(700)
    app.state.settings.size = 40
    stroke([[200, 300], [500, 500]])
    await rec.flush()
    await sleep(900)
    editFrame(app.doc, { x: 50, y: 60, w: 800, h: 450 }, 'Frame')
    await sleep(400)
    stroke([[200, 300], [600, 400]])
    await rec.flush()
    await sleep(900)
    const tags = await window.animio!.tl.tags(rec.id)
    const rects = tags.map((x) => (x.r ? x.r.join(',') : ''))
    check('timelapse rect: every frame has its source rect', rects.length >= 2 && rects.every((r) => r.split(',').length === 4), rects.join(' | '))
    check('timelapse rect: moving / resizing the frame changes it', new Set(rects).size >= 2, rects.join(' | '))
    check('timelapse rect: output keeps one stable size', !!rec.out)
  }

  /** Animation Assist + Page Assist on an infinite canvas work inside the frame */
  async function assistChecks(): Promise<void> {
    app.newDocument(1200, 900, { kind: 'infinite', background: { color: [1, 1, 1], visible: true } })
    const doc = app.doc
    app.state.settings.size = 60
    editFrame(doc, { x: -300, y: -200, w: 600, h: 400, enabled: true, visible: true }, 'Frame')
    type Bmp = { width: number; height: number; data: Uint8ClampedArray }
    type Rend = { width: number; height: number; bitmap(r: unknown[], o: unknown): Bmp }
    const an = (window as unknown as { brushwork_animio: { anim: { enabled: boolean; setEnabled(b: boolean): void; addFrame(): void; frames(): unknown[]; renderer(): Rend }; pages: { setEnabled(b: boolean): void; pages(): unknown[]; stackFor(i: number): unknown[]; renderer(): Rend } } }).brushwork_animio
    stroke([[-200, 0], [200, 0]])
    an.anim.setEnabled(true)
    an.anim.addFrame()
    stroke([[-200, 100], [200, 100]])
    check('assist: animation frames on an infinite canvas', an.anim.frames().length === 2)
    const fr = an.anim.renderer()
    check('assist: frame renderer covers the frame rect', fr.width === 600 && fr.height === 400, `${fr.width}x${fr.height}`)
    const frames = an.anim.frames()
    const b0 = fr.bitmap([frames[0]], { paper: [1, 1, 1] })
    const dark = (b: Bmp, x: number, y: number): boolean => b.data[(y * b.width + x) * 4] < 100
    check('assist: frame 1 renders its own stroke only', dark(b0, 300, 200) && !dark(b0, 300, 300))
    const b1 = fr.bitmap([frames[1]], { paper: [1, 1, 1] })
    check('assist: frame 2 renders its own stroke only', dark(b1, 300, 300) && !dark(b1, 300, 200))
    an.anim.setEnabled(false)
    const pa = an.pages
    pa.setEnabled(true)
    check('assist: pages on an infinite canvas', pa.pages().length === 2)
    const pb = pa.renderer().bitmap(pa.stackFor(0), { paper: [1, 1, 1] })
    check('assist: page bitmap is the frame size', pb.width === 600 && pb.height === 400, `${pb.width}x${pb.height}`)
    pa.setEnabled(false)
    // no frame: the menu item must offer one instead of failing silently
    editFrame(doc, null, 'Frame')
    const item = menus.actions.find((m) => m.id === 'canvas-anim')
    item?.run?.({ app } as never)
    await sleep(200)
    const prompt = document.querySelector('.an-modal .an-btn.primary')
    check('assist: no frame -> prompt offers Create frame', !!prompt)
    ;(prompt as HTMLElement | null)?.click()
    await sleep(300)
    check('assist: Create frame creates it and enables the assist', !!getFrame(doc) && an.anim.enabled)
    an.anim.setEnabled(false)
  }

  /** pasted / inserted pixels are clipped to the frame while it is ON */
  async function pasteChecks(): Promise<void> {
    app.newDocument(1000, 800, { background: { color: [1, 1, 1], visible: true } })
    const doc = app.doc
    editFrame(doc, { x: 200, y: 200, w: 300, h: 300, enabled: true, visible: true }, 'Frame')
    const W = 600
    const H = 600
    const data = new Uint8ClampedArray(W * H * 4)
    for (let i = 0; i < data.length; i += 4) {
      data[i] = 255
      data[i + 3] = 255
    }
    const img = { x: 100, y: 100, w: W, h: H, data }
    const l1 = layerFromImage(doc, img, 'paste')
    const a = (x: number, y: number): number => doc.readRegionPixels(l1, { x, y, w: 1, h: 1 })[3]
    check('paste: clipped to the frame', a(300, 300) === 255 && a(150, 150) === 0 && a(600, 300) === 0 && a(300, 600) === 0)
    editFrame(doc, { enabled: false }, 'Frame')
    const l2 = layerFromImage(doc, img, 'paste2')
    check('paste: frame off keeps everything', doc.readRegionPixels(l2, { x: 150, y: 150, w: 1, h: 1 })[3] === 255)
    l1.dispose()
    l2.dispose()
  }
  for (const [name, fn] of [['compose', composeChecks], ['timelapse rect', tlRectChecks], ['assist', assistChecks], ['paste', pasteChecks]] as const) {
    try {
      await fn()
    } catch (e) {
      check(`${name}: no exception`, false, (e as Error).message)
    }
  }
  console.warn('[frame]', failures.length ? 'FAILED ' + failures.join(', ') : 'ALL PASSED')
  return failures.length === 0
}
