const COLOR_CSS = `
.bw-color-body { padding: 8px 10px 10px; }
.bw-color-head { display: flex; align-items: center; gap: 8px; margin: 2px 0 8px; }
.bw-swatch-stack { position: relative; width: 62px; height: 46px; flex: none; }
.bw-swatch-big { position: absolute; left: 0; top: 0; width: 38px; height: 38px; border-radius: 50%; border: 3px solid var(--panel); box-shadow: 0 0 0 1px var(--line); cursor: grab; padding: 0; z-index: 2; touch-action: none; }
.bw-swatch-big.small { left: 22px; top: 12px; width: 32px; height: 32px; z-index: 1; }
.bw-swatch-big.active { box-shadow: 0 0 0 2px var(--accent); }
.bw-head-mid { flex: 1; min-width: 0; color: var(--dim); font-size: 12px; white-space: nowrap; overflow: hidden; text-overflow: ellipsis; }
.bw-icon-btn { min-width: 30px; height: 30px; border-radius: 8px; border: 1px solid var(--line); background: var(--panel2); cursor: pointer; display: grid; place-items: center; padding: 0 6px; }
.bw-icon-btn:hover { border-color: var(--accent); }
.bw-icon-btn.active { background: var(--accent); border-color: var(--accent); color: #fff; }
.bw-eye-glyph { font-size: 17px; line-height: 1; }
.bw-history { display: flex; gap: 5px; margin: 0 0 8px; min-height: 20px; }
.bw-hist { width: 20px; height: 20px; border-radius: 50%; border: 1px solid var(--line); padding: 0; cursor: pointer; flex: none; }
.bw-hist.empty { background: transparent; border-style: dashed; opacity: .5; }
.bw-tabs { display: flex; gap: 2px; background: var(--bg); border-radius: 9px; padding: 2px; margin-bottom: 8px; }
.bw-tab { flex: 1; border: 0; background: transparent; border-radius: 7px; padding: 6px 2px; cursor: pointer; font-size: 12px; color: var(--dim); }
.bw-tab.sel { background: var(--panel2); color: var(--text); }
.bw-tab-page { display: flex; flex-direction: column; gap: 6px; align-items: stretch; }
.bw-disc-wrap { position: relative; margin: 2px auto; touch-action: none; cursor: crosshair; }
.bw-disc { display: block; }
.bw-disc-wrap .knob { pointer-events: none; }
.bw-harm-svg { position: absolute; inset: 0; width: 100%; height: 100%; pointer-events: none; }
.bw-harm-poly { fill: rgba(255,255,255,.08); stroke: #fff; stroke-width: 1.5; stroke-opacity: .8; }
.bw-harm-handle { stroke: #fff; stroke-width: 3; }
.bw-harm-handle.base { stroke-width: 4; }
.bw-harm-swatches { display: flex; gap: 6px; justify-content: center; margin: 2px 0; }
.bw-harm-sw { width: 40px; height: 32px; border-radius: 8px; border: 2px solid var(--line); cursor: pointer; padding: 0; }
.bw-harm-sw.sel { border-color: #fff; }
.bw-chips { display: flex; flex-wrap: wrap; gap: 4px; justify-content: center; margin-top: 4px; }
.bw-chip { border: 1px solid var(--line); background: var(--panel2); border-radius: 12px; padding: 3px 9px; cursor: pointer; font-size: 11px; }
.bw-chip.sel { background: var(--accent); border-color: var(--accent); color: #fff; }
.bw-hue { margin: 6px 4px; }
.bw-sliders { display: flex; flex-direction: column; gap: 4px; }
.bw-slider { display: flex; align-items: center; gap: 8px; }
.bw-slider .lbl { width: 14px; color: var(--dim); font-size: 12px; }
.bw-slider .val { width: 34px; text-align: right; color: var(--dim); font-size: 12px; }
.bw-slider-track { position: relative; flex: 1; height: 18px; border-radius: 9px; touch-action: none; cursor: pointer; box-shadow: inset 0 0 0 1px #0006; }
.bw-slider-track .knob { width: 16px; height: 16px; margin: -8px 0 0 -8px; border-width: 2px; background: #fff; }
.bw-num { width: 46px; background: var(--panel2); color: var(--text); border: 1px solid var(--line); border-radius: 6px; padding: 3px 4px; text-align: right; }
.bw-group-title { color: var(--dim); font-size: 11px; text-transform: uppercase; letter-spacing: .06em; margin-top: 6px; }
.bw-hex { flex: 1; min-width: 0; background: var(--panel2); color: var(--text); border: 1px solid var(--line); border-radius: 6px; padding: 6px 8px; font-family: Consolas, monospace; }
.bw-btn { background: var(--panel2); border: 1px solid var(--line); border-radius: 7px; padding: 5px 10px; cursor: pointer; }
.bw-btn:hover { border-color: var(--accent); }
.bw-select { flex: 1; min-width: 0; background: var(--panel2); color: var(--text); border: 1px solid var(--line); border-radius: 7px; padding: 5px; }
.bw-select.small { padding: 3px; }
.bw-pal-head { display: flex; gap: 5px; align-items: center; }
.bw-pal-sub { color: var(--dim); font-size: 11px; margin: 2px 2px 0; }
.bw-swatch-grid { display: grid; gap: 6px; margin-top: 4px; }
.bw-swatch-grid.compact { grid-template-columns: repeat(auto-fill, minmax(34px, 1fr)); }
.bw-swatch-grid.card { grid-template-columns: repeat(3, 1fr); gap: 8px; }
.bw-slot { position: relative; display: flex; flex-direction: column; align-items: center; gap: 3px; background: transparent; border: 0; padding: 0; cursor: pointer; color: var(--dim); touch-action: none; }
.bw-slot-c { width: 100%; aspect-ratio: 1; border-radius: 50%; background: var(--c); border: 2px solid var(--line); }
.bw-swatch-grid.card .bw-slot-c { border-radius: 10px; aspect-ratio: 1.4; }
.bw-slot.sel .bw-slot-c { border-color: #fff; box-shadow: 0 0 0 1px var(--accent); }
.bw-slot-t { font: 10px Consolas, monospace; }
.bw-slot.empty { aspect-ratio: 1; border: 2px dashed var(--line); border-radius: 50%; font-size: 16px; justify-content: center; }
.bw-swatch-grid.card .bw-slot.empty { border-radius: 10px; aspect-ratio: 1.4; }
.bw-slot.empty:hover { border-color: var(--accent); color: var(--text); }
.bw-hint { color: var(--dim); font-size: 11px; margin-top: 6px; }
.bw-settings { margin-top: 10px; border-top: 1px solid var(--line); padding-top: 6px; }
.bw-settings summary { cursor: pointer; color: var(--dim); font-size: 12px; }
.bw-settings .row { margin: 4px 0; }
.bw-settings .lbl { width: 90px; font-size: 12px; }
.bw-range { flex: 1; min-width: 0; accent-color: var(--accent); }
.chk { display: flex; align-items: center; gap: 6px; margin: 6px 2px; }

/* eyedropper loupe */
.bw-loupe { position: fixed; z-index: 400; width: 104px; height: 104px; margin: -52px 0 0 -52px; pointer-events: none; }
.bw-loupe-ring { position: absolute; inset: 0; border-radius: 50%; overflow: hidden; box-shadow: 0 0 0 2px #000a, 0 6px 20px #000a; display: flex; flex-direction: column; }
.bw-loupe-new, .bw-loupe-old { flex: 1; }
.bw-loupe-zoom { position: absolute; left: 12px; top: 12px; width: 80px; height: 80px; border-radius: 50%; image-rendering: pixelated; box-shadow: 0 0 0 2px #000a; }
.bw-loupe-cross { position: absolute; left: 47px; top: 47px; width: 10px; height: 10px; border: 1px solid #fff; box-shadow: 0 0 0 1px #000; }

/* ColorDrop */
.bw-drop-ghost { position: fixed; z-index: 500; width: 46px; height: 46px; margin: -23px 0 0 -23px; border-radius: 50%; border: 3px solid #fff; box-shadow: 0 6px 18px #000a; pointer-events: none; }
.bw-pill { position: fixed; z-index: 500; left: 50%; top: 64px; transform: translateX(-50%); background: #000c; color: #fff; padding: 6px 14px; border-radius: 16px; font-size: 13px; pointer-events: none; }

/* dialogs */
.bw-small-modal { width: 340px; }
.bw-text-input { width: 100%; background: var(--panel2); color: var(--text); border: 1px solid var(--line); border-radius: 8px; padding: 8px; margin-bottom: 10px; }
.bw-msg { margin: 0 0 14px; color: var(--dim); }
.modal .primary { background: var(--accent); border-color: var(--accent); color: #fff; }
.modal .primary.danger { background: #d8453d; border-color: #d8453d; }
.bw-ctx { position: fixed; z-index: 600; min-width: 190px; background: var(--panel); border: 1px solid var(--line); border-radius: 10px; padding: 4px; box-shadow: 0 12px 40px #000a; }
.bw-ctx-item { display: block; width: 100%; text-align: left; border: 0; background: transparent; padding: 8px 10px; border-radius: 6px; cursor: pointer; }
.bw-ctx-item:hover:not([disabled]) { background: var(--panel2); }
.bw-ctx-item[disabled] { color: #6d6d75; cursor: default; }
.bw-ctx-item.danger { color: #ff6b62; }
`

let done = false
export function ensureColorStyles(): void {
  if (done) return
  done = true
  const el = document.createElement('style')
  el.id = 'bw-color-styles'
  el.textContent = COLOR_CSS
  document.head.append(el)
}

export function injectCss(id: string, css: string): void {
  if (document.getElementById(id)) return
  const el = document.createElement('style')
  el.id = id
  el.textContent = css
  document.head.append(el)
}
