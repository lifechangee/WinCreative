// v0.3.0 visual sweep helper: node scripts/qa/qa-polish.mjs <scenario> [--lang ru] [--size 1280x720] [--out out-polish]
import { launch, newDoc, outDirOf, strokeDoc } from './qa-inf-lib.mjs'
import { mkdirSync } from 'fs'
const args = process.argv.slice(2)
const opt = (n, d) => (args.includes(n) ? args[args.indexOf(n) + 1] : d)
const lang = opt('--lang', 'en')
const [W, H] = opt('--size', '1280x720').split('x').map(Number)
const scen = args.filter((a, i) => !a.startsWith('--') && !['--lang', '--size', '--out'].includes(args[i - 1]))
const dir = 'qa-screens/v030'
mkdirSync(dir, { recursive: true })
const { app, page, errors } = await launch(outDirOf(['--out', opt('--out', 'out-polish')]), { BW_LANG: lang })
await app.evaluate(({ BrowserWindow }, [w, h]) => { const win = BrowserWindow.getAllWindows()[0]; win.setContentSize(w, h); win.center() }, [W, H])
await page.waitForTimeout(600)
const tag = `${lang}-${W}`
const shot = async (name, clip) => { await page.waitForTimeout(350); await page.screenshot({ path: `${dir}/${name}-${tag}.png`, ...(clip ? { clip } : {}) }); console.log('shot', `${name}-${tag}.png`) }
const ev = (fn, a) => page.evaluate(fn, a)
const SC = (await import(new URL(`./polish/${scen[0]}.mjs`, import.meta.url))).default
try { await SC({ app, page, errors, shot, ev, newDoc, strokeDoc, lang, W, H }) } catch (e) { console.log('SCENARIO ERROR', e.message) }
console.log('errors', errors.length ? errors.slice(0, 8) : 'none')
await app.close()
