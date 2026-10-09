export const stroke = (page, pts, size = 40) => page.evaluate(({ pts, size }) => {
  const a = window.brushwork_app; a.state.setTool('brush'); a.state.settings.size = size; a.state.settings.opacity = 1
  const s = pts.map((p, i) => ({ x: p[0], y: p[1], pressure: 0.7, tiltX: 0, tiltY: 0, twist: 0, t: 1000 + i * 8, pointerType: 'pen' }))
  const t = a.tools.get('brush'); t.begin(s[0], a); for (let i = 1; i < s.length; i += 8) t.move(s.slice(i, i + 8), a); t.end(a)
}, { pts, size })
export const scribble = (page, cx, cy, r = 400, n = 6, size = 40) => {
  const out = []
  return (async () => { for (let k = 0; k < n; k++) { const pts = []; for (let i = 0; i <= 30; i++) { const a = (i / 30) * Math.PI * 2 + k; pts.push([cx + Math.cos(a) * r * (0.4 + k * 0.1), cy + Math.sin(a * 2) * r * 0.5]) } await stroke(page, pts, size) } })()
}
export const menu = async (page, idx, ...res) => { // open top menu idx (1-based tb-btn) and click the first item matching any regex
  await page.click(`.tb-left .tb-btn:nth-child(${idx})`); await page.waitForTimeout(220)
  for (const re of res) { const l = page.locator('.popover .menu-item').filter({ hasText: re }); if (await l.count()) { await l.first().scrollIntoViewIfNeeded(); await l.first().click(); await page.waitForTimeout(350); return true } }
  console.log('MENU ITEM NOT FOUND', res.map(String)); await page.keyboard.press('Escape'); return false
}
export const openMenu = async (page, idx) => { await page.click(`.tb-left .tb-btn:nth-child(${idx})`); await page.waitForTimeout(220) }
