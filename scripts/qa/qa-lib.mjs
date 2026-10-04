import { _electron as electron } from 'playwright-core'
import fs from 'fs'
export async function launch(opts={}) {
  const ud = process.env.TEMP.split(String.fromCharCode(92)).join('/') + '/bw-ui-qa-' + Date.now()
  const app = await electron.launch({ args: ['out-ui/main/index.js', '--user-data-dir=' + ud], cwd: process.cwd() })
  const page = await app.firstWindow()
  const errs = []
  page.on('console', m => { if (m.type()==='error'||m.type()==='warning') errs.push(m.type()+': '+m.text()) })
  page.on('pageerror', e => errs.push('PAGEERR ' + e.message))
  await page.waitForTimeout(2500)
  return { app, page, errs }
}
export async function draw(page){
  const strokes=[[420,300,'#e33'],[520,420,'#3a3']]
  await page.mouse.move(450,250);await page.mouse.down()
  for(let i=0;i<40;i++) await page.mouse.move(450+i*8,250+Math.sin(i/4)*60,{steps:2})
  await page.mouse.up()
  await page.mouse.move(450,500);await page.mouse.down()
  for(let i=0;i<40;i++) await page.mouse.move(450+i*8,500-Math.cos(i/5)*80,{steps:2})
  await page.mouse.up()
}
