import { createReadStream } from 'fs'
import { open as fsOpen } from 'fs/promises'
import { crc32, createInflateRaw } from 'zlib'

/**
 * Save verification: re-opens a written .bwk (zip), walks the central directory and inflates every entry, comparing CRC-32 and size.
 * Runs on the libuv pool (async zlib streams), never blocks the main thread. Throws a descriptive Error on the first problem.
 * ZIP64 archives (> 4 GB / 65535 entries) are only structurally checked at the EOCD level (WinCreative never writes them).
 */
export async function verifyZipFile(path: string): Promise<{ entries: number; bytes: number }> {
  const fh = await fsOpen(path, 'r')
  try {
    const size = (await fh.stat()).size
    if (size < 22) throw new Error('file too small for a zip')
    const tailLen = Math.min(size, 65557)
    const tail = Buffer.alloc(tailLen)
    await fh.read(tail, 0, tailLen, size - tailLen)
    let eocd = -1
    for (let i = tailLen - 22; i >= 0; i--) {
      if (tail.readUInt32LE(i) === 0x06054b50) {
        eocd = i
        break
      }
    }
    if (eocd < 0) throw new Error('end of central directory not found')
    const count = tail.readUInt16LE(eocd + 10)
    const cdSize = tail.readUInt32LE(eocd + 12)
    const cdOff = tail.readUInt32LE(eocd + 16)
    if (count === 0xffff || cdOff === 0xffffffff) return { entries: 0, bytes: size } // zip64: not produced by us
    if (cdOff + cdSize > size) throw new Error('central directory out of range')
    const cd = Buffer.alloc(cdSize)
    await fh.read(cd, 0, cdSize, cdOff)
    let p = 0
    let bytes = 0
    for (let n = 0; n < count; n++) {
      if (p + 46 > cdSize || cd.readUInt32LE(p) !== 0x02014b50) throw new Error('bad central directory entry #' + n)
      const method = cd.readUInt16LE(p + 10)
      const crc = cd.readUInt32LE(p + 16)
      const csize = cd.readUInt32LE(p + 20)
      const usize = cd.readUInt32LE(p + 24)
      const nameLen = cd.readUInt16LE(p + 28)
      const extraLen = cd.readUInt16LE(p + 30)
      const commentLen = cd.readUInt16LE(p + 32)
      const lho = cd.readUInt32LE(p + 42)
      const name = cd.toString('utf8', p + 46, p + 46 + nameLen)
      p += 46 + nameLen + extraLen + commentLen
      const lh = Buffer.alloc(30)
      await fh.read(lh, 0, 30, lho)
      if (lh.readUInt32LE(0) !== 0x04034b50) throw new Error('bad local header for ' + name)
      const start = lho + 30 + lh.readUInt16LE(26) + lh.readUInt16LE(28)
      if (csize > 0 && start + csize > size) throw new Error('data of ' + name + ' runs past the end of the file')
      let sum = 0
      let got = 0
      const feed = (c: Buffer): void => {
        sum = crc32(c, sum)
        got += c.length
      }
      if (csize > 0 || method !== 0) {
        await new Promise<void>((res, rej) => {
          const src = createReadStream(path, { start, end: start + csize - 1, highWaterMark: 1 << 20 })
          src.on('error', rej)
          if (method === 0) {
            src.on('data', (c) => feed(c as Buffer)).on('end', res)
          } else if (method === 8) {
            const inf = createInflateRaw()
            inf.on('data', feed).on('end', res).on('error', (e) => rej(new Error(`${name}: ${e.message}`)))
            src.pipe(inf)
          } else rej(new Error(`${name}: unsupported compression method ${method}`))
        })
      }
      if (got !== usize) throw new Error(`${name}: size ${got} != ${usize}`)
      if (sum >>> 0 !== crc) throw new Error(`${name}: CRC mismatch`)
      bytes += got
    }
    return { entries: count, bytes }
  } finally {
    await fh.close()
  }
}
