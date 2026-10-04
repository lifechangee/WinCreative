import type { App } from '../../app/app'
import { docToScreen } from '../../core/viewTransform'
import type { UIContext } from '../../ui/registry'
import { fillAt, fillLast } from './colorDrop'
import { galleryRef } from './galleryRef'
import { hsvToHex } from './colorMath'
import { paletteStore } from './paletteStore'
import { shared } from './shared'

const sleep = (ms: number): Promise<void> => new Promise((r) => setTimeout(r, ms))

/** BW_COLOR_SELFTEST=1: exercises colour panel, palettes, eyedropper, ColorDrop and gallery round trip. */
export async function runColorSelfTest(app: App, ui: UIContext): Promise<void> {
  const log = (...a: unknown[]): void => console.warn('[colortest]', ...a)
  let ok = true
  const check = (name: string, cond: boolean, extra = ''): void => {
    log((cond ? 'PASS ' : 'FAIL ') + name + ' ' + extra)
    if (!cond) ok = false
  }
  const errors: string[] = []
  window.addEventListener('error', (e) => errors.push(String(e.message)))
  const csp: string[] = []
  document.addEventListener('securitypolicyviolation', (e) => csp.push(`${e.violatedDirective} ${e.blockedURI} ${e.sourceFile}:${e.lineNumber}`))
  try {
    await sleep(600)
    const st = app.state

    // ---- primary / secondary
    st.setColor({ h: 0, s: 1, v: 1 })
    st.setSecondaryColor({ h: 120, s: 1, v: 1 })
    st.swapColors()
    check('swap colours', hsvToHex(st.color) === '#00ff00' && hsvToHex(st.secondaryColor) === '#ff0000')
    st.swapColors()

    // ---- colour panel renders every tab without errors
    const btn = document.querySelector<HTMLElement>('.tb-color')!
    btn.click()
    await sleep(100)
    for (const t of ['Classic', 'Harmony', 'Value', 'Palettes', 'Disc']) {
      const tab = [...document.querySelectorAll<HTMLElement>('.bw-tab')].find((b) => b.textContent === t)
      tab?.click()
      await sleep(60)
      check('panel tab ' + t, !!document.querySelector('.bw-tab-content')?.children.length)
    }
    ui.popovers.close()

    // ---- palettes
    const store = paletteStore()
    const p = store.createEmpty('Selftest')
    const i = store.addColor(p.id, '#123456')
    check('palette add colour', p.colors[i] === '#123456')
    store.setSwatch(p.id, i, '#abcdef')
    check('palette set swatch', store.get(p.id)!.colors[i] === '#abcdef')
    store.deleteSwatch(p.id, i)
    check('palette delete swatch', store.get(p.id)!.colors[i] === null)
    store.remove(p.id)

    // ---- ColorDrop on a fresh doc with a closed square outline
    const N = 256
    app.newDocument(N, N, { background: { color: [1, 1, 1], visible: true } })
    const px = new Uint8ClampedArray(N * N * 4)
    for (let y = 64; y <= 192; y++)
      for (let x = 64; x <= 192; x++) if (x === 64 || x === 192 || y === 64 || y === 192) px.set([0, 0, 0, 255], (y * N + x) * 4)
    app.gpu.uploadRGBA8(app.doc.activeLayer.surface, 0, 0, N, N, px)
    st.setColor({ h: 0, s: 1, v: 1 }) // red
    const read = (x: number, y: number): number[] => Array.from(app.gpu.readRGBA8(app.doc.activeLayer.surface, { x, y, w: 1, h: 1 }))
    check('fill returns true', fillAt(app, 128, 128, 0.1))
    const inside = read(128, 128)
    const outside = read(20, 20)
    check('fill colours inside', inside[0] > 250 && inside[1] < 5 && inside[3] === 255, JSON.stringify(inside))
    check('fill stays inside outline', outside[3] === 0, JSON.stringify(outside))
    check('outline untouched', read(64, 100)[0] === 0 && read(64, 100)[3] === 255)
    app.undo()
    check('undo removes fill', read(128, 128)[3] === 0)
    app.redo()
    check('redo restores fill', read(128, 128)[3] === 255)
    st.setColor({ h: 240, s: 1, v: 1 })
    app.undo()
    check('fill last repeats with new colour', fillLast(app) && read(128, 128)[2] > 250)
    check('max threshold fills whole layer', fillAt(app, 10, 10, 1) && read(64, 64)[2] > 250)

    // ---- eyedropper (hook path, as used by touch-hold / Alt-hold)
    app.doc.activeLayer.surface && app.gpu.uploadRGBA8(app.doc.activeLayer.surface, 0, 0, N, N, new Uint8ClampedArray(N * N * 4).fill(0))
    for (let k = 0; k < N * N; k++) px.set([200, 100, 50, 255], k * 4)
    app.gpu.uploadRGBA8(app.doc.activeLayer.surface, 0, 0, N, N, px)
    const s = app.cssSize()
    const sp = docToScreen(app.view, 100, 100, s.w, s.h)
    st.setColor({ h: 10, s: 0.2, v: 0.2 })
    shared.eyedropper!.hook('start', sp, { x: 100, y: 100 })
    shared.eyedropper!.hook('end', sp, { x: 100, y: 100 })
    check('eyedropper samples layer colour', hsvToHex(st.color) === '#c86432', hsvToHex(st.color))

    // ---- gallery: new canvas registers an artwork; autosave writes; reopen restores
    log('gallery start')
    const gal = galleryRef.store!
    await gal.load()
    const before = gal.live().length
    log('adding')
    const id = await gal.addDocument(app.doc, { name: 'Selftest art' })
    log('added')
    check('gallery item created', gal.live().length === before + 1)
    app.doc.name = 'Selftest art'
    await gal.flush()
    const th = await gal.thumbUrl(id)
    check('gallery thumbnail stored', !!th)
    {
      // the blob thumbnail must be fetchable (connect-src) and decode to a real, non-empty image
      const bmp = th ? await createImageBitmap(await (await fetch(th)).blob()).catch(() => null) : null
      let opaque = 0
      if (bmp) {
        const c = document.createElement('canvas')
        c.width = bmp.width
        c.height = bmp.height
        const g = c.getContext('2d')!
        g.drawImage(bmp, 0, 0)
        const d = g.getImageData(0, 0, c.width, c.height).data
        for (let k = 3; k < d.length; k += 4) if (d[k] > 0) opaque++
      }
      check('gallery thumbnail decodes non-empty', !!bmp && bmp.width > 0 && bmp.height > 0 && opaque > 0, bmp ? `${bmp.width}x${bmp.height} opaque=${opaque}` : 'decode failed')
    }
    const dup = await gal.duplicate(id)
    check('gallery duplicate', !!dup && gal.live().length === before + 2)
    const st1 = gal.createStack([id, dup!], 'S')
    check('gallery stack', gal.stackItems(st1.id).length === 2)
    gal.ungroup(st1.id)
    check('gallery ungroup', gal.get(id)!.stackId === null)
    app.newDocument(64, 64)
    check('gallery reopen', await gal.open(id) && app.doc.width === N)
    check('reopened pixels intact', read(10, 10)[0] === 200)
    galleryRef.show?.()
    await sleep(500)
    const shown = [...document.querySelectorAll<HTMLImageElement>('.bw-gallery img')]
    check('gallery view thumbnails loaded', shown.length > 0 && shown.every((im) => im.complete && im.naturalWidth > 0), `${shown.length} imgs`)
    galleryRef.hide?.()
    gal.trash(dup!)
    check('gallery trash hides item', !gal.live().some((i) => i.id === dup))
    gal.restore(dup!)
    await gal.purge(dup!)
    gal.trash(id)
    await gal.purge(id)
    galleryRef.show?.()
    await sleep(200)
    check('gallery view renders', !!document.querySelector('.bw-gallery.open .bw-g-grid'))
    galleryRef.hide?.()
    check('no CSP violations', csp.length === 0, csp.join('; '))
    check('no uncaught errors', errors.length === 0, errors.join('; '))
  } catch (e) {
    ok = false
    log('EXCEPTION', (e as Error).stack ?? String(e))
  }
  log('done ok=' + ok)
  await window.brushwork?.selfTestDone({ ok })
}
