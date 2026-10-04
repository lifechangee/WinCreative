import type { App } from '../app/app'
import { galleryRef } from '../features/color/galleryRef'
import type { GalleryStore } from '../features/color/galleryStore'
import { loadBwk, saveBwk } from '../io/bwk'
import { SaveAborted, saveStats } from '../io/asyncSave'
import { prefs } from '../input/prefs'
import { predictionOverlay } from '../input/prediction'

const sleep = (ms: number): Promise<void> => new Promise((r) => setTimeout(r, ms))
const raf = (): Promise<void> =>
  new Promise((r) => {
    requestAnimationFrame(() => r())
    setTimeout(r, 60)
  })
const within = <T>(p: Promise<T>, ms: number, what: string): Promise<T> =>
  new Promise<T>((ok, err) => {
    const t = setTimeout(() => err(new Error('TIMEOUT (promise left unresolved): ' + what)), ms)
    p.then(
      (v) => (clearTimeout(t), ok(v)),
      (e) => (clearTimeout(t), err(e))
    )
  })

/**
 * BW_PERF_SELFTEST=1: pointer->stroke robustness (no lost strokes / taps), async-save race hammer (newDocument / save /
 * autosave / strokes at once), incremental save, crash-journal replay and the prediction overlay.
 */
export async function runPerfSelfTest(app: App): Promise<boolean> {
  const failures: string[] = []
  const check = (name: string, cond: boolean, extra = ''): void => {
    console.log('[perf]', cond ? 'PASS' : 'FAIL', name, extra)
    if (!cond) failures.push(name)
  }
  const gl = app.gpu.gl
  const asyncErrors: string[] = []
  const onRej = (e: PromiseRejectionEvent): void => void asyncErrors.push('unhandledrejection: ' + String(e.reason))
  const onErr = (e: ErrorEvent): void => void asyncErrors.push('error: ' + e.message)
  window.addEventListener('unhandledrejection', onRej)
  window.addEventListener('error', onErr)
  const origErr = console.error
  const logged: string[] = []
  console.error = (...a: unknown[]): void => {
    logged.push(a.map(String).join(' '))
    origErr(...a)
  }
  try {
    await sleep(1200)
    await galleryRef.ready
    const store = galleryRef.store as GalleryStore
    gl.getError()

    // ---------------------------------------------------------------- pointer helpers (real input path)
    const rect = (): DOMRect => app.canvas.getBoundingClientRect()
    const toClient = (dx: number, dy: number): { x: number; y: number } => {
      const r = rect()
      const s = app.view.zoom
      const c = Math.cos(app.view.rot)
      const sn = Math.sin(app.view.rot)
      const px = dx - app.view.cx
      const py = dy - app.view.cy
      const sw = app.cssSize()
      return { x: r.left + sw.w / 2 + s * (c * px - sn * py), y: r.top + sw.h / 2 + s * (sn * px + c * py) }
    }
    let ptr = 100
    const fire = (type: string, x: number, y: number, o: { id?: number; pen?: boolean; pressure?: number; buttons?: number; predicted?: [number, number][] } = {}): void => {
      const c = toClient(x, y)
      const pen = o.pen ?? true
      const buttons = o.buttons ?? (type === 'pointerup' || type === 'pointercancel' || type === 'lostpointercapture' ? 0 : 1)
      const mk = (cx: number, cy: number): PointerEvent => new PointerEvent(type, { pointerId: o.id ?? ptr, pointerType: pen ? 'pen' : 'mouse', isPrimary: true, clientX: cx, clientY: cy, pressure: o.pressure ?? (buttons ? 0.6 : 0), tiltX: 10, tiltY: 5, bubbles: true, cancelable: true, button: 0, buttons })
      const ev = mk(c.x, c.y)
      if (o.predicted) {
        const pe = o.predicted.map(([px, py]) => {
          const q = toClient(px, py)
          return mk(q.x, q.y)
        })
        Object.defineProperty(ev, 'getPredictedEvents', { value: () => pe })
      }
      app.canvas.dispatchEvent(ev)
    }
    const alphaNear = (x: number, y: number, r = 4): number => {
      const px = app.gpu.readRGBA8(app.doc.activeLayer.pixels, { x: Math.round(x) - r, y: Math.round(y) - r, w: r * 2 + 1, h: r * 2 + 1 })
      let m = 0
      for (let i = 3; i < px.length; i += 4) m = Math.max(m, px[i])
      return m
    }
    const fresh = (w = 2048, h = 2048): void => {
      app.newDocument(w, h)
      app.state.setTool('brush')
      app.state.setPreset('brush', 'hard-round')
      app.state.setSize(30)
      app.state.setColor({ h: 200, s: 0.8, v: 0.7 })
      app.fit()
      app.renderNow()
    }
    const hardBusy = (ms: number): void => {
      const t = performance.now()
      while (performance.now() - t < ms);
    }

    // ================================================================ 1. lost strokes / taps
    fresh()
    let expect = 0
    const undo0 = (): number => app.doc.history.undoCount
    // quick taps: down + up in the same task (pointerup before the first rAF)
    for (let i = 0; i < 25; i++) {
      ptr++
      fire('pointerdown', 200 + i * 60, 200, { id: ptr })
      fire('pointerup', 200 + i * 60, 200, { id: ptr })
    }
    expect += 25
    let dots = 0
    for (let i = 0; i < 25; i++) if (alphaNear(200 + i * 60, 200) > 10) dots++
    check('25 same-task taps all leave a dot', dots === 25 && undo0() === expect, `dots=${dots} undo=${undo0()}`)

    // mouse taps, reused pointer id (like a real mouse), burst without awaiting
    for (let i = 0; i < 25; i++) {
      fire('pointerdown', 200 + i * 60, 300, { id: 1, pen: false })
      fire('pointerup', 200 + i * 60, 300, { id: 1, pen: false })
    }
    expect += 25
    dots = 0
    for (let i = 0; i < 25; i++) if (alphaNear(200 + i * 60, 300) > 10) dots++
    check('25 mouse taps with a reused pointer id all leave a dot', dots === 25 && undo0() === expect, `dots=${dots} undo=${undo0()}`)

    // window blur mid-stroke keeps the stroke
    ptr++
    fire('pointerdown', 300, 420, { id: ptr })
    for (let i = 1; i < 8; i++) fire('pointermove', 300 + i * 12, 420, { id: ptr })
    window.dispatchEvent(new Event('blur'))
    fire('pointermove', 420, 420, { id: ptr })
    fire('pointerup', 420, 420, { id: ptr })
    expect += 1
    check('blur mid-stroke commits the stroke (not lost)', undo0() === expect && alphaNear(330, 420) > 10, `undo=${undo0()}`)

    // pointercancel mid-stroke (pen hand-over)
    ptr++
    fire('pointerdown', 300, 480, { id: ptr })
    for (let i = 1; i < 8; i++) fire('pointermove', 300 + i * 12, 480, { id: ptr })
    fire('pointercancel', 384, 480, { id: ptr })
    expect += 1
    check('pointercancel (pen) commits the stroke', undo0() === expect && alphaNear(330, 480) > 10, `undo=${undo0()}`)

    // lost pointerup: next pointerdown of the same device must still paint
    ptr++
    fire('pointerdown', 300, 540, { id: ptr })
    for (let i = 1; i < 6; i++) fire('pointermove', 300 + i * 12, 540, { id: ptr })
    fire('pointerdown', 300, 600, { id: ptr }) // (up never arrived)
    for (let i = 1; i < 6; i++) fire('pointermove', 300 + i * 12, 600, { id: ptr })
    fire('pointerup', 360, 600, { id: ptr })
    expect += 2
    check('lost pointerup: both the old and the new stroke survive', undo0() === expect && alphaNear(330, 540) > 10 && alphaNear(330, 600) > 10, `undo=${undo0()}`)

    // lostpointercapture without buttons = the up was swallowed
    ptr++
    fire('pointerdown', 300, 660, { id: ptr })
    for (let i = 1; i < 6; i++) fire('pointermove', 300 + i * 12, 660, { id: ptr })
    fire('lostpointercapture', 360, 660, { id: ptr })
    expect += 1
    check('lostpointercapture (no buttons) commits the stroke', undo0() === expect && !app.input.drawing, `undo=${undo0()} drawing=${app.input.drawing}`)

    // heavy load: 150 mixed taps / strokes, CPU burned between events, occasional rAF
    let sent = 0
    for (let i = 0; i < 150; i++) {
      ptr++
      const x = 150 + (i % 30) * 55
      const y = 800 + Math.floor(i / 30) * 60
      fire('pointerdown', x, y, { id: ptr })
      if (i % 3) for (let k = 1; k <= (i % 3) * 4; k++) fire('pointermove', x + k * 3, y + k, { id: ptr })
      if (i % 7 === 0) hardBusy(15)
      fire('pointerup', x + 6, y + 2, { id: ptr })
      sent++
      if (i % 25 === 0) await raf()
    }
    expect += sent
    let lost = 0
    for (let i = 0; i < 150; i++) if (alphaNear(150 + (i % 30) * 55, 800 + Math.floor(i / 30) * 60) < 10) lost++
    check('150 taps/strokes under CPU load lose nothing', lost === 0 && undo0() === expect, `lost=${lost} undo=${undo0()}/${expect}`)

    // ================================================================ 2. save hammer
    fresh(1600, 1200)
    for (let i = 0; i < 5; i++) {
      const l = app.doc.addLayer({ name: 'H' + i })
      const d = new Uint8ClampedArray(200 * 200 * 4)
      for (let k = 0; k < d.length; k += 4) d.set([40 * i, 200 - 30 * i, 90, 255], k)
      app.gpu.uploadRGBA8(l.pixels, 100 + i * 150, 100, 200, 200, d)
    }
    app.doc.emitCommit('layer-props', null, null, 'setup')
    ;(store as any).delayMs = 250
    await within(store.addDocument(app.doc, { name: 'hammer' }), 30000, 'addDocument')
    const start = performance.now()
    const end = start + 7000
    const counts = { strokes: 0, news: 0, saves: 0, flushes: 0, opens: 0, undos: 0, aborted: 0, rejected: 0 }
    const worker = async (name: string, body: () => Promise<void>): Promise<void> => {
      while (performance.now() < end) {
        try {
          await within(body(), 45000, name)
        } catch (e) {
          if (e instanceof SaveAborted || /aborted|disposed/i.test(String(e))) counts.aborted++
          else {
            counts.rejected++
            asyncErrors.push(name + ': ' + String(e))
          }
        }
      }
    }
    const strokeOnce = async (): Promise<void> => {
      ptr++
      const y = 200 + Math.random() * 700
      fire('pointerdown', 150, y, { id: ptr })
      for (let i = 1; i < 12; i++) {
        fire('pointermove', 150 + i * 40, y + Math.sin(i) * 30, { id: ptr })
        if (i % 4 === 0) await raf()
      }
      fire('pointerup', 600, y, { id: ptr })
      counts.strokes++
      await sleep(Math.random() * 60)
    }
    await Promise.all([
      worker('strokes', strokeOnce),
      worker('newDocument', async () => {
        await sleep(400 + Math.random() * 500)
        const r = Math.random()
        if (r < 0.5) {
          fresh(1024 + Math.floor(Math.random() * 4) * 128, 768)
          if (Math.random() < 0.7) await store.addDocument(app.doc, { name: 'h' + counts.news })
        } else {
          const items = store.live()
          const it = items[Math.floor(Math.random() * items.length)]
          if (it) {
            await store.open(it.id)
            counts.opens++
          }
        }
        counts.news++
      }),
      worker('manual save', async () => {
        await sleep(150 + Math.random() * 250)
        const d = app.doc
        const b = await saveBwk(d, app.compositor)
        if (b.length > 100) counts.saves++
      }),
      worker('flush/save', async () => {
        await sleep(200 + Math.random() * 300)
        if (Math.random() < 0.5) await store.flush()
        else await store.saveDocument(app.doc)
        counts.flushes++
      }),
      worker('undo', async () => {
        await sleep(300 + Math.random() * 300)
        if (app.doc.history.canUndo && !app.input.drawing) {
          app.undo()
          counts.undos++
        }
      })
    ])
    await within(store.idle(), 60000, 'store.idle')
    check('hammer: every promise resolved (no hang)', counts.rejected === 0, JSON.stringify(counts))
    check('hammer: work was actually concurrent', counts.strokes > 10 && counts.news >= 1 && counts.saves >= 1 && counts.flushes >= 1, JSON.stringify(counts))
    check('hammer: no unhandled rejections / DOMException', asyncErrors.length === 0 && !logged.some((l) => /DOMException|save failed|crashed/.test(l)), asyncErrors.concat(logged.filter((l) => /DOMException|save failed|crashed/.test(l))).slice(0, 4).join(' | '))
    check('hammer: replaced documents were all released', ((app as any).retiring as Map<unknown, unknown>).size === 0)
    // every artwork in the gallery must be a loadable file
    let bad = 0
    for (const it of store.live()) {
      const bytes = await window.bwGallery!.read(it.id + '.bwk')
      if (!bytes) continue
      try {
        const d = await loadBwk(bytes, app.gpu)
        d.dispose()
      } catch (e) {
        bad++
        console.log('[perf] unreadable', it.id, String(e))
      }
    }
    check('hammer: all saved artworks load back', bad === 0, `items=${store.live().length}`)
    check('hammer: no GL error', gl.getError() === 0)

    // ================================================================ 3. incremental save (dirty layers only)
    fresh(2048, 2048)
    for (let i = 0; i < 9; i++) {
      const l = app.doc.addLayer({ name: 'I' + i })
      const d = new Uint8ClampedArray(300 * 300 * 4)
      for (let k = 0; k < d.length; k += 4) d.set([255 - i * 20, i * 25, 128, 255], k)
      app.gpu.uploadRGBA8(l.pixels, 100 + i * 100, 100, 300, 300, d)
    }
    app.doc.emitCommit('layer-props', null, null, 'setup')
    const id = await within(store.addDocument(app.doc, { name: 'incremental' }), 30000, 'addDocument')
    check('first save encodes every layer', store.lastSave.encoded === 10, JSON.stringify(store.lastSave))
    const target = app.doc.layers[4]
    app.doc.setActive(target.id)
    ptr++
    fire('pointerdown', 500, 900, { id: ptr })
    for (let i = 1; i < 10; i++) fire('pointermove', 500 + i * 20, 900, { id: ptr })
    fire('pointerup', 700, 900, { id: ptr })
    const t0 = performance.now()
    await within(store.flush(), 30000, 'flush')
    const ms = Math.round(performance.now() - t0)
    check('after one stroke only that layer is re-encoded', store.lastSave.encoded === 1 && store.lastSave.reused === 9, JSON.stringify(store.lastSave) + ' ' + ms + 'ms')
    // undo / filters touch pixels without a stroke: must also invalidate
    app.undo()
    await within(store.flush(), 30000, 'flush')
    const bytes = (await window.bwGallery!.read(id + '.bwk'))!
    const d2 = await loadBwk(bytes, app.gpu)
    const a1 = app.gpu.readRGBA8(app.doc.getLayer(target.id)!.pixels, { x: 600, y: 900, w: 1, h: 1 })[3]
    const a2 = app.gpu.readRGBA8(d2.getLayer(target.id)!.pixels, { x: 600, y: 900, w: 1, h: 1 })[3]
    check('saved file reflects undo (cache invalidated)', a1 === a2, `live=${a1} saved=${a2}`)
    d2.dispose()

    // ================================================================ 4. crash journal (simulated crash)
    const base = (await window.bwGallery!.read(id + '.bwk'))!
    app.redo()
    ptr++
    fire('pointerdown', 800, 1200, { id: ptr })
    for (let i = 1; i < 10; i++) fire('pointermove', 800 + i * 20, 1200, { id: ptr })
    fire('pointerup', 980, 1200, { id: ptr })
    await within(store.journal.drain(app.doc), 10000, 'journal drain')
    const jr = await window.bwGallery!.read(id + '.jrn')
    check('stroke is journaled right after the commit', !!jr && jr.length > 50, `journal=${jr?.length}`)
    // emulate kill -9 before any autosave ran: the old .bwk is what is on disk, the journal is intact
    clearTimeout((store as any).saveTimer)
    ;(store as any).saveTimer = 0
    await store.idle()
    ;(store as any).dirty.delete(app.doc)
    await window.bwGallery!.write(id + '.bwk', base)
    fresh()
    const opened = await within(store.open(id), 30000, 'open+recover')
    const px = app.gpu.readRGBA8(app.doc.getLayer(target.id)!.pixels, { x: 880, y: 1200, w: 1, h: 1 })[3]
    check('journal replay recovers the last stroke', opened && px > 200, `alpha=${px}`)
    await within(store.flush(), 30000, 'flush after recovery')
    const jr2 = await window.bwGallery!.read(id + '.jrn')
    check('journal is truncated once the recovered doc was saved', !jr2 || jr2.length === 0, `len=${jr2?.length}`)

    // ================================================================ 5. prediction overlay is display-only
    prefs.v.predictStroke = true
    fresh()
    const before = app.doc.history.undoCount
    ptr++
    fire('pointerdown', 400, 400, { id: ptr })
    for (let i = 1; i < 10; i++) fire('pointermove', 400 + i * 15, 400, { id: ptr, predicted: [[400 + i * 15 + 10, 400], [400 + i * 15 + 20, 400]] })
    const shown = predictionOverlay.active && predictionOverlay.lastCount === 2
    prefs.v.predictStroke = false
    fire('pointermove', 560, 400, { id: ptr, predicted: [[570, 400]] })
    const offOk = !predictionOverlay.active
    prefs.v.predictStroke = true
    fire('pointerup', 540, 400, { id: ptr })
    check('prediction overlay shows while drawing and honours the pref', shown && offOk, `shown=${shown} off=${offOk}`)
    check('prediction overlay never touches the document', app.doc.history.undoCount === before + 1 && !predictionOverlay.active && alphaNear(590, 400) === 0, `undo=${app.doc.history.undoCount - before} tipAlpha=${alphaNear(590, 400)}`)
    // ================================================================ 6. cursor follows the RAW pointer, no backtracking
    {
      prefs.v.predictStroke = true
      fresh()
      const curEl = document.getElementById('brush-cursor') as HTMLElement
      const nextFrame = (): Promise<void> => new Promise((r) => requestAnimationFrame(() => r()))
      ptr++
      fire('pointerdown', 300, 300, { id: ptr })
      let backs = 0
      let maxDev = 0
      let prevCx = -1e9
      let tipBack = 0
      let prevTip = -1e9
      for (let i = 1; i <= 40; i++) {
        const x = 300 + i * 12
        // noisy predictions that alternate far / near: must not reach the cursor
        const j = i % 2 ? 40 : 4
        fire('pointermove', x, 300, { id: ptr, predicted: [[x + j, 300 + (i % 3) * 6]] })
        await nextFrame()
        const r = curEl.getBoundingClientRect()
        const cx = r.left + r.width / 2
        const raw = toClient(x, 300).x
        maxDev = Math.max(maxDev, Math.abs(cx - raw))
        if (cx < prevCx - 0.25) backs++
        prevCx = cx
        const tip = predictionOverlay.lastTip
        if (tip) {
          if (tip.x < prevTip - 1) tipBack = Math.max(tipBack, prevTip - tip.x)
          prevTip = tip.x
        }
      }
      fire('pointerup', 780, 300, { id: ptr })
      check('cursor follows the raw pointer without backtracking', backs === 0 && maxDev < 1, `backs=${backs} maxDev=${maxDev.toFixed(2)}`)
      check('prediction tip never backtracks under noisy predictions', tipBack < 1, `maxBack=${tipBack.toFixed(2)}`)
    }
    check('no GL error at the end', gl.getError() === 0)
    void saveStats
  } catch (e) {
    check('perf self-test did not throw', false, String((e as Error)?.stack ?? e))
  } finally {
    console.error = origErr
    window.removeEventListener('unhandledrejection', onRej)
    window.removeEventListener('error', onErr)
  }
  console.log('[perf] done, failures=' + failures.length)
  return failures.length === 0
}
