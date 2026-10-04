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
