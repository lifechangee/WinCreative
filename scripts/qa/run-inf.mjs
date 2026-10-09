// usage: [BENCH=1] node scripts/qa/run-inf.mjs <outDir> [grep]   runs the infinite selftest (or the bench) and streams matching lines
import { spawn } from 'node:child_process'
import { mkdtempSync, rmSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join, resolve } from 'node:path'
import { createRequire } from 'node:module'
const electron = createRequire(import.meta.url)('electron')
const out = resolve(process.argv[2] ?? 'out-infD')
const re = new RegExp(process.argv[3] ?? 'memory|tile-memory|FAIL|infbench|zoom-out')
const tmp = mkdtempSync(join(tmpdir(), 'bw-inf-'))
const env = { ...process.env, ...(process.env.BENCH ? { BW_INF_BENCH: '1' } : { BW_INF_SELFTEST: '1' }), BW_PERF_TEST: '1', BW_GALLERY_DIR: join(tmp, 'g'), ELECTRON_ENABLE_LOGGING: '' }
const p = spawn(electron, [join(out, 'main', 'index.js'), `--user-data-dir=${join(tmp, 'ud')}`], { env })
const timer = setTimeout(() => (console.log('TIMEOUT'), p.kill()), Number(process.env.TMO ?? 900000))
let buf = ''
const feed = (d) => {
  buf += d.toString()
  const lines = buf.split(/\r?\n/)
  buf = lines.pop()
  for (const l of lines) if (re.test(l)) console.log(l.replace(/ \(file:.*$/, '').slice(0, 260))
}
p.stdout.on('data', feed)
p.stderr.on('data', feed)
p.on('exit', (c) => {
  clearTimeout(timer)
  console.log('exit', c)
  try { rmSync(tmp, { recursive: true, force: true }) } catch {}
})
