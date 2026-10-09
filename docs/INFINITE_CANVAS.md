# Infinite canvas (core, phase 1)

New canvas > **Infinite canvas** creates a document without bounds. Fixed documents are untouched (same code paths, same shaders with neutral
uniforms, `.bwk` v1). `doc.kind: 'fixed' | 'infinite'`, `doc.isInfinite`.

## Data model
- **Pixels = sparse GPU tiles.** `Layer.tiles: TileStore` (`doc/tileStore.ts`): `Map<tileKey, Surface>` of **512 x 512 RGBA8** tiles, allocated on first
  touch (transparent), freed when fully transparent (`prune`/`emptyAmong`: 3 tiny GPU reduce passes + 1 px readback; run after erase/smudge, region
  writes and before every save). `layer.pixels` is a 1x1 placeholder (as for groups), so legacy code never crashes, it just sees nothing.
- **Why 512 / RGBA8.** 512 px = 1 MB/tile, 2000 tiles = 2 Gpx; a stroke touches 1-4 tiles. RGBA8 is the existing policy for canvases > 6 Mpx and halves
  memory/save cost; dithering on commit keeps soft brushes band-free. Stroke buffers stay RGBA16F (sparse, pooled).
- **Coordinates.** Document space = unbounded signed integers (origin 0,0 = where the first view starts), y down. `core/tiles.ts` (pure, unit-tested):
  `tileKey(tx,ty)` packs +-16.7 M tiles into one safe integer, floor division everywhere, `regionPieces(rect)` = copy plan tiles <-> region.
  `doc.width/height` of an infinite doc is a nominal 4096 x 4096 "frame" for legacy readers; nothing is clipped to it.
- Dab coordinates are made **tile-relative on the CPU** (exact in float32 even at 1e6 px); grain/noise add the tile origin back in the shader (`uOrigin`).
  Dithering uses the tile origin modulo 4096 so it equals a fixed canvas inside 4096 px and stays alive far away.

## Subsystems
- **Brush engine** (`gl/brushEngine.ts`, sparse `StrokeTiles` A/B/C + `SurfacePool`): every dab batch is bucketed per tile and drawn into that tile's
  stroke buffer with the same shaders (MAX coverage, dual brush, wet edge, burnt, alpha lock...). Commit bakes each touched tile (one undo step).
  Smudge / wet mix assemble the dab's region from tiles into a scratch and draw the dab into every tile it touches; direct-blend brushes use the
  edit's per-tile snapshots as base. Measured: identical to a fixed canvas (<= 2 levels, see QA below), no seams.
- **Compositor** (`gl/infCompositor.ts`): one composite per tile built with the same `StackRenderer` passes (all 26 blend modes, pass-through/isolated
  groups, clipping, alpha lock, live stroke). A **pyramid** (level k = 2^k doc px per texel, exact 2x2 box downsample, 2 px gutters for seam-free
  filtering) keeps the screen pass at <= ~100 tile draws at any zoom and shimmer-free; lazy, scissored rebuilds (16 tile composes/frame budget), LRU.
  Background = solid colour (+ optional dot grid), no page border.
- **Undo** (`doc/pixelEdit.ts`): per-tile snapshots; a tile that did not exist is saved as `null`, so allocate/free is undone exactly; undo/redo swap
  surface objects (no GPU copy).
- **Save/load** (`io/bwk.ts`, `io/bwkInfinite.ts`): manifest `version 2`, `kind:'infinite'`, `infinite:{tileSize,view,grid}`, per layer `tiles:[[tx,ty]..]`,
  files `layers/<id>/<tx>_<ty>.png`. Fixed docs still write v1; readers accept 1 and 2. Save (`io/bwkSaveInf.ts`): saved PNGs of clean and evicted tiles are reused byte for byte, dirty tiles are batch-read and encoded in
  parallel, the zip is streamed (`SaveOptions.sink`; the gallery pipes it into the file via `gallery:wchunk`) so a big document is never one buffer. Load (`io/zipIndex.ts`):
  the central directory is indexed and every tile becomes a zero-copy cold tile - opening costs the manifest + thumbnail and tiles stream in viewport-first. Incremental saves
  re-encode only tiles whose `Surface.rev` changed. Crash journal: one patch per touched tile (`x,y` = tile origin; empty PNG = "tile freed"). Gallery thumbnail = fit of the content bounds.
- **View**: unbounded pan/zoom/rotate; `app.fit()` = `app.fitContent()` (tight bounds), `app.goToOrigin()`, HUD (centre x/y + zoom), `doc.infinite.grid`.
- **Memory (tiers)**: `doc/tileMemory.ts` + `doc/tileStore.ts` + `doc/tileBudget.ts` (pure policy). A tile is *resident* (GPU surface), *clean* (resident + a valid saved PNG,
  so evicting it is free) or *cold* (only its PNG: in RAM, or in `userData/scratch/<docId>/` through `main/scratch.ts` once the RAM budget is exceeded; the folder is wiped at
  every app start and when the document closes - the .bwk stays the only source of truth). Budgets come from the device (`deriveBudget`: ~15 % of `navigator.deviceMemory`,
  clamped 384 MB..1.25 GB GPU; compressed RAM 256 MB..1 GB; a low `MAX_TEXTURE_SIZE` caps the GPU at 512 MB) with a Prefs override (Preferences > Advanced > Tile memory,
  `localStorage bw.tileMem`). LRU stamps (`tileClock`, advanced each presented frame) pick victims older than 2 frames; dirty victims are read back several per readback
  (vertical atlas, one PBO, raw premultiplied bytes) and encoded by the codec Worker pool (`io/tileIo.ts`, `io/tileWorker.ts`; the straight-alpha conversion is exact integer
  math, so evict -> restore is bit exact). Undo snapshots (`SnapEntry`) take part: a tile captured / removed while cold stays a blob (no decode); old snapshots count as 600
  frames older and go first. Restore is transparent: every accessor (`get/getKey/ensure/take/...`) restores synchronously; the compositor never does - it calls
  `tileMemory.prefetch` (decode in Workers, <= 3 uploads / 4 ms per slice, nearest to the view first) and meanwhile shows the nearest coarser pyramid composite (levels >= 3
  are sticky). `TileStore.map` holds RESIDENT tiles only - iterate `keys()` and use `getKey` / `peekKey`. Canvas Information shows tiles in GPU / compressed / on disk.

## Extension API for the next phase
```ts
doc.readRegion(layer, rect): Surface                  // new surface (layer fmt), tiles assembled; caller disposes
doc.writeRegion(layer, rect, surface, {undoLabel,type}) // allocate/free tiles, ONE undo step + commit event
doc.withRegion(layer, rect, (surface, rect) => ..., opts) // assemble -> tool works as on a fixed layer -> commit back
doc.readRegionPixels(layer, rect): Uint8ClampedArray  // straight RGBA8
doc.contentBounds({tight?, visibleOnly?}): Rect|null  // tile union, or exact pixels (cached per tile rev); layer.tiles.bounds()/tightBounds()
compositor.readFlattened(rect, scale?, withBackground?) -> {px,w,h,rect}   // any doc rect, pyramid for scale < 1
doc.beginPixelEdit(layer,label) -> edit.save(rect) | edit.saveKey(key) | edit.removeKey(key) | edit.finish()   // tiled "before" snapshots
notAvailable() / blockedMenuItem(menu,id) / ACTIONS_BLOCKED (doc/infiniteGuard.ts) // toast "Not available on infinite canvas yet"
```
Rules: never assume `0..width`; allocate GL objects BEFORE binding textures for a draw (a new texture rebinds the active unit and can alias a sampled
unit = feedback loop = dropped draw); selections are ignored on infinite docs (`clipMask.off`).

## Tool / feature status (what the next agents migrate)
| Status | Items |
|---|---|
| **works** | Brush, Smudge, Eraser (all brush kinds), QuickShape, layers (add/delete/duplicate/clear/reorder/group/opacity/blend/clip/alpha lock/visibility), undo/redo, save/open/autosave/journal, gallery, eyedropper (both), PNG/JPG export (content bounds), Canvas Information, view tools, flip view, project canvas |
| **work-rect** | interactive Adjustments in Layer + Pencil mode, Liquify, Clone (`features/adjustments/session.ts`): run on a temporary surface = `workRect(app)` (frame, else visible area, <= 6144 px, padded for blur reach), written back with ONE undo step; the bar shows "Limited to ...". Pixel-local colour adjustments (HSB, Color Balance, Curves, Gradient Map, Recolor, Invert, Desaturate) preview in the work rect but Apply runs over EVERY tile. Text layers (tiles + `.bwk` v2), Drawing Guides / Assist / Symmetry (grid origin, vanishing points, symmetry centre placed at the frame / view centre on first enable, draggable), Reference window (frame or content bounds) |
| **tile-wise** | Selection (all modes) + Transform + ColorDrop / Fill layer / Recolor + layer ops (see *Selection, transform, fill, layer ops* below) |
| **region-limited** | legacy `readFlattened(bool)` (content bounds, <= 4096 px) |
| **frame** | time-lapse recording (frame area, else the visible screen; per-frame source rectangle stored in the recording index) |
| **bridge (frame, else content bounds)** | PSD export (layers, groups, blend modes), layer PNG / layers PDF export, one-page PDF, copy canvas (`withWorkDoc` in `features/infinite/convert.ts` runs bounded-canvas code on a temporary fixed copy); *Convert to fixed canvas...* (frame / content bounds / custom rect) and *Convert to infinite canvas* - both create a NEW gallery artwork ("duplicate as"; the original is never modified, safer than an in-place cross-kind undo); flip canvas (pixels around the work-rect centre, one undo step); colour-profile convert (tile by tile); gallery card ("Infinite" + content size; thumbnail of the frame, else the content) |
| **frame-bound** | Animation Assist and Page Assist work *inside the frame* (`io/frameRender.ts` renders the roots over a temporary fixed copy of the frame rectangle: thumbnails, onion skins as tile ghosts, GIF / MP4 / PNG-sequence / page PNG / PDF exports use the frame size). Without a frame the menu item offers *Create frame* (`features/frame/needFrame.ts`); PSD *import* opens as a fixed canvas, as before |

## Selection, transform, fill, layer ops (tile-wise)
**Selection mask = a movable bounded WINDOW.** `SelectionService.data` / the GPU texture cover `win` (document rect, `svc.window`; on fixed docs always the whole canvas, so
old consumers see exactly what they saw before). The first selection allocates a window around it (+64 px); extending the selection grows the window with a margin
(max(256, 25 %)), a much smaller selection shrinks it again; the window is limited to 8192 px per side (`MAX_SEL_WINDOW`, toast). Outside the window coverage is 0.
Why a window and not a sparse tile mask: every CPU algorithm (polygon AA, flood fill, blur, bounds) keeps working on one contiguous buffer, the GPU side needs ONE texture
and the shaders one extra mapping; the cost is the 8192 px limit, which is far above any real selection (workRect is <= 8192 too).
- Shaders: `gl/clipMask.ts` `bindClipMask(gpu, prog, ctx)`, `ctx = {x, y, w, h}` = document position of the pass' pixel (0,0) and the size `uv` is normalised by (a tile pass: tile
  origin + 512). `setClipCtx` re-targets one program to the next tile. A pass on an infinite doc without ctx ignores the selection. Brush commit/live preview, smudge/wet-mix,
  direct-blend brushes, filters, layer ops and the selection actions all pass tile contexts, so clipping is seamless across tile borders.
- Define: *select all* = `workRect` (frame, else visible area); *invert* = work rect (+ current bounds) minus the selection; the magic wand reads the work rect around the
  seed (<= 6144 px; "limited" toast when the region touches its border); rectangle/ellipse/freehand are unbounded (window-limited).
- Public API (backward compatible): `mask/hasSelection/bounds/onChange/coverageAt/applyPatch/setFromFull/begin/selectAll/clear/invert` as before; NEW: `window`, `readRect(rect)`,
  `coverageRegion(rect): Surface|null` (rect-sized RGBA8, coverage in .r - adjustments/liquify/clone), `grant(rect)`, `setFromRegion(rect, data, label)` (use this instead of
  `setFromFull` on infinite docs; `setFromFull` means the nominal 0..width x 0..height rect), `allRect()`. Patches given to `applyPatch` use document coordinates (any sign).
  `data` is window-sized: index it with `win`, or use `readRect`.
- Saved selections (`saveCurrent/load`) are rect-addressed snapshots and persist in the `.bwk` extension `selections`; the active selection is not persisted (as on fixed docs).
- **Transform**: the source (selection bounds or the layer's tight content bounds) is read through the region API in chunks (<= 4096 px incl. halo; one chunk in practice), the live
  preview is written straight into the layer tiles through `doc/tileEdit.ts` `LiveTileEdit` (snapshot on first touch, restore before each re-render, prune + ONE undo step on commit,
  exact cancel). Destination tiles can be anywhere and are allocated on demand. Hard limit: a destination that would touch > 2500 tiles is not drawn (toast).
- **ColorDrop / Fill layer / Recolor**: flood fill runs on `workRect(app)` around the seed (<= 4096 px), seed outside it -> toast; reaching the border shows "Fill limited to
  frame/visible area" once; reference layer honoured; live threshold drag uses `LiveTileEdit`. *Fill layer* fills the work rect (or the selection).
- **Layer masks** (`doc/maskStore.ts`): `layer.mask` is a 1x1 placeholder Surface that owns a `MaskTileStore` (`surface.inf`); missing tiles read as `layer.maskFill` (1 = visible),
  new tiles are initialised to it. Painting on the mask uses the normal brush tile path (`layer.editTiles`), the compositor resolves the mask tile per tile (`gpu.white` for absent
  tiles), invert / clear / reveal swap the mask structurally (one undo step), apply runs per tile, duplicate clones the store, persistence = `.bwk` extension `infmasks`
  (`infmask/<layer>/<tx>_<ty>.png`). Limit: smudge/wet-mix directly on a mask tile that does not exist yet starts from black.
- **Merge down / group / flatten** render tile by tile with the normal `StackRenderer.renderTile` (all blend modes, groups, clipping, masks). **Insert image / paste / PSD** split the
  bitmap into tiles at the view centre (any size). **Copy / cut / copy merged / Select (alpha -> selection) / duplicate selection** work on the selection bounds. Layer thumbnails
  are rendered tile by tile over the whole content bounds.
- Limits: selection window 8192 px; wand/fill area 6144 / 4096 px; clipboard copy of > maxTexture px is cropped; mask tiles are not paged out by the memory manager.

## Memory API (additions)
```ts
tileMemory.budget / configure(gpu, override?) / tick() / stats() / residentBytes()    // doc/tileMemory.ts
tileMemory.prefetch(store, key, prio) / settle()                                       // async restore (smaller prio first)
store.getKey / get / ensure / take / put / free                                       // transparent (sync restore if cold)
store.peekKey(key) / isCold(key) / hasKey(key) / touch(key) / count / residentCount / coldCount
store.savedOf(key) / attach(...) / putCold(key, saved) / takeAny(key)                  // saved-PNG tier primitives
SnapEntry.capture / takeFrom / giveTo / dispose                                        // undo snapshots (doc/tileMemory.ts)
writeInfiniteZip(doc, files, late, sink, check)                                       // io/bwkSaveInf.ts
infiniteToFixed(gpu, doc, rect) / fixedToInfinite(gpu, doc) / withWorkDoc(app, fn)     // features/infinite/convert.ts
```

## Frame (features/frame)
One frame per document (`FrameData`: x, y, w, h, `enabled` = clip + dim, `visible` = outline while off), stored in the `.bwk` extension `frame`, undoable.
- **UI**: top-bar button (frame icon, accent = clipping ON, dot = a frame exists; click = toggle, or the presets panel when there is none; right-click / long-press = panel),
  `panel.ts` (presets grid, W x H + aspect lock, dim opacity, move / resize on canvas, centre on content, fit view, remove). On-canvas overlay: dim, crisp border, size label,
  16 px handles with a 26 px pick radius, *Done* pill at the top centre, Esc / Enter ends editing; correct under any pan / zoom / rotation / mirror.
- **Clipping**: `clipMask.frame` (shaders: brush, fill, filters, adjustments over every tile) x selection; pasted / inserted / PSD / smart cut-out pixels go through
  `clipImageToFrame` inside `layers/ops.ts layerFromImage`.
- **Time-lapse**: every recorded frame stores the document rectangle it shows (`r: [x, y, w, h]` in the recording index, saved with the `.bwk`); the frames themselves are
  letterboxed into one stable output size.
- **Animation / Page Assist on an infinite canvas**: see the status table; `requireFrame` (needFrame.ts) offers *Create frame* when there is none.
- Actions (bindable, QuickMenu slots, shortcut editor): `frame.toggle` (Ctrl+Shift+F), `frame.edit`, `frame.fit`, `frame.show`.
- QA: `node scripts/selftest.mjs --out <build> frame` (42 checks incl. compose, paste, time-lapse rect, assists), `scripts/qa/qa-polish.mjs <scenario> [--lang ru] [--size 1920x1080]`.

## QA
`node scripts/qa/qa-inf-seams.mjs` (fixed vs infinite, offsets +-49152), `qa-inf-core.mjs dirs undo save kill zoom mem perf`, `node scripts/selftest.mjs
--out out-inf infinite`, `npx vitest run tests/infinite.test.ts`. Known pre-existing fixed-canvas artefact: smudge / wet-mix dab quads write stale scratch texels at
their corners (the infinite path assembles the whole quad, so it is cleaner than the fixed reference).
