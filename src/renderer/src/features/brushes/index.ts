import type { App } from '../../app/app'
import { hsvToRgb, rgbToHex } from '../../app/state'
import { BrushPreset } from '../../core/brush'
import { getBrushPreset } from '../../brush/presets'
import { getTextureDef } from '../../brush/textures'
import { t, tk } from '../../i18n'
import { registerMenuItem, registerPanel, UIContext } from '../../ui/registry'
import { BRUSH_EXTS, editBrush, importBytes, importViaDialog } from './actions'
import { library } from './library'
import { renderLibrary } from './libraryPanel'
import { runBrushSelfTest } from './selftest'
import { injectCss } from './widgets'
import { registerResourceImporter } from '../color/resourceImport'

/** Feature module 'brushes' - brush library, Brush Studio, import/export, recents, per-brush cursor. Installed once after buildUI(). */
export function install(app: App, ui: unknown): void {
  injectCss()
  const ctx = ui as UIContext
  // .brush / .brushset / .abr / .bwbrush(set) chosen in the Gallery's Import
  registerResourceImporter({ exts: BRUSH_EXTS, run: async (bytes, name) => ((await importBytes(app, bytes, name)) ? t('brushes.menu.imported') : t('brushes.menu.importFailed')) })
  const st = app.state
  try {
    st.linkBrushTools = localStorage.getItem('bw.linkBrushTools') === '1'
  } catch {
    /* storage unavailable */
  }

  const titles = { brush: tk('brushes.menu.brushLibrary'), smudge: tk('brushes.menu.smudgeLibrary'), eraser: tk('brushes.menu.eraserLibrary') }
  for (const t of ['brush', 'smudge', 'eraser'] as const) registerPanel({ id: 'lib-' + t, title: titles[t], width: 580, render: renderLibrary(t) })

  registerMenuItem('actions', { id: 'brush-studio', label: tk('brushes.menu.brushStudio'), separator: true, run: () => editBrush(app, st.preset) })
  registerMenuItem('actions', { id: 'brush-import', label: tk('brushes.menu.importBrushes'), run: () => void importViaDialog(app) })

  // restore the stored library (custom brushes, edited defaults, sets, favorites, recents)
  void library.load().then(() => {
    for (const t of ['brush', 'smudge', 'eraser'] as const) {
      const ts = st.toolSettings[t]
      if (!getBrushPreset(ts.presetId)) st.setPreset(t, t === 'brush' ? 'hard-round' : t === 'smudge' ? 'smudge-soft' : 'eraser-hard')
    }
    st.events.emit('toolSettings', undefined)
  })
  ;(window as unknown as { brushwork_library: unknown }).brushwork_library = library

  // drag & drop of brush files
  const hasFiles = (e: DragEvent): boolean => !!e.dataTransfer && Array.from(e.dataTransfer.types).includes('Files')
  window.addEventListener('dragover', (e) => hasFiles(e) && e.preventDefault())
  window.addEventListener('drop', (e) => {
    const files = Array.from(e.dataTransfer?.files ?? []).filter((f) => BRUSH_EXTS.includes(f.name.toLowerCase().replace(/^.*\./, '')))
    if (!files.length) return
    e.preventDefault()
    void (async () => {
      for (const f of files) await importBytes(app, new Uint8Array(await f.arrayBuffer()), f.name)
    })()
  })

  installCursor(app)
  void ctx
  // brush / tablet QA harness (BW_BRUSH_QA=1): window.__bwqa, driven by qa-brush.mjs
  void (async () => {
    const gal = (window as unknown as { bwGallery?: { env(k: string): Promise<string | null> } }).bwGallery
    if (gal && (await gal.env('BW_BRUSH_QA')) === '1') (await import('./qa/brushQA')).installBrushQA(app)
  })()
  // self-test: BW_SELFTEST=1 (alongside the others) or standalone with BW_BRUSH_SELFTEST=1 (+ BW_COLOR_SELFTEST=1)
  void (async () => {
    const on = await window.brushwork?.isSelfTest()
    const gal = (window as unknown as { bwGallery?: { env(k: string): Promise<string | null> } }).bwGallery
    const alone = gal ? (await gal.env('BW_BRUSH_SELFTEST')) === '1' : false
    if (!on && !alone) return
    setTimeout(
      () =>
        void runBrushSelfTest(app, ctx, alone).then((ok) => {
          if (alone) void window.brushwork?.selfTestDone({ ok })
        }),
      alone ? 1500 : 1200
    )
  })()
}

// ------------------------------------------------------------------ per-brush cursor (outline + hover fill)
const fillCache = new Map<string, string>()

function stampDataUrl(b: BrushPreset, hex: string, alpha: number): string {
  const key = [b.tipTexture, b.hardness, b.roundness, b.angle, hex, alpha, b.shape.invert].join('|')
  const hit = fillCache.get(key)
  if (hit) return hit
  const S = 64
  const c = document.createElement('canvas')
  c.width = c.height = S
  const g = c.getContext('2d')!
  const img = g.createImageData(S, S)
  const tex = b.tipTexture ? getTextureDef(b.tipTexture) : undefined
  const col = [parseInt(hex.slice(1, 3), 16), parseInt(hex.slice(3, 5), 16), parseInt(hex.slice(5, 7), 16)]
  const rn = Math.max(0.05, b.roundness)
  const ang = (b.angle * Math.PI) / 180
  for (let y = 0; y < S; y++)
    for (let x = 0; x < S; x++) {
      const dx = (x + 0.5) / S - 0.5
      const dy = (y + 0.5) / S - 0.5
      const u = (Math.cos(-ang) * dx - Math.sin(-ang) * dy) * 2
      const v = ((Math.sin(-ang) * dx + Math.cos(-ang) * dy) * 2) / rn
      let a = 0
      if (tex) {
        if (Math.abs(u) <= 1 && Math.abs(v) <= 1) a = tex.data[Math.floor((v * 0.5 + 0.5) * tex.size) * tex.size + Math.floor((u * 0.5 + 0.5) * tex.size)] / 255
        if (b.shape.invert) a = 1 - a
      } else {
        const r = Math.hypot(u, v)
        const w = Math.max(0.02, 1 - b.hardness)
        a = Math.max(0, Math.min(1, (1 - r) / w))
      }
      const o = (y * S + x) * 4
      img.data[o] = col[0]
      img.data[o + 1] = col[1]
      img.data[o + 2] = col[2]
      img.data[o + 3] = Math.round(a * alpha * 255)
    }
  g.putImageData(img, 0, 0)
  const url = c.toDataURL()
  if (fillCache.size > 60) fillCache.clear()
  fillCache.set(key, url)
  return url
}

function installCursor(app: App): void {
  const apply = (): void => {
    const el = app.cursorEl
    const b = app.state.preset
    const hex = rgbToHex(hsvToRgb(app.state.color))
    const c = b.cursor
    if (c.outline === 'none') el.style.border = '0'
    else if (c.outline === 'active') {
      el.style.border = '2px solid ' + hex
      el.style.boxShadow = 'none'
    } else {
      el.style.border = ''
      el.style.boxShadow = ''
    }
    if (c.hoverFill !== 'none' && c.hoverOpacity > 0) {
      if (c.hoverFill === 'all') {
        el.style.backgroundImage = ''
        el.style.backgroundColor = hex + Math.round(c.hoverOpacity * 255).toString(16).padStart(2, '0')
      } else {
        el.style.backgroundColor = ''
        el.style.backgroundImage = `url(${stampDataUrl(b, hex, c.hoverOpacity)})`
        el.style.backgroundSize = '100% 100%'
      }
    } else {
      el.style.backgroundImage = ''
      el.style.backgroundColor = ''
    }
  }
  // styles (not geometry) of the cursor element follow the active brush; geometry stays with the interface module
  app.state.events.on('tool', apply)
  app.state.events.on('toolSettings', apply)
  app.state.events.on('color', apply)
  library.events.on('change', apply)
  apply()
}
