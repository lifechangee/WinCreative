import type { App } from '../../app/app'
import type { Document } from '../../doc/document'
import { tileKey } from '../../core/tiles'
import { tileMemory } from '../../doc/tileMemory'
import { memCounters } from '../../doc/tileStore'
import { loadBwk, saveBwk } from '../../io/bwk'
import { codec, ioStats } from '../../io/tileIo'
import { infSaveStats } from '../../io/bwkSaveInf'

/**
 * BW_INF_BENCH=1: measurements for the memory / save / open targets (prints `[infbench] key value`).
 * Content = compressible painting-like tiles (stripes + opaque discs) from 8 templates, so every tile can be hash-verified.
 */
export async function runInfiniteBench(app: App): Promise<boolean> {
  const out = (k: string, v: unknown): void => console.log('[infbench]', k, typeof v === 'number' ? Math.round(v * 100) / 100 : v)
  const gpu = app.gpu
  const gl = gpu.gl
  const sleep = (ms: number): Promise<void> => new Promise((r) => setTimeout(r, ms))
  const frame = (): Promise<number> => new Promise((r) => requestAnimationFrame((t) => r(t)))
  await sleep(800)
  gl.getError()
  const MB = 1048576
  const N_BIG = Number((await window.bwGallery?.env('BW_INF_BENCH_TILES')) ?? 20000) || 20000
  out('budget.gpuMB', tileMemory.budget.gpu / MB)
  out('budget.cpuMB', tileMemory.budget.cpu / MB)

  const templates: Uint8Array[] = []
  for (let t = 0; t < 8; t++) {
    const px = new Uint8Array(512 * 512 * 4)
    for (let y = 0; y < 512; y++) {
      for (let x = 0; x < 512; x++) {
        const o = (y * 512 + x) * 4
        const d = Math.hypot(x - 256 - t * 9, y - 256 + t * 5)
        const disc = d < 150 + t * 8
        px[o] = disc ? (200 + t * 7) & 255 : ((x >> 3) * 5 + t * 30) & 255
        px[o + 1] = disc ? 60 + t * 20 : ((y >> 4) * 7) & 255
        px[o + 2] = disc ? 90 : 200 - t * 10
        px[o + 3] = disc ? 255 : (x + y) % 64 < 32 ? 0 : 160
      }
    }
    templates.push(px)
  }
  const fnv = (px: Uint8ClampedArray): number => {
    let h = 2166136261
    for (let i = 0; i < px.length; i++) h = Math.imul(h ^ px[i], 16777619) >>> 0
    return h
  }
  const tmplHash: number[] = []
  {
    app.newDocument(4096, 4096, { kind: 'infinite' })
    const L = app.doc.activeLayer.tiles!
    for (let t = 0; t < 8; t++) {
      L.upload(0, 0, templates[t])
      tmplHash.push(fnv(gpu.readRGBA8(L.get(0, 0)!, { x: 0, y: 0, w: 512, h: 512 })))
    }
    app.doc.dispose()
  }

  const populate = async (doc: Document, layers: number, per: number, side: number, report: boolean): Promise<void> => {
    const t0 = performance.now()
    let peak = 0
    for (let li = 0; li < layers; li++) {
      const layer = li === 0 ? doc.layers[0] : doc.addLayer()
      const L = layer.tiles!
      for (let i = 0; i < per; i++) {
        const tx = i % side
        const ty = Math.floor(i / side)
        L.upload(tx, ty, templates[(tx * 3 + ty * 5 + li) & 7])
        if (i % 1000 === 999) out('populate.progress', li * per + i + 1)
        if (i % 40 === 39) {
          await frame()
          tileMemory.tick()
          peak = Math.max(peak, tileMemory.residentBytes())
          let guard = 0
          while (tileMemory.residentBytes() > tileMemory.budget.gpu * 1.15 && guard++ < 4000) {
            tileMemory.tick()
            peak = Math.max(peak, tileMemory.residentBytes())
            await sleep(4)
          }
        }
      }
    }
    if (report) {
      out('populate.ms', performance.now() - t0)
      out('populate.peakGpuMB', peak / MB)
    }
  }

  // ---- A. many tiles over 3 layers under the default budget
  app.newDocument(4096, 4096, { kind: 'infinite' })
  app.setView({ cx: 5e7, cy: 5e7, zoom: 1, rot: 0 })
  let doc = app.doc
  const per = Math.ceil(N_BIG / 3)
  const side = Math.ceil(Math.sqrt(per))
  await populate(doc, 3, per, side, true)
  for (let i = 0; i < 40; i++) (tileMemory.tick(), await sleep(25))
  const st = doc.tileStats()
  out('big.tiles', st.tiles)
  out('big.gpuTiles', st.gpu)
  out('big.compressedTiles', st.cpu)
  out('big.diskTiles', st.disk)
  out('big.gpuMB', tileMemory.residentBytes() / MB)
  out('big.cpuMB', st.cpuBytes / MB)
  out('big.diskMB', st.diskBytes / MB)
  out('big.underBudget', tileMemory.residentBytes() <= tileMemory.budget.gpu * 1.05)
  let bad = 0
  let checked = 0
  const t1 = performance.now()
  for (let li = 0; li < doc.layers.length; li++) {
    const L = doc.layers[li].tiles!
    const step = li === 0 ? 12 : 60
    for (let i = 0; i < per; i += step) {
      const tx = i % side
      const ty = Math.floor(i / side)
      const k = tileKey(tx, ty)
      if (i % 2 === 0 && L.isCold(k)) {
        tileMemory.prefetch(L, k, 0)
        await tileMemory.settle()
      }
      const s = L.getKey(k)!
      const h = fnv(gpu.readRGBA8(s, { x: 0, y: 0, w: 512, h: 512 }))
      checked++
      if (h !== tmplHash[(tx * 3 + ty * 5 + li) & 7]) bad++
      if (i % 30 === 0) (tileMemory.tick(), await sleep(0))
    }
  }
  out('big.hashChecked', checked)
  out('big.hashMismatch', bad)
  out('big.hashMs', performance.now() - t1)
  for (let i = 0; i < 30; i++) (tileMemory.tick(), await sleep(25))

  // ---- B. panning frame times over the evicted content
  const pan = async (zoom: number, n: number): Promise<void> => {
    const ts: number[] = []
    let last = await frame()
    const w = side * 512
    for (let i = 0; i < n; i++) {
      const u = i / n
      app.setView({ cx: 256 + u * (w - 1500) + 700, cy: 256 + Math.sin(u * 6) * 3000 + w / 2, zoom, rot: 0 })
      const t = await frame()
      ts.push(t - last)
      last = t
    }
    ts.sort((a, b) => a - b)
    out('pan.z' + zoom + '.p50', ts[Math.floor(n * 0.5)])
    out('pan.z' + zoom + '.p95', ts[Math.floor(n * 0.95)])
    out('pan.z' + zoom + '.max', ts[n - 1])
  }
  await pan(1, 500)
  await pan(0.25, 400)
  await pan(0.05, 300)
  out('pan.syncRestores', memCounters.syncRestores)
  out('pan.asyncRestores', memCounters.restores)
  out('pan.glErrors', gl.getError())
  doc.dispose()

  // ---- C. 2000-tile document: full save, incremental save, open
  app.newDocument(4096, 4096, { kind: 'infinite' })
  doc = app.doc
  app.setView({ cx: 5e7, cy: 5e7, zoom: 1, rot: 0 })
  await populate(doc, 1, 2000, 45, false)
  for (let i = 0; i < 20; i++) (tileMemory.tick(), await sleep(25))
  await tileMemory.settle()
  await sleep(1500) // let background eviction finish so the save is measured alone
  const frames: number[] = []
  const slow: string[] = []
  let sampling = true
  const s0 = performance.now()
  void (async () => {
    let last = await frame()
    while (sampling) {
      const t = await frame()
      frames.push(t - last)
      if (t - last > 40) slow.push(Math.round(t - s0) + ':' + Math.round(t - last))
      last = t
    }
  })()
  const bytes = await saveBwk(doc, app.compositor, {}, { background: true }) // what the gallery autosave does
  const full = performance.now() - s0
  sampling = false
  await frame()
  out('save.full.ms', full)
  out('save.full.MB', bytes.length / MB)
  out('save.full.encoded', infSaveStats.encoded)
  out('save.full.reused', infSaveStats.reusedBlobs)
  out('save.full.thumbMs', infSaveStats.thumbMs)
  out('save.full.readbackMs', infSaveStats.readMs)
  out('save.full.zipMs', infSaveStats.ms)
  out('save.full.io', JSON.stringify(ioStats))
  out('save.full.workers', codec.size)
  out('save.full.maxFrameMs', Math.max(...frames))
  out('save.full.frames', frames.length)
  out('save.full.slowFrames(atMs:dur)', slow.slice(0, 12).join(' '))
  app.setView({ cx: 600, cy: 600, zoom: 1, rot: 0 })
  app.renderNow()
  app.state.setTool('brush')
  app.state.settings.size = 40
  const t = app.tools.get('brush')!
  const pts = [0, 1, 2, 3, 4, 5, 6, 7].map((i) => ({ x: 300 + i * 30, y: 300 + i * 10, pressure: 0.7, tiltX: 0, tiltY: 0, twist: 0, t: 1000 + i * 8, pointerType: 'pen' as const }))
  t.begin(pts[0], app)
  t.move(pts.slice(1), app)
  t.end(app)
  const s1 = performance.now()
  await saveBwk(doc, app.compositor)
  out('save.incremental.ms', performance.now() - s1)
  out('save.incremental.encoded', infSaveStats.encoded)
  doc.dispose()
  const o0 = performance.now()
  const d2 = await loadBwk(bytes, gpu)
  app.setDocument(d2)
  app.setView({ cx: 2000, cy: 2000, zoom: 1, rot: 0 })
  let shown = 0
  for (let i = 0; i < 600; i++) {
    await frame()
    const s = app.compositor.inf.stats
    if (s.drawn > 0 && !s.pending) {
      shown = performance.now() - o0
      break
    }
  }
  out('open.canvasShownMs', shown)
  out('open.tiles', d2.tileStats().tiles)
  out('bench.glErrors', gl.getError())
  d2.dispose()
  return true
}
