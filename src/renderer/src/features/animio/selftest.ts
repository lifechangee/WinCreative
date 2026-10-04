import type { App } from '../../app/app'
import { loadBwk, saveBwk } from '../../io/bwk'
import { animioApi } from './api'
import { getRecorder } from './timelapse'
import { timelapsePlan, videoSize } from './schedule'

const sleep = (ms: number): Promise<void> => new Promise((r) => setTimeout(r, ms))
const raf = (): Promise<void> =>
  new Promise((r) => {
    requestAnimationFrame(() => r())
    setTimeout(r, 40)
  })

export interface TestCtx {
  app: App
  out: string
  log(...a: unknown[]): void
  check(name: string, cond: boolean, extra?: string): void
  stroke(pts: [number, number, number][]): Promise<void>
}

/** BW_ANIMIO_TEST=1 BW_ANIMIO_OUT=<dir>  npx electron .   -- see ARCHITECTURE.md "Self-test". */
export async function runAnimioSelfTest(app: App, out: string): Promise<void> {
  const log = (...a: unknown[]): void => console.warn('[animio-test]', ...a)
  let ok = true
  const check = (name: string, cond: boolean, extra = ''): void => {
    log((cond ? 'PASS ' : 'FAIL ') + name + ' ' + extra)
    if (!cond) ok = false
  }
  const sep = out.includes('\\') ? '\\' : '/'
  const path = (f: string): string => out + sep + f
  try {
    await sleep(500)
    // ---- synthetic pen input (same path as a real stylus)
    const canvas = app.canvas
    let ptr = 100
    const client = (dx: number, dy: number): { x: number; y: number } => {
      const rect = canvas.getBoundingClientRect()
      const v = app.view
      const c = Math.cos(v.rot)
      const s = Math.sin(v.rot)
      const px = dx - v.cx
      const py = dy - v.cy
      const sw = app.cssSize()
      return { x: rect.left + sw.w / 2 + v.zoom * (c * px - s * py), y: rect.top + sw.h / 2 + v.zoom * (s * px + c * py) }
    }
    const fire = (type: string, x: number, y: number, p: number): void => {
      const c = client(x, y)
      canvas.dispatchEvent(new PointerEvent(type, { pointerId: ptr, pointerType: 'pen', isPrimary: true, clientX: c.x, clientY: c.y, pressure: p, bubbles: true, cancelable: true, button: 0, buttons: type === 'pointerup' ? 0 : 1 }))
    }
    const stroke = async (pts: [number, number, number][]): Promise<void> => {
      ptr++
      fire('pointerdown', ...pts[0])
      for (let i = 1; i < pts.length; i++) {
        fire('pointermove', ...pts[i])
        if (i % 5 === 0) await raf()
      }
      fire('pointerup', pts[pts.length - 1][0], pts[pts.length - 1][1], 0)
      await raf()
      await sleep(180)
    }
    const wave = (y: number, amp: number, x0 = 200, x1 = 1400): [number, number, number][] => {
      const o: [number, number, number][] = []
      for (let i = 0; i <= 40; i++) {
        const t = i / 40
        o.push([x0 + (x1 - x0) * t, y + Math.sin(t * Math.PI * 3) * amp, 0.2 + 0.7 * Math.sin(t * Math.PI)])
      }
      return o
    }
    const tctx: TestCtx = { app, out, log, check, stroke }

    // ================= TIME-LAPSE =================
    app.newDocument(1600, 1200)
    await sleep(600)
    const rec = getRecorder(app.doc)!
    check('recorder auto-attached to new canvas', !!rec)
    app.state.setTool('brush')
    app.state.setPreset('brush', 'hard-round')
    app.state.setSize(40)
    let sc = 0
    const hist: Record<string, number> = {}
    app.doc.events.on('commit', (e) => {
      hist[e.type] = (hist[e.type] ?? 0) + 1
      if (e.type === 'stroke') sc++
    })
    const hues = [0, 30, 60, 120, 180, 210, 260, 300]
    for (let i = 0; i < hues.length; i++) {
      app.state.setColor({ h: hues[i], s: 0.8, v: 0.85 })
      await stroke(wave(150 + i * 130, 60))
    }
    app.doc.undo()
    await sleep(250)
    app.doc.redo()
    app.doc.addLayer({ name: 'second' })
    await sleep(300)
    await rec.flush()
    log('commit types:', JSON.stringify(hist))
    log('frames after drawing:', rec.count, 'bytes', rec.bytes, 'strokes', rec.strokes, 'tracked ms', Math.round(rec.trackedMs))
    check('frames captured for every stroke (>= 1 initial + 8 strokes)', rec.count >= 9, 'count=' + rec.count)
    check('stroke stats', rec.strokes === sc && sc >= 6, 'strokes=' + rec.strokes + ' observed=' + sc)

    // ---- persistence across save / load
    const before = rec.count
    const bytes = await saveBwk(app.doc, app.compositor)
    const { unzipSync } = await import('fflate')
    const files = unzipSync(bytes)
    check('bwk contains timelapse', !!files['timelapse/frames.bin'] && !!files['timelapse/index.json'], 'frames.bin=' + files['timelapse/frames.bin']?.length)
    const doc2 = await loadBwk(bytes, app.gpu)
    app.setDocument(doc2)
    await sleep(700)
    const rec2 = getRecorder(app.doc)!
    check('recording restored after load', rec2 !== rec && rec2.count === before, `restored=${rec2.count} expected=${before}`)
    app.state.setColor({ h: 330, s: 0.9, v: 0.9 })
    await stroke(wave(1050, 40))
    await rec2.flush()
    check('recording continues after load', rec2.count === before + 1 || rec2.count === before + 2, 'count=' + rec2.count)
    check('strokes carried over', rec2.strokes === sc + 1, 'strokes=' + rec2.strokes + ' expected=' + (sc + 1))

    // ---- export MP4 (30 s version and full length)
    const total = rec2.count
    const plan = timelapsePlan(total, 'full', 30)
    const sz = videoSize(app.doc.width, app.doc.height, '1080p')
    const mp4 = path('timelapse-full.mp4')
    const res = await animioApi().tl.export({ id: rec2.id, indices: plan.indices, repeats: plan.repeats, fps: 30, width: sz.width, height: sz.height, out: mp4, codec: 'h264' })
    check('timelapse mp4 exported', res.ok, res.error ?? 'size=' + res.size)
    const probe = await animioApi().ff.probe(mp4)
    log('ffprobe full:', probe)
    if (probe) {
      const j = JSON.parse(probe)
      const s = j.streams[0]
      check('mp4 frame count', Number(s.nb_read_frames) === plan.frames, `${s.nb_read_frames} vs ${plan.frames}`)
      check('mp4 resolution', s.width === sz.width && s.height === sz.height, `${s.width}x${s.height}`)
      check('mp4 is h264', s.codec_name === 'h264' && s.pix_fmt === 'yuv420p')
    } else check('ffprobe available', false)
    const plan30 = timelapsePlan(total, 'short', 30)
    const mp430 = path('timelapse-30s.mp4')
    const r30 = await animioApi().tl.export({ id: rec2.id, indices: plan30.indices, repeats: plan30.repeats, fps: 30, width: 1080, height: 810, out: mp430, codec: 'h264' })
    check('30s version exported', r30.ok, r30.error)

    await import('./selftestTl').then((m) => m.runTimelapseEditorTests(tctx))
    await import('./selftestMore').then((m) => m.runMore(tctx))
  } catch (e) {
    console.error('[animio-test] exception', e)
    ok = false
  }
  log('done ok=' + ok)
  await window.brushwork!.selfTestDone({ ok })
}
