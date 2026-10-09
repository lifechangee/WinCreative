import { describe, expect, it } from 'vitest'
import { mkdtempSync, readFileSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { strToU8, zipSync } from 'fflate'
import { verifyZipFile } from '../src/main/zipVerify'

const dir = mkdtempSync(join(tmpdir(), 'bw-zv-'))
const noisy = (n: number): Uint8Array => {
  const a = new Uint8Array(n)
  let x = 12345
  for (let i = 0; i < n; i++) {
    x = (x * 1103515245 + 12345) & 0x7fffffff
    a[i] = i % 7 === 0 ? x & 255 : (i >> 4) & 255 // compressible but not trivially so
  }
  return a
}
const make = (): Uint8Array =>
  zipSync({
    'manifest.json': strToU8(JSON.stringify({ version: 2, layers: [] })),
    'layers/a/0_0.png': [noisy(200_000), { level: 6 }],
    'layers/a/1_0.png': [noisy(150_000), { level: 0 }], // stored entry
    'thumbnail.png': noisy(5000)
  })

describe('save verification (zipVerify)', () => {
  it('accepts a good archive and counts entries', async () => {
    const p = join(dir, 'ok.bwk')
    writeFileSync(p, make())
    const r = await verifyZipFile(p)
    expect(r.entries).toBe(4)
    expect(r.bytes).toBeGreaterThan(350_000)
  })
  it('rejects a flipped byte inside a deflated entry (invalid distance / CRC)', async () => {
    const z = make()
    const bad = z.slice()
    bad[2000] ^= 0xff
    bad[2001] ^= 0x55
    const p = join(dir, 'bad.bwk')
    writeFileSync(p, bad)
    await expect(verifyZipFile(p)).rejects.toThrow()
  })
  it('rejects a flipped byte inside a stored entry (CRC mismatch)', async () => {
    const z = make()
    const bad = z.slice()
    const s = Buffer.from(z).indexOf(Buffer.from('layers/a/1_0.png'))
    bad[s + 16 + 300] ^= 0x01
    const p = join(dir, 'bad2.bwk')
    writeFileSync(p, bad)
    await expect(verifyZipFile(p)).rejects.toThrow(/CRC/)
  })
  it('rejects a truncated archive', async () => {
    const z = readFileSync(join(dir, 'ok.bwk'))
    const p = join(dir, 'cut.bwk')
    writeFileSync(p, z.subarray(0, z.length - 100))
    await expect(verifyZipFile(p)).rejects.toThrow()
  })
})
