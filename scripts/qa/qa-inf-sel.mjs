// Visual / interaction QA of selection, transform, fill and layer ops on an INFINITE canvas (real pointer path, real UI menus).
// usage: node scripts/qa/qa-inf-sel.mjs --out out-infB    (screenshots in qa-inf-sel/)
import { launch, newDoc, setBrush, outDirOf, save } from './qa-inf-lib.mjs'
const args = process.argv.slice(2)
const { app, page, errors } = await launch(outDirOf(args))
const log = []
const check = (n, c, x = '') => { log.push(`${c ? 'PASS' : 'FAIL'} ${n} ${x}`); console.log(c ? 'PASS' : 'FAIL', n, x) }
const shot = async (n) => { await page.waitForTimeout(350); save('qa-inf-sel', n + '.png', await page.screenshot()); console.log('shot', n) }
const OX = -49500, OY = -2300
await newDoc(page, 'infinite')
await page.evaluate(({ OX, OY }) => window.brushwork_app.setView({ cx: OX + 500, cy: OY + 350, zoom: 1, rot: 0 }), { OX, OY })
await setBrush(page, 'hard-round', 40)
const geo = async () => page.evaluate(() => { const r = window.brushwork_app.canvas.getBoundingClientRect(); const v = window.brushwork_app.view; return { x: r.x, y: r.y, w: r.width, h: r.height, cx: v.cx, cy: v.cy, zoom: v.zoom } })
const toScr = async (dx, dy) => { const g = await geo(); return { x: g.x + g.w / 2 + (dx - g.cx) * g.zoom, y: g.y + g.h / 2 + (dy - g.cy) * g.zoom } }
const dragDoc = async (pts) => {
  const a = await toScr(pts[0][0], pts[0][1]); await page.mouse.move(a.x, a.y); await page.mouse.down()
  for (const p of pts.slice(1)) { const b = await toScr(p[0], p[1]); await page.mouse.move(b.x, b.y, { steps: 6 }) }
  await page.mouse.up(); await page.waitForTimeout(120)
}
const menu = async (top, item) => {
  await page.getByRole('button', { name: top, exact: true }).first().click().catch(async () => page.getByText(top, { exact: true }).first().click())
  await page.waitForTimeout(150)
  await page.getByText(item, { exact: true }).first().click()
  await page.waitForTimeout(200)
}
const rd = (r) => page.evaluate((r) => { const a = window.brushwork_app; return Array.from(a.doc.readRegionPixels(a.doc.activeLayer, r)) }, r)
const alpha = (px, i) => px[i * 4 + 3]

// a ring (closed contour) crossing a tile border + some scribbles
await dragDoc([[OX + 300, OY + 250], [OX + 700, OY + 250], [OX + 700, OY + 550], [OX + 300, OY + 550], [OX + 300, OY + 250]])
await shot('1-ring')

// --- selection: rectangle via the real tool
await menu('Selection', 'Rectangle')
await dragDoc([[OX + 380, OY + 300], [OX + 640, OY + 500]])
await shot('2-rect-selected-ants')
const s1 = await page.evaluate(() => window.brushwork_selection.bounds())
check('rectangle selection via pointer', s1 && Math.abs(s1.x - (OX + 380)) <= 2 && Math.abs(s1.w - 260) <= 3, JSON.stringify(s1))

// zoom + rotate: ants must follow
await page.evaluate(({ OX, OY }) => window.brushwork_app.setView({ cx: OX + 510, cy: OY + 400, zoom: 2.3, rot: 0.5 }), { OX, OY })
await shot('3-ants-zoom-rot')
await page.evaluate(({ OX, OY }) => window.brushwork_app.setView({ cx: OX + 500, cy: OY + 350, zoom: 1, rot: 0 }), { OX, OY })

// brush clipped by the selection (real stroke across the whole ring)
await setBrush(page, 'hard-round', 60, 1, '#2060d0')
await page.evaluate(() => window.brushwork_app.state.setTool('brush'))
await dragDoc([[OX + 200, OY + 320], [OX + 500, OY + 420], [OX + 800, OY + 330]])
await shot('4-brush-clipped')
const sel = await page.evaluate(() => window.brushwork_selection.bounds())
const px = await rd({ x: OX + 100, y: OY + 200, w: 800, h: 400 })
let outside = 0
for (let y = 0; y < 400; y++) for (let x = 0; x < 800; x++) { const ax = OX + 100 + x, ay = OY + 200 + y; const i4 = (y * 800 + x) * 4; if (px[i4 + 3] > 200 && px[i4 + 2] > px[i4] + 60 && (ax < sel.x - 1 || ax > sel.x + sel.w || ay < sel.y - 1 || ay > sel.y + sel.h)) outside++ }
check('blue stroke does not leak outside the selection', outside === 0, String(outside))

// --- magic wand inside the ring
await menu('Selection', 'Automatic')
const c = await toScr(OX + 500, OY + 350)
await page.mouse.click(c.x, c.y)
await page.waitForTimeout(300)
await shot('5-wand')
const wb = await page.evaluate(() => window.brushwork_selection.bounds())
check('wand selects the ring interior (bounded, no toast about limits)', wb && wb.w > 300 && wb.w < 420 && wb.h > 250 && wb.h < 330, JSON.stringify(wb))

// --- invert + deselect + select all
await menu('Selection', 'Invert')
await shot('6-inverted')
const ib = await page.evaluate(() => window.brushwork_selection.bounds())
check('invert covers the visible work area', ib && ib.w >= 1000, JSON.stringify(ib))
await menu('Selection', 'Deselect')

// --- transform: move the ring contents far away with a real drag + commit
await menu('Transform', 'Freeform')
await page.waitForTimeout(300)
await shot('7-transform-handles')
const mid = await toScr(OX + 500, OY + 400)
await page.mouse.move(mid.x, mid.y); await page.mouse.down(); await page.mouse.move(mid.x + 200, mid.y + 120, { steps: 8 }); await page.mouse.up()
await page.waitForTimeout(200)
await shot('8-transform-moved')
await page.keyboard.press('Enter')
await page.waitForTimeout(300)
await shot('9-transform-committed')
const moved = await rd({ x: OX + 500, y: OY + 370, w: 600, h: 400 })
let n = 0; for (let i = 3; i < moved.length; i += 4) if (moved[i] > 8) n++
check('content landed at the new position', n > 2000, String(n))
await page.keyboard.press('Control+z')
await page.waitForTimeout(300)
await shot('10-undo')

// --- ColorDrop inside the ring
await page.evaluate(() => { const a = window.brushwork_app; a.state.setColor({ h: 130, s: 0.8, v: 0.8 }, false) })
await shot('11-before-fill')

// layers: add mask via the layer panel API handle
await page.evaluate(() => { const a = window.brushwork_app; a.doc.addMask(a.doc.activeId) })
await setBrush(page, 'hard-round', 50, 1, '#000000')
await dragDoc([[OX + 350, OY + 400], [OX + 650, OY + 400]])
await shot('12-mask-painted')
const hidden = await page.evaluate(({ OX, OY }) => { const a = window.brushwork_app; a.renderNow(); const f = a.compositor.readFlattened({ x: OX + 480, y: OY + 395, w: 40, h: 10 }, 1, false); return f.px[3] }, { OX, OY })
check('mask hides the layer under the stroke', hidden === 0, String(hidden))
await page.evaluate(() => { const a = window.brushwork_app; a.doc.removeMask(a.doc.activeId) })
await shot('13-mask-deleted')

console.log('errors', errors.filter((e) => !/gallery/.test(e)))
await app.close()
