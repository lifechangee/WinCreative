import { scribble, menu, openMenu, stroke } from './lib.mjs'
export default async ({ page, ev, shot, newDoc, W }) => {
  // --- new canvas dialog
  await page.keyboard.press('Control+n'); await page.waitForTimeout(500)
  await shot('newdoc-fixed')
  const chk = page.locator('.modal label').filter({ hasText: /Infinite canvas|Бесконечный/ }).locator('input')
  await chk.check(); await page.waitForTimeout(250)
  await shot('newdoc-infinite')
  await chk.uncheck()
  await page.locator('.modal select:has(option[value=reels])').selectOption('reels'); await page.waitForTimeout(250)
  await shot('newdoc-frame')
  await page.keyboard.press('Escape'); await page.locator('.modal-back').evaluate((e) => e.remove()).catch(() => {})
  // --- infinite canvas with content at 100 / 10 / 2 %
  await newDoc(page, 'infinite', 2048, 2048)
  await ev(() => { document.querySelectorAll('.bw-gallery.open').forEach((e) => e.classList.remove('open')) })
  const spots = [[0, 0], [3000, 500], [-2500, 1800], [800, -2600], [-3200, -900], [5200, 3300]]
  for (const [x, y] of spots) await scribble(page, x, y, 500, 4, 50)
  await ev(() => window.brushwork_app.setView({ cx: 0, cy: 0, zoom: 1, rot: 0 })); await shot('inf-100')
  await ev(() => window.brushwork_app.setView({ cx: 1000, cy: 400, zoom: 0.1, rot: 0 })); await shot('inf-10')
  await ev(() => window.brushwork_app.setView({ cx: 1000, cy: 400, zoom: 0.02, rot: 0 })); await shot('inf-2')
  await ev(() => window.brushwork_app.setView({ cx: 123456, cy: -98765, zoom: 4, rot: 0.4 })); await shot('inf-far-hud')
  await openMenu(page, 2)
  const it = page.locator('.popover .menu-item').filter({ hasText: /Go to origin|К началу координат/ }); await it.first().scrollIntoViewIfNeeded(); await shot('menu-inf-items')
  await page.keyboard.press('Escape')
  // --- canvas info
  await menu(page, 2, /Canvas information/, /Сведения о холсте/); await shot('canvas-info')
  await page.keyboard.press('Escape'); await ev(() => document.querySelectorAll('.modal-back').forEach((e) => e.remove()))
  // --- memory warning toast
  await ev(() => { const g = window.brushwork_app; g.notify(window.__t ? '' : 'x') })
}
