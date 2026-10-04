import { _electron as electron } from 'playwright-core'
const ud = process.env.TEMP + '\bw-probe-' + Date.now()
const app = await electron.launch({ args: [process.argv[2] + '/main/index.js', '--user-data-dir=' + ud], cwd: process.cwd(), env: { ...process.env, BW_BRUSH_QA: '1' } })
const page = await app.firstWindow()
await page.waitForFunction(() => !!window.__bwqa, null, { timeout: 30000 })
const code = process.argv[3]
const out = await page.evaluate(new Function('return (async()=>{' + code + '})()'))
console.log(typeof out === 'string' ? out : JSON.stringify(out))
await app.close()
