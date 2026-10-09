export default async ({ page, ev, shot, newDoc }) => {
  await newDoc(page, 'infinite', 2048, 2048)
  await ev(() => { document.querySelectorAll('.bw-gallery.open').forEach((e) => e.classList.remove('open')); const a = window.brushwork_app; a.state.setTool('brush'); window.brushwork_frame.createFrame(1080, 1350); window.brushwork_frame.editFrame({ x: 100, y: -200 }); a.setView({ cx: 600, cy: 400, zoom: 0.5, rot: 0.7, mirror: true }) })
  await page.click('.bw-frame-btn', { button: 'right' }); await page.waitForTimeout(300)
  await page.locator('.fr-acts .btn').first().click(); await page.waitForTimeout(200)
  await page.mouse.click(900, 600)
  await page.waitForTimeout(500); await shot('frame-rot-mirror-edit')
  // drag SE handle with the mouse
  const h = await ev(() => { const a = window.brushwork_app; const f = window.brushwork_frame.getFrame(); const v = a.view; const r = a.canvas.getBoundingClientRect(); const s = a.cssSize(); return { f, v: { ...v }, r: { l: r.left, t: r.top }, s } })
  console.log(JSON.stringify(h.f))
  // compute SE corner screen pos via library function exposed? approximate using the overlay: find through app.view math
  const pt = { x: 1392 + (process.env.SIZE_OFF ? 0 : 0), y: 663 }
  await page.mouse.move(pt.x, pt.y); await page.mouse.down(); await page.mouse.move(pt.x + 60, pt.y + 40, { steps: 6 }); await page.mouse.up(); await page.waitForTimeout(300)
  console.log('after', JSON.stringify(await ev(() => window.brushwork_frame.getFrame())))
  await shot('frame-rot-mirror-drag')
}
