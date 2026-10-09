export default async ({ page, ev, newDoc }) => {
  await newDoc(page, 'infinite', 2048, 2048)
  for (const i of [2, 4, 5, 6]) { await page.click(`.tb-left .tb-btn:nth-child(${i})`); await page.waitForTimeout(200); console.log(i, JSON.stringify(await page.$$eval('.popover .menu-item', (els) => els.map((e) => e.textContent.trim().slice(0, 50))))); await page.keyboard.press('Escape') }
}
