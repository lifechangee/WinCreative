# Language variants (0.4.0)

One drawing / time-lapse session yields several language versions of the video (EN, RU, ...). The common artwork is drawn once; the language-dependent
handwriting differs per version and appears progressively in each version's time-lapse like normal drawing.

## The user's workflow
1. Create a canvas (e.g. infinite) with a 1080x1920 frame, draw the common chart on ordinary layers.
2. *Layers panel > Lang.* (or Actions > Add > Language layer) and write the month names in Russian.
3. Press **EN** in the switcher (or `Ctrl+Alt+L`): the Russian writing disappears completely; write the months in English into the same language layer.
4. *Time-lapse* tab: two versions, `EN | RU`, with the same chart but different captions; **Compare versions** shows them side by side; fit each to its
   voice-over; **Export** writes `name.en.mp4` and `name.ru.mp4` in one pass.

## Model
- **Language layer** = a group with `langSet: true` whose children are ordinary paint layers tagged `lang: <code>` (the *cells*). Tiles, masks, undo, save and merge
  keep working because a cell IS an ordinary layer. The panel shows the group as ONE row (`displayRows` never lists cells) with a chip per language
  (filled / empty / current). A language layer cannot contain another one, a cell cannot leave its row and an ordinary layer / group cannot enter it
  (`moveRelative` rules, unit-tested). A language layer inside an ordinary group works.
- **Active target.** The row stays the active layer; `doc.activeLayer` resolves it to the cell of the VIEW language, `doc.writableActive()` creates a missing cell (one
  undo step, type `layer-add`) on the first write: brush / eraser / smudge strokes, ColorDrop fills, paste (the pasted pixels become an empty cell; if the cell exists
  they become an ordinary layer above the row). Cells are created lazily, so a fixed canvas pays memory only for languages that were written.
- **No document switch.** The feature is active exactly when `doc.hasLangLayers`. Without a language layer: no UI, no extra `.bwk` data (the `langvariants`
  extension writes nothing), recordings carry no variant tags, the compositor takes the same path as before.
- **Language list** (`doc.langs`, 2-4 entries `{code, name}`, default `en` English + `ru` Русский): edited in the *New language layer* dialog, the switcher menu (`...`),
  or the `lang.edit` action. Add / rename (the code never changes) / remove, as ONE undo step; removing a language deletes its cells (confirmed when they hold writing).
- **View language** (`doc.viewLang`, saved per document): the canvas shows common layers + the cells of that language; other cells are not rendered at all
  (`StackRenderer.buildOps`). Changing it is NOT a commit and not an undo step. **Ghost** (`doc.langGhost`, off by default): the other languages' cells at 25 %,
  display only - every read (`readFlattened`, recordings, exports, thumbnails, eyedropper, fill / smart-selection sampling) goes through a clean per-language renderer.
- `isEffectivelyVisible` honours the language, so contentBounds, cut-outs etc. follow the view language.

### Row operations
| Operation | Behaviour |
|---|---|
| rename / visibility / opacity / blend / mask | group properties: apply to every language |
| lock / alpha lock | the group AND every cell, one undo step |
| reorder, move in / out of ordinary groups | as for a group |
| duplicate / delete | all cells (a duplicate keeps the `lang` tags) |
| merge down | *language layer onto language layer*: cell by cell (`mergeLangDown`, the upper row's opacity / blend applied); onto anything else: refused with an explanation |
| merge group / flatten all | refused while a language layer is inside (would lose the other languages); **Actions > Flatten into the current language only** (confirm) bakes the shown language |
| copy cell to another language / clear cell | row options view: replaces the target cell (one undo step) / empties one language |
| clipping | not supported for the row (a group cannot clip, as before); cells have no per-cell clipping UI |
| mask | the group mask is shared by all languages (the simplest correct choice) |

## File format additions
- Layer entries of the manifest gain `langSet` (groups) and `lang` (paint layers); old readers ignore them (and show all cells - the file is meant for 0.4.0+).
  `validateManifest` defaults both, so old files load unchanged.
- `extra.langvariants = { langs: [{code, name}], view, ghost? }` - only written when the document has a language layer or non-default language settings; works for bwk v1
  (fixed) and v2 (infinite).
- Recording index (`timelapse/index.json`): per frame optional `v: string[]` (variants; absent = all) and `g` (capture group; frames written by the same capture pass share
  it). `extra.edit` becomes `{v: 2, by: {'*': TlEdit, en: TlEdit, ...}}` when the document has language layers (**edit model version 2**); without them the plain version-1
  model is still written, and a version-1 model is migrated to every variant (copy) on load.

## Recording
- A commit is classified (`classifyCommit`): a pixel commit (stroke, erase, smudge, fill, filter, clear, transform, paste...) whose layers are all cells of ONE language
  affects that variant only; everything else (common layers, props, order, masks, merges, deletes, new / load, language list edits) affects all variants. Multi-layer
  transactions carry `layerIds` (`CommitEvent`), undo / redo reuse them.
- `planFrames`: while no language cell has content -> ONE shared `*` frame (exactly as before). Afterwards: cell commits -> one frame for that variant; common / structural
  commits (and a capture with no commit info) -> one frame per variant. **Dedup:** variants without visible cell content in the capture area are provably identical and
  share ONE frame tagged for all of them.
- Composites are built EXPLICITLY per variant, never from the screen and never with the ghost: fixed canvases render the stack for the language (`Compositor.renderLang`);
  infinite canvases use a tile compositor per language (`langInf`, invalidated by document changes). All variants of one capture are requested in ONE task; the
  GPU command stream snapshots the state at that moment, reading back / JPEG / append happen later, so strokes arriving faster than captures never mix states
  (coalesced commits union their variants; verified by `qa-lang-logic.mjs` section 5).
- Frame area (any canvas): box-downscale on the GPU into the stable output size + fenced PBO read-back (`captureAreaGpu`); no `readPixels` stall, no 2D canvas.
  Frameless infinite canvas ("view" area), language variants only: `InfCompositor.present(view, w, h, target)` draws the screen as that language straight into an out-sized surface
  (flipped into the stored layout by `resample`) - 34 ms -> 0.6 ms per capture for 2 variants (QA, `qa-langqa-view.mjs` compares the frames with a real screenshot: mean diff 0.15). The plain
  recording of a frameless canvas and frames needing letterbox bars keep the 2D-canvas path.
- The history tree (`hideUndone`) is common; undo / redo frames of a cell commit are tagged with the cell's variant. "Hide undone" runs on each variant's own frames
  (`keepForVariant`): an undo frame that re-shows a state deeper than anything the variant showed stays (a harmless duplicate picture).
- Thinning of marathon recordings (3000 frames x number of languages) works per lane (frames with the same tag); every language's edit follows (`remapEditBySurvivors`).

## Time-lapse editor
- `Language version` card: `EN | RU` switcher (own edit model, own undo history per variant), **Copy edits from <language>** (pauses / segments / speed / finale mapped onto the
  frame captured at the same drawing moment - same capture group, else the nearest; the target keeps its own *fit to duration*), per-variant *hide undone*, fit to duration (RU is
  usually longer).
- **Compare versions** (header button; Esc / *Back to editing*): the versions side by side, each pane plays its own schedule and shows its own duration. Sync:
  *by drawing moment* (default; the longest video leads, other panes show their latest frame captured at or before the same moment) or *by video time* (every pane from the same
  second). Play, scrub, frame stepping work in both modes; all lookups are binary searches (`panesAt`, 20 000 frames x 2 variants in well under a second, unit-tested).
- Export dialog: *Versions: All languages / Current language only*; `name.mp4` -> `name.en.mp4`, `name.ru.mp4`; progress per variant + overall; cancel stops the batch.

## Static exports
Image export (PNG / JPG / WebP / TIFF) by Frame / All content / canvas gets **Language: current / all (one file per language, suffix `.en` / `.ru`)**. **Decision:** PSD is always ONE
layered file: every language layer becomes a group holding one layer per language (`Row [EN]`, `Row [RU]`); only the view language's layers are visible, the composite is the view
language. Gallery thumbnails use the view language (never the ghost).

## Other features
Undo / redo, autosave / journal / crash recovery, infinite tiles and paging, frame clipping, selection, smart selection (source = common + view language; the cache key
includes the language), Animation / Page Assist (a language layer is one root element, rendered in the view language), convert fixed <-> infinite (language data travels with the copy) and PSD import
(never creates language layers) all work on the cells as on ordinary layers.

## Measured cost (RTX 3060, i5-10400F, `scripts/qa/qa-lang-perf.mjs`)
40 quick strokes on a common layer, 2 languages with writing, vs the same strokes in a document without a language layer:

| canvas | main-thread ms per capture (baseline -> 2 variants) | frames > 33 ms | frames written | bytes written |
|---|---|---|---|---|
| fixed 3840x2160 | 0.1 -> 0.2 (max 0.2 -> 0.8) | 0 / 0 | 40 -> 80 | x2.5 |
| infinite, 1080x1920 frame | 0.2 -> 0.5 (max 0.4 -> 1.4) | 0 / 0 | 40 -> 80 | x2.3 |

(0.3.0 spent 62 ms - up to 110 ms - per capture on the infinite frame path: a synchronous read-back; the GPU path removes that for every document.) JPEG encoding stays in the Worker.
Storage is ~N x for common commits; writing commits and the shared `*` frames before any writing cost nothing extra; identical pictures are stored once.

## Decisions and limitations
- Cell names are internal (`Row [EN]`); the panel never lists cells. Per-cell visibility / opacity are not exposed (the row's apply to all).
- A language ADDED after variant frames existed starts with the shared `*` frames and its own later frames only (`rec.lateLangs`, saved in the recording's extra); the time-lapse tab shows a warning
  note for that version. A REMOVED language leaves orphan frames that no variant plays.
- Variant recordings of a frameless infinite canvas respect rotation / mirror but use the slower 2D-canvas capture per variant (a frame gives the fast GPU path).
- The implicit creation of a cell (first stroke / fill / paste in a language) is flagged in the history; `Document.undo()` / `redo()` take it together with the stroke that needed it (ONE step; each
  half still emits its own commit event, so the recorder's history mirror stays exact).
- A paste onto a language row whose cell already has writing is an ordinary (common) layer: a toast says so.
- A layer clipped onto a language row is not clipped (clipping onto ANY group is unsupported, as in 0.3.0).
- Verified in the real app by the independent QA (`qa-langqa-*.mjs`): Animation Assist (frame = language row, follows the view language), 3 and 4 language documents end to end (record, switch, export all),
  kill -9 recovery, fast alternating strokes (every frame equals the reference composite of the state it claims). Page Assist and the Reference window use the same readers (not driven separately).
- Self-tests: `node scripts/selftest.mjs --out <build> langvariants` (`scripts/qa/qa-lang-logic.mjs` + `qa-lang.mjs`), perf `qa-lang-perf.mjs`, screenshots `qa-lang-shots.mjs`; unit tests `tests/langvariants.test.ts`.
