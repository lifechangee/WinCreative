import { _electron as electron } from 'playwright-core'
const ud = process.env.TEMP.split(String.fromCharCode(92)).join('/') + '/bw-rs2-' + Date.now()
const app = await electron.launch({ args: [(process.argv[2]||'out-resize')+'/main/index.js', '--user-data-dir=' + ud], cwd: process.cwd() })
const page = await app.firstWindow()
const ev = (f, a) => app.evaluate(f, a)
const probe = () => page.evaluate(() => {
  const a = window.brushwork_app; a.renderNow()
  const gl = a.canvas.getContext('webgl2'); const W = a.canvas.width, H = a.canvas.height
  const px = (x,y) => { const b = new Uint8Array(4); gl.readPixels(x,y,1,1,gl.RGBA,gl.UNSIGNED_BYTE,b); return [...b].join(',') }
  return { iw: innerWidth, ih: innerHeight, W, H, vp: [...gl.getParameter(gl.VIEWPORT)], corner: px(W-2,1), corner2: px(1,H-2), left: px(1,1), cb: [a.canvas.clientWidth, a.canvas.clientHeight] }
})
const log = async n => console.log(n, JSON.stringify(await probe()))
await page.waitForFunction(()=>window.brushwork_app); await log('t0')
await ev(({BrowserWindow}) => BrowserWindow.getAllWindows()[0].maximize())
await log('max-immediate')
await page.waitForTimeout(500); await log('max+500')
for (let i=0;i<8;i++) { await ev(({BrowserWindow},i) => BrowserWindow.getAllWindows()[0].setSize(900+i*90,600+i*50), i) }
await log('storm-immediate'); await page.waitForTimeout(300); await log('storm+300')
await ev(({BrowserWindow}) => BrowserWindow.getAllWindows()[0].webContents.setZoomFactor(1.5))
await page.waitForTimeout(300); await log('zoom1.5')
await ev(({BrowserWindow}) => BrowserWindow.getAllWindows()[0].webContents.setZoomFactor(1))
await page.waitForTimeout(300); await log('zoom1')
await app.close()
