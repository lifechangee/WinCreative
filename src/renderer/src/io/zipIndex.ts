import { inflateSync } from 'fflate'

/** Read-only index of a ZIP's central directory (pure): lets the loader slice single entries out of a big archive without unzipping it. */
export interface ZipEntry {
  name: string
  method: number
  csize: number
  usize: number
  /** offset of the local header */
  offset: number
}

export function indexZip(b: Uint8Array): Map<string, ZipEntry> {
  const dv = new DataView(b.buffer, b.byteOffset, b.byteLength)
  let e = b.length - 22
  const min = Math.max(0, b.length - 22 - 65535)
  while (e >= min && dv.getUint32(e, true) !== 0x06054b50) e--
  if (e < min) throw new Error('not a zip archive')
  let count = dv.getUint16(e + 10, true)
  let cd = dv.getUint32(e + 16, true)
  if (count === 0xffff || cd === 0xffffffff) {
    // zip64 end-of-central-directory locator
    const loc = e - 20
    if (loc >= 0 && dv.getUint32(loc, true) === 0x07064b50) {
      const z = Number(dv.getBigUint64(loc + 8, true))
      count = Number(dv.getBigUint64(z + 32, true))
      cd = Number(dv.getBigUint64(z + 48, true))
    }
  }
  const out = new Map<string, ZipEntry>()
  const td = new TextDecoder()
  let o = cd
  for (let i = 0; i < count; i++) {
    if (dv.getUint32(o, true) !== 0x02014b50) throw new Error('bad zip directory')
    const method = dv.getUint16(o + 10, true)
    let csize = dv.getUint32(o + 20, true)
    let usize = dv.getUint32(o + 24, true)
    const nl = dv.getUint16(o + 28, true)
    const xl = dv.getUint16(o + 30, true)
    const cl = dv.getUint16(o + 32, true)
    let offset = dv.getUint32(o + 42, true)
    const name = td.decode(b.subarray(o + 46, o + 46 + nl))
    if (csize === 0xffffffff || usize === 0xffffffff || offset === 0xffffffff) {
      let x = o + 46 + nl
      const xe = x + xl
      while (x + 4 <= xe) {
        const id = dv.getUint16(x, true)
        const sz = dv.getUint16(x + 2, true)
        if (id === 1) {
          let p = x + 4
          if (usize === 0xffffffff) (usize = Number(dv.getBigUint64(p, true)), (p += 8))
          if (csize === 0xffffffff) (csize = Number(dv.getBigUint64(p, true)), (p += 8))
          if (offset === 0xffffffff) offset = Number(dv.getBigUint64(p, true))
        }
        x += 4 + sz
      }
    }
    out.set(name, { name, method, csize, usize, offset })
    o += 46 + nl + xl + cl
  }
  return out
}

/** The (decompressed) bytes of one entry. Stored entries are zero-copy views into `b`. */
export function readEntry(b: Uint8Array, e: ZipEntry): Uint8Array {
  const dv = new DataView(b.buffer, b.byteOffset, b.byteLength)
  if (dv.getUint32(e.offset, true) !== 0x04034b50) throw new Error('bad zip entry ' + e.name)
  const start = e.offset + 30 + dv.getUint16(e.offset + 26, true) + dv.getUint16(e.offset + 28, true)
  const raw = b.subarray(start, start + e.csize)
  return e.method === 0 ? raw : inflateSync(raw, { out: new Uint8Array(e.usize) })
}
