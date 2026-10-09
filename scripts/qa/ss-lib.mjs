// Shared helpers for the Smart selection QA scripts (Playwright + Electron, isolated profile, explicit timeouts).
import { _electron as electron } from 'playwright-core'
import fs from 'node:fs'
import os from 'node:os'
import path from 'node:path'

export const sleep = (ms) => new Promise((r) => setTimeout(r, ms))

export async function launch({ out = 'out-ss', lang = 'en', env = {}, userData = null } = {}) {
  const ud = userData ?? path.join(os.tmpdir(), 'bw-ss-qa-' + Date.now() + '-' + Math.floor(Math.random() * 1e6))
  const exe = process.env.BW_EXE // QA against a packaged build
  const app = await electron.launch({
    ...(exe ? { executablePath: exe } : {}),
    args: [...(exe ? [] : [path.join(out, 'main', 'index.js')]), '--user-data-dir=' + ud],
    cwd: process.cwd(),
    timeout: 60000,
    env: { ...process.env, BW_LANG: lang, BW_NO_WINSTATE: '1', ...env }
  })
  const page = await app.firstWindow({ timeout: 60000 })
  const errs = []
  page.on('console', (m) => {
    if (m.type() === 'error' || m.type() === 'warning') errs.push(m.type() + ': ' + m.text())
  })
  page.on('pageerror', (e) => errs.push('PAGEERR ' + e.message))
  await page.waitForFunction(() => !!window.brushwork_app && !!window.brushwork_smartselect, null, { timeout: 60000 })
  await page.waitForTimeout(1500)
  return { app, page, errs, ud }
}

/** New document of the image size and draw the image into its active layer. `src` = file path or {rgba,w,h}. */
export async function loadImage(page, src, { docW, docH, offset = [0, 0] } = {}) {
  let payload
  if (typeof src === 'string') {
    const b64 = fs.readFileSync(src).toString('base64')
    const mime = src.toLowerCase().endsWith('.png') ? 'image/png' : 'image/jpeg'
    payload = { b64, mime }
  } else payload = { rgba: Buffer.from(src.rgba.buffer, src.rgba.byteOffset, src.rgba.byteLength).toString('base64'), w: src.w, h: src.h }
  return page.evaluate(
    async ({ payload, docW, docH, offset }) => {
      const app = window.brushwork_app
      let w, h, data
      if (payload.b64) {
        const bin = Uint8Array.from(atob(payload.b64), (c) => c.charCodeAt(0))
        const bmp = await createImageBitmap(new Blob([bin], { type: payload.mime }))
        w = bmp.width
        h = bmp.height
        const oc = new OffscreenCanvas(w, h)
        const cx = oc.getContext('2d')
        cx.drawImage(bmp, 0, 0)
        data = cx.getImageData(0, 0, w, h).data
      } else {
        w = payload.w
        h = payload.h
        data = new Uint8ClampedArray(Uint8Array.from(atob(payload.rgba), (c) => c.charCodeAt(0)).buffer)
      }
      const dw = docW ?? w + offset[0]
      const dh = docH ?? h + offset[1]
      const doc = app.newDocument(dw, dh)
      app.gpu.uploadRGBA8(doc.activeLayer.pixels, offset[0], offset[1], w, h, data)
      app.requestRender()
      return { w, h, dw, dh }
    },
    { payload, docW, docH, offset }
  )
}

/** client position of a document point */
export async function docToClient(page, x, y) {
  return page.evaluate(
    ({ x, y }) => {
      const app = window.brushwork_app
      const r = app.canvas.getBoundingClientRect()
      const { w, h } = app.cssSize()
      const v = app.view
      const dx = x - v.cx
      const dy = y - v.cy
      const c = Math.cos(v.rot)
      const s = Math.sin(v.rot)
      return { x: r.left + w / 2 + (v.mirror ? -1 : 1) * v.zoom * (c * dx - s * dy), y: r.top + h / 2 + v.zoom * (s * dx + c * dy) }
    },
    { x, y }
  )
}

export async function openTool(page, mode = 'fast') {
  await page.evaluate((mode) => {
    const b = window.brushwork_smartselect
    b.ss.mode = mode
    b.c.activate()
  }, mode)
  await page.waitForTimeout(200)
}

export async function click(page, x, y, { alt = false, button = 'left' } = {}) {
  const p = await docToClient(page, x, y)
  await page.mouse.move(p.x, p.y)
  if (alt) await page.keyboard.down('Alt')
  await page.mouse.down({ button })
  await page.mouse.up({ button })
  if (alt) await page.keyboard.up('Alt')
}

export async function waitIdle(page, timeout = 60000) {
  await page.waitForFunction(() => !window.brushwork_smartselect.c.busy && window.brushwork_smartselect.c.pending === 0, null, { timeout, polling: 100 })
  await page.waitForTimeout(150)
}

/** selection coverage as a flat Uint8 array (base64) + dims */
export async function selectionMask(page) {
  return page.evaluate(() => {
    const s = window.brushwork_app.selection
    if (!s.data) return null
    let bin = ''
    const d = s.data
    const CH = 0x8000
    for (let i = 0; i < d.length; i += CH) bin += String.fromCharCode.apply(null, d.subarray(i, i + CH))
    return { w: s.w, h: s.h, b64: btoa(bin) }
  })
}
export const decodeMask = (m) => (m ? Uint8Array.from(Buffer.from(m.b64, 'base64')) : null)

export function iouBytes(a, b, thr = 128) {
  let i = 0
  let u = 0
  for (let k = 0; k < a.length; k++) {
    const x = a[k] >= thr
    const y = b[k] >= thr
    if (x && y) i++
    if (x || y) u++
  }
  return u ? i / u : 1
}

export async function shot(page, file) {
  fs.mkdirSync(path.dirname(file), { recursive: true })
  await page.screenshot({ path: file, timeout: 30000 })
}
