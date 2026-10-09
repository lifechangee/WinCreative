export default async ({ page, ev, newDoc }) => {
  await newDoc(page, 'infinite', 2048, 2048)
  await ev(() => document.querySelectorAll('.bw-gallery.open').forEach((e) => e.classList.remove('open')))
  await page.click('.bw-frame-btn'); await page.waitForTimeout(300)
  const read = () => page.evaluate(() => ({ title: document.querySelector('.pop-title')?.textContent, chip: document.querySelector('.fr-chip b')?.textContent, hint: document.querySelector('.fr-hint')?.textContent, tip: document.querySelector('.bw-frame-btn').getAttribute('data-tip') || document.querySelector('.bw-frame-btn').title }))
  console.log('EN', JSON.stringify(await read()))
  await ev(() => { document.activeElement?.blur() })
  await page.keyboard.press('Control+,'); await page.waitForTimeout(500)
  await page.locator('.prefs-tabs button').nth(0).click()
  await page.locator('.prefs-pane select').first().selectOption('ru'); await page.waitForTimeout(700)
  await ev(() => document.querySelectorAll('.modal-back').forEach((e) => e.remove()))
  await page.click('.bw-frame-btn'); await page.waitForTimeout(400)
  console.log('RU', JSON.stringify(await read()))
  // switch back live while the panel is open
  await page.keyboard.press('Control+,'); await page.waitForTimeout(500)
  await page.locator('.prefs-pane select').first().selectOption('en'); await page.waitForTimeout(700)
  console.log('EN2', JSON.stringify(await read()))
}
