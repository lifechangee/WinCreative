// Heuristic scan for hard-coded English UI strings left in src/renderer/src, grouped by i18n module.
//   npm run i18n:check                 counts per module
//   npm run i18n:check -- --list       + every finding (file:line: text)
//   npm run i18n:check -- layers       only the given module(s) (implies --list)
//   npm run i18n:check -- --strict     exit 1 when anything is left (CI)
// Also reports t('..') / tk('..') keys that are not in the English dictionaries (typos).
// Silence a false positive with a trailing `// i18n-ignore` comment on the line.
import { readdirSync, readFileSync, statSync } from 'node:fs'
import { join, relative, sep } from 'node:path'
import { fileURLToPath } from 'node:url'

const root = join(fileURLToPath(new URL('.', import.meta.url)), '..', 'src', 'renderer', 'src')
const args = process.argv.slice(2)
const MODULES = ['core', 'ui', 'brushes', 'layers', 'color', 'gallery', 'adjustments', 'selectxform', 'smartselect', 'guides', 'animio', 'interface', 'tutorial', 'langs']
const only = args.filter((a) => MODULES.includes(a))
const list = args.includes('--list') || only.length > 0
const strict = args.includes('--strict')

/** file (posix path relative to src/renderer/src) -> i18n module */
function moduleOf(rel) {
  const m = /^features\/(\w+)\//.exec(rel)
  if (m) {
    const f = m[1]
    if (f === 'color') return /gallery/i.test(rel) ? 'gallery' : 'color'
    if (f === 'profiles') return 'color'
    if (f === 'psdimport') return 'animio'
    if (f === 'langvariants') return 'langs'
    if (MODULES.includes(f)) return f
    return 'core'
  }
  if (rel.startsWith('ui/')) return /^ui\/(newDocDialog|index|sidebar|popover|registry|dom)\./.test(rel) ? 'ui' : rel.includes('layerPanel') ? 'layers' : rel.includes('brushPanel') ? 'brushes' : rel.includes('colorPanel') ? 'color' : 'ui'
  return 'core'
}

const SKIP_FILE = /(^|\/)(selftest\w*|qa\w*|i18n\/.*)\.ts$|\.d\.ts$|tlWorker|saveWorker|\/qa\//
function* walk(dir) {
  for (const n of readdirSync(dir)) {
    const p = join(dir, n)
    if (statSync(p).isDirectory()) yield* walk(p)
    else if (/\.ts$/.test(n)) yield p
  }
}

const latin = (s) => /[A-Za-z]{3,}/.test(s)
/** looks like user-facing prose rather than an identifier / css / path */
function looksUi(s) {
  const t = s.replace(/\$\{[^}]*\}/g, ' ').trim()
  if (!latin(t)) return false
  if (/^[\w.:/#-]+$/.test(t) && !/^[A-Z]/.test(t)) return false // ids, classes, urls, paths
  if (/[;{}]/.test(t) && /:/.test(t)) return false // css
  if (/^(https?:|data:|[.#])/.test(t)) return false
  if (/^\$\{[^}]+\}$/.test(t)) return false
  return /\s/.test(t) || /^[A-Z]/.test(t)
}

const LIT = String.raw`(?:'((?:[^'\\]|\\.)*)'|"((?:[^"\\]|\\.)*)"|\x60((?:[^\x60\\]|\\.)*)\x60)`
const PATTERNS = [
  new RegExp(String.raw`\b(?:text|title|placeholder|label|ariaLabel|alt|caption|tooltip)\s*:\s*` + LIT, 'g'),
  new RegExp(String.raw`['"](?:data-tip|aria-label|placeholder|title)['"]\s*:\s*` + LIT, 'g'),
  new RegExp(String.raw`\.(?:textContent|innerText|title|placeholder|ariaLabel)\s*=\s*` + LIT, 'g'),
  new RegExp(String.raw`\b(?:notify|toast|alert|confirm|prompt|askText|showToast|setStatus)\(\s*` + LIT, 'g'),
  new RegExp(String.raw`\bsetAttribute\(\s*['"](?:title|aria-label|placeholder|data-tip)['"]\s*,\s*` + LIT, 'g'),
  new RegExp(String.raw`\bh\(\s*'\w+'\s*(?:,\s*(?:\{[^}]*\}|null))?\s*,\s*` + LIT + String.raw`\s*[,)]`, 'g'),
  new RegExp(String.raw`\.innerHTML\s*=\s*` + LIT, 'g')
]

const found = new Map(MODULES.map((m) => [m, []]))
const used = [] // [file, line, key]
for (const file of walk(root)) {
  const rel = relative(root, file).split(sep).join('/')
  if (SKIP_FILE.test(rel)) continue
  const mod = moduleOf(rel)
  const lines = readFileSync(file, 'utf8').split(/\r?\n/)
  lines.forEach((line, i) => {
    const trimmed = line.trim()
    for (const km of line.matchAll(/\b(?:t|tk|tEl|tAttr|tIn)\(\s*(?:[a-z]+\s*,\s*)?'([\w.]+)'/g)) used.push([rel, i + 1, km[1]])
    if (trimmed.startsWith('//') || trimmed.startsWith('*') || trimmed.startsWith('/*') || /i18n-ignore/.test(line)) return
    if (/^\s*(import|export .* from)\b/.test(line) || /console\.(log|warn|error|info)\(/.test(line) || /throw new Error/.test(line)) return
    const seen = new Set()
    for (const re of PATTERNS) {
      re.lastIndex = 0
      for (const m of line.matchAll(re)) {
        const s = m[1] ?? m[2] ?? m[3] ?? ''
        if (seen.has(s)) continue
        // innerHTML: only if it contains visible words outside tags
        const visible = re.source.includes('innerHTML') ? s.replace(/<[^>]*>/g, ' ') : s
        if (!looksUi(visible)) continue
        seen.add(s)
        found.get(mod).push(`${rel}:${i + 1}: ${s.length > 90 ? s.slice(0, 87) + '...' : s}`)
      }
    }
  })
}

// ---- keys used in code but missing from the English dictionaries
const enDir = join(root, 'i18n', 'locales', 'en')
const enKeys = new Set()
for (const n of readdirSync(enDir)) {
  if (n === 'index.ts') continue
  for (const m of readFileSync(join(enDir, n), 'utf8').matchAll(/^\s*'([^']+)'\s*:/gm)) enKeys.add(m[1])
}
const has = (k) => enKeys.has(k) || enKeys.has(k + '_other')
const unknown = used.filter(([, , k]) => k.includes('.') && !k.endsWith('.') && !has(k))

let total = 0
console.log('Hard-coded English UI strings left (heuristic), by module:')
for (const m of MODULES) {
  const n = found.get(m).length
  total += n
  console.log(`  ${m.padEnd(12)} ${String(n).padStart(4)}`)
  if (list && (!only.length || only.includes(m))) for (const f of found.get(m)) console.log('      ' + f)
}
console.log(`  ${'TOTAL'.padEnd(12)} ${String(total).padStart(4)}`)
if (unknown.length) {
  console.log(`\nKeys used in code but missing from locales/en (${unknown.length}):`)
  for (const [f, l, k] of unknown.slice(0, 60)) console.log(`  ${f}:${l}: ${k}`)
}
if (strict && (total || unknown.length)) process.exit(1)
