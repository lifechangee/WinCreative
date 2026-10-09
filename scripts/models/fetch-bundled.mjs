// Downloads the BUNDLED Smart-selection model (MobileSAM, Apache-2.0) into resources/models/fast and verifies size + SHA-256
// against src/renderer/src/features/smartselect/models.json. Files that are already present and hash-correct are skipped (no network).
// usage: node scripts/models/fetch-bundled.mjs [--force] [--check]   (--check: verify only, never download, exit 1 when missing)
// Wired into `npm run dist` (predist) / `npm run models`. Needs the network only when a file is missing or corrupt.
import { createHash } from 'node:crypto'
import { createReadStream, existsSync, mkdirSync, renameSync, statSync, unlinkSync, writeFileSync } from 'node:fs'
import { readFileSync } from 'node:fs'
import { dirname, join, resolve } from 'node:path'
import { fileURLToPath } from 'node:url'

const root = resolve(dirname(fileURLToPath(import.meta.url)), '..', '..')
const models = JSON.parse(readFileSync(join(root, 'src/renderer/src/features/smartselect/models.json'), 'utf8'))
const force = process.argv.includes('--force')
const checkOnly = process.argv.includes('--check')
const fileSha = (p) => new Promise((res, rej) => {
  const h = createHash('sha256')
  createReadStream(p).on('data', (d) => h.update(d)).on('end', () => res(h.digest('hex'))).on('error', rej)
})
const fail = (msg) => { console.error('\n[models] ERROR: ' + msg + '\n'); process.exit(1) }

for (const m of Object.values(models).filter((x) => x.bundled)) {
  const dir = join(root, 'resources', 'models', m.id)
  mkdirSync(dir, { recursive: true })
  for (const f of [m.encoder, m.decoder, ...m.extra]) {
    const p = join(dir, f.name)
    if (!force && existsSync(p) && statSync(p).size === f.size && (await fileSha(p)) === f.sha256) {
      console.log('[models] ok   ', f.name)
      continue
    }
    if (checkOnly) fail(`${f.name} is missing or corrupt in ${dir}; run "npm run models"`)
    console.log('[models] fetch', f.url)
    let buf
    try {
      const r = await fetch(f.url)
      if (!r.ok) throw new Error('HTTP ' + r.status)
      buf = Buffer.from(await r.arrayBuffer())
    } catch (e) {
      fail(`cannot download ${f.name} (${e?.cause?.code ?? e?.message ?? e}). The bundled Smart-selection model is required for installers.\n` +
        `  Connect to the internet and run "npm run models", or copy the verified file(s) into ${dir}\n  (source: ${f.url})`)
    }
    if (buf.length !== f.size || createHash('sha256').update(buf).digest('hex') !== f.sha256) fail('checksum mismatch: ' + f.name)
    const tmp = p + '.part'
    writeFileSync(tmp, buf)
    try { if (existsSync(p)) unlinkSync(p) } catch {}
    renameSync(tmp, p)
    console.log('[models] saved', f.name, buf.length)
  }
}
