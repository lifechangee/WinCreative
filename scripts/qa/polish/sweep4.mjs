import { scribble, menu, openMenu, stroke } from './lib.mjs'
export default async ({ page, ev, shot, newDoc }) => {
  await newDoc(page, 'infinite', 1600, 1200)
  await ev(() => { document.querySelectorAll('.bw-gallery.open').forEach((e) => e.classList.remove('open')); window.brushwork_app.setView({ cx: 0, cy: 0, zoom: 0.6, rot: 0 }) })
  await scribble(page, 0, 0, 400, 4, 50)
  await page.waitForTimeout(1500)
  // layer mask
  await page.click('.tb-layers'); await page.waitForTimeout(300)
  await page.locator('.popover .layer-row.sel').dispatchEvent('contextmenu'); await page.waitForTimeout(300)
  const mi = page.locator('.popover .menu-item, .popover .lp-opt button').filter({ hasText: /Add mask|Добавить маск/ })
  if (await mi.count()) await mi.first().click(); await page.waitForTimeout(600)
  await shot('layer-mask-panel')
  await page.keyboard.press('Escape')
  await ev(() => window.brushwork_app.setView({ cx: 0, cy: 0, zoom: 0.6, rot: 0 }))
  await page.waitForTimeout(400); await shot('layer-mask-canvas')
  // time-lapse tab without frame, then with frame
  await page.click('.tb-left .tb-btn:nth-child(6)'); await page.waitForTimeout(1500); await shot('tl-tab-noframe')
  await page.keyboard.press('Escape'); await ev(() => window.brushwork_animio.tle.close()); await page.waitForTimeout(400)
  await ev(() => { window.brushwork_frame.createFrame(1080, 1920); window.brushwork_app.fitContent() })
  await scribble(page, 0, 0, 300, 2, 50); await page.waitForTimeout(1500)
  await page.click('.tb-left .tb-btn:nth-child(6)'); await page.waitForTimeout(1800); await shot('tl-tab-frame')
}
