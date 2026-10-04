// Generates build/icon.png (256) and build/icon.ico (16..256, PNG-compressed entries): `node scripts/make-icon.js`
const zlib = require('zlib')
const fs = require('fs')
const path = require('path')

const lerp = (a, b, t) => a + (b - a) * t
const mix = (c1, c2, t) => c1.map((v, i) => lerp(v, c2[i], t))
const BG1 = [40, 42, 110]
const BG2 = [128, 62, 205]
const S1 = [255, 214, 130]
const S2 = [255, 98, 92]

// brush stroke: S-curve polyline with a tapered width
const pts = []
for (let i = 0; i <= 80; i++) {
  const t = i / 80
  const x = lerp(0.2, 0.8, t)
  const y = 0.5 + 0.3 * Math.cos(t * Math.PI) * 1.0 + 0.0
  pts.push({ t, x, y: 0.5 - (0.5 - y) * 0.95 - 0.0, w: 0.015 + 0.095 * Math.pow(Math.sin(Math.PI * Math.min(1, t * 1.05)), 0.7) })
}
function strokeAt(px, py) {
  let best = null
  for (let i = 0; i < pts.length - 1; i++) {
    const a = pts[i], b = pts[i + 1]
    const dx = b.x - a.x, dy = b.y - a.y
    const u = Math.max(0, Math.min(1, ((px - a.x) * dx + (py - a.y) * dy) / (dx * dx + dy * dy)))
    const d = Math.hypot(px - (a.x + dx * u), py - (a.y + dy * u))
    const w = lerp(a.w, b.w, u)
    const k = d - w
    if (!best || k < best.k) best = { k, t: lerp(a.t, b.t, u) }
  }
  return best
}
function rrDist(x, y, r) {
  const qx = Math.abs(x - 0.5) - (0.5 - r), qy = Math.abs(y - 0.5) - (0.5 - r)
  return Math.hypot(Math.max(qx, 0), Math.max(qy, 0)) + Math.min(Math.max(qx, qy), 0) - r
}
function render(size) {
  const px = Buffer.alloc(size * size * 4)
  const SS = size <= 32 ? 4 : 3
  for (let y = 0; y < size; y++)
    for (let x = 0; x < size; x++) {
      let r = 0, g = 0, b = 0, a = 0
      for (let sy = 0; sy < SS; sy++)
        for (let sx = 0; sx < SS; sx++) {
          const u = (x + (sx + 0.5) / SS) / size, v = (y + (sy + 0.5) / SS) / size
          const dr = rrDist(u, v, 0.2)
          if (dr > 0) continue
          let c = mix(BG1, BG2, (u + v) / 2)
          const s = strokeAt(u, v)
          if (s.k < 0.004) {
            const cov = Math.max(0, Math.min(1, 0.5 - s.k / 0.008))
            c = mix(c, mix(S1, S2, s.t), cov)
          }
          r += c[0]; g += c[1]; b += c[2]; a += 1
        }
      const o = (y * size + x) * 4
      const n = SS * SS
      if (a) { px[o] = r / a; px[o + 1] = g / a; px[o + 2] = b / a }
      px[o + 3] = Math.round((a / n) * 255)
    }
  return px
}
function png(size, rgba) {
  const raw = Buffer.alloc((size * 4 + 1) * size)
  for (let y = 0; y < size; y++) { raw[y * (size * 4 + 1)] = 0; rgba.copy(raw, y * (size * 4 + 1) + 1, y * size * 4, (y + 1) * size * 4) }
  const chunk = (type, data) => {
    const len = Buffer.alloc(4); len.writeUInt32BE(data.length)
    const td = Buffer.concat([Buffer.from(type), data])
    const crc = Buffer.alloc(4); crc.writeUInt32BE(zlib.crc32(td) >>> 0)
    return Buffer.concat([len, td, crc])
  }
  const ihdr = Buffer.alloc(13); ihdr.writeUInt32BE(size, 0); ihdr.writeUInt32BE(size, 4); ihdr[8] = 8; ihdr[9] = 6
  return Buffer.concat([Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]), chunk('IHDR', ihdr), chunk('IDAT', zlib.deflateSync(raw, { level: 9 })), chunk('IEND', Buffer.alloc(0))])
}
const sizes = [16, 24, 32, 48, 64, 128, 256]
const pngs = sizes.map((s) => png(s, render(s)))
const dir = path.join(__dirname, '..', 'build')
fs.mkdirSync(dir, { recursive: true })
fs.writeFileSync(path.join(dir, 'icon.png'), pngs[pngs.length - 1])
const head = Buffer.alloc(6); head.writeUInt16LE(1, 2); head.writeUInt16LE(sizes.length, 4)
let off = 6 + 16 * sizes.length
const ents = sizes.map((s, i) => {
  const e = Buffer.alloc(16)
  e[0] = s === 256 ? 0 : s; e[1] = s === 256 ? 0 : s; e.writeUInt16LE(1, 4); e.writeUInt16LE(32, 6)
  e.writeUInt32LE(pngs[i].length, 8); e.writeUInt32LE(off, 12); off += pngs[i].length
  return e
})
fs.writeFileSync(path.join(dir, 'icon.ico'), Buffer.concat([head, ...ents, ...pngs]))
console.log('wrote build/icon.png, build/icon.ico')
