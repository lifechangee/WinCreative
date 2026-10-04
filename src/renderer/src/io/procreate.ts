import { t } from '../i18n'
import { unzipSync } from 'fflate'
import type { BlendMode } from '../core/blend'
import { Document } from '../doc/document'
import { normalizeOrder } from '../doc/layerTree'
import type { GPU } from '../gl/gpu'

/**
 * BEST-EFFORT import of Procreate ".procreate" files (a ZIP holding Document.archive - an NSKeyedArchiver binary
 * plist - and per-layer folders of tile chunks). Chunks are LZ4 block compressed (or raw) premultiplied RGBA tiles.
 * Written from the publicly documented structure; not verified against every Procreate version.
 */

// ------------------------------------------------------------------ binary plist
export type PValue = null | boolean | number | string | Uint8Array | PValue[] | { [k: string]: PValue } | { uid: number }

export function parseBplist(buf: Uint8Array): PValue {
  const dv = new DataView(buf.buffer, buf.byteOffset, buf.byteLength)
  const magic = String.fromCharCode(...buf.subarray(0, 8))
  if (magic !== 'bplist00') throw new Error('Not a binary plist')
  const t = buf.length - 32
  const offSize = buf[t + 6]
  const refSize = buf[t + 7]
  const num = Number(dv.getBigUint64(t + 8))
  const top = Number(dv.getBigUint64(t + 16))
  const tableOff = Number(dv.getBigUint64(t + 24))
  const uint = (o: number, n: number): number => {
    let v = 0
    for (let i = 0; i < n; i++) v = v * 256 + buf[o + i]
    return v
  }
  const offsetOf = (i: number): number => uint(tableOff + i * offSize, offSize)
  const cache = new Map<number, PValue>()
  const parse = (idx: number): PValue => {
    if (cache.has(idx)) return cache.get(idx)!
    let o = offsetOf(idx)
    const marker = buf[o++]
    const hi = marker >> 4
    const lo = marker & 15
    const readLen = (): number => {
      if (lo !== 15) return lo
      const m = buf[o++]
      const n = 1 << (m & 15)
      const v = uint(o, n)
      o += n
      return v
    }
    let out: PValue
    switch (hi) {
      case 0x0:
        out = lo === 8 ? false : lo === 9 ? true : null
        break
      case 0x1: {
        const n = 1 << lo
        out = n === 8 ? Number(dv.getBigInt64(o)) : uint(o, n)
        break
      }
      case 0x2:
        out = lo === 2 ? dv.getFloat32(o) : dv.getFloat64(o)
        break
      case 0x3:
        out = dv.getFloat64(o)
        break
      case 0x4: {
        const n = readLen()
        out = buf.slice(o, o + n)
        break
      }
      case 0x5: {
        const n = readLen()
        out = String.fromCharCode(...buf.subarray(o, o + n))
        break
      }
      case 0x6: {
        const n = readLen()
        let s = ''
        for (let i = 0; i < n; i++) s += String.fromCharCode(dv.getUint16(o + i * 2))
        out = s
        break
      }
      case 0x8:
        out = { uid: uint(o, lo + 1) }
        break
      case 0xa:
      case 0xc: {
        const n = readLen()
        const arr: PValue[] = []
        cache.set(idx, arr)
        for (let i = 0; i < n; i++) arr.push(parse(uint(o + i * refSize, refSize)))
        return arr
      }
      case 0xd: {
        const n = readLen()
        const d: { [k: string]: PValue } = {}
        cache.set(idx, d)
        for (let i = 0; i < n; i++) {
          const k = parse(uint(o + i * refSize, refSize))
          d[String(k)] = parse(uint(o + (n + i) * refSize, refSize))
        }
        return d
      }
      default:
        throw new Error('Unsupported plist marker 0x' + marker.toString(16))
    }
    cache.set(idx, out)
    return out
  }
  void num
  return parse(top)
}

const isUid = (v: PValue): v is { uid: number } => !!v && typeof v === 'object' && !Array.isArray(v) && !(v instanceof Uint8Array) && 'uid' in v

/** Resolve an NSKeyedArchiver graph into plain JS values (dictionaries keep their fields; NSArray -> array). */
export function unarchive(root: PValue): PValue {
  const top = root as { [k: string]: PValue }
  const objs = top['$objects'] as PValue[]
  const seen = new Map<number, PValue>()
  const resolve = (v: PValue, depth = 0): PValue => {
    if (depth > 40) return null
    if (isUid(v)) {
      if (seen.has(v.uid)) return seen.get(v.uid)!
      const raw = objs[v.uid]
      const placeholder: { [k: string]: PValue } = {}
      seen.set(v.uid, placeholder)
      const res = resolve(raw, depth + 1)
      if (res && typeof res === 'object' && !Array.isArray(res) && !(res instanceof Uint8Array)) {
        Object.assign(placeholder, res)
        seen.set(v.uid, placeholder)
        return placeholder
      }
      seen.set(v.uid, res)
      return res
    }
    if (Array.isArray(v)) return v.map((x) => resolve(x, depth + 1))
    if (v && typeof v === 'object' && !(v instanceof Uint8Array)) {
      const d = v as { [k: string]: PValue }
      if (Array.isArray(d['NS.objects'])) {
        const objsList = (d['NS.objects'] as PValue[]).map((x) => resolve(x, depth + 1))
        if (Array.isArray(d['NS.keys'])) {
          const keys = (d['NS.keys'] as PValue[]).map((x) => String(resolve(x, depth + 1)))
          const o: { [k: string]: PValue } = {}
          keys.forEach((k, i) => (o[k] = objsList[i]))
          return o
        }
        return objsList
      }
      const o: { [k: string]: PValue } = {}
      for (const [k, x] of Object.entries(d)) if (k !== '$class') o[k] = resolve(x, depth + 1)
      return o
    }
    return v
  }
  return resolve((top['$top'] as { [k: string]: PValue })['root'])
}

// ------------------------------------------------------------------ LZ4 block
export function lz4Block(src: Uint8Array, outSize: number): Uint8Array {
  const out = new Uint8Array(outSize)
  let i = 0
  let o = 0
  while (i < src.length) {
    const tok = src[i++]
    let lit = tok >> 4
    if (lit === 15) {
      let b: number
      do {
        b = src[i++]
        lit += b
      } while (b === 255)
    }
    if (o + lit > outSize) lit = outSize - o
    out.set(src.subarray(i, i + lit), o)
    i += lit
    o += lit
    if (i >= src.length || o >= outSize) break
    const off = src[i] | (src[i + 1] << 8)
    i += 2
    let ml = tok & 15
    if (ml === 15) {
      let b: number
      do {
        b = src[i++]
        ml += b
      } while (b === 255)
    }
    ml += 4
    if (off === 0 || off > o) throw new Error('Corrupt LZ4 data')
    for (let k = 0; k < ml && o < outSize; k++, o++) out[o] = out[o - off]
  }
  return out
}

// ------------------------------------------------------------------ document
interface PLayer {
  uuid: string
  name: string
  opacity: number
  hidden: boolean
  blend: BlendMode
  clipped: boolean
  locked: boolean
}

/** Procreate blend enum -> ours (subset that is documented; unknown -> normal). */
const PC_BLEND: Record<number, BlendMode> = {
  0: 'normal',
  1: 'multiply',
  2: 'screen',
  3: 'overlay',
  4: 'difference',
  5: 'lighten',
  6: 'darken',
  7: 'colorDodge',
  8: 'colorBurn',
  9: 'softLight',
  10: 'hardLight',
  11: 'exclusion',
  12: 'hue',
  13: 'saturation',
  14: 'color',
  15: 'luminosity',
  16: 'linearBurn',
  17: 'add',
  20: 'hardMix',
  21: 'linearLight',
  22: 'pinLight',
  23: 'vividLight',
  24: 'darkerColor',
  25: 'lighterColor',
  26: 'divide',
  27: 'subtract'
}

const num = (v: PValue, d: number): number => (typeof v === 'number' && Number.isFinite(v) ? v : d)

function parseSize(v: PValue): [number, number] | null {
  if (typeof v === 'string') {
    const m = v.match(/(-?[\d.]+)\s*,\s*(-?[\d.]+)/)
    if (m) return [Math.round(Number(m[1])), Math.round(Number(m[2]))]
  }
  return null
}

export function importProcreate(gpu: GPU, bytes: Uint8Array, name: string): Document {
  const files = unzipSync(bytes)
  const archive = files['Document.archive']
  if (!archive) throw new Error('Not a Procreate file (Document.archive missing)')
  const root = unarchive(parseBplist(archive)) as { [k: string]: PValue }
  const size = parseSize(root['size']) ?? [num(root['width'], 0), num(root['height'], 0)]
  const [W, H] = size
  if (!(W > 0 && H > 0)) throw new Error('Cannot read the canvas size from this Procreate file')
  const tile = num(root['tileSize'], 256)
  const list = (root['layers'] as PValue[]) ?? []
  const layers: PLayer[] = list
    .filter((l): l is { [k: string]: PValue } => !!l && typeof l === 'object' && !Array.isArray(l))
    .map((l) => ({
      uuid: String(l['UUID'] ?? ''),
      name: String(l['name'] ?? t('core.doc.layer')),
      opacity: Math.max(0, Math.min(1, num(l['opacity'], 1))),
      hidden: !!l['hidden'],
      blend: PC_BLEND[num(l['blend'], 0)] ?? 'normal',
      clipped: !!l['clipped'],
      locked: !!l['locked']
    }))
    .filter((l) => l.uuid)
  if (!layers.length) throw new Error('No layers found in this Procreate file')

  const doc = new Document(gpu, W, H, { background: { color: [1, 1, 1], visible: false } })
  const bgc = root['backgroundColor']
  if (bgc instanceof Uint8Array && bgc.length >= 12) {
    const f = new Float32Array(bgc.buffer.slice(bgc.byteOffset, bgc.byteOffset + 16))
    doc.background = { color: [f[0], f[1], f[2]], visible: !root['backgroundHidden'] }
  }
  doc.name = name
  const cols = Math.ceil(W / tile)
  const rows = Math.ceil(H / tile)
  for (const pl of layers) {
    const layer = doc.createLayer({ name: pl.name, visible: !pl.hidden, opacity: pl.opacity, blendMode: pl.blend, clipping: pl.clipped, locked: pl.locked })
    const buf = new Uint8ClampedArray(W * H * 4)
    let any = false
    for (let r = 0; r < rows; r++) {
      for (let c = 0; c < cols; c++) {
        const chunk = files[`${pl.uuid}/${c}~${r}.chunk`] ?? files[`${pl.uuid}/${c}~${r}.lz4`]
        if (!chunk) continue
        const tw = Math.min(tile, W - c * tile)
        const th = Math.min(tile, H - r * tile)
        const expect = tw * th * 4
        let px: Uint8Array
        if (chunk.length === expect) px = chunk
        else px = lz4Block(chunk, expect)
        any = true
        // Procreate stores tile rows bottom-up; premultiplied -> convert to straight alpha for upload
        const ty = H - (r * tile + th) // top of the tile in document space (rows are counted from the bottom)
        for (let y = 0; y < th; y++) {
          const srcRow = (th - 1 - y) * tw * 4
          const dstY = ty + y
          if (dstY < 0 || dstY >= H) continue
          for (let x = 0; x < tw; x++) {
            const s = srcRow + x * 4
            const d = (dstY * W + c * tile + x) * 4
            const a = px[s + 3]
            const k = a > 0 ? 255 / a : 0
            buf[d] = px[s] * k
            buf[d + 1] = px[s + 1] * k
            buf[d + 2] = px[s + 2] * k
            buf[d + 3] = a
          }
        }
      }
    }
    if (any) gpu.uploadRGBA8(layer.pixels, 0, 0, W, H, buf)
    doc.layers.push(layer)
  }
  doc.layers.splice(0, doc.layers.length, ...normalizeOrder(doc.layers))
  // Procreate lists layers top -> bottom in the archive
  doc.layers.reverse()
  doc.activeId = doc.layers[doc.layers.length - 1].id
  doc.emitCommit('load', null, null, 'Import Procreate')
  return doc
}
