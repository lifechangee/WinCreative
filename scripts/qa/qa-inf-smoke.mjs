import { launch, newDoc, strokeDoc, setBrush, outDirOf, save } from './qa-inf-lib.mjs'
const args = process.argv.slice(2)
const { app, page, errors } = await launch(outDirOf(args))
await newDoc(page, 'infinite')
await setBrush(page, 'hard-round', 40)
await strokeDoc(page, [[100, 100], [300, 180], [520, 120], [700, 300]])
await page.waitForTimeout(300)
const info = await page.evaluate(() => {
  const a = window.brushwork_app
  return { kind: a.doc.kind, tiles: a.doc.tileStats(), bounds: a.doc.contentBounds({ tight: true }), inf: a.compositor.inf.stats }
})
console.log(JSON.stringify(info))
save('qa-inf', 'smoke.png', await page.screenshot())
console.log('errors', errors)
await app.close()
