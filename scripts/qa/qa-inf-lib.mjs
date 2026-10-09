// Shared helpers of the infinite-canvas QA scripts (playwright-driven real Electron, isolated profile).
import { _electron as electron } from 'playwright-core'
import { mkdtempSync, mkdirSync, writeFileSync } from 'fs'
import { tmpdir } from 'os'
import { join, resolve } from 'path'

export const outDirOf = (args) => resolve(args.includes('--out') ? args[args.indexOf('--out') + 1] : 'out-inf')

export async function launch(outDir, env = {}, ud) {
  const tmp = mkdtempSync(join(tmpdir(), 'bw-inf-'))
  const app = await electron.launch({
    args: [join(outDir, 'main', 'index.js'), `--user-data-dir=${ud ?? join(tmp, 'ud')}`],
    env: { ...process.env, BW_PERF_TEST: '1', BW_GALLERY_DIR: join(tmp, 'gallery'), BW_LANG: 'en', ...env },
    timeout: 60000
  })
  const page = await app.firstWindow()
  page.setDefaultTimeout(60000)
  const errors = []
  page.on('pageerror', (e) => errors.push('PAGEERROR ' + e.message))
  page.on('console', (m) => {
    if (m.type() === 'error') errors.push('console.error ' + m.text().slice(0, 300))
  })
  await page.waitForFunction(() => !!window.brushwork_app && !!window.brushwork_io?.gallery, null, { timeout: 60000 })
  await page.waitForTimeout(1500)
  return { app, page, tmp, errors }
}

/** Create a document and hide the gallery. kind: 'infinite' | 'fixed'. */
export async function newDoc(page, kind, w = 2048, h = 2048, fmt) {
  await page.evaluate(
    async ({ kind, w, h, fmt }) => {
      const app = window.brushwork_app
      app.newDocument(w, h, kind === 'infinite' ? { kind: 'infinite', background: { color: [1, 1, 1], visible: true } } : { background: { color: [1, 1, 1], visible: true }, ...(fmt ? { format: fmt } : {}) })
      app.setView({ cx: kind === 'infinite' ? 0 : w / 2, cy: kind === 'infinite' ? 0 : h / 2, zoom: 1, rot: 0 })
      await new Promise((r) => requestAnimationFrame(() => r()))
    },
    { kind, w, h, fmt }
  )
}

/** Client position of a document point under the current view. */
export function toClient(page) {
  return page.evaluate(() => {
    const app = window.brushwork_app
    const r = app.canvas.getBoundingClientRect()
    return { left: r.left, top: r.top, w: r.width, h: r.height }
  })
}

/** Draw a polyline given in DOCUMENT coords through the real pointer path (page.mouse). Places the view so the stroke fits. */
export async function strokeDoc(page, pts, opts = {}) {
  const { zoom = 1, steps = 3 } = opts
  const cx = (Math.min(...pts.map((p) => p[0])) + Math.max(...pts.map((p) => p[0]))) / 2
  const cy = (Math.min(...pts.map((p) => p[1])) + Math.max(...pts.map((p) => p[1]))) / 2
  await page.evaluate(({ cx, cy, zoom }) => window.brushwork_app.setView({ cx, cy, zoom, rot: 0 }), { cx, cy, zoom })
  await page.waitForTimeout(60)
  const r = await toClient(page)
  const sc = (p) => ({ x: r.left + r.w / 2 + (p[0] - cx) * zoom, y: r.top + r.h / 2 + (p[1] - cy) * zoom })
  const a = sc(pts[0])
  await page.mouse.move(a.x, a.y)
  await page.mouse.down()
  for (let i = 1; i < pts.length; i++) {
    const b = sc(pts[i])
    await page.mouse.move(b.x, b.y, { steps })
  }
  await page.mouse.up()
  await page.waitForTimeout(80)
}

export async function setBrush(page, id, size, opacity = 1, color = '#d02020') {
  await page.evaluate(
    ({ id, size, opacity, color }) => {
      const app = window.brushwork_app
      const st = app.state
      st.setTool('brush')
      if (id) st.setPreset('brush', id)
      st.settings.size = size
      st.settings.opacity = opacity
      const [r, g, b] = color.match(/[0-9a-f]{2}/gi).map((x) => parseInt(x, 16) / 255)
      const mx = Math.max(r, g, b), mn = Math.min(r, g, b), d = mx - mn
      let hh = 0
      if (d > 0) hh = mx === r ? ((g - b) / d + 6) % 6 : mx === g ? (b - r) / d + 2 : (r - g) / d + 4
      st.setColor({ h: hh * 60, s: mx ? d / mx : 0, v: mx }, true)
    },
    { id, size, opacity, color }
  )
}

export function save(dir, name, buf) {
  mkdirSync(dir, { recursive: true })
  writeFileSync(join(dir, name), buf)
}

export const stats = (a) => {
  const s = [...a].sort((x, y) => x - y)
  const q = (p) => s[Math.min(s.length - 1, Math.floor(s.length * p))] ?? 0
  return { n: s.length, mean: s.reduce((x, y) => x + y, 0) / Math.max(1, s.length), p50: q(0.5), p95: q(0.95), p99: q(0.99), max: s[s.length - 1] ?? 0 }
}

// ---- minimal PNG writer (RGBA8) for diagnostics
import { deflateSync } from 'zlib'
const crcTable = (() => {
  const t = new Uint32Array(256)
  for (let n = 0; n < 256; n++) {
    let c = n
    for (let k = 0; k < 8; k++) c = c & 1 ? 0xedb88320 ^ (c >>> 1) : c >>> 1
    t[n] = c >>> 0
  }
  return t
})()
const crc32 = (b) => {
  let c = 0xffffffff
  for (let i = 0; i < b.length; i++) c = crcTable[(c ^ b[i]) & 255] ^ (c >>> 8)
  return (c ^ 0xffffffff) >>> 0
}
export function pngBytes(w, h, rgba) {
  const raw = Buffer.alloc((w * 4 + 1) * h)
  for (let y = 0; y < h; y++) {
    raw[y * (w * 4 + 1)] = 0
    Buffer.from(rgba.buffer, rgba.byteOffset + y * w * 4, w * 4).copy(raw, y * (w * 4 + 1) + 1)
  }
  const chunk = (type, data) => {
    const len = Buffer.alloc(4)
    len.writeUInt32BE(data.length)
    const td = Buffer.concat([Buffer.from(type), data])
    const crc = Buffer.alloc(4)
    crc.writeUInt32BE(crc32(td))
    return Buffer.concat([len, td, crc])
  }
  const ihdr = Buffer.alloc(13)
  ihdr.writeUInt32BE(w, 0)
  ihdr.writeUInt32BE(h, 4)
  ihdr[8] = 8
  ihdr[9] = 6
  return Buffer.concat([Buffer.from([137, 80, 78, 71, 13, 10, 26, 10]), chunk('IHDR', ihdr), chunk('IDAT', deflateSync(raw)), chunk('IEND', Buffer.alloc(0))])
}
/** Composite straight-alpha RGBA over white and write as PNG. */
export function writeFlat(path, w, h, px) {
  const o = new Uint8Array(w * h * 4)
  for (let i = 0; i < w * h; i++) {
    const a = px[i * 4 + 3] / 255
    for (let c = 0; c < 3; c++) o[i * 4 + c] = px[i * 4 + c] * a + 255 * (1 - a)
    o[i * 4 + 3] = 255
  }
  writeFileSync(path, pngBytes(w, h, o))
}
export function writeDiff(path, w, h, a, b, gain = 16) {
  const o = new Uint8Array(w * h * 4)
  for (let i = 0; i < w * h; i++) {
    let d = 0
    for (let c = 0; c < 4; c++) d = Math.max(d, Math.abs(a[i * 4 + c] - b[i * 4 + c]))
    const v = Math.min(255, d * gain)
    o[i * 4] = v
    o[i * 4 + 1] = d > 2 ? 255 - v / 2 : 0
    o[i * 4 + 2] = 0
    o[i * 4 + 3] = 255
  }
  writeFileSync(path, pngBytes(w, h, o))
}
