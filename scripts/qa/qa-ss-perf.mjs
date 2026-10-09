// Smart selection performance: model load / encode / per-click decode / click-to-selection / peak memory / idle CPU, per execution provider.
// usage: node scripts/qa/qa-ss-perf.mjs <img.jpg> [fast|precise] [userDataDir] [bigSide]
import * as L from './ss-lib.mjs'

const [img, model = 'fast', ud, big = '0'] = process.argv.slice(2)
const out = []
for (const ep of ['webgpu', 'wasm']) {
  const { app, page, errs } = await L.launch({ userData: ud })
  let peak = 0
  let peakGpu = 0
  const sample = async () => {
    const m = await app.evaluate(({ app }) => app.getAppMetrics().map((p) => ({ type: p.type, ws: p.memory.workingSetSize, priv: p.memory.privateBytes ?? 0, cpu: p.cpu.percentCPUUsage })))
    const total = m.reduce((s, p) => s + p.ws, 0) // KB
    peak = Math.max(peak, total)
    peakGpu = Math.max(peakGpu, m.filter((p) => p.type === 'GPU').reduce((s, p) => s + p.ws, 0))
    return m
  }
  const timer = setInterval(() => void sample().catch(() => undefined), 250)
  try {
    await L.loadImage(page, img)
    if (+big) {
      // stress: replace the picture by an upscaled copy (long side = big)
      await page.evaluate(async (side) => {
        const app = window.brushwork_app
        const px = app.gpu.readRGBA8(app.doc.layers[0].pixels, { x: 0, y: 0, w: app.doc.width, h: app.doc.height })
        const oc = new OffscreenCanvas(app.doc.width, app.doc.height)
        oc.getContext('2d').putImageData(new ImageData(px, app.doc.width, app.doc.height), 0, 0)
        const k = side / Math.max(app.doc.width, app.doc.height)
        const w = Math.round(app.doc.width * k), h = Math.round(app.doc.height * k)
        const big = new OffscreenCanvas(w, h)
        big.getContext('2d').drawImage(oc, 0, 0, w, h)
        const d = big.getContext('2d').getImageData(0, 0, w, h).data
        const doc = app.newDocument(w, h)
        app.gpu.uploadRGBA8(doc.activeLayer.pixels, 0, 0, w, h, d)
        return { w, h }
      }, +big)
    }
    const dim = await page.evaluate(() => ({ w: window.brushwork_app.doc.width, h: window.brushwork_app.doc.height }))
    await page.evaluate((ep) => { window.brushwork_smartselect.ss.ep = ep; window.brushwork_smartselect.c.engine.ep = ep }, ep)
    const base = (await sample()).reduce((s, p) => s + p.ws, 0)
    const t0 = Date.now()
    await L.openTool(page, model)
    await L.waitIdle(page, 300000)
    const first = Date.now() - t0
    const st = await page.evaluate(() => ({ ...window.brushwork_smartselect.c.engine.stats }))
    // second analysis of the same image = steady state (shader cache warm)
    await page.evaluate(() => { const c = window.brushwork_smartselect.c; c.engine.encodedKey = null; c.resample() })
    await L.waitIdle(page, 300000)
    const st2 = await page.evaluate(() => ({ ...window.brushwork_smartselect.c.engine.stats }))
    const cx = dim.w / 2, cy = dim.h * 0.56
    const clicks = []
    const decodes = []
    for (let i = 0; i < 6; i++) {
      const t1 = Date.now()
      await L.click(page, cx + (i % 3) * 20 - 20, cy + (i % 2) * 20)
      await L.waitIdle(page, 120000)
      clicks.push(Date.now() - t1)
      decodes.push(await page.evaluate(() => window.brushwork_smartselect.c.metrics))
      await page.evaluate(() => window.brushwork_smartselect.c.finishSession(false))
    }
    const active = await sample()
    // idle while the tool is open but untouched
    await new Promise((r) => setTimeout(r, 3000))
    const idleOpen = (await sample()).reduce((s, p) => s + p.cpu, 0)
    await page.evaluate(() => { const b = window.brushwork_smartselect; b.c.deactivate(false); b.c.engine.release() })
    await new Promise((r) => setTimeout(r, 4000))
    const idleClosed = await sample()
    out.push({
      ep: st.ep + '/' + st.decEp, model, doc: `${dim.w}x${dim.h}`, threads: st.threads,
      loadMs: Math.round(st.loadMs), encodeFirstMs: Math.round(st.lastEncodeMs), encodeWarmMs: Math.round(st2.lastEncodeMs),
      decodeMs: Math.round(decodes.map((d) => d.decodeMs).sort((a, b) => a - b)[3]), refineMs: Math.round(decodes.map((d) => d.refineMs).sort((a, b) => a - b)[3]), clickToSelMs: Math.round(decodes.map((d) => d.totalMs).sort((a, b) => a - b)[3]),
      openToReadyMs: first, peakMB: Math.round(peak / 1024), peakGpuMB: Math.round(peakGpu / 1024), baselineMB: Math.round(base / 1024),
      idleCpuToolOpen: +idleOpen.toFixed(1), idleCpuAfterRelease: +idleClosed.reduce((s, p) => s + p.cpu, 0).toFixed(1)
    })
  } catch (e) {
    console.log('ERR', ep, e)
  }
  clearInterval(timer)
  await app.close()
}
console.table(out)
