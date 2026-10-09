// Runs every in-app self-test sequentially against a build (default out/, or --out <dir>) and prints a summary.
// usage: node scripts/selftest.mjs [--out out-int] [--build] [--exe <path to packaged WinCreative.exe>] [suite ...]
// --exe runs the same suites against a PACKAGED app (e.g. release-qa/win-unpacked/WinCreative.exe) instead of out/.
import { spawnSync } from 'node:child_process'
import { mkdtempSync, mkdirSync, rmSync, existsSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { dirname, join, resolve } from 'node:path'
import { fileURLToPath } from 'node:url'
import { createRequire } from 'node:module'

const args = process.argv.slice(2)
const flag = (n) => args.includes(n)
const opt = (n, d) => (args.includes(n) ? args[args.indexOf(n) + 1] : d)
const outDir = resolve(opt('--out', 'out'))
const exe = args.includes('--exe') ? resolve(opt('--exe')) : null
const only = args.filter((a, i) => !a.startsWith('--') && args[i - 1] !== '--out' && args[i - 1] !== '--exe')
const electron = createRequire(import.meta.url)('electron')

if (flag('--build')) {
  const r = spawnSync('npx', ['electron-vite', 'build', '--outDir', outDir], { stdio: 'inherit', shell: true })
  if (r.status !== 0) process.exit(r.status ?? 1)
}
if (exe ? !existsSync(exe) : !existsSync(join(outDir, 'main', 'index.js'))) {
  console.error(`No build in ${outDir}; run with --build`)
  process.exit(2)
}

const SUITES = [
  { name: 'core smoke', env: { BW_SELFTEST: '1' } },
  { name: 'brushes', env: { BW_BRUSH_SELFTEST: '1' } },
  { name: 'layers', env: { BW_LAYERS_TEST: '1' } },
  { name: 'smartselect', env: { BW_SS_TEST: '1' } },
  { name: 'color+gallery', env: { BW_COLOR_SELFTEST: '1' } },
  { name: 'animio', env: { BW_ANIMIO_TEST: '1' }, out: true },
  { name: 'interface', env: { BW_INTERFACE_SELFTEST: '1' } },
  { name: 'tutorial', env: { BW_TUTORIAL_SELFTEST: '1' } },
  { name: 'integration', env: { BW_INTEG_TEST: '1' } },
  { name: 'perf+robustness', env: { BW_PERF_SELFTEST: '1' } },
  { name: 'infinite', env: { BW_INF_SELFTEST: '1', BW_PERF_TEST: '1' } },
  { name: 'frame', env: { BW_FRAME_SELFTEST: '1', BW_PERF_TEST: '1' } },
  // language variants (0.4.0): language layers, per-variant recording / edit models / compare / export, reload, old files (Playwright + ffprobe)
  { name: 'langvariants', node: ['scripts/qa/qa-lang-suite.mjs'] },
  // multi-session cross-feature stress (Playwright drives the app): 3 back-to-back sessions of mixed ops on an infinite canvas with tiny memory budgets;
  // fails on any renderer crash / GPU process loss / GL error / context loss / texture or memory growth after closing documents
  { name: 'stress', node: ['scripts/qa/qa-int-stress.mjs', '--iters', '80', '--seed', '21', '--sessions', '3'] },
  // renderer crash recovery: kills the renderer, expects the window to reload and the last artwork to reopen with the translated notice
  { name: 'recovery', node: ['scripts/qa/qa-crash-recovery.mjs'] }
]

// the smartselect suite needs the bundled MobileSAM weights (not in git): fetch + verify them once (no network when already present)
if (SUITES.some((s) => s.name === 'smartselect' && (!only.length || only.some((o) => s.name.includes(o))))) {
  const m = spawnSync(process.execPath, [join(dirname(fileURLToPath(import.meta.url)), 'models', 'fetch-bundled.mjs')], { stdio: 'inherit' })
  if (m.status !== 0) process.exit(m.status ?? 1)
}
const results = []
for (const s of SUITES) {
  if (only.length && !only.some((o) => s.name.includes(o))) continue
  const tmp = mkdtempSync(join(tmpdir(), 'bw-st-'))
  const env = { ...process.env, ...s.env, BW_GALLERY_DIR: join(tmp, 'gallery'), ELECTRON_ENABLE_LOGGING: '' }
  if (s.out) {
    mkdirSync(join(tmp, 'out'), { recursive: true })
    env.BW_ANIMIO_OUT = join(tmp, 'out')
  }
  process.stdout.write(`== ${s.name} ... `)
  const t0 = Date.now()
  const r = s.node
    ? spawnSync(process.execPath, [...s.node, '--out', outDir], { env: { ...env, ...(exe ? { BW_EXE: exe } : {}) }, encoding: 'utf8', timeout: 900000, maxBuffer: 256 * 1024 * 1024 })
    : spawnSync(exe ?? electron, [...(exe ? [] : [join(outDir, 'main', 'index.js')]), `--user-data-dir=${join(tmp, 'ud')}`], { env, encoding: 'utf8', timeout: 420000, maxBuffer: 256 * 1024 * 1024 })
  const text = (r.stdout ?? '') + (r.stderr ?? '')
  const lines = text.split(/\r?\n/)
  const fails = lines.filter((l) => (/\bFAIL\b|exception|render-process-gone|RENDERER CRASHED|FATAL|\bRPG |\[renderer:3\]/i.test(l) || /\bCPG .*"type":"GPU"/.test(l)) && !/PASS/.test(l))
  const passes = lines.filter((l) => /\bPASS\b/.test(l)).length
  const ok = r.status === 0 && fails.length === 0
  const secs = ((Date.now() - t0) / 1000).toFixed(0)
  console.log(`${ok ? 'OK' : 'FAILED'} (exit ${r.status ?? r.signal}, ${passes} pass, ${fails.length} fail, ${secs}s)`)
  if (!ok) {
    for (const f of fails.slice(0, 15)) console.log('   ' + f.slice(0, 260))
    if (!fails.length) for (const f of lines.slice(-12)) console.log('   ' + f.slice(0, 260))
  }
  results.push({ name: s.name, ok, passes, fails: fails.length })
  try { rmSync(tmp, { recursive: true, force: true }) } catch {}
}
console.log('\nSummary:')
for (const r of results) console.log(`  ${r.ok ? 'PASS' : 'FAIL'}  ${r.name}  (${r.passes} checks)`)
process.exit(results.every((r) => r.ok) ? 0 : 1)
