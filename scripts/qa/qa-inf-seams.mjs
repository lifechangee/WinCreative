// Seam / equivalence test: the same deterministic stroke is painted on a FIXED document (rgba8) and on an INFINITE document
// (optionally shifted by whole tiles, incl. +-51200 px = 100 tiles, negative coordinates) and the layer pixels are compared.
// usage: node scripts/qa/qa-inf-seams.mjs [--out out-inf] [case ...]
import { join } from 'path'
import { launch, outDirOf, save, writeDiff, writeFlat } from './qa-inf-lib.mjs'

const args = process.argv.slice(2)
const only = args.filter((a, i) => !a.startsWith('--') && args[i - 1] !== '--out')
const { app, page, errors } = await launch(outDirOf(args))

await page.evaluate(() => {
  window.__qa = {
    samples(pts, dt = 8) {
      return pts.map((p, i) => ({ x: p[0], y: p[1], pressure: p[2] ?? 0.6, tiltX: 0, tiltY: 0, twist: 0, t: 1000 + i * dt, pointerType: 'pen' }))
    },
    cfg(tool, preset, size, opacity, hex) {
      const st = window.brushwork_app.state
      st.setTool(tool)
      if (preset) st.setPreset(tool, preset)
      st.settings.size = size
      st.settings.opacity = opacity
      const [r, g, b] = hex.match(/[0-9a-f]{2}/gi).map((x) => parseInt(x, 16) / 255)
      const mx = Math.max(r, g, b), mn = Math.min(r, g, b), d = mx - mn
      let hh = 0
      if (d > 0) hh = mx === r ? ((g - b) / d + 6) % 6 : mx === g ? (b - r) / d + 2 : (r - g) / d + 4
      st.setColor({ h: hh * 60, s: mx ? d / mx : 0, v: mx }, false)
    },
    stroke(tool, pts) {
      const app = window.brushwork_app
      const s = this.samples(pts)
      const t = app.tools.get(tool)
      const now = performance.now
      performance.now = () => 123456.789 // deterministic brush RNG seed (PaintTool seeds from the clock)
      try {
        if (!t.begin(s[0], app)) throw new Error('begin refused')
        for (let i = 1; i < s.length; i += 6) t.move(s.slice(i, i + 6), app)
        t.end(app)
      } finally {
        performance.now = now
      }
      app.renderNow()
    },
    read(rect) {
      const doc = window.brushwork_app.doc
      const px = doc.readRegionPixels(doc.activeLayer, rect)
      let s = ''
      for (let i = 0; i < px.length; i += 0x8000) s += String.fromCharCode.apply(null, px.subarray(i, i + 0x8000))
      return btoa(s)
    }
  }
})

const spiral = (cx, cy, r0, r1, turns, n, ox = 0, oy = 0) => {
  const pts = []
  for (let i = 0; i <= n; i++) {
    const u = i / n
    const a = u * turns * Math.PI * 2
    const r = r0 + (r1 - r0) * u
    pts.push([cx + Math.cos(a) * r + ox, cy + Math.sin(a) * r * 0.8 + oy, 0.35 + 0.5 * Math.sin(u * 9) ** 2])
  }
  return pts
}
const PRE = [
  ['hard-round', 220, '#2060d0', [[620, 700, 0.8], [900, 1100, 0.8], [1400, 1000, 0.8], [1500, 1500, 0.8]]],
  ['hard-round', 160, '#e0a020', [[600, 1500, 0.8], [1100, 900, 0.8], [1550, 700, 0.8]]]
]
const CASES = [
  { id: 'hard', tool: 'brush', preset: 'hard-round', size: 120, op: 1, color: '#d02020' },
  { id: 'softAir', tool: 'brush', preset: 'soft-airbrush', size: 420, op: 0.6, color: '#20a040' },
  { id: 'grain', tool: 'brush', preset: 'sketch-graphite', size: 70, op: 1, color: '#303030' },
  { id: 'dual', tool: 'brush', preset: 'abs-dual', size: 130, op: 1, color: '#7020b0' },
  { id: 'neon', tool: 'brush', preset: 'ret-neon', size: 44, op: 1, color: '#10c0d0' },
  { id: 'screen', tool: 'brush', preset: 'air-glow', size: 220, op: 1, color: '#c06020', pre: true },
  { id: 'oilMix', tool: 'brush', preset: 'paint-oil', size: 90, op: 1, color: '#d02020', pre: true },
  { id: 'smudge', tool: 'smudge', preset: 'smudge-soft', size: 160, op: 1, color: '#000000', pre: true },
  { id: 'smudgeBig', tool: 'smudge', preset: 'smudge-soft', size: 600, op: 1, color: '#000000', pre: true },
  { id: 'erase', tool: 'eraser', preset: 'eraser-hard', size: 170, op: 1, color: '#000000', pre: true },
  { id: 'alphaLock', tool: 'brush', preset: 'hard-round', size: 140, op: 1, color: '#d02020', pre: true, lock: true }
]
// shifts of the INFINITE stroke (multiples of 512 keep the dab phase identical); [0,0] = same coordinates as the fixed reference
const SHIFTS = [[0, 0], [49152, 49152], [-49152, 49152], [49152, -49152], [-49152, -49152], [-4096 * 3, -4096 * 2]]
const RECT = { x: 480, y: 480, w: 1200, h: 1200 }

async function runDoc(kind, c, sh) {
  await page.evaluate(
    ({ kind }) => {
      const a = window.brushwork_app
      a.newDocument(4096, 4096, kind === 'infinite' ? { kind: 'infinite', background: { color: [1, 1, 1], visible: true } } : { format: 'rgba8', background: { color: [1, 1, 1], visible: true } })
    },
    { kind }
  )
  const [ox, oy] = kind === 'infinite' ? sh : [0, 0]
  if (c.pre) {
    for (const [preset, size, hex, pts] of PRE) {
      await page.evaluate(([p, s, h, pp]) => { window.__qa.cfg('brush', p, s, 1, h); window.__qa.stroke('brush', pp) }, [preset, size, hex, pts.map((p) => [p[0] + ox, p[1] + oy, p[2]])])
    }
  }
  if (c.lock) await page.evaluate(() => { const d = window.brushwork_app.doc; d.setLayerProps(d.activeId, { alphaLock: true }) })
  const pts = spiral(1024, 1024, 60, 470, 1.6, 150, ox, oy)
  await page.evaluate(([c, pts]) => { window.__qa.cfg(c.tool, c.preset, c.size, c.op, c.color); window.__qa.stroke(c.tool, pts) }, [c, pts])
  const r = { x: RECT.x + ox, y: RECT.y + oy, w: RECT.w, h: RECT.h }
  const b64 = await page.evaluate((r) => window.__qa.read(r), r)
  const tiles = await page.evaluate(() => window.brushwork_app.doc.tileStats().tiles)
  return { px: Buffer.from(b64, 'base64'), tiles }
}

// premultiplied comparison (straight RGB at alpha ~ 1/255 is meaningless): max over alpha and premultiplied colour channels, in 8-bit levels
function compare(a, b) {
  let max = 0, sum = 0, over2 = 0, over8 = 0, nonEmpty = 0
  const perTile = {}
  for (let i = 0; i < a.length; i += 4) {
    const aa = a[i + 3], ab = b[i + 3]
    if (aa > 0) nonEmpty++
    let d = Math.abs(aa - ab)
    for (let c = 0; c < 3; c++) d = Math.max(d, Math.abs((a[i + c] * aa) / 255 - (b[i + c] * ab) / 255))
    sum += d
    if (d > max) max = d
    if (d > 2) {
      over2++
      const p = i / 4
      const k = Math.floor((RECT.x + (p % RECT.w)) / 512) + ',' + Math.floor((RECT.y + Math.floor(p / RECT.w)) / 512)
      perTile[k] = (perTile[k] ?? 0) + 1
    }
    if (d > 8) over8++
  }
  return { max: +max.toFixed(1), mean: +(sum / (a.length / 4)).toFixed(5), over2, over8, nonEmpty, perTile }
}

/**
 * Seam ratio of an image: mean absolute neighbour difference ACROSS tile borders (vertical seams at absolute x % 512 == 0, horizontal at y % 512 == 0)
 * divided by the same measure on the 6 columns / rows next to the seam. A seam-free image gives ~1; a visible seam gives >> 1.
 */
function seamRatio(px) {
  const W = RECT.w, H = RECT.h
  const v = (x, y) => { const i = (y * W + x) * 4; return [px[i + 3], (px[i] * px[i + 3]) / 255, (px[i + 1] * px[i + 3]) / 255, (px[i + 2] * px[i + 3]) / 255] }
  const dif = (a, b) => Math.abs(a[0] - b[0]) + Math.abs(a[1] - b[1]) + Math.abs(a[2] - b[2]) + Math.abs(a[3] - b[3])
  let worst = 0
  const mean = (arr) => arr.reduce((p, q) => p + q, 0) / Math.max(1, arr.length)
  for (const sx of [32, 544, 1056]) {
    const seam = [], near = []
    for (let y = 0; y < H; y++) {
      seam.push(dif(v(sx - 1, y), v(sx, y)))
      for (const k of [-6, -5, -4, 3, 4, 5]) near.push(dif(v(sx + k - 1, y), v(sx + k, y)))
    }
    worst = Math.max(worst, (mean(seam) + 0.02) / (mean(near) + 0.02))
  }
  for (const sy of [32, 544, 1056]) {
    const seam = [], near = []
    for (let x = 0; x < W; x++) {
      seam.push(dif(v(x, sy - 1), v(x, sy)))
      for (const k of [-6, -5, -4, 3, 4, 5]) near.push(dif(v(x, sy + k - 1), v(x, sy + k)))
    }
    worst = Math.max(worst, (mean(seam) + 0.02) / (mean(near) + 0.02))
  }
  return +worst.toFixed(3)
}

let fails = 0
for (const c of CASES) {
  if (only.length && !only.includes(c.id)) continue
  const ref = await runDoc('fixed', c)
  for (const sh of SHIFTS) {
    // grain / noise textures are indexed by absolute coordinates: only compare shifts that keep their phase (0,0) for those brushes
    if ((c.id === 'grain' || c.id === 'dual' || c.id === 'oilMix' || c.id === 'screen') && (sh[0] !== 0 || sh[1] !== 0)) continue
    const inf = await runDoc('infinite', c, sh)
    const m = compare(ref.px, inf.px)
    const sr = seamRatio(inf.px)
    // equivalence with the fixed canvas (the fixed wet-mix / smudge reference has stale-scratch artefacts at dab corners, so those are judged by the seam ratio only)
    const equiv = c.id === 'oilMix' ? true : c.id === 'smudge' || c.id === 'smudgeBig' ? m.over8 <= 0.001 * m.nonEmpty : m.over8 <= 0.0001 * m.nonEmpty && m.over2 <= 0.002 * m.nonEmpty
    const srRef = seamRatio(ref.px)
    const ok = m.nonEmpty > 100 && equiv && sr <= Math.max(1.25, srRef * 1.05 + 0.05)
    if (!ok) fails++
    console.log(`${ok ? 'PASS' : 'FAIL'} ${c.id.padEnd(9)} shift ${String(sh).padEnd(14)} tiles=${inf.tiles} nonEmpty=${m.nonEmpty} maxDiff=${m.max} mean=${m.mean} >2:${m.over2} >8:${m.over8} seamRatio=${sr} (fixed ref ${srRef})`)
    if (!ok) console.log("   per tile (>2):", JSON.stringify(m.perTile))
    if (!ok && sh[0] === 0 && sh[1] === 0) {
      save('qa-inf', `seam-${c.id}-keep`, Buffer.alloc(0))
      writeFlat(join('qa-inf', `seam-${c.id}-ref.png`), RECT.w, RECT.h, ref.px)
      writeFlat(join('qa-inf', `seam-${c.id}-inf.png`), RECT.w, RECT.h, inf.px)
      writeDiff(join('qa-inf', `seam-${c.id}-diff.png`), RECT.w, RECT.h, ref.px, inf.px)
    }
  }
}
console.log('errors', errors.slice(0, 5))
console.log(fails ? `${fails} FAILED` : 'ALL PASS')
await app.close()
process.exit(fails ? 1 : 0)
