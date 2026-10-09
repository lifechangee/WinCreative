import type { App } from '../../app/app'
import { Document } from '../../doc/document'
import { loadBwk, saveBwk } from '../../io/bwk'
import { applyFilter } from '../../gl/filters'
import { flatForExport } from '../../io/exporters'
import { tileKey } from '../../core/tiles'
import { runInfiniteToolsTests } from './selftestTools'
import { runInfiniteSelectionTests } from './selftestSel'
import { tileMemory } from '../../doc/tileMemory'
import { infSaveStats } from '../../io/bwkSaveInf'
import { memCounters } from '../../doc/tileStore'
import { sampleDocColor } from '../interface/eyedropper'

/**
 * BW_INF_SELFTEST=1 (run it with `node scripts/selftest.mjs --out <build> infinite`): infinite canvas in the real app -
 * painting in every direction incl. +-50000 px, fixed-vs-infinite equivalence across tile seams, undo/redo exactness, region API,
 * save / load, filters through the region API, exports, guards. Prints `[inf] PASS|FAIL name`.
 */
export async function runInfiniteSelfTest(app: App): Promise<boolean> {
  const failures: string[] = []
  const check = (name: string, cond: boolean, extra = ''): void => {
    console.log('[inf]', cond ? 'PASS' : 'FAIL', name, extra)
    if (!cond) failures.push(name)
  }
  const gpu = app.gpu
  const gl = gpu.gl
  const sleep = (ms: number): Promise<void> => new Promise((r) => setTimeout(r, ms))
  await sleep(800)
  gl.getError()

  const st = app.state
  const cfg = (tool: 'brush' | 'smudge' | 'eraser', preset: string, size: number, hsv = { h: 10, s: 0.8, v: 0.8 }): void => {
    st.setTool(tool)
    st.setPreset(tool, preset)
    st.settings.size = size
    st.settings.opacity = 1
    st.setColor(hsv, false)
  }
  const stroke = (tool: 'brush' | 'smudge' | 'eraser', pts: number[][]): void => {
    const s = pts.map((p, i) => ({ x: p[0], y: p[1], pressure: p[2] ?? 0.7, tiltX: 0, tiltY: 0, twist: 0, t: 1000 + i * 8, pointerType: 'pen' as const }))
    const t = app.tools.get(tool)!
    const now = performance.now
    performance.now = () => 777 // PaintTool seeds its RNG from the clock: make strokes reproducible
    try {
      if (!t.begin(s[0], app)) throw new Error('stroke refused')
      for (let i = 1; i < s.length; i += 8) t.move(s.slice(i, i + 8), app)
      t.end(app)
    } finally {
      performance.now = now
    }
  }
  const spiral = (cx: number, cy: number, r0: number, r1: number, n = 90): number[][] => {
    const o: number[][] = []
    for (let i = 0; i <= n; i++) {
      const u = i / n
      o.push([cx + Math.cos(u * 9.4) * (r0 + (r1 - r0) * u), cy + Math.sin(u * 9.4) * (r0 + (r1 - r0) * u) * 0.8, 0.4 + 0.4 * Math.sin(u * 7) ** 2])
    }
    return o
  }
  const flat = (doc: Document, r: { x: number; y: number; w: number; h: number }): Uint8ClampedArray => doc.readRegionPixels(doc.activeLayer, r)
  /** max premultiplied 8-bit difference */
  const diff = (a: Uint8ClampedArray, b: Uint8ClampedArray): { max: number; n2: number } => {
    let max = 0
    let n2 = 0
    for (let i = 0; i < a.length; i += 4) {
      let d = Math.abs(a[i + 3] - b[i + 3])
      for (let c = 0; c < 3; c++) d = Math.max(d, Math.abs((a[i + c] * a[i + 3]) / 255 - (b[i + c] * b[i + 3]) / 255))
      if (d > max) max = d
      if (d > 2) n2++
    }
    return { max, n2 }
  }
  const hashDoc = (doc: Document): string => {
    let h = 2166136261
    let n = 0
    for (const l of doc.layers) {
      if (!l.tiles) continue
      for (const k of [...l.tiles.keys()].sort((a, b) => a - b)) {
        const s = l.tiles.getKey(k)!
        const px = gpu.readRGBA8(s, { x: 0, y: 0, w: s.w, h: s.h })
        let any = false
        for (let i = 3; i < px.length; i += 4) if (px[i]) { any = true; break }
        if (!any) continue
        n++
        h = Math.imul(h ^ (k % 65521), 16777619) >>> 0
        for (let i = 0; i < px.length; i += 7) h = Math.imul(h ^ px[i], 16777619) >>> 0
      }
    }
    return n + ':' + h
  }

  /** tiered memory: LRU eviction to compressed RAM + scratch disk, transparent restore, undo of removals, save/load reuse */
  async function memoryTests(): Promise<void> {
    const MB = 1048576
    const prev = tileMemory.budget
    app.newDocument(4096, 4096, { kind: 'infinite' })
    tileMemory.budget = { gpu: 40 * MB, cpu: 6 * MB } // after newDocument: setDocument re-derives the budgets
    app.setView({ cx: 3000000, cy: 3000000, zoom: 1, rot: 0 }) // nothing visible: the compositor must not pull the tiles back
    app.renderNow()
    const d = app.doc
    const L = d.activeLayer.tiles!
    const N = 160
    const fnv = (px: Uint8ClampedArray): number => {
      let h = 2166136261
      for (let i = 0; i < px.length; i++) h = Math.imul(h ^ px[i], 16777619) >>> 0
      return h
    }
    const keys: number[] = []
    for (let i = 0; i < N; i++) {
      const tx = (i % 16) - 8
      const ty = Math.floor(i / 16) - 5
      const px = new Uint8Array(512 * 512 * 4)
      let seed = (i + 1) * 2654435761
      for (let y = 0; y < 512; y++) for (let x = 0; x < 512; x++) {
        const o = (y * 512 + x) * 4
        seed = (Math.imul(seed, 1664525) + 1013904223) >>> 0
        px[o] = (x + i * 7) & 255
        px[o + 1] = (y + (seed >>> 28)) & 255
        px[o + 2] = (i * 13) & 255
        px[o + 3] = x < 256 ? 255 : (seed >>> 24) | 1
      }
      L.upload(tx, ty, px)
      keys.push(tileKey(tx, ty))
    }
    const hashOf = (k: number): number => {
      const s = L.getKey(k)!
      return fnv(gpu.readRGBA8(s, { x: 0, y: 0, w: 512, h: 512 }))
    }
    const before = new Map<number, number>()
    for (const k of keys) before.set(k, hashOf(k))
    const sync0 = memCounters.syncRestores
    const t0 = performance.now()
    while (performance.now() - t0 < 25000) {
      tileMemory.tick()
      if (tileMemory.residentBytes() <= tileMemory.budget.gpu && !tileMemory.pendingRestores) break
      await sleep(30)
    }
    await sleep(300)
    tileMemory.tick()
    const st1 = d.tileStats()
    check('memory: GPU residency is held under the budget by LRU eviction', tileMemory.residentBytes() <= tileMemory.budget.gpu * 1.02 && st1.tiles === N, `${st1.gpu} resident of ${st1.tiles}, ${Math.round(performance.now() - t0)} ms`)
    check('memory: evicted tiles sit in compressed RAM and spill to the scratch disk beyond the second budget', st1.cpu + st1.disk >= N - st1.gpu - 2 && st1.disk > 0, `gpu ${st1.gpu} cpu ${st1.cpu} disk ${st1.disk}`)
    let bad = 0
    for (let r = 0; r < 4; r++) {
      const part = keys.filter((_, i) => i % 4 === r)
      for (const k of part) if (L.isCold(k)) tileMemory.prefetch(L, k, 0)
      await tileMemory.settle()
      for (const k of part) if (L.peekKey(k) && hashOf(k) !== before.get(k)) bad++
      for (let i = 0; i < 6; i++) (tileMemory.tick(), await sleep(20))
    }
    check('memory: async restore round trip is lossless for every tile (hash before/after)', bad === 0, `${bad} mismatches`)
    bad = 0
    for (const k of keys) {
      if (hashOf(k) !== before.get(k)) bad++
      tileMemory.tick()
    }
    check('memory: transparent synchronous restore is lossless', bad === 0, `${bad} mismatches, ${memCounters.syncRestores - sync0} sync restores`)
    for (let i = 0; i < 12; i++) (tileMemory.tick(), await sleep(30))
    const sync1 = memCounters.syncRestores
    const tc = performance.now()
    d.clearLayer(d.activeId)
    const clearMs = performance.now() - tc
    check('memory: clearing a mostly evicted layer does not decode the tiles', d.tileStats().tiles === 0 && memCounters.syncRestores - sync1 < 8, `${Math.round(clearMs)} ms, ${memCounters.syncRestores - sync1} sync restores`)
    d.undo()
    bad = 0
    for (const k of keys) if (!L.hasKey(k) || hashOf(k) !== before.get(k)) bad++
    check('memory: undo of the clear restores every tile exactly', bad === 0 && d.tileStats().tiles === N, `${bad} mismatches`)
    for (let i = 0; i < 8; i++) (tileMemory.tick(), await sleep(30))
    const ts = performance.now()
    const bytes = await saveBwk(d, app.compositor)
    const saveMs = performance.now() - ts
    const tl = performance.now()
    const d2 = await loadBwk(bytes, gpu)
    const loadMs = performance.now() - tl
    const L2 = d2.activeLayer.tiles!
    check('memory: lazy load opens with every tile evicted (decoded on demand)', L2.count === N && L2.residentCount === 0, `${Math.round(loadMs)} ms, ${(bytes.length / MB).toFixed(1)} MB`)
    bad = 0
    for (const k of keys.filter((_, i) => i % 5 === 0)) {
      const s = L2.getKey(k)!
      const px2 = gpu.readRGBA8(s, { x: 0, y: 0, w: 512, h: 512 })
      if (fnv(px2) !== before.get(k)) {
        bad++
        if (bad === 1) {
          const px1 = gpu.readRGBA8(L.getKey(k)!, { x: 0, y: 0, w: 512, h: 512 })
          let nd = 0
          let first = -1
          for (let i = 0; i < px1.length; i++) if (px1[i] !== px2[i]) (nd++, first < 0 && (first = i))
          console.log('[inf] dbg mismatch bytes', nd, 'first', first, Array.from(px1.slice(first - (first % 4), first - (first % 4) + 4)).join(','), Array.from(px2.slice(first - (first % 4), first - (first % 4) + 4)).join(','))
        }
      }
    }
    check('memory: save -> lazy load -> restore is lossless', bad === 0, `save ${Math.round(saveMs)} ms (thumb ${Math.round(infSaveStats.thumbMs)}, zip ${Math.round(infSaveStats.ms)}, encoded ${infSaveStats.encoded}, reused ${infSaveStats.reusedBlobs}), ${bad} mismatches`)
    d2.dispose()
    check('memory: no GL error', gl.getError() === 0)
    tileMemory.budget = prev
    d.dispose()
  }

  /** Zoom-out shimmer: a 1 px black / white line pattern (worst case) must average to flat grey at 2-25 % zoom and stay flat while panning in sub-pixel steps. */
  async function zoomOutQuality(): Promise<void> {
    app.newDocument(4096, 4096, { kind: 'infinite' })
    const d = app.doc
    d.setBackground([0.5, 0.5, 0.5], true)
    const L = d.activeLayer.tiles!
    const px = new Uint8Array(512 * 512 * 4)
    for (let y = 0; y < 512; y++) for (let x = 0; x < 512; x++) {
      const o = (y * 512 + x) * 4
      const on = (x + y) & 1 ? 255 : 0 // 1 px checkerboard: spatial Nyquist, mean 0.5
      px[o] = px[o + 1] = px[o + 2] = on
      px[o + 3] = 255
    }
    for (let ty = -8; ty < 8; ty++) for (let tx = -8; tx < 8; tx++) L.upload(tx, ty, px)
    const cv = gpu.canvas
    const lum = (side: number): Float32Array => {
      // sample only inside the painted square (8192 doc px wide): at 2 % zoom it is just ~160 device px
      const w = Math.max(8, Math.min(cv.width, 400, side))
      const h = Math.max(8, Math.min(cv.height, 300, side))
      const buf = new Uint8Array(w * h * 4)
      gl.bindFramebuffer(gl.FRAMEBUFFER, null)
      gl.readPixels(Math.floor((cv.width - w) / 2), Math.floor((cv.height - h) / 2), w, h, gl.RGBA, gl.UNSIGNED_BYTE, buf)
      const o = new Float32Array(w * h)
      for (let i = 0; i < o.length; i++) o[i] = (buf[i * 4] * 0.3 + buf[i * 4 + 1] * 0.59 + buf[i * 4 + 2] * 0.11) / 255
      return o
    }
    let worst = 0
    let worstFlicker = 0
    const rows: string[] = []
    for (const z of [0.25, 0.1, 0.05, 0.02]) {
      let prev: Float32Array | null = null
      let dev = 0
      let flick = 0
      for (let i = 0; i < 24; i++) {
        app.setView({ cx: i * 0.37 / z, cy: i * 0.21 / z, zoom: z, rot: 0 })
        for (let k = 0; k < 40; k++) {
          app.renderNow()
          await sleep(16)
          if (!app.compositor.inf.stats.pending && k > 2) break
        }
        const f = lum(Math.floor(8192 * z * 0.5))
        let m = 0
        for (let j = 0; j < f.length; j++) m = Math.max(m, Math.abs(f[j] - 0.5))
        dev = Math.max(dev, m)
        if (prev) {
          let a = 0
          for (let j = 0; j < f.length; j++) a += Math.abs(f[j] - prev[j])
          flick = Math.max(flick, a / f.length)
        }
        prev = f
      }
      rows.push(`z${z}: maxDev ${dev.toFixed(3)} flicker ${flick.toFixed(4)}`)
      worst = Math.max(worst, dev)
      worstFlicker = Math.max(worstFlicker, flick)
    }
    check('zoom-out: a 1 px checkerboard averages to flat grey at 25..2 % zoom (no aliasing)', worst < 0.08, rows.join(' | '))
    check('zoom-out: frame-to-frame flicker while panning in sub-pixel steps is negligible', worstFlicker < 0.02, rows.join(' | '))
    d.dispose()
  }

  try {
    // ------------------------------------------------------------------ data model
    app.newDocument(4096, 4096, { kind: 'infinite' })
    let doc = app.doc
    check('infinite document: kind, rgba8 tiles, no full-size surface', doc.kind === 'infinite' && doc.isInfinite && doc.format === 'rgba8' && !!doc.activeLayer.tiles && doc.activeLayer.pixels.w === 1, doc.format)
    check('empty document has no tiles and no content bounds', doc.tileStats().tiles === 0 && doc.contentBounds() === null)

    // ------------------------------------------------------------------ paint in every direction
    cfg('brush', 'hard-round', 60)
    const spots: [number, number][] = []
    for (const sx of [-1, 0, 1]) for (const sy of [-1, 0, 1]) if (sx || sy) spots.push([sx * 50000, sy * 50000])
    for (const [x, y] of spots) stroke('brush', [[x - 120, y - 40], [x, y + 40], [x + 120, y - 40]])
    const filled = spots.map(([x, y]) => {
      const px = flat(doc, { x: x - 20, y: y + 20, w: 40, h: 40 })
      let n = 0
      for (let i = 3; i < px.length; i += 4) if (px[i] > 200) n++
      return n
    })
    check('paint at +-50000 px in all 8 directions (negative coordinates included)', filled.every((n) => n > 100), filled.join(','))
    const b = doc.contentBounds({ tight: true })!
    check('content bounds span the painted area', b.x < -49800 && b.y < -49800 && b.x + b.w > 49800 && b.y + b.h > 49800, JSON.stringify(b))
    check('only the touched tiles exist (sparse)', doc.tileStats().tiles <= 40, String(doc.tileStats().tiles))
    app.setView({ cx: -50000, cy: -50000, zoom: 1, rot: 0 })
    app.renderNow()
    const eye = sampleDocColor(app, 50000, 50000 + 38)
    const none = sampleDocColor(app, 20000, 20000)
    check('eyedropper samples far-away paint and the background elsewhere', !!eye && eye[0] > eye[2] + 0.2 && !!none && none[0] > 0.99 && none[2] > 0.99, JSON.stringify([eye, none]))
    check('display shows far-away paint (tile compositor drew tiles)', app.compositor.inf.stats.drawn > 0, JSON.stringify(app.compositor.inf.stats))

    // ------------------------------------------------------------------ fixed vs infinite equivalence across tile seams
    const R = { x: 480, y: 480, w: 1100, h: 1100 }
    const cases: [string, 'brush' | 'smudge' | 'eraser', string, number][] = [
      ['hard', 'brush', 'hard-round', 120],
      ['soft airbrush', 'brush', 'soft-airbrush', 420],
      ['textured', 'brush', 'sketch-graphite', 70],
      ['smudge', 'smudge', 'smudge-soft', 160],
      ['eraser', 'eraser', 'eraser-hard', 170]
    ]
    for (const [label, tool, preset, size] of cases) {
      const run = (kind: 'fixed' | 'infinite', shift = 0): Uint8ClampedArray => {
        app.newDocument(4096, 4096, kind === 'infinite' ? { kind: 'infinite' } : { format: 'rgba8' })
        const d = app.doc
        if (tool !== 'brush') {
          cfg('brush', 'hard-round', 220, { h: 220, s: 0.8, v: 0.8 })
          stroke('brush', [[620 + shift, 700 + shift], [900 + shift, 1100 + shift], [1400 + shift, 1000 + shift]])
        }
        cfg(tool, preset, size)
        stroke(tool, spiral(1024 + shift, 1024 + shift, 60, 450))
        return flat(d, { x: R.x + shift, y: R.y + shift, w: R.w, h: R.h })
      }
      const ref = run('fixed')
      // grain textures are indexed by absolute coordinates (a shift is a different phase): only compare them in place
      for (const shift of preset === 'sketch-graphite' ? [0] : [0, 49152, -49152]) {
        const inf = run('infinite', shift)
        const d = diff(ref, inf)
        const lim = tool === 'smudge' ? 20 : 4
        // smudge: the fixed reference has stale-scratch artefacts at dab corners (pre-existing), so only a bounded deviation is required
        check(`seams: ${label} identical to a fixed canvas at offset ${shift}`, d.max <= lim && (tool === 'smudge' || d.n2 <= ref.length / 4 / 500), `max=${d.max.toFixed(1)} >2:${d.n2}`)
      }
    }

    // ------------------------------------------------------------------ undo / redo exactness
    app.newDocument(4096, 4096, { kind: 'infinite' })
    doc = app.doc
    const states: string[] = [hashDoc(doc)]
    const steps: [() => void][] = [
      [() => { cfg('brush', 'hard-round', 200); stroke('brush', spiral(0, 0, 40, 600)) }],
      [() => { cfg('brush', 'soft-airbrush', 400, { h: 200, s: 0.7, v: 0.8 }); stroke('brush', spiral(5000, -3000, 40, 700)) }],
      [() => { cfg('smudge', 'smudge-soft', 200); stroke('smudge', spiral(0, 0, 100, 500, 60)) }],
      [() => { cfg('eraser', 'eraser-hard', 260); stroke('eraser', spiral(0, 0, 40, 300, 60)) }],
      [() => doc.clearLayer(doc.activeId)]
    ]
    for (const [fn] of steps) {
      fn()
      states.push(hashDoc(doc))
    }
    let ok = true
    for (let k = steps.length; k >= 1; k--) {
      doc.undo()
      if (hashDoc(doc) !== states[k - 1]) ok = false
    }
    check('undo restores every earlier state exactly (tile allocation and freeing included)', ok && doc.tileStats().tiles === 0)
    ok = true
    for (let k = 1; k <= steps.length; k++) {
      doc.redo()
      if (hashDoc(doc) !== states[k]) ok = false
    }
    check('redo reproduces every state exactly', ok)

    // ------------------------------------------------------------------ region API
    app.newDocument(4096, 4096, { kind: 'infinite' })
    doc = app.doc
    cfg('brush', 'hard-round', 150)
    stroke('brush', [[-300, -200], [200, 150], [900, -100]])
    const layer = doc.activeLayer
    const rect = { x: -700, y: -400, w: 1800, h: 900 }
    const before = flat(doc, rect)
    const s = doc.readRegion(layer, rect)
    const back = gpu.readRGBA8(s, { x: 0, y: 0, w: s.w, h: s.h })
    check('readRegion assembles tiles (negative origin) into one texture', diff(before, back).max === 0 && s.w === 1800 && s.h === 900)
    s.dispose()
    const nHist = doc.history.undoCount
    doc.withRegion(layer, rect, (surf, r) => {
      // invert alpha-weighted colour with a tiny pass: just blit the surface onto itself shifted by 40 px
      const tmp = gpu.surface(r.w, r.h, surf.fmt, 0)
      gpu.blit(surf, { x: 0, y: 0, w: r.w - 40, h: r.h }, tmp, 40, 0)
      gpu.blit(tmp, { x: 0, y: 0, w: r.w, h: r.h }, surf, 0, 0)
      tmp.dispose()
    }, { undoLabel: 'Shift', type: 'filter' })
    const shifted = flat(doc, rect)
    let shiftOk = true
    for (let y = 100; y < 800 && shiftOk; y += 37) for (let x = 100; x < 1700; x += 41) {
      const a = (y * rect.w + x) * 4
      const o = (y * rect.w + x - 40) * 4
      if (Math.abs(shifted[a + 3] - before[o + 3]) > 1) { shiftOk = false; break }
    }
    check('withRegion lets a full-texture tool work on tiles and commits back as ONE undo step', shiftOk && doc.history.undoCount === nHist + 1)
    doc.undo()
    check('region write is undoable', diff(flat(doc, rect), before).max === 0)

    // ------------------------------------------------------------------ filters (region-limited), layers
    const hBefore = hashDoc(doc)
    applyFilter(doc, 'invert')
    check('legacy filter works through the region API (region-limited)', hashDoc(doc) !== hBefore)
    doc.undo()
    check('filter undo restores the pixels', hashDoc(doc) === hBefore)
    const dup = doc.duplicateLayer(doc.activeId)!
    check('duplicate layer clones the tiles', !!dup.tiles && dup.tiles.count === layer.tiles!.count && hashDoc(doc) !== hBefore)
    doc.deleteLayer(dup.id)

    // ------------------------------------------------------------------ guards: nothing crashes, features say "not available"
    doc.addMask(doc.activeId)
    check('layer masks work on infinite canvases (own tile store)', !!doc.activeLayer.mask && !!doc.activeLayer.maskTiles)
    doc.undo()
    check('mask add is undone', !doc.activeLayer.mask)

    // ------------------------------------------------------------------ export / flatten
    app.setView({ cx: 300, cy: 0, zoom: 1, rot: 0 })
    const fl = flatForExport(doc, app.compositor, true)
    const tb = doc.contentBounds({ tight: true, visibleOnly: true })!
    check('PNG export renders the tight content bounds', fl.w === tb.w && fl.h === tb.h && fl.px.length === tb.w * tb.h * 4, `${fl.w}x${fl.h} vs ${tb.w}x${tb.h}`)
    let painted = 0
    for (let i = 3; i < fl.px.length; i += 4) if (fl.px[i] === 255) painted++
    check('exported pixels are opaque (background composited)', painted === fl.w * fl.h)
    const sm = app.compositor.readFlattened({ x: -1500, y: -1500, w: 3000, h: 3000 }, 0.1, false)
    let any = 0
    for (let i = 3; i < sm.px.length; i += 4) if (sm.px[i] > 0) any++
    check('readFlattened(rect, scale) renders a down-scaled view through the pyramid', sm.w === 300 && sm.h === 300 && any > 50, `${sm.w}x${sm.h} nonEmpty=${any}`)

    // ------------------------------------------------------------------ save / load
    const t0 = performance.now()
    const bytes = await saveBwk(doc, app.compositor)
    const d2 = await loadBwk(bytes, gpu)
    check('save -> load: infinite kind and every tile come back', d2.kind === 'infinite' && d2.layers.length === doc.layers.length && d2.tileStats().tiles === doc.tileStats().tiles, `${Math.round(performance.now() - t0)} ms`)
    let worst = 0
    const a = flat(doc, { x: -700, y: -400, w: 1800, h: 900 })
    const bpx = d2.readRegionPixels(d2.getLayer(doc.activeId)!, { x: -700, y: -400, w: 1800, h: 900 })
    worst = diff(a, bpx).max
    check('save -> load: pixels identical (premultiplied diff <= 1 level)', worst <= 1.01, worst.toFixed(2))
    check('loaded tiles are addressable by key', !!d2.getLayer(doc.activeId)!.tiles!.getKey(tileKey(-1, -1)))
    d2.dispose()

    await runInfiniteToolsTests(app, { check, cfg, stroke, flat, sleep })
    await runInfiniteSelectionTests(app, { check, cfg, stroke, flat, sleep })

    await memoryTests()
    await zoomOutQuality()

    // ------------------------------------------------------------------ fixed documents are untouched
    app.newDocument(1024, 768, { background: { color: [1, 1, 1], visible: true } })
    const fx = app.doc
    check('fixed document: kind fixed, full-size surface, no tiles', fx.kind === 'fixed' && !fx.activeLayer.tiles && fx.activeLayer.pixels.w === 1024 && !!fx.contentBounds())
    cfg('brush', 'hard-round', 60)
    stroke('brush', [[100, 100], [500, 300], [900, 200]])
    const fb = await saveBwk(fx, app.compositor)
    const f2 = await loadBwk(fb, gpu)
    check('fixed document save/load unchanged', f2.kind === 'fixed' && f2.width === 1024 && f2.height === 768)
    f2.dispose()

    check('no GL error during the whole run', gl.getError() === 0)
  } catch (e) {
    check('selftest ran to the end', false, String((e as Error).stack ?? e))
  }
  console.log('[inf] done, failures:', failures.length)
  return failures.length === 0
}
