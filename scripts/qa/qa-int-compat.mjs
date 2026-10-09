// 0.3.0 QA: documents saved by the PUBLISHED v0.1.0 and v0.2.0 builds (tests/fixtures/*.bwk, made by those exact builds) open unchanged in this build:
// layer count / order / props, every layer's pixels (vs the PNG inside the file), still fixed canvas + version 1, and a re-save round trip.
// usage: node scripts/qa/qa-int-compat.mjs [--out out-integ]
import { readFileSync } from 'node:fs'
import { unzipSync, strFromU8 } from 'fflate'
import { launch, outDirOf, reporter } from './qa-int-lib.mjs'

const outDir = outDirOf(process.argv.slice(2))
const { check, done } = reporter()
const { app, page, errors } = await launch(outDir)
for (const v of ['v0.1.0', 'v0.2.0']) {
  const bytes = readFileSync(`tests/fixtures/${v}.bwk`)
  const z = unzipSync(new Uint8Array(bytes))
  const man = JSON.parse(strFromU8(z['manifest.json']))
  const layerPngs = man.layers.filter((l) => !l.isGroup).map((l) => ({ id: l.id, png: Buffer.from(z[l.file]).toString('base64') }))
  const res = await page.evaluate(
    async ({ b64, layerPngs }) => {
      const app = window.brushwork_app
      const raw = Uint8Array.from(atob(b64), (c) => c.charCodeAt(0))
      const doc = await window.brushwork_io.loadBwk(raw)
      app.setDocument(doc)
      const out = { kind: doc.kind, w: doc.width, h: doc.height, n: doc.layers.length, maxDiff: 0, props: doc.layers.map((l) => [l.blendMode, +l.opacity.toFixed(2)]) }
      for (const lp of layerPngs) {
        const bmp = await createImageBitmap(new Blob([Uint8Array.from(atob(lp.png), (c) => c.charCodeAt(0))], { type: 'image/png' }))
        const oc = new OffscreenCanvas(bmp.width, bmp.height)
        const cx = oc.getContext('2d', { willReadFrequently: true })
        cx.drawImage(bmp, 0, 0)
        const ref = cx.getImageData(0, 0, bmp.width, bmp.height).data
        const layer = doc.getLayer(lp.id)
        const px = app.gpu.readRGBA8(layer.pixels, { x: 0, y: 0, w: bmp.width, h: bmp.height }) // straight RGBA8 (readRGBA8 un-premultiplies)
        for (let i = 0; i < ref.length; i += 4) {
          // canvas ImageData is straight alpha too; colour of fully transparent texels is undefined
          if (ref[i + 3] === 0 && px[i + 3] === 0) continue
          let d = Math.abs(ref[i + 3] - px[i + 3])
          if (ref[i + 3] > 8) for (let c = 0; c < 3; c++) d = Math.max(d, Math.abs(ref[i + c] - px[i + c]) * (ref[i + 3] / 255))
          if (d > out.maxDiff) out.maxDiff = d
        }
      }
      // round trip: save with the current writer, reload, same size and layers
      const again = await window.brushwork_io.saveBwk()
      const doc2 = await window.brushwork_io.loadBwk(again)
      out.rt = { n: doc2.layers.length, w: doc2.width, h: doc2.height, kind: doc2.kind }
      // GL health
      out.gl = app.gpu.gl.getError()
      return out
    },
    { b64: bytes.toString('base64'), layerPngs }
  )
  console.log(v, JSON.stringify(res))
  check(`${v}: opens as a fixed canvas of the same size`, res.kind === 'fixed' && res.w === man.width && res.h === man.height)
  check(`${v}: layer count and properties kept`, res.n === man.layers.length && res.props.every((p, i) => p[0] === man.layers[i].blendMode && Math.abs(p[1] - man.layers[i].opacity) < 0.011), JSON.stringify(res.props))
  check(`${v}: layer pixels equal the PNGs in the file (max diff <= 2)`, res.maxDiff <= 2, 'maxDiff=' + res.maxDiff)
  check(`${v}: re-save with the 0.3.0 writer writes a fixed v1 file that reloads`, res.rt.n === res.n && res.rt.kind === 'fixed' && res.rt.w === res.w)
  check(`${v}: no GL error`, res.gl === 0)
}
// the current writer keeps fixed documents at manifest version 1
{
  const ver = await page.evaluate(async () => {
    const a = window.brushwork_app
    a.newDocument(128, 128)
    return Array.from(await window.brushwork_io.saveBwk())
  })
  const m = JSON.parse(strFromU8(unzipSync(new Uint8Array(ver))['manifest.json']))
  check('current writer: fixed document is manifest version 1', m.version === 1 && !m.kind, JSON.stringify({ version: m.version, kind: m.kind }))
}
check('no console errors', errors.length === 0, errors.slice(0, 3).join(' | '))
await app.close()
process.exit(done())
