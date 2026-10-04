/**
 * Binary property list (bplist00) reader + NSKeyedArchiver resolver. Pure, no DOM: used by the Procreate
 * .brush importer. Only reading is supported.
 */
export interface Uid {
  UID: number
}
export const isUid = (v: unknown): v is Uid => !!v && typeof v === 'object' && 'UID' in (v as object) && Object.keys(v as object).length === 1

export function parseBplist(buf: Uint8Array): unknown {
  const dv = new DataView(buf.buffer, buf.byteOffset, buf.byteLength)
  if (buf.length < 40 || String.fromCharCode(...buf.slice(0, 8)) !== 'bplist00') throw new Error('Not a binary plist')
  const t = buf.length - 32
  const offSize = buf[t + 6]
  const refSize = buf[t + 7]
  const count = Number(dv.getBigUint64(t + 8))
  const top = Number(dv.getBigUint64(t + 16))
  const tableOff = Number(dv.getBigUint64(t + 24))
  if (offSize < 1 || offSize > 8 || refSize < 1 || refSize > 8 || tableOff + count * offSize > buf.length) throw new Error('Corrupt plist trailer')
  const uint = (pos: number, n: number): number => {
    let v = 0
    for (let i = 0; i < n; i++) v = v * 256 + buf[pos + i]
    return v
  }
  const offsets: number[] = []
  for (let i = 0; i < count; i++) offsets.push(uint(tableOff + i * offSize, offSize))
  const cache = new Map<number, unknown>()

  const readLen = (marker: number, pos: number): { len: number; pos: number } => {
    let len = marker & 15
    if (len === 15) {
      const m = buf[pos]
      const n = 1 << (m & 15)
      len = uint(pos + 1, n)
      return { len, pos: pos + 1 + n }
    }
    return { len, pos }
  }

  const obj = (idx: number, depth: number): unknown => {
    if (depth > 200) throw new Error('plist too deep')
    if (cache.has(idx)) return cache.get(idx)
    let p = offsets[idx]
    if (p === undefined || p >= buf.length) throw new Error('Bad object offset')
    const m = buf[p++]
    const hi = m >> 4
    let v: unknown
    switch (hi) {
      case 0:
        v = m === 0x08 ? false : m === 0x09 ? true : null
        break
      case 1: {
        const n = 1 << (m & 15)
        v = n <= 6 ? uint(p, n) : Number(dv.getBigInt64(p))
        break
      }
      case 2: {
        const n = 1 << (m & 15)
        v = n === 4 ? dv.getFloat32(p) : dv.getFloat64(p)
        break
      }
      case 3:
        v = new Date(978307200000 + dv.getFloat64(p) * 1000)
        break
      case 4: {
        const r = readLen(m, p)
        v = buf.slice(r.pos, r.pos + r.len)
        break
      }
      case 5: {
        const r = readLen(m, p)
        v = String.fromCharCode(...buf.slice(r.pos, r.pos + r.len))
        break
      }
      case 6: {
        const r = readLen(m, p)
        let s = ''
        for (let i = 0; i < r.len; i++) s += String.fromCharCode(dv.getUint16(r.pos + i * 2))
        v = s
        break
      }
      case 8:
        v = { UID: uint(p, (m & 15) + 1) } as Uid
        break
      case 0xa:
      case 0xc: {
        const r = readLen(m, p)
        const arr: unknown[] = []
        cache.set(idx, arr)
        for (let i = 0; i < r.len; i++) arr.push(obj(uint(r.pos + i * refSize, refSize), depth + 1))
        return arr
      }
      case 0xd: {
        const r = readLen(m, p)
        const o: Record<string, unknown> = {}
        cache.set(idx, o)
        for (let i = 0; i < r.len; i++) {
          const k = obj(uint(r.pos + i * refSize, refSize), depth + 1)
          o[String(k)] = obj(uint(r.pos + (r.len + i) * refSize, refSize), depth + 1)
        }
        return o
      }
      default:
        throw new Error('Unsupported plist object type ' + hi)
    }
    cache.set(idx, v)
    return v
  }
  return obj(top, 0)
}

/**
 * Resolve an NSKeyedArchiver archive into plain JS: class instances become objects with their fields,
 * NSArray/NSDictionary become arrays/objects, '$null' becomes null.
 */
export function unarchive(plist: unknown): unknown {
  const root = plist as { $objects?: unknown[]; $top?: Record<string, unknown> }
  if (!root || !Array.isArray(root.$objects) || !root.$top) return plist
  const objs = root.$objects
  const memo = new Map<number, unknown>()
  const res = (v: unknown, depth: number): unknown => {
    if (depth > 60) return null
    if (isUid(v)) {
      const i = v.UID
      if (memo.has(i)) return memo.get(i)
      const raw = objs[i]
      if (raw === '$null') return null
      if (raw && typeof raw === 'object' && !Array.isArray(raw) && !(raw instanceof Uint8Array) && !(raw instanceof Date)) {
        const r = raw as Record<string, unknown>
        if (Array.isArray(r['NS.keys']) && Array.isArray(r['NS.objects'])) {
          const o: Record<string, unknown> = {}
          memo.set(i, o)
          const ks = r['NS.keys'] as unknown[]
          const vs = r['NS.objects'] as unknown[]
          ks.forEach((k, n) => (o[String(res(k, depth + 1))] = res(vs[n], depth + 1)))
          return o
        }
        if (Array.isArray(r['NS.objects'])) {
          const a: unknown[] = []
          memo.set(i, a)
          for (const x of r['NS.objects'] as unknown[]) a.push(res(x, depth + 1))
          return a
        }
        const o: Record<string, unknown> = {}
        memo.set(i, o)
        for (const [k, x] of Object.entries(r)) if (k !== '$class') o[k] = res(x, depth + 1)
        return o
      }
      memo.set(i, raw)
      return raw
    }
    if (Array.isArray(v)) return v.map((x) => res(x, depth + 1))
    return v
  }
  const top = root.$top
  return res(top.root ?? Object.values(top)[0], 0)
}
