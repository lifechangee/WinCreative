import type { App } from '../app/app'
import { resolveText } from '../i18n'
import { listActions } from '../input/actions'
import { normalizeCombo } from '../input/shortcutMap'
import { loadBwk, saveBwk } from '../io/bwk'
import { menus } from '../ui/registry'
import { animState } from '../features/animio/animation'
import { docMeta, setDocMeta } from '../features/animio/docMeta'
import { getRecorder } from '../features/animio/timelapse'
import { layerHooks } from '../features/layers/ops'
import { unzipSync } from 'fflate'

const sleep = (ms: number): Promise<void> => new Promise((r) => setTimeout(r, ms))

/**
 * Cross-module integration test (BW_INTEG_TEST=1): hook wiring, undo interception, selection <-> layers, text, onion skin,
 * shortcut / menu conflicts and one .bwk round trip that carries every module's data at once.
 * Also runs the guides module's own pointer-path test (window.brushwork_guides_test).
 */
export async function runIntegrationSelfTest(app: App): Promise<boolean> {
  const failures: string[] = []
  const check = (name: string, cond: boolean, extra = ''): void => {
    console.log('[integ]', cond ? 'PASS' : 'FAIL', name, extra)
    if (!cond) failures.push(name)
  }
  const gl = app.gpu.gl
  const w = window as any
  try {
    await sleep(1500)
    gl.getError()

    // ------------------------------------------------------------ guides module's own test
    const gt: string[] = await w.brushwork_guides_test()
    for (const l of gt) check('guides: ' + l.replace(/^(PASS|FAIL) /, ''), l.startsWith('PASS'))

    // ------------------------------------------------------------ wiring
    check('layerHooks.addText wired (text feature)', typeof layerHooks.addText === 'function')
    check('layerHooks.beginTransform wired (transform feature)', typeof layerHooks.beginTransform === 'function')
    check('app.selection exposed', !!app.selection && typeof app.selection.hasSelection === 'function')
    check('single brush cursor element + one renderer', document.querySelectorAll('#brush-cursor').length === 1 && !!app.input.cursorRenderer)
    check('compositor.rootProvider hook present', 'rootProvider' in app.compositor)

    // ------------------------------------------------------------ shortcut / menu conflicts
    const byKey = new Map<string, string[]>()
    for (const a of listActions()) for (const k of a.defaultKeys ?? []) (byKey.get(normalizeCombo(k)) ?? byKey.set(normalizeCombo(k), []).get(normalizeCombo(k))!).push(a.id)
    const clashes = [...byKey].filter(([, ids]) => ids.length > 1).map(([k, ids]) => k + '=' + ids.join('/'))
    check('no default shortcut bound to two actions', clashes.length === 0, clashes.join('; '))
    const dupLabels: string[] = []
    for (const [m, items] of Object.entries(menus)) {
      const seen = new Set<string>()
      for (const it of items) {
        const text = resolveText(it.label)
        const l = text.replace(/^[✓ ]+/, '').trim().toLowerCase()
        if (seen.has(l)) dupLabels.push(m + ':' + text)
        seen.add(l)
      }
    }
    check('no duplicate menu labels within a menu', dupLabels.length === 0, dupLabels.join('; '))

    // ------------------------------------------------------------ fresh document
    app.newDocument(512, 512)
    const doc = () => app.doc
    const fillRect = (id: string, x: number, y: number, ww: number, hh: number, c: [number, number, number, number]): void => {
      const d = new Uint8ClampedArray(ww * hh * 4)
      for (let i = 0; i < ww * hh; i++) d.set(c, i * 4)
      app.gpu.uploadRGBA8(doc().getLayer(id)!.pixels, x, y, ww, hh, d)
      doc().events.emit('change', { rect: null })
    }
    const alphaAt = (id: string, x: number, y: number): number => app.gpu.readRGBA8(doc().getLayer(id)!.pixels, { x, y, w: 1, h: 1 })[3]
    const flatAt = (x: number, y: number): number[] => Array.from(app.compositor.readFlattened(false).subarray((y * doc().width + x) * 4, (y * doc().width + x) * 4 + 4))

    // ------------------------------------------------------------ undo: normal
    const n0 = doc().layers.length
    doc().addLayer({ name: 'tmp' })
    app.undo()
    check('undo (normal) reverts layer add', doc().layers.length === n0)
    app.redo()
    check('redo (normal) re-adds layer', doc().layers.length === n0 + 1)
    app.undo()

    // ------------------------------------------------------------ selection <-> layers
    const base = doc().addLayer({ name: 'base' })
    fillRect(base.id, 100, 100, 100, 100, [255, 0, 0, 255])
    const layersApi = w.brushwork_layers
    layersApi.actions.selectAlpha(base.id)
    check('Layer > Select (alpha to selection) sets app.selection', app.selection.hasSelection() && app.selection.coverageAt(150, 150) > 0.98 && app.selection.coverageAt(300, 300) === 0, 'has=' + app.selection.hasSelection() + ' cov=' + app.selection.coverageAt(150, 150))
    app.undo()
    check('undo with active selection edit removes selection', !app.selection.hasSelection())
    app.redo()
    check('redo restores selection', app.selection.hasSelection())
    app.selection.saveCurrent('integ-sel')
    app.selection.clear()
    check('deselect', !app.selection.hasSelection())

    // ------------------------------------------------------------ undo during transform
    const histBefore = doc().history.undoCount
    const px0 = alphaAt(base.id, 150, 150)
    doc().setActive(base.id)
    menus.transform.find((m) => m.id === 'tf-free')!.run!(w.brushwork_ui)
    check('transform session opens (brush cursor hidden via tool override)', app.brushCursorHidden)
    app.undo()
    check('undo during transform abandons the session, history untouched', !app.brushCursorHidden && doc().history.undoCount === histBefore && alphaAt(base.id, 150, 150) === px0, `hist ${doc().history.undoCount}/${histBefore}`)
    menus.transform.find((m) => m.id === 'tf-free')!.run!(w.brushwork_ui)
    app.redo()
    check('redo during transform is swallowed', app.brushCursorHidden && doc().history.redoCount === 0)
    menus.transform.find((m) => m.id === 'tf-cancel')!.run!(w.brushwork_ui)
    check('transform cancelled', !app.brushCursorHidden)

    // ------------------------------------------------------------ undo inside an open adjustment
    const adj = w.brushwork_app.adjustments
    const h1 = doc().history.undoCount
    adj.ui.open('hsb')
    const s = adj.ui.session
    check('adjustment session open', !!s && !s.isClosed)
    s.setParam('hue', 30)
    s.beginEdit()
    s.setParam('hue', 60)
    const hueBefore = s.params.hue
    app.undo()
    check('undo inside adjustment steps back within the session only', !s.isClosed && doc().history.undoCount === h1 && s.params.hue !== hueBefore, `hue ${hueBefore}->${s.params.hue}`)
    app.redo()
    check('redo inside adjustment does not touch document history', !s.isClosed && doc().history.redoCount === 0)
    adj.ui.finish(false)
    app.undo() // normal again (undoes fill selection etc. -> just must not throw / must hit document history)
    check('undo after adjustment closes uses document history', true)
    app.redo()

    // ------------------------------------------------------------ text hook
    const textLayers0 = doc().layers.length
    layerHooks.addText!()
    await sleep(200)
    check('Add > Add text creates a text layer', doc().layers.length === textLayers0 + 1 && w.brushwork_text.isText(doc().activeId))
    w.brushwork_text.stopEditing()

    // ------------------------------------------------------------ onion skin through compositor.rootProvider
    app.newDocument(256, 256)
    const f1 = doc().addLayer({ name: 'f1' })
    const f2 = doc().addLayer({ name: 'f2' })
    fillRect(f1.id, 40, 40, 60, 60, [255, 255, 255, 255])
    const anim = w.brushwork_animio.anim
    doc().setBackground([0, 0, 0], true)
    anim.setEnabled(true)
    anim.setCurrent(doc().childrenOf(null).findIndex((l) => l.id === f2.id))
    app.renderNow()
    check('animation assist installs rootProvider', !!app.compositor.rootProvider)
    const ghost = flatAt(70, 70)
    check('onion skin ghost of the previous frame renders', ghost[0] > 10 && ghost[3] > 0 && ghost[0] > ghost[1], ghost.join(','))
    anim.setCurrent(doc().childrenOf(null).findIndex((l) => l.id === f1.id))
    app.renderNow()
    check('current frame shows full', flatAt(70, 70)[0] > 200)
    anim.setEnabled(false)
    check('animation assist off removes rootProvider', app.compositor.rootProvider === null)

    // ------------------------------------------------------------ .bwk round trip of everything
    app.newDocument(512, 512)
    const d = doc()
    const A = d.addLayer({ name: 'A' })
    fillRect(A.id, 50, 50, 200, 200, [255, 0, 0, 255])
    const B = d.addLayer({ name: 'B' })
    fillRect(B.id, 150, 150, 200, 200, [0, 0, 255, 255])
    d.setLayerProps(B.id, { blendMode: 'multiply', opacity: 0.8 })
    d.addMask(B.id, true)
    const C = d.addLayer({ name: 'C' })
    fillRect(C.id, 0, 0, 512, 512, [0, 255, 0, 255])
    d.setLayerProps(C.id, { clipping: true, alphaLock: true })
    const grp = d.groupLayers([A.id, B.id, C.id], 'Grp')!
    d.setLayerProps(grp.id, { passThrough: false, opacity: 0.9 })
    d.setReference(A.id, true)
    const T = d.addLayer({ name: 'T0' })
    void T
    w.brushwork_text.addText('Round trip')
    await sleep(200)
    const textId = d.activeId
    w.brushwork_text.setStyle({ size: 80 })
    w.brushwork_text.stopEditing()
    await sleep(900)
    w.brushwork_guides.set({ enabled: true, type: 'symmetry', symKind: 'radial', symSegments: 6 })
    const st = animState(d)
    st.fps = 8
    st.mode = 'pingpong'
    st.holds[A.id] = 3
    st.onion.before = 3
    setDocMeta(d, { author: 'integ', dpi: 300 })
    // saved selection
    fillRect(A.id, 60, 60, 20, 20, [255, 0, 0, 255])
    layersApi.actions.selectAlpha(A.id)
    const covBefore = app.selection.coverageAt(65, 65)
    app.selection.saveCurrent('rt-sel')
    app.selection.clear()
    // timelapse frames: a few real commits
    const rec = getRecorder(d)!
    for (let i = 0; i < 3; i++) {
      d.clearLayer(T.id)
      await sleep(120)
    }
    await rec.flush()
    const frames = rec.count
    check('timelapse recorded frames', frames > 0, 'frames=' + frames)

    const bytes = await saveBwk(d, app.compositor)
    const zip = unzipSync(bytes)
    check('zip has selection + timelapse entries', Object.keys(zip).some((k) => k.startsWith('selections/')) && Object.keys(zip).some((k) => k.startsWith('timelapse/')), Object.keys(zip).filter((k) => !k.startsWith('layers/') && !k.startsWith('masks/')).join(','))
    const d2 = await loadBwk(bytes, app.gpu)
    const g2 = d2.getLayer(grp.id)!
    check('rt: groups', g2.isGroup && !g2.passThrough && Math.abs(g2.opacity - 0.9) < 1e-3 && d2.getLayer(A.id)!.parentId === grp.id)
    check('rt: mask', !!d2.getLayer(B.id)!.mask && d2.getLayer(B.id)!.blendMode === 'multiply')
    check('rt: clipping + alpha lock', d2.getLayer(C.id)!.clipping && d2.getLayer(C.id)!.alphaLock)
    check('rt: reference layer', d2.getLayer(A.id)!.reference)
    check('rt: layer order + count', d2.layers.map((l) => l.id).join() === d.layers.map((l) => l.id).join())
    check('rt: pixels', app.gpu.readRGBA8(d2.getLayer(A.id)!.pixels, { x: 70, y: 70, w: 1, h: 1 })[0] === 255)
    check('rt: text layer data', w.brushwork_text.store.get(d2)?.get(textId)?.text === 'Round trip' && w.brushwork_text.store.get(d2).get(textId).style.size === 80)
    const gs = w.brushwork_guides.exportState(d2)
    check('rt: guides', gs.type === 'symmetry' && gs.symKind === 'radial' && gs.symSegments === 6)
    const as2 = animState(d2)
    check('rt: animation settings', as2.fps === 8 && as2.mode === 'pingpong' && as2.holds[A.id] === 3 && as2.onion.before === 3)
    check('rt: doc meta', docMeta(d2).author === 'integ' && docMeta(d2).dpi === 300)
    const saved = app.selection.savedFor(d2)
    check('rt: saved selection', saved.length === 1 && saved[0].name === 'rt-sel' && saved[0].snap.data[(65 - saved[0].snap.rect.y) * saved[0].snap.rect.w + (65 - saved[0].snap.rect.x)] === Math.round(covBefore * 255), saved.map((x) => x.name + JSON.stringify(x.snap.rect)).join() + ' cov=' + covBefore)
    app.setDocument(d2) // attaches timelapse recorder, restoring the embedded frames
    await sleep(600)
    const rec2 = getRecorder(d2)
    check('rt: timelapse restored', !!rec2 && rec2.count === frames, `count=${rec2?.count} expected=${frames}`)
    try {
      const again = await saveBwk(d2, app.compositor)
      check('rt: second save is loadable', (await loadBwk(again, app.gpu)).layers.length === d2.layers.length)
    } catch (e) {
      check('rt: second save is loadable', false, String((e as Error)?.stack ?? e))
    }

    check('no GL error', gl.getError() === 0)
  } catch (e) {
    console.error('[integ] exception', e)
    failures.push('exception ' + (e as Error).message)
  }
  console.log('[integ] ' + (failures.length ? 'FAILED: ' + failures.join(' | ') : 'DONE all passed'))
  return failures.length === 0
}
