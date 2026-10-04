import { _electron as electron } from 'playwright-core'
import fs from 'fs'
const tag = process.argv[3] || 'after'
const ud = process.env.TEMP + '\bw-disp-' + Date.now()
const app = await electron.launch({ args: [process.argv[2] + '/main/index.js', '--user-data-dir=' + ud], cwd: process.cwd(), env: { ...process.env, BW_BRUSH_QA: '1' } })
const page = await app.firstWindow()
await page.waitForFunction(() => !!window.__bwqa, null, { timeout: 30000 })
fs.mkdirSync('qa-brush/display', { recursive: true })
for (const [z, r] of [[0.25, 0], [0.5, 0], [0.33, 0.6], [1, 0], [1, 0.58], [4, 0], [4, 0.5]]) {
  const o = await page.evaluate(([z, r]) => window.__bwqa.display(z, r), [z, r])
  fs.writeFileSync(`qa-brush/display/${tag}_z${z}_r${r}.png`, Buffer.from(o.png.split(',')[1], 'base64'))
  delete o.png
  console.log(JSON.stringify(o))
}
await app.close()
