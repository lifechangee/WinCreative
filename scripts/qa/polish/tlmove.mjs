import { execFileSync } from 'child_process'
import { resolve } from 'path'
import { mkdirSync } from 'fs'
export default async ({ page, ev, newDoc, strokeDoc, shot }) => {
  const dir = resolve('qa-screens/v030'); mkdirSync(dir, { recursive: true })
  await newDoc(page, 'fixed', 2000, 2000)
  await ev(() => { window.brushwork_frame.createFrame(540, 960); window.brushwork_app.state.settings.size = 60; window.brushwork_app.state.setTool('brush') })
  await page.waitForTimeout(800)
  await strokeDoc(page, [[800, 700], [1100, 1200]], { zoom: 0.6 })
  await page.waitForTimeout(2500)
  // resize to landscape + move
  await ev(() => window.brushwork_frame.editFrame({ w: 960, h: 540, x: 300, y: 400 }))
  await page.waitForTimeout(2500)
  await strokeDoc(page, [[400, 500], [1100, 800]], { zoom: 0.6 })
  await page.waitForTimeout(2500)
  await ev(() => window.brushwork_frame.editFrame({ w: 700, h: 700, x: 700, y: 900 }))
  await page.waitForTimeout(2500)
  await strokeDoc(page, [[800, 1000], [1300, 1500]], { zoom: 0.6 })
  const out = resolve(dir, 'tl-move.mp4').split(String.fromCharCode(92)).join('/')
  const r = await page.evaluate(async (out) => {
    const an = window.brushwork_animio; const rec = an.tl.current; await rec.flush()
    const rs = await an.tle.resolve(rec)
    const res = await an.tle.export(rec, window.brushwork_app.doc, rs, { format: 'h264', res: '1080p', fps: 24, quality: 'standard' }, out)
    return { ok: res.ok, error: res.error, w: res.width, h: res.height, frames: rec.count, out: rec.out }
  }, out)
  console.log(JSON.stringify(r))
  const b64 = await page.evaluate(async () => { const rec = window.brushwork_animio.tl.current; const o = []; for (let i = 0; i < rec.count; i++) { const b = await rec.frame(i); let s = ''; for (const c of new Uint8Array(b)) s += String.fromCharCode(c); o.push(btoa(s)) } return o })
  const { writeFileSync } = await import('fs')
  b64.forEach((b, i) => writeFileSync(resolve(dir, `tl-raw-${i}.jpg`), Buffer.from(b, 'base64')))
  const n = r.frames
  for (const [i, nm] of [[0.15, 'a'], [0.5, 'b'], [0.99, 'c']]) execFileSync('ffmpeg', ['-y', '-v', 'error', '-ss', String(i * (n / 24)), '-i', out, '-vframes', '1', resolve(dir, `tl-move-${nm}.png`)])
}
