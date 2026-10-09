import type { App } from '../../app/app'
import { BLEND_MODES } from '../../core/blend'
import { LayerLimitError } from '../../doc/document'
import { loadBwk, saveBwk } from '../../io/bwk'
import * as ops from './ops'

/** Layers feature self-test (BW_LAYERS_TEST=1 electron .). Logs through window.brushworkClip.testLog. */
export async function runLayersSelfTest(app: App, log: (s: string) => void): Promise<boolean> {
  let ok = true
  const check = (name: string, cond: boolean, extra = ''): void => {
    log((cond ? 'PASS ' : 'FAIL ') + name + ' ' + extra)
    if (!cond) ok = false
  }
  try {
    const gpu = app.gpu
    const gl = gpu.gl
    const commits: string[] = []
    const fresh = (): import('../../doc/document').Document => {
      const d = app.newDocument(256, 256)
      d.events.on('commit', (e) => commits.push(e.type))
      return d
    }
    let doc = fresh()
    const px = (x = 128, y = 128): number[] => {
      app.compositor.compose(null, null)
      return [...gpu.readRGBA8(app.compositor.composite, { x, y, w: 1, h: 1 })]
    }
    const near = (a: number[], b: number[], tol = 6): boolean => a.every((v, i) => Math.abs(v - b[i]) <= tol)
    const RED: [number, number, number] = [1, 0, 0]
    const BLUE: [number, number, number] = [0, 0, 1]
    const l1 = doc.activeLayer
    ops.fillLayer(doc, l1, RED)
    check('fill layer', near(px(), [255, 0, 0, 255]), px().join(','))
    const l2 = doc.addLayer()
    ops.fillLayer(doc, l2, BLUE)
    check('new layer above + fill', near(px(), [0, 0, 255, 255]) && doc.layerIndex(l2.id) === 1)
    ops.invertLayer(doc, l2)
    check('invert colors', near(px(), [255, 255, 0, 255]) || near(px(), [255, 255, 0, 255], 8), px().join(','))
    doc.undo()
    check('undo invert', near(px(), [0, 0, 255, 255]))

    // ---- groups
    const g = doc.groupLayers([l1.id, l2.id])!
    check('group created', !!g && l1.parentId === g.id && l2.parentId === g.id && doc.layers[doc.layers.length - 1] === g)
    check('group composite unchanged', near(px(), [0, 0, 255, 255]))
    doc.setLayerProps(g.id, { opacity: 0.5 })
    check('pass-through group opacity (no backdrop -> 50% alpha)', px()[3] > 120 && px()[3] < 135 && px()[2] > 250, px().join(','))
    doc.setLayerProps(g.id, { passThrough: false, opacity: 0.5 })
    check('isolated group opacity', px()[3] > 120 && px()[3] < 135, px().join(','))
    doc.undo()
    doc.undo()
    doc.setLayerProps(g.id, { visible: false })
    check('hidden group', px()[3] === 0)
    doc.undo()
    doc.setLayerProps(g.id, { collapsed: true })
    doc.undo()
    check('undo group props', near(px(), [0, 0, 255, 255]))
    doc.undo()
    check('undo group', l1.parentId === null && doc.layers.length === 2 && !doc.getLayer(g.id))
    doc.redo()
    check('redo group', l1.parentId === g.id && !!doc.getLayer(g.id))
    doc.ungroup(g.id)
    check('ungroup', l1.parentId === null && doc.layers.length === 2)
    const dup = doc.duplicateLayer(l2.id)!
    check('duplicate', doc.layers.length === 3 && dup.name.endsWith('copy'))
    doc.deleteLayer(dup.id)
    doc.undo()
    check('delete+undo', doc.layers.length === 3)
    doc.undo()

    // ---- masks
    doc.addMask(l2.id)
    check('mask added (white)', near(px(), [0, 0, 255, 255]) && !!l2.mask && l2.editingMask, px().join(',') + ' layers=' + doc.layers.map((l) => l.name + ':' + l.visible + ':' + l.opacity + ':' + l.parentId).join('|'))
    ops.clearMask(doc, l2)
    check('clear mask hides layer', near(px(), [255, 0, 0, 255]), px().join(','))
    doc.undo()
    check('undo mask clear', near(px(), [0, 0, 255, 255]))
    ops.invertMask(doc, l2)
    check('invert mask', near(px(), [255, 0, 0, 255]))
    doc.setLayerProps(l2.id, { maskEnabled: false })
    check('disable mask', near(px(), [0, 0, 255, 255]))
    doc.setLayerProps(l2.id, { maskEnabled: true })
    ops.applyMask(doc, l2)
    check('apply mask bakes + removes', !l2.mask && near(px(), [255, 0, 0, 255]))
    doc.undo()
    check('undo apply mask', !!l2.mask && near(px(), [255, 0, 0, 255]))
    doc.removeMask(l2.id)
    doc.undo()
    check('mask persists in undo', !!l2.mask)

    // ---- clipping incl. live stroke on the clip base
    doc = fresh()
    const base = doc.activeLayer
    const top = doc.addLayer()
    ops.fillLayer(doc, top, [0, 1, 0])
    doc.setLayerProps(top.id, { clipping: true })
    check('clipped to empty base -> hidden', px()[3] === 0, px().join(','))
    doc.setActive(base.id)
    app.engine.begin(base, { mode: 'paint', preset: app.state.preset, color: [1, 0, 0], opacity: 1 })
    app.engine.stamp([{ x: 128, y: 128, size: 60, angle: 0, alpha: 1, roundness: 1, px: 128, py: 128 } as any])
    app.compositor.compose(app.engine.live, null)
    const live = [...gpu.readRGBA8(app.compositor.composite, { x: 128, y: 128, w: 1, h: 1 })]
    check('clipped layer follows LIVE stroke on base', live[1] > 200 && live[3] > 200, live.join(','))
    const off = [...gpu.readRGBA8(app.compositor.composite, { x: 20, y: 20, w: 1, h: 1 })]
    check('outside stroke still hidden', off[3] === 0)
    app.engine.cancel()

    // ---- merge / combine / flatten
    doc = fresh()
    const a = doc.activeLayer
    ops.fillLayer(doc, a, RED)
    const b = doc.addLayer()
    ops.fillLayer(doc, b, BLUE)
    doc.setLayerProps(b.id, { opacity: 0.5 })
    check('merge down ok', ops.mergeDown(doc, b.id) === null && doc.layers.length === 1)
    check('merge result = 50% blue over red', near(px(), [128, 0, 128, 255], 4), px().join(','))
    doc.undo()
    check('undo merge restores both', doc.layers.length === 2 && near(px(), [128, 0, 128, 255], 4))
    doc.redo()
    doc.undo()
    const c = doc.addLayer()
    ops.fillLayer(doc, c, [0, 1, 0])
    check('multi merge', ops.mergeLayers(doc, [a.id, b.id, c.id]) === null && doc.layers.length === 1)
    doc.undo()
    check('flatten', ops.flattenAll(doc) === null && doc.layers.length === 1)
    doc.undo()
    check('undo flatten', doc.layers.length === 3)

    // ---- persistence
    while (gl.getError()) /* flush */;
    const g2 = doc.groupLayers([b.id, c.id])!
    doc.addMask(a.id, true)
    doc.setReference(a.id, true)
    doc.setLayerProps(a.id, { drawingAssist: true })
    doc.setLayerProps(a.id, { blendMode: 'vividLight' })
    const bytes = await saveBwk(doc, app.compositor)
    const back = await loadBwk(bytes, gpu)
    const ba = back.getLayer(a.id)!
    check('bwk roundtrip group/mask/reference', back.getLayer(b.id)!.parentId === g2.id && !!ba.mask && ba.reference && ba.drawingAssist && ba.blendMode === 'vividLight' && back.getLayer(g2.id)!.isGroup)
    back.dispose()

    // ---- blend modes render without GL errors
    while (gl.getError()) /* flush */;
    let glErr = ''
    for (const m of BLEND_MODES) {
      doc.setLayerPropsLive(b.id, { blendMode: m })
      app.compositor.compose(null, null)
      const e1 = gl.getError()
      px()
      const er = gl.getError()
      if (e1 || er) glErr += m + ':' + e1 + '/' + er + ' '
    }
    check('all blend modes render', glErr === '', glErr)

    // ---- panel UI
    const uiTest = async (): Promise<void> => {
      const d = fresh()
      const l0 = d.activeLayer
      const l1b = d.addLayer()
      const l2b = d.addLayer()
      d.groupLayers([l1b.id, l2b.id])
      d.addMask(l2b.id)
      d.setLayerProps(l0.id, { blendMode: 'multiply', opacity: 0.6 })
      const sleep = (ms: number): Promise<void> => new Promise((r) => setTimeout(r, ms))
      const btn = document.querySelector('button[title=Layers]') as HTMLElement
      btn.click()
      await sleep(400)
      const rows = (): HTMLElement[] => [...document.querySelectorAll('.layer-row')] as HTMLElement[]
      check('panel lists rows (group + 3 layers)', rows().length === 4, String(rows().length))
      check('thumbnails present', document.querySelectorAll('canvas.lthumb').length >= 3)
      await window.brushwork?.selfTestShot('layers-list')
      const fire = (el: Element, type: string, o: any = {}): void => void el.dispatchEvent(new PointerEvent(type, { bubbles: true, cancelable: true, pointerId: 7, pointerType: 'mouse', button: 0, clientX: 50, clientY: 50, ...o }))
      const row0 = rows()[3]
      fire(row0, 'pointerdown')
      fire(row0, 'pointerup')
      await sleep(100)
      check('click selects layer', d.activeId === l0.id)
      const row1 = rows()[0]
      const gl0 = rows().find((r) => r.classList.contains('group'))!
      ;(gl0.querySelector('.chev') as HTMLElement).click()
      await sleep(100)
      check('collapse group hides children', rows().length === 2, String(rows().length))
      ;(rows()[0].querySelector('.chev') as HTMLElement).click()
      await sleep(100)
      rows()[3].dispatchEvent(new MouseEvent('contextmenu', { bubbles: true, cancelable: true }))
      await sleep(100)
      check('options view opens', !!document.querySelector('.lp-opt') && document.body.textContent!.includes('Combine Down'))
      const blendBtn = [...document.querySelectorAll('.lp-opt .lp-btn')].find((b) => b.textContent!.includes('Multiply')) as HTMLElement
      blendBtn.click()
      await sleep(100)
      const opts = [...document.querySelectorAll('.lp-blend .menu-item')] as HTMLElement[]
      check('blend picker lists all modes', opts.length === BLEND_MODES.length, String(opts.length))
      fire(opts[3], 'pointerenter')
      check('live preview applies', l0.blendMode === 'colorBurn', l0.blendMode)
      opts[1].click()
      await sleep(100)
      const picked = l0.blendMode
      d.undo()
      check('blend commit + undo', picked === 'darken' && l0.blendMode === 'multiply', picked + '/' + l0.blendMode)
      void row1
      await window.brushwork?.selfTestShot('layers-panel')
      document.body.dispatchEvent(new PointerEvent('pointerdown', { bubbles: true }))
    }

    // ---- OS clipboard (Electron 44 main-process clipboard: async ClipboardItem API), fixed AND infinite documents
    {
      const clip = await import('./clipboard')
      const { encodePng, decodeImage } = await import('../../io/bwk')
      const clipApi = window.brushworkClip
      const alphaOf = (d: ImageData): number => {
        let m = 0
        for (let i = 3; i < d.data.length; i += 4) m = Math.max(m, d.data[i])
        return m
      }
      for (const kind of ['fixed', 'infinite'] as const) {
        const cd = kind === 'fixed' ? app.newDocument(256, 256) : app.newDocument(2048, 2048, { kind: 'infinite', background: { color: [1, 1, 1], visible: true } })
        if (kind === 'infinite') app.setView({ cx: 100, cy: 100, zoom: 1, rot: 0 })
        const cl = cd.activeLayer
        const patch = { x: 40, y: 50, w: 60, h: 30 }
        ops.fillLayer(cd, cl, [1, 0, 0])
        if (kind === 'infinite') {
          // keep only a 60x30 patch: clear everything else through a selection-less region write
          const cl2 = cd.activeLayer
          const rgba = new Uint8ClampedArray(patch.w * patch.h * 4)
          for (let i = 0; i < patch.w * patch.h; i++) rgba.set([255, 0, 0, 128], i * 4)
          cd.clearLayer(cl2.id)
          const lay = ops.layerFromImage(cd, { x: patch.x, y: patch.y, w: patch.w, h: patch.h, data: rgba }, 'patch')
          cd.insertLayer(lay, { id: cl2.id, where: 'above' }, 'patch', 'layer-paste')
          cd.setActive(lay.id)
        }
        const copied = await clip.copy(app)
        const back = clipApi ? await clipApi.readImage() : null
        const dec = back ? await decodeImage(back) : null
        check('os clipboard (' + kind + '): copy puts a PNG on the OS clipboard', copied && !!dec && dec.width > 0, dec ? dec.width + 'x' + dec.height : 'none')
        if (kind === 'infinite') check('os clipboard (infinite): copy is cropped to the content and keeps alpha', !!dec && dec.width === patch.w && dec.height === patch.h && alphaOf(dec) > 100 && alphaOf(dec) < 200, dec ? dec.width + 'x' + dec.height + ' a=' + alphaOf(dec) : 'none')
        // a foreign image (as if copied in another app) is pasted as a new layer of its own size
        const fw = 37
        const fh = 21
        const fpx = new Uint8ClampedArray(fw * fh * 4)
        for (let i = 0; i < fw * fh; i++) fpx.set([0, 200, 0, 255], i * 4)
        await clipApi?.writeImage(await encodePng(fpx, fw, fh))
        const n0 = cd.layers.length
        const pasted = await clip.paste(app)
        const pl = cd.activeLayer
        check('os clipboard (' + kind + '): foreign image is pasted as a new layer', pasted && cd.layers.length === n0 + 1 && /./.test(pl.name))
        cd.undo()
        // our own copy afterwards: paste uses the internal clip (no re-decode), also a layer
        await clip.copy(app)
        const n1 = cd.layers.length
        await clip.paste(app)
        check('os clipboard (' + kind + '): paste of our own copy', cd.layers.length === n1 + 1)
      }
    }

    // ---- limits + events
    check('layer limit computed', doc.maxLayers > 2)
    let threw = false
    try {
      const small = fresh()
      Object.defineProperty(small, 'maxLayers', { get: () => 2 })
      small.addLayer()
      small.addLayer()
    } catch (e) {
      threw = e instanceof LayerLimitError
    }
    check('layer limit enforced', threw)
    await uiTest()
    check('commit events emitted', commits.includes('layer-group') && commits.includes('layer-mask') && commits.includes('layer-merge'), commits.join(','))
  } catch (e) {
    log('FAIL exception ' + (e as Error).stack)
    ok = false
  }
  return ok
}
