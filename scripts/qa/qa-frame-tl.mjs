// Time-lapse of the frame area / visible viewport -> MP4 -> ffprobe + extracted frames (qa-frame/).
// usage: node scripts/qa/qa-frame-tl.mjs [--out out-frame]
import { launch, newDoc, outDirOf, strokeDoc } from './qa-inf-lib.mjs'
import { execFileSync } from 'child_process'
import { mkdirSync } from 'fs'
import { resolve } from 'path'
const FF = process.env.FFMPEG_DIR ?? 'ffmpeg'
const { app, page, errors } = await launch(outDirOf(process.argv.slice(2)))
const dir = resolve('qa-frame'); mkdirSync(dir, { recursive: true })
let fail = 0
const ok = (c, m) => { console.log((c ? 'PASS ' : 'FAIL ') + m); if (!c) fail++ }
async function exportMp4(name) {
  return page.evaluate(async (out) => {
    const an = window.brushwork_animio
    const rec = an.tl.current
    await rec.flush()
    const r = await an.tle.resolve(rec)
    const res = await an.tle.export(rec, window.brushwork_app.doc, r, { format: 'h264', res: '1080p', fps: 24, quality: 'standard' }, out)
    return { ok: res.ok, error: res.error, w: res.width, h: res.height, frames: rec.count, out: rec.out }
  }, resolve(dir, name).replaceAll(String.fromCharCode(92), '/'))
}
const probe = (f) => execFileSync('ffprobe', ['-v', 'error', '-select_streams', 'v:0', '-show_entries', 'stream=width,height,nb_frames', '-of', 'csv=p=0', f]).toString().trim()
const grab = (f, png) => execFileSync('ffmpeg', ['-y', '-v', 'error', '-ss', '0.2', '-i', f, '-vframes', '1', png])

// A: fixed doc with a 9:16 frame inside a 2000x2000 canvas
await newDoc(page, 'fixed', 2000, 2000)
await page.evaluate(() => { window.brushwork_frame.createFrame(540, 960); window.brushwork_app.state.settings.size = 70 })
await page.waitForTimeout(800)
for (let i = 0; i < 4; i++) await strokeDoc(page, [[600 + i * 120, 600], [800 + i * 120, 1400]], { zoom: 0.6 })
let r = await exportMp4('frame-fixed.mp4'); console.log(JSON.stringify(r))
ok(r.ok && r.out && Math.abs(r.out.w / r.out.h - 0.5625) < 0.02, 'fixed: recording is 9:16 shaped ' + JSON.stringify(r.out))
const pa = probe(resolve(dir, 'frame-fixed.mp4')); console.log('ffprobe', pa)
ok(/^\d+,\d+/.test(pa) && Math.abs(Number(pa.split(',')[0]) / Number(pa.split(',')[1]) - 0.5625) < 0.02, 'fixed: mp4 aspect 9:16 (' + pa + ')')
grab(resolve(dir, 'frame-fixed.mp4'), resolve(dir, 'frame-fixed.png'))

// B: frameless infinite doc, pan/zoom/rotate between strokes
await newDoc(page, 'infinite', 2000, 2000)
await page.waitForTimeout(800)
await page.evaluate(() => { window.brushwork_app.state.settings.size = 50 })
await strokeDoc(page, [[-300, -100], [300, 100]], { zoom: 1 })
await strokeDoc(page, [[2000, 2000], [2600, 2300]], { zoom: 0.5 })
await page.evaluate(() => window.brushwork_app.setView({ cx: 2300, cy: 2150, zoom: 0.8, rot: 0.5 }))
await strokeDoc(page, [[2100, 2100], [2500, 2200]], { zoom: 0.8 })
r = await exportMp4('view-inf.mp4'); console.log(JSON.stringify(r))
ok(r.ok && r.frames >= 3, 'infinite view: exported ' + r.frames + ' frames')
const pb = probe(resolve(dir, 'view-inf.mp4')); console.log('ffprobe', pb)
grab(resolve(dir, 'view-inf.mp4'), resolve(dir, 'view-inf.png'))
console.log('errors', errors.length ? errors : 'none')
await app.close()
process.exit(fail ? 1 : 0)
