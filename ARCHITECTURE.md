# WinCreative architecture

Electron + TypeScript + Vite (electron-vite), WebGL2 rendering, vanilla-TS UI. Renderer code lives in
`src/renderer/src`. Layering rule: `core/` is pure (no DOM/GL, unit-tested); `gl/` knows WebGL only;
`doc/` owns document state; `tools/`, `input/`, `ui/` sit on top; `app/app.ts` wires everything.

```
src/main/index.ts            Electron main: window, file dialogs (IPC), GPU flags, self-test hooks
src/preload/index.ts         contextBridge -> window.brushwork {saveFile, openFile, ...}
src/renderer/src/
  core/     types, events (Emitter), geometry, viewTransform, pressure (curve), smoothing (StreamLine),
            stroke (Catmull-Rom + spacing walker), dynamics (BrushPreset -> Dab), brush (BrushPreset type),
            blend (CPU reference of all 17 blend modes), undo (UndoStack of Commands)
  brush/    presets.ts (registry + 10 defaults), textures.ts (procedural tips/grains + registry)
  gl/       gpu (GPU, Surface, Program, blit/readback), shaders (all GLSL), brushEngine (stroke buffer,
            dab stamping, commit, smudge), compositor (layer stack -> composite -> screen), filters
  doc/      document (Document: layers, history, commit bus), layer, pixelEdit (tile snapshots for undo)
  input/    pointerInput (pen/mouse/touch/gestures/palm rejection), shortcuts
  tools/    tool.ts (Tool interface), paintTool.ts (brush/eraser/smudge pipeline)
  ui/       index (top bar, menus), sidebar, popover, registry (menus/panels), colorPanel, layerPanel,
            brushPanel, newDocDialog, dom helpers
  io/       bwk (.bwk zip: manifest.json + layers/<id>.png + thumbnail.png), exporters (PNG/JPG/save/open)
  app/      app.ts (App: GPU, doc, compositor, engine, tools, render loop), state.ts (AppState)
  selftest.ts  BW_SELFTEST=1 smoke test using synthetic pen events (see below)
tests/      vitest for pure logic
```

## Rendering pipeline
Pointer samples (doc coords) -> `PathSmoother` -> `StrokeBuilder` (Catmull-Rom, distance spacing with carry)
-> `computeDab` (dynamics) -> `BrushEngine.stamp` (instanced quads, AA falloff in fragment shader, RGBA16F
stroke buffer, premultiplied, per-dab flow) -> on stroke end `BrushEngine.end` bakes stroke into the layer with
whole-stroke opacity cap (Photoshop-style). While drawing, `Compositor.compose(live, dirtyRect)` overlays the
live stroke on its layer inside a scissor rect, so cost is proportional to the stroke, not the canvas.
Layers use RGBA16F (<= 6 Mpx) or RGBA8 (larger); display shader adds dithering, supersampling when zoomed out.

## Extension points
- **Brush presets**: `brush/presets.ts` `registerBrushPreset(json)`; type `BrushPreset` in `core/brush.ts`
  (partial JSON is filled by `normalizeBrush`). Textures: `brush/textures.ts` `registerTexture()`.
  Per-tool selection: `AppState.setPreset(tool, id)`. Brush library UI: `ui/brushPanel.ts`.
- **Tools**: implement `Tool` (`tools/tool.ts`), `app.registerTool(id, tool)`; `AppState.effectiveTool` picks it.
  Samples arrive in doc coordinates. Paint tools reuse `PaintTool`/`BrushEngine`.
- **Panels/popovers/menus**: `ui/registry.ts` `registerPanel({id,title,render})`, `registerMenuItem(menu, item)`
  (menus: gallery, actions, adjustments, selection, transform). `PopoverHost.toggle(id, anchor, build)`.
- **Adjustments/filters**: `gl/filters.ts` `registerFilter({id, name, glsl, params})` (GLSL `filterPixel`),
  `applyFilter(doc, id)` does undo + commit event. Listed automatically in the Adjustments menu.
- **Commit event bus**: `doc.events.on('commit', e => ...)`, `CommitEvent {type, layerId, dirtyRect, label, seq,
  time}` fires for every committed operation (stroke, erase, smudge, filter, clear, layer ops, undo, redo, new,
  load). `doc.events.on('change')` = redraw, `'layers'`, `'history'`. `app.events.on('doc')` fires when the
  document is replaced (rebind listeners). Frame capture: `app.compositor.readFlattened(withBackground)`.
- **File I/O**: `io/bwk.ts` `saveBwk/loadBwk/buildManifest/validateManifest` (manifest has `extra` for other
  modules; unknown zip entries are preserved via `extraFiles`), `io/exporters.ts` PNG/JPG + Electron dialogs.
  Add PSD etc. next to it and register a menu item.
- **Undo**: `doc.history` (`UndoStack`, 300 steps / 1.5 GB budget, min 100). Pixel edits: `doc.beginPixelEdit(layer,
  label)`, `edit.save(rect)` before modifying, `edit.finish()`; tile-based GPU snapshots (no readback).
- **Input tuning**: `AppState.pressureCurve`, `smoothing`, `smoothingOverride`, `mousePressure`, `touchDraws`.

## Self-test
`npm run build && set BW_SELFTEST=1 && set BW_SELFTEST_PNG=out.png && npx electron .` drives the real input path
with synthetic pen events, checks undo/redo, save/load, events, GL errors and 4K frame times, writes screenshots.

## Known limits
See the "known-incomplete" list in the hand-off report: no selection/transform, predicted events are display-only (`input/prediction.ts`),
clipping mask base does not include the live stroke, cancelled smudge is reverted via undo.

## animio (time-lapse, animation, pages, import/export, canvas ops)
`features/animio/` + `io/*` + `main/animio.ts` + `preload/animio.ts` (`window.animio`). Time-lapse: `timelapse.ts` records a JPEG
frame per commit (GPU downscale -> async fenced readback -> Worker JPEG -> IPC append to a per-doc file in userData); the file is
embedded in the .bwk via `registerBwkExtension` (io/bwk.ts; other modules can persist data the same way). ffmpeg = `ffmpeg-static`
(asarUnpack) with PATH fallback; time-lapse export streams frames main-side (image2pipe), animation export streams raw RGBA.
Animation/Page Assist frames = ROOT layers/groups; they change what is shown via `compositor.rootProvider` (hook in gl/compositor.ts).
`io/frameRender.ts` renders any root-layer list to a bitmap (used by exports and thumbnails); `io/psd.ts` is pure (ag-psd).
Self-test: `set BW_ANIMIO_TEST=1 & set BW_ANIMIO_OUT=<dir> & npx electron .` (features/animio/selftest*.ts; ffprobe-verifies outputs).

## Saving, crash safety, perf (io/asyncSave.ts, io/saveWorker.ts, features/color/journal.ts, perf/)
- **Non-blocking save.** `saveBwk/saveBwkEx` (io/bwk.ts) never reads a whole layer synchronously. Each changed layer is rendered
  as straight-alpha RGBA8 into a staging surface, read back in ~2 MB row bands through pixel-pack buffers + `fenceSync`
  (one main-thread slice per band, `setTimeout` yields in between) and streamed to a pool of Workers that filter + deflate the PNG
  (`io/pngStream.ts`). An archive Worker caches every layer's PNG and builds the zip. The thumbnail is a GPU box-downscale of the live
  composite. Only layers whose `Surface.rev` changed are re-encoded (`rev` is bumped by `GPU.bindTarget` / `GPU.blit` = every GPU write
  path, so undo, filters, transforms, imports all invalidate automatically). Extensions may cache big append-only data in the
  archive worker (`BwkExtSave.blobFiles`, used by the time-lapse embed: only the new bytes cross the IPC).
- **One save queue.** `saveBwk` calls are serialised (`saveChain`); `GalleryStore.enqueue` is the gallery-level queue (index, files,
  journal). Autosave is a *background* job: it aborts with `SaveAborted` when a stroke starts (`saveHooks.busy`), when the document is
  edited mid-save or when it is disposed, stays dirty and retries after 900 ms (finished layers stay cached, so progress accumulates).
  Foreground saves restart when the document changes mid-read. `App.disposeGuards` keeps a replaced document's GPU memory alive
  until its unsaved edits are written. Every save has a watchdog: a promise is never left pending.
- **Crash journal.** After each committed stroke the dirty rect is read back (fenced PBO) and appended as a PNG patch to
  `<artwork>.jrn` (main-process append IPC). The .bwk manifest records `extra.journal = {gen, seq}`; on open, patches with a higher
  `seq` are replayed, the document is saved and the journal truncated. Non-stroke commits trigger a 300 ms "quick" incremental autosave.
- **Input.** `PointerInput`: pointercancel / blur / lost capture of a pen or mouse stroke *commit* it; a pointerdown while a stale
  stroke of the same device is open finishes it first (no dropped strokes). `getPredictedEvents` feeds a display-only 2D overlay
  (`input/prediction.ts`, pref `predictStroke`), anchored at the painted tip.
- **Warm-up.** `perf/warmup.ts` runs tiny strokes through the real pipeline at start-up so the first stroke of each brush family has no
  shader-compile hitch. Tests: `BW_PERF_SELFTEST=1` (perf/selftest.ts), harness `node qa-perf.mjs [--out dir] save4k autosave4k kill stress throttled-suite draw4k`.

## Colour profiles, PSD extras, view mirror, resource import (feature pass)
- `io/colorProfile.ts` (pure): built-in RGB spaces (sRGB, Display P3, Adobe RGB), matrices/TRC, ICC v2 profile builder, ICC
  reader/identifier, and embedding in PNG (iCCP) / JPEG (APP2) / PSD (resource 1039). The document tag lives in
  `features/animio/docMeta.ts` (`profile` label + optional imported `icc`, saved in the .bwk; `embedDocProfile` is called by every
  exporter). `features/profiles/` has the GPU Convert pass, Assign / Convert / ICC-import dialog, and syncs the WebGL
  `drawingBufferColorSpace` (Display P3 canvases render through a P3 buffer).
- `io/psdMap.ts` (pure) maps PSD text layers and adjustment layers to WinCreative data; `io/docPsd.ts` records them in `psdPost`
  and `features/psdimport/` finishes the import when the document becomes current (text -> `TextManager.adopt`, adjustments ->
  `runAdjustment` on the layers beneath, one undo step).
- View mirror: `View.mirror` (core/viewTransform) is honoured by `screenToDoc/docToScreen/anchorView/panBy`, the display shader and
  the selection overlay (`uMirror`). `app.toggleMirror()`; pixel flips are separate menu items.
- Gallery Import routes non-document files through `features/color/resourceImport.ts` (brushes, fonts, palettes, ICC register there).
- Input: `input/hoverAdjust.ts` (pen hover size/opacity), touch pressure curve + advanced gesture timing in `Prefs`, layer-row
  gestures in `features/layers/rowGestures.ts` (pure) + `ui/layerPanel.ts`, Transform Bend (`bendNet` in xformMath) and guide
  snapping (`snapTargetsFor` in guides/model, read through `app.guides.snapTargets()`).

## Time-lapse editor (features/animio/tl*.ts)
Top-bar tab "Time-lapse" (`registerTopTab` in ui/registry.ts) opens a full-window mode over the canvas (`tlEditor.ts`; Esc / "Back to drawing"
leaves it; painting keys are swallowed while it is open). The recording is never modified; everything lives in a versioned edit model
(`tlModel.ts` `TlEdit`: hideUndone, globalSpeed, fitDuration, segments, pauses, finale) saved in the .bwk next to the frames
(`extra.edit`) and autosaved through `GalleryStore.touchDoc`. The editor has its own undo stack (`tlEditorCore.ts`).
- **Hide undone actions** (`tlHistory.ts`, pure): `UndoStack` counts pushes / undos / redos / clears; the recorder's `HistoryTracker` mirrors the
  stack and turns every commit into a node of a state tree (push = new child, undo / redo = move between existing ids, truncation / clear / reopen
  continue from the current state). Each frame is stored with `{s: state id, t: commit type}` (index.json entries, `timelapse/tree.json` = parents).
  `computeKeep` keeps frames on the root -> FINAL-state path; undo / redo frames are dropped unless they reveal a deeper state (coalesced captures).
  Old recordings have no tags: the toggle is disabled and every frame is kept.
- **One schedule** (`buildSchedule`): kept frames + edit -> `[{frameIndex, startTime, duration}]`, used by the preview (`itemAt`) and by the export
  (`outputPlan` = constant-fps run-length list fed to ffmpeg image2pipe, so pauses are repeated frames; fade filters in `main/animio.ts`).
- Frames are decoded lazily from the on-disk store (LRU of bitmaps + thumbnails), the timeline canvas only draws the visible part.
- QA: `node scripts/qa/qa-tl.mjs out-tl [en|ru]`, `scripts/qa/qa-tl-perf.mjs`; self-test block `tle:` in the animio suite (`selftestTl.ts`).

## Smart selection (features/smartselect/*, main/smartselect.ts, preload/smartselect.ts)
`app.selection` gets objects from three engines behind one tool + bar (`smart.ts` controller/tool, `bar.ts` UI, `cutout.ts` actions):
- **AI** (`ortWorker.ts`, onnxruntime-web, MIT): MobileSAM (bundled in `resources/models/fast`) or SAM 2.1 Hiera-Small (optional download into
  `userData/models/precise`). The encoder runs once per region (cached by source key = layer/visible-stack `Surface.rev` + region), on WebGPU when available
  (WASM, 4 threads otherwise); the decoder runs per click (WebGPU for MobileSAM, WASM for SAM 2 because its WebGPU decoder returns garbage; the worker also
  self-checks the warm-up decode and re-places the decoder on the CPU if a GPU gives nonsense). Models/weights are read by the main process (`ss:read`, size +
  SHA-256 verified) and transferred to the Worker; nothing is fetched by the renderer (CSP only gains `'wasm-unsafe-eval'`). The runtime (`ort/*.jsep.{mjs,wasm}`) is
  emitted next to the renderer by a Vite plugin (`electron.vite.config.ts`). Idle: workers are terminated after `idleMinutes` (default 5) or when the tool closes.
- **Brush** (`brushSeg.ts`): geodesic two-class labelling on a <= 720 px working image (edge cost + colour histograms, GrabCut-style re-estimation, morphological clean-up).
- **Edge refinement** (`refine.ts`, `imgops.ts`, in `computeWorker.ts`): coarse signed field (decoder logits / brush) -> bilinear to document pixels -> signed-distance ramp
  -> colour guided filter (He et al.) in a narrow band -> crisp-but-anti-aliased alpha -> Smooth / Shift edge (EDT) / Feather; Decontaminate = normalised colour propagation.
- **Pixels in / out**: only `source.ts` (`getSourceImage(rect, sample)`, `sourceInfo`) reads pixels, in document-space rects (point it at the tiled-canvas region API later).
- **Main process**: `ss:status|read|download|cancel|delete`; downloads use pinned URLs of `models.json` (commit-pinned Hugging Face files), `hostAllowed()` on every redirect hop,
  `.part` files, size + SHA-256 before the file is renamed, a `verified.json` marker. `--enable-blink-features=SharedArrayBuffer` gives the WASM fallback threads.
- Tests: `tests/smartselect.test.ts` (pure maths, prompts, regions, manifest), self-test `BW_SS_TEST=1` (`node scripts/selftest.mjs --out <dir> smartselect`), QA `scripts/qa/qa-smartselect.mjs`.

## Infinite canvas (docs/INFINITE_CANVAS.md)
`doc.kind === 'infinite'`: layer pixels live in a sparse `TileStore` (512 px RGBA8 tiles, `core/tiles.ts` = pure math), painted by the same brush shaders
tile by tile (`gl/brushEngine.ts` `*Inf` paths, `gl/strokeTiles.ts`), shown by the pyramid compositor `gl/infCompositor.ts`, undone through per-tile
snapshots (`doc/pixelEdit.ts`), saved as `.bwk` v2 (`io/bwkInfinite.ts`). Legacy full-texture tools use `doc.readRegion / writeRegion / withRegion`; features that are
not migrated are refused through `doc/infiniteGuard.ts` (menu gate in `ui/registry.ts`). Self-test: `node scripts/selftest.mjs --out <build> infinite`.

## Frame (`features/frame/`)
`model.ts` (pure: presets, rect math, letterbox), `state.ts` (per-document frame in a WeakMap, undoable `editFrame`/`commitFrame`, syncs `clipMask.frame`),
`workRect.ts` (`workRect(app)`, `frameRect(doc)`, `frameEnabled(doc)`), `index.ts` (overlay dim/outline/handles, toggle button, panel, actions, `.bwk` extension),
`exportArea.ts` (export area used by `io/exporters.ts` + `io/frameRender.ts`), `tlCapture.ts` (time-lapse capture of the frame / visible viewport into the recording's
stable `out` size, see `TimelapseRecorder.out`). GPU: `CLIP_CHUNK` has `frameCov(uv)` multiplied into `selCov`; passes whose uv is not the whole canvas give their
document region to `bindClipMask(gpu, prog, region)`.

## Language variants (0.4.0, docs/LANGUAGE_VARIANTS.md)
`features/langvariants/` (`model.ts` pure: language list, commit classification, frame planning, tags; `ops.ts` language-layer operations; `ui.ts` switcher + dialogs; `index.ts` install / persistence / actions).
A language layer is a group flagged `langSet` whose children are paint layers tagged `lang` (LayerProps `langSet` / `lang`); the panel shows it as ONE row. `Document`: `langs`, `viewLang`, `langGhost`,
`activeLayer` resolves a language row to its cell, `writableActive()` creates the cell on the first write, `editLangs`. `gl/compositor.ts`: `StackRenderer.lang` (render as a language; other languages' cells are skipped in `buildOps`),
`Compositor.renderLang / langInf / readFlattened(..., lang)` give a private renderer, tile compositor and surface per language (recordings, exports). The recorder (`animio/timelapse.ts`) classifies commits (`CommitEvent.layerIds`),
plans one frame per affected variant (`planFrames`), requests every composite in one task and tags frames `{v: variants, g: capture group}` in the frame index. `animio/tlVariants.ts` (pure): per-variant schedule input, per-variant edit sets
(edit model version 2), copy edits, thinning, compare-view sync (`panesAt`). `tlCompare.ts` is the compare view.

## Release plumbing (0.3.0)
- **Bundled model.** `resources/models/fast` (MobileSAM, ~45 MB) is not in git. `npm run models` (`scripts/models/fetch-bundled.mjs`, SHA-256 verified, skipped when present,
  `--check` = verify only) runs automatically before `npm run dist` (`predist`) and before the `smartselect` self-test. `npm run build`, `tsc` and `vitest` never need it (the integrity test
  skips when the files are absent), so CI on a clean checkout downloads nothing.
- **Verified saves.** The gallery writes `.bwk` files through `gallery:write` / `gallery:wend` (`main/gallery.ts`): the temp file is re-opened (`main/zipVerify.ts`: central directory,
  every entry inflated, CRC-32 + size compared, on the libuv pool) *before* it replaces the artwork; the previous version is kept as `<id>.bwk~` (hard link) and `GalleryStore.open`
  falls back to it when the current file cannot be read.
- **OS clipboard.** Electron 44's main-process clipboard is the async `ClipboardItem` API (`main/layersIpc.ts`); `features/layers/clipboard.ts` `writeClipboardPng` is the single writer
  (layer copy / copy canvas / smart selection "Copy object"), foreign bitmaps are read as `image/png`.
- **Single instance.** A redundant second launch (`PRIMARY` in `main/index.ts`) only forwards its arguments: it must not wipe `userData/scratch` of the running instance.
- **Packaged QA.** `node scripts/selftest.mjs --exe <WinCreative.exe>` runs every suite against an unpacked build; `BW_EXE=<exe> node scripts/qa/qa-int-pkg.mjs` (scratch lifecycle, kill -9,
  second launch, foreign clipboard), `qa-int-compat.mjs` (v0.1.0 / v0.2.0 fixtures in `tests/fixtures`), `qa-int-stress.mjs` (cross-feature infinite-canvas session), `qa-int-hitch.mjs`.
