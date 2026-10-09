import { readFileSync } from 'fs'
import { scribble, menu, openMenu, stroke } from './lib.mjs'
const loc = (lang, key) => { const s = readFileSync(`src/renderer/src/i18n/locales/${lang}/ui.ts`, 'utf8'); const i = s.indexOf("'" + key + "':"); if (i < 0) return key; const j = s.indexOf("'", s.indexOf(':', i)); let k = j + 1, out = ''; while (s[k] !== "'" ) { if (s[k] === String.fromCharCode(92)) { out += s[k + 1]; k += 2 } else out += s[k++] } return out }
export default async ({ page, ev, shot, newDoc, lang }) => {
  const close = async () => { await page.keyboard.press('Escape'); await ev(() => document.querySelectorAll('.modal-back,.an-modal-bg').forEach((e) => e.remove())) }
  // create an infinite doc through the real dialog (registers a gallery artwork)
  await page.keyboard.press('Control+n'); await page.waitForTimeout(400)
  await page.locator('.modal label').filter({ hasText: /Infinite canvas|Бесконечный/ }).locator('input').check()
  await page.locator('.modal select:has(option[value=reels])').selectOption('hd')
  await page.locator('.modal .primary').click(); await page.waitForTimeout(1500)
  await ev(() => window.brushwork_app.setView({ cx: 960, cy: 540, zoom: 0.5, rot: 0 }))
  await scribble(page, 960, 540, 350, 5, 50)
  await shot('inf-frame-created')
  // adjustments limited notice
  await menu(page, 3, /Gaussian blur|Blur|Размытие/)
  await page.waitForTimeout(500); await shot('adj-limited')
  await page.keyboard.press('Escape'); await page.waitForTimeout(300)
  // ColorDrop onto the empty area reaching the border -> "Fill limited" toast
  const cb = await page.locator('.tb-color').boundingBox()
  await page.mouse.move(cb.x + 15, cb.y + 15); await page.mouse.down(); await page.mouse.move(400, 300, { steps: 8 }); await page.waitForTimeout(700); await page.mouse.up(); await page.waitForTimeout(600)
  await shot('fill-limited')
  // memory warning toast (real text, real toast element)
  await ev((m) => window.brushwork_app.notify(m), loc(lang, 'ui.inf.memWarn').replace('{mb}', '1450'))
  await shot('mem-warn')
  await ev((m) => window.brushwork_app.notify(m), loc(lang, 'ui.inf.memHard').replace('{mb}', '1900'))
  await shot('mem-hard')
  // convert dialogs
  await menu(page, 2, /Convert to fixed/, /Преобразовать в фиксированный/); await shot('convert-fixed'); await close()
  // export dialog with Area select
  await menu(page, 2, /Export image/, /Экспорт изображения/); await shot('export-dialog'); await close()
  await menu(page, 2, /Photoshop PSD/, /Photoshop PSD/); await shot('export-psd'); await close()
  // no frame variant: remove frame, open export dialog again
  await ev(() => window.brushwork_frame.editFrame(null)); await page.waitForTimeout(300)
  await menu(page, 2, /Export image/, /Экспорт изображения/); await shot('export-dialog-noframe'); await close()
  // gallery card
  await page.keyboard.press('Control+s'); await page.waitForTimeout(2500)
  await page.click('.tb-left .tb-btn:nth-child(1)'); await page.waitForTimeout(300)
  await page.locator('.popover .menu-item').first().click().catch(() => {}); await page.waitForTimeout(300)
  await ev(() => document.querySelector('.popover') && (document.querySelector('.popover').style.display = 'none'))
  await shot('gallery')
}
