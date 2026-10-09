# Changelog

## 0.4.0 - 2026-10-09

First public release after 0.2.0 (versions 0.3.0 and 0.3.1 were not published separately; their changes are included below).

### Language variants and time-lapse

* Language variants: one drawing session yields one time-lapse video per language. A language layer is one row in the layers panel with one writing (cell) per language; ordinary layers are common to all languages. A language switcher (EN | RU) appears at the top of the panel as soon as the document has a language layer (Ctrl+Alt+L cycles); the other languages are hidden completely (optional faint ghost, display only). The language list (2-4 languages) is editable. Documents without a language layer behave exactly as before.
* Recording per language: common commits are recorded once per language, writing only for its own language; frames are stored once when the pictures are provably identical. Frame and canvas captures now run on the GPU with an asynchronous read-back (no frame hitch while recording, also for a single language).
* Time-lapse editor: language switcher with an own edit model per version (speed, pauses, segments, fit to duration, finale, hide undone), "Copy edits from <language>", and Compare versions: the versions side by side, synchronised by drawing moment or by video time.
* Export: all language videos in one pass (name.en.mp4, name.ru.mp4; MP4 / HEVC / WebM / GIF), or the current language only; image exports can write one file per language; PSD keeps every language as layers.
* Tutorial lesson "Two languages, one drawing"; new actions in the shortcut editor and QuickMenu (next / previous language, new language layer, ghost).
* Fixed: a frame created right after a new canvas now gives a recording of the frame's shape instead of a square one.
* Language variants polish: the shown language is part of the window title, creating a language layer brings the layers panel back (the switcher lives there), undoing a first stroke in a language also removes the empty cell it created (one step), Esc closes only the topmost dialog, a ghost on the screen never reaches the eyedropper, a language added after recording started is flagged in the time-lapse tab, frameless infinite canvases record language variants on the GPU (34 ms -> 0.6 ms per capture).
* Time-lapse: every recorded frame now shows exactly the state it is tagged with, also when the window is hidden or minimised; plain frameless infinite canvases record on the GPU too. Fixed an occasional "No time-lapse recording" autosave error after resetting a recording (canvas resize / crop). The Time-lapse tab opens on the language the canvas shows; the Russian layer-count label stays on one line; the Clipping Mask item is off above a group or language row (with a tooltip) instead of doing nothing.
* Files stay compatible: older files open unchanged; files without language layers are written exactly as before.

* Time-lapse recording no longer causes a pause after each stroke when a frame is enabled or on a frameless infinite canvas (asynchronous capture).

### Infinite canvas, frame, smart selection, saves and recovery (0.3.0)

* Infinite canvas: new canvas type chosen when creating a canvas; paint in any direction without bounds; layers stored as sparse tiles; distant tiles are paged out of GPU memory automatically; fast incremental saving; "Convert to fixed canvas" / "Convert to infinite canvas" (creates a copy).
* Frame: one frame per document with presets (9:16, 16:9, 1:1, 4:5, A4, custom); toggle while drawing (Ctrl+Shift+F); when on, strokes and fills are clipped to the frame; defines the time-lapse area and the export area; on an infinite canvas without a frame the time-lapse records the visible screen area.
* Smart selection: select an object in an imported picture with one click (on-device neural network, works offline, nothing is uploaded); modes switch inside the tool: AI Fast (MobileSAM, bundled), AI Precise (SAM 2.1, optional ~176 MB download), Brush without AI; edge refinement; actions: cut to new layer, copy to new layer, remove background (layer mask), copy object to clipboard.
* Fixed: Clone adjustment discarded its result on Apply.
* Fixed: clipboard copy/paste of images and selections.
* Verified saves: every save is written to a temporary file, read back and checked before it atomically replaces the artwork; the previous version is kept as a `.bwk~` backup and used automatically if the main file is unreadable.
* Crash recovery: local crash dumps; if the renderer crashes or the graphics context is lost, the app reloads itself and restores the last artwork with a notice.

## 0.2.0

* Time-lapse editor: hide undone actions, pauses, flexible/per-segment speed, fit to duration, finale.
* Cursor jitter fix.
* Russian localization of all modules (English/Russian UI, live switching) and a localization audit.
* Interactive tutorial: 13 lessons, gestures and pen guide, tips.
* Renamed to WinCreative; settings from earlier builds are migrated.
* Unified viewport resize, window state persistence, page zoom locked to 1.
* Gallery thumbnail fixes (blob URLs allowed by the CSP, de-duplicated thumbnails).
* Published under AGPL-3.0-or-later; the About dialog shows version, license and source link; third-party notices added.

## 0.1.0

Initial development version.

* Painting engine on WebGL2 with a brush engine, 106 anti-aliased brushes and Brush Studio.
* Layers with blend modes, masks and groups; adjustments (including Liquify and Bend warp); selection and transform.
* Drawing guides with snapping, symmetry, QuickShape; text; animation assist; time-lapse recording and MP4 export.
* Full pen and touch support: pressure, tilt, eraser, barrel buttons, gestures.
* PSD import/export (text and adjustment layers on import), colour profiles.
* Non-blocking asynchronous save with a crash journal, stroke-loss fixes, stroke-tip prediction.
