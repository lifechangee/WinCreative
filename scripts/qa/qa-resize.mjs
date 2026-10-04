import { _electron as electron } from 'playwright-core'
const ud = process.env.TEMP.split(String.fromCharCode(92)).join('/') + '/bw-rs-' + Date.now()
const app = await electron.launch({ args: [(process.argv[2]||'out-resize')+'/main/index.js', '--user-data-dir=' + ud], cwd: process.cwd() })
const page = await app.firstWindow()
await page.waitForTimeout(2500)
const probe = () => page.evaluate(() => {
  const st = document.getElementById('stage').getBoundingClientRect()
  const dpr = devicePixelRatio
  const cs = [...document.querySelectorAll('#stage canvas')].map(c => { const r = c.getBoundingClientRect(); return { id: c.id||c.className, w: Math.round(r.width*10)/10, h: Math.round(r.height*10)/10, bw: c.width, bh: c.height, ew: Math.round(st.width*dpr), eh: Math.round(st.height*dpr) } })
  const a = window.brushwork_app
  return { iw: innerWidth, ih: innerHeight, dpr, stage: [st.width, st.height], css: a.cssSize(), cs }
})
const step = async (name, fn) => { await fn(); await page.waitForTimeout(700); const p = await probe(); console.log(name, JSON.stringify(p)); await page.screenshot({ path: `qa-screens/resize-${name}.png` }) }
const ev = (f, a) => app.evaluate(f, a)
await step('start', async()=>{})
await step('max', () => ev(({BrowserWindow}) => BrowserWindow.getAllWindows()[0].maximize()))
await step('unmax', () => ev(({BrowserWindow}) => BrowserWindow.getAllWindows()[0].unmaximize()))
for (const [w,h] of [[1000,700],[1700,1000],[900,600]]) await step(`size${w}`, () => ev(({BrowserWindow}, [w,h]) => BrowserWindow.getAllWindows()[0].setSize(w,h), [w,h]))
await step('fs', () => ev(({BrowserWindow}) => BrowserWindow.getAllWindows()[0].setFullScreen(true)))
await step('nofs', () => ev(({BrowserWindow}) => BrowserWindow.getAllWindows()[0].setFullScreen(false)))
await step('bounds', () => ev(({BrowserWindow}) => BrowserWindow.getAllWindows()[0].setBounds({x:0,y:0,width:960,height:1040})))
for (const z of [1.25,1.5,1]) await step('zoom'+z, () => ev(({BrowserWindow}, z) => BrowserWindow.getAllWindows()[0].webContents.setZoomFactor(z), z))
await app.close()
