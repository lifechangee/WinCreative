import { execFileSync } from 'child_process'
import { resolve } from 'path'
import { mkdirSync } from 'fs'
export default async ({ page, ev, newDoc, shot }) => {
  const dir = resolve('qa-screens/v030'); mkdirSync(dir, { recursive: true })
  await newDoc(page, 'infinite', 2048, 2048)
  await ev(() => { const a = window.brushwork_app; a.state.setTool('brush'); a.state.settings.size = 50; a.setView({ cx: 0, cy: 0, zoom: 0.6, rot: 0 }) })
  // no frame: menu offers "Create frame"
  await ev(() => window.brushwork_ui?.menus?.find?.(() => false))
  const clickMenu = async (re) => { await page.click('.tb-left .tb-btn:nth-child(2)'); await page.waitForTimeout(200); await page.locator('.popover .menu-item', { hasText: re }).first().click(); await page.waitForTimeout(300) }
  await clickMenu(/Animation Assist|Помощник анимации/)
  await shot('anim-needframe')
  await page.locator('.an-btn.primary').click()
  await page.waitForTimeout(500)
  // three frames = three layers with different strokes
  await ev(async () => {
    const a = window.brushwork_app, an = window.brushwork_animio.anim
    const stroke = (pts) => { const s = pts.map((p, i) => ({ x: p[0], y: p[1], pressure: 0.7, tiltX: 0, tiltY: 0, twist: 0, t: 1000 + i * 8, pointerType: 'pen' })); const t = a.tools.get('brush'); t.begin(s[0], a); for (let i = 1; i < s.length; i += 8) t.move(s.slice(i, i + 8), a); t.end(a) }
    const f = window.brushwork_frame.getFrame()
    const cx = f.x + f.w / 2, cy = f.y + f.h / 2
    for (let i = 0; i < 3; i++) {
      if (i > 0) an.addFrame()
      const pts = []; for (let k = 0; k <= 20; k++) pts.push([cx - 300 + i * 150 + k * 3, cy - 200 + k * 20 + i * 30])
      stroke(pts)
    }
    an.setCurrent(1)
  })
  await page.waitForTimeout(800)
  await ev(() => window.brushwork_frame.fit())
  await page.waitForTimeout(800)
  await shot('anim-inf-onion')
  const r = await ev(async () => {
    const an = window.brushwork_animio.anim
    const fr = an.renderer()
    return { enabled: an.enabled, frames: an.frames().length, w: fr.width, h: fr.height, ghosts: an.ghosts?.length }
  })
  console.log(JSON.stringify(r))
  // page assist
  await ev(() => window.brushwork_animio.anim.setEnabled(false))
  await clickMenu(/Page Assist|Помощник страниц/)
  await page.waitForTimeout(600)
  await shot('page-inf')
  console.log(JSON.stringify(await ev(() => { const p = window.brushwork_animio.pages; const b = p.renderer().bitmap(p.stackFor(0), { paper: [1,1,1] }); let n = 0; for (let i = 0; i < b.data.length; i += 4) if (b.data[i] < 128) n++; return { pages: p.pages().length, w: b.width, h: b.height, dark: n } })))
}
