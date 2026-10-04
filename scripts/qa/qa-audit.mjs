// Russian visual/text audit: opens many UI surfaces, screenshots them and lists text that still contains Latin words.
//   node scripts/qa/qa-audit.mjs [--out out-audit] [--shots qa-screens/audit] [--lang ru] [--only name,name]
import { _electron as electron } from 'playwright-core'
import fs from 'node:fs'
import os from 'node:os'
import path from 'node:path'

const args = process.argv.slice(2)
const opt = (n, d) => (args.includes(n) ? args[args.indexOf(n) + 1] : d)
const out = opt('--out', 'out-audit')
const shots = opt('--shots', 'qa-screens/audit')
const lang = opt('--lang', 'ru')
const only = opt('--only', '')
fs.mkdirSync(shots, { recursive: true })
const ud = path.join(os.tmpdir(), 'bw-audit-' + Date.now())
const app = await electron.launch({ args: [`${out}/main/index.js`, '--user-data-dir=' + ud], cwd: process.cwd(), env: { ...process.env, APPDATA: ud, BW_LANG: lang } })
const page = await app.firstWindow()
const errs = []
page.on('console', (m) => (m.type() === 'error' || m.type() === 'warning') && errs.push(m.type() + ': ' + m.text()))
page.on('pageerror', (e) => errs.push('PAGEERR ' + e.message))
await page.waitForTimeout(3500)
await page.setViewportSize({ width: 1280, height: 800 }).catch(() => {})

const ALLOWED = /^(WinCreative|HSB|RGB|Hex|DPI|FPS|PNG|JPG|JPEG|PSD|ICC|GIF|APNG|MP4|WebM|WebP|PDF|ASE|H\.264|HEVC|H\.265|QuickShape|QuickMenu|ColorDrop|StreamLine|Flow|Bloom|Esc|Ctrl|Shift|Alt|Enter|Del|Tab|Space|Photoshop|Procreate|Windows Ink|px|Hz|GPU|OK|BMP|TIFF|TIF|Wintab|Alt\+|F\d+)$/i
const seen = new Set()
const findings = []
const scan = async (name) => {
  const items = await page.evaluate(() => {
    const res = []
    const vis = (el) => {
      const r = el.getBoundingClientRect()
      if (r.width < 1 || r.height < 1) return false
      const cs = getComputedStyle(el)
      return cs.visibility !== 'hidden' && cs.display !== 'none' && cs.opacity !== '0'
    }
    const walker = document.createTreeWalker(document.body, NodeFilter.SHOW_TEXT)
    let n
    while ((n = walker.nextNode())) {
      const p = n.parentElement
      if (!p || /^(SCRIPT|STYLE)$/.test(p.tagName) || !vis(p)) continue
      const s = n.textContent.trim()
      if (s) res.push(['text', s])
    }
    for (const el of document.querySelectorAll('[title],[data-tip],[placeholder],[aria-label]')) {
      if (!vis(el)) continue
      for (const a of ['title', 'data-tip', 'placeholder', 'aria-label']) {
        const v = el.getAttribute(a)
        if (v) res.push([a, v])
      }
    }
    for (const o of document.querySelectorAll('option')) if (vis(o.parentElement)) res.push(['option', o.textContent])
    // overflow: elements whose content is wider than the box
    for (const el of document.querySelectorAll('button,label,span,div,h3,h4,option')) {
      if (el.children.length || !vis(el)) continue
      const s = el.textContent.trim()
      if (!s) continue
      const cs = getComputedStyle(el)
      if (el.scrollWidth > el.clientWidth + 2 && el.clientWidth > 0 && (cs.overflow === 'hidden' || cs.textOverflow === 'ellipsis')) res.push(['CLIP', s + ' [' + el.scrollWidth + '>' + el.clientWidth + ']'])
    }
    return res
  })
  for (const [k, s] of items) {
    const words = s.match(/[A-Za-z][A-Za-z'.+-]*/g) || []
    if (/^(#[0-9a-f]{3,8}|[A-Za-z]+.[A-Za-z0-9.]+)$/.test(s) && k !== 'CLIP') continue
    const bad = k === 'CLIP' || words.some((w) => w.length >= 2 && !ALLOWED.test(w) && !/^(x|px|ms|mm|cm|fps)$/i.test(w))
    if (!bad) continue
    const key = k + '|' + s
    if (seen.has(key)) continue
    seen.add(key)
    findings.push(`[${name}] ${k}: ${s.slice(0, 140)}`)
  }
}
const shot = async (name) => {
  await page.waitForTimeout(400)
  await scan(name)
  await page.screenshot({ path: path.join(shots, name + '.png') })
}
const step = async (name, fn) => {
  if (only && !only.split(',').some((o) => name.includes(o))) return
  try {
    await fn()
    await shot(name)
  } catch (e) {
    findings.push(`[${name}] STEP FAILED: ${String(e.message).split('\n')[0]}`)
  }
}
const esc = async () => {
  await page.keyboard.press('Escape')
  await page.waitForTimeout(150)
}
const closeModals = async () => {
  await page.evaluate(() => document.querySelectorAll('.modal-back').forEach((e) => e.remove()))
}

// expose helpers for the sweep file
export { page, app, step, shot, scan, esc, closeModals, findings, errs, shots, path, fs, ud }
const sweep = await import('./qa-audit-sweep.mjs')
await sweep.run({ page, app, step, shot, scan, esc, closeModals, findings, errs, opt })
console.log('\n=== FINDINGS (' + findings.length + ') ===')
for (const f of findings) console.log(f)
console.log('console problems:', errs.length)
for (const e of errs.slice(0, 20)) console.log('  ' + e.slice(0, 200))
await app.close()
try { fs.rmSync(ud, { recursive: true, force: true }) } catch {}
