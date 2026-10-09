import { scribble, menu, openMenu, stroke } from './lib.mjs'
export default async ({ page, ev, shot, newDoc, W }) => {
  const kind = process.env.SWEEP_KIND ?? 'infinite'
  await newDoc(page, kind, 1600, 1200)
  await ev(() => document.querySelectorAll('.bw-gallery.open').forEach((e) => e.classList.remove('open')))
  if (kind === 'infinite') await ev(() => { window.brushwork_frame.createFrame(1200, 900); window.brushwork_app.fitContent() })
  else await ev(() => window.brushwork_app.setView({ cx: 800, cy: 600, zoom: 0.6, rot: 0 }))
  const cx = kind === 'infinite' ? 0 : 800, cy = kind === 'infinite' ? 0 : 600
  // an object: filled disc made from strokes
  for (let r = 10; r < 160; r += 25) { const pts = []; for (let i = 0; i <= 40; i++) pts.push([cx - 120 + Math.cos(i / 40 * 6.283) * r, cy + Math.sin(i / 40 * 6.283) * r]); await stroke(page, pts, 40) }
  await ev(() => window.brushwork_app.setView({ ...window.brushwork_app.view, zoom: 0.6 }))
  await menu(page, 4, /Smart selection/, /Умное выделение/)
  await page.waitForTimeout(700); await shot('ss-bar-' + kind)
  const bar = page.locator('.ss-bar')
  console.log('bar html buttons', await bar.locator('button').allInnerTexts())
  // switch modes via the first row of buttons
  const modeBtns = bar.locator('.ss-modes button'); const n = await modeBtns.count(); console.log('modes', n, await modeBtns.allInnerTexts())
  for (const i of [0, 1, 3]) { await modeBtns.nth(i).click().catch(() => {}); await page.waitForTimeout(500); await shot(`ss-mode${i}-` + kind) }
  // click on the object
  await modeBtns.nth(0).click().catch(() => {})
  const r = await page.evaluate(() => { const a = window.brushwork_app; const c = a.canvas.getBoundingClientRect(); return { l: c.left, t: c.top, w: c.width, h: c.height, v: a.view } })
  const px = r.l + r.w / 2 + (cx - 120 - r.v.cx) * r.v.zoom, py = r.t + r.h / 2 + (cy - r.v.cy) * r.v.zoom
  await page.mouse.click(px, py); await page.waitForTimeout(250); await shot('ss-progress-' + kind)
  await page.waitForTimeout(6000); await shot('ss-selected-' + kind)
  await page.mouse.click(px + 400 * r.v.zoom, py, { modifiers: ['Alt'] }).catch(() => {}); await page.waitForTimeout(3000); await shot('ss-points-' + kind)
}
