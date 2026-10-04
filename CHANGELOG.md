# Changelog

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
