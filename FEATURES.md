# Procreate (5.x, 2025-2026) Feature Checklist

> Internal parity checklist for WinCreative. It mentions Procreate only factually, to track which features have been implemented. WinCreative is an independent project, not affiliated with or endorsed by Savage Interactive; "Procreate" is a trademark of Savage Interactive Pty Ltd.

Source: Procreate Handbook (help.procreate.com/procreate/handbook), plus background knowledge where a page was not fetched (marked "verify" where uncertain).
Pen mapping used throughout: Apple Pencil pressure = pen pressure; tilt/azimuth = pen tiltX/tiltY; Pencil Pro barrel roll = pen barrel rotation/twist; Pencil eraser end = pen eraser; Pencil double-tap/squeeze = pen side/barrel buttons; hover = pen proximity/hover.
"(N/A on Windows - skip)" = do not implement.

## 1. Interface
- [x] Canvas viewport — central drawing area; pan/zoom/rotate; neutral dark surround
- [x] Gallery button (top-left) — Gallery menu / Ctrl+Alt+G returns to the Gallery; the artwork is auto-saved first
- [x] Actions button (wrench) — opens Actions popover (Add, Canvas, Share, Video, Prefs, Help)
- [x] Adjustments button (magic wand) — opens Adjustments list
- [x] Selection button (S) — opens Selection tool bar
- [x] Transform button (cursor arrow) — opens Transform on selection or layer
- [x] Paint tool (brush icon) — tap opens Brush Library for paint brush
- [x] Smudge tool (finger icon) — tap opens library; has its own brush, size and opacity
- [x] Eraser tool — tap opens library; has its own brush, size and opacity
- [x] Layers button — toggles Layers panel
- [x] Color button (circle showing current color) — toggles Color panel
- [x] Brush Size slider (left sidebar, top) — vertical slider with size preview bubble
- [x] Brush Opacity slider (left sidebar, bottom) — vertical slider with percentage bubble
- [x] Modify button (sidebar square) — held while using a tool to act as eyedropper/modifier per gesture prefs
- [x] Undo / Redo buttons (sidebar) — step through history
- [x] Fine slider control — grab slider, drag horizontally away from track for finer resolution
- [x] Sidebar side swap — Prefs "Right-hand interface" moves sidebar right
- [x] Light / dark interface toggle — Prefs
- [x] Hide interface (full screen) — four-finger tap or hotkey; repeat to restore
- [x] Canvas rotation snapping — snaps near 0/90/180/270 degrees; toggle in Prefs
- [x] Zoom/rotation HUD — transient overlay showing zoom % and angle while pinching
- [x] Toast confirmations — brief on-canvas text (e.g. "Layer cleared", "Copied")
- [x] Popover dismissal — click outside closes panels
- [x] Undo history — deep undo/redo (up to ~250 steps, limited by canvas size)
- [x] Brush cursor outline — shows brush size/shape at pointer; modes None, Contrast, Active Color
- [x] Accessibility — high-contrast, larger UI text, reduced motion options
- [ ] Widgets — (N/A on Windows - skip)

## 2. Gestures (touch; mouse/keyboard alternates in Section 3)
- [x] One-finger draw — paints/smudges/erases with active tool
- [x] Pinch — zoom
- [x] Pinch + twist — rotate canvas
- [x] Two-finger drag — pan
- [x] Quick pinch — fit canvas to screen (and reset rotation)
- [x] Two-finger tap — undo one step
- [x] Two-finger tap and hold — rapid repeated undo
- [x] Three-finger tap — redo one step
- [x] Three-finger tap and hold — rapid redo
- [x] Three-finger scrub (side to side) — clears current layer contents (respects selection)
- [x] Three-finger swipe down — opens Copy/Paste menu
- [x] Four-finger tap — toggle full screen (hide UI)
- [x] Draw + hold at stroke end — activates QuickShape (hold delay in the QuickShape & StreamLine panel)
- [x] Long-press canvas — eyedropper (delay configurable)
- [x] Pinch two layers together in Layers panel — merges them (two fingers on two rows moving together)
- [x] Tap layer — make primary selected layer
- [x] Swipe layer right — add to multi-selection (secondary)
- [x] Two-finger tap layer — opacity slider popup
- [x] Two-finger swipe layer right — toggle Alpha Lock
- [x] Two-finger tap-and-hold layer — select layer contents (creates selection)
- [x] Swipe layer left — Lock, Duplicate, Delete buttons
- [x] Long-press layer + drag — reorder / move into groups
- [x] Hover pinch (Pencil) — while the pen hovers, Shift + move sideways changes brush size (Preferences > Pen & Buttons > Hover size / opacity)
- [x] Hover slide (Pencil) — while the pen hovers, Ctrl+Shift + move sideways changes opacity
- [x] Touch-vs-pen discrimination — option to disable touch drawing

## 3. Keyboard shortcuts and QuickMenu
- [x] Undo / Redo — Ctrl+Z / Ctrl+Shift+Z
- [x] Cut / Copy / Paste — Ctrl+X / C / V
- [x] Select all / Deselect / Invert selection — Ctrl+A / Ctrl+D / Ctrl+I (assign)
- [x] Zoom in/out/fit — Ctrl+= / Ctrl+- / Ctrl+0; mouse wheel zoom
- [x] Pan — Space+drag
- [x] Rotate canvas — R+drag
- [x] Brush size down/up — [ and ]
- [x] Opacity down/up — Shift+[ and Shift+]
- [x] Tool switch — B paint, S smudge, E erase
- [x] Eyedropper — hold I (or Alt) to sample
- [x] Toggle Layers / Color / Brush panels — L / C / hotkey
- [x] New layer, delete layer — hotkeys
- [x] Transform — Ctrl+T
- [x] Hide UI — Tab
- [x] Modifier keys — Shift constrains aspect (uniform scale), Alt scales from the centre in Transform
- [x] Keyboard shortcut editor — assign/reassign combos to actions
- [x] Shortcut cheat sheet — hold a key to display list
- [x] QuickMenu — summoned by configured gesture, pen button or hotkey; shows 6 slots
- [x] QuickMenu customization — each slot assignable to any action (Copy/Paste, Flip, Add Text, Clip, Group, Merge, Lock, Invert etc.)
- [x] Multiple QuickMenus — up to 5 menus, cycled via center button
- [x] QuickMenu trigger — configurable in Gesture Controls

## 4. Copy/Paste menu
- [x] Cut — remove selection/layer content to clipboard
- [x] Copy — copy selection/layer
- [x] Copy All — copy composite of visible layers
- [x] Duplicate — copy & paste selection into new layer in place
- [x] Cut & Paste — move selection to new layer in place
- [x] Paste — paste clipboard as new layer and enter Transform
- [x] Paste external image — OS clipboard bitmap becomes layer
- [x] Menu trigger — three-finger swipe down or shortcut

## 5. Gallery
- [x] Artwork grid — thumbnails, newest first, manual drag reordering
- [x] Stacks — drag artwork onto artwork to create a stack; rename; drag out to remove; ungroup
- [x] Select mode — multi-select for share/duplicate/delete/stack
- [x] New canvas (+) presets — Screen Size, Square, 4K, A4, 4x6 Photo, plus user presets
- [x] Custom canvas — width, height, units (px/in/cm/mm), DPI, shows resulting max layer count
- [x] Custom canvas color profile — sRGB / Display P3 / Adobe RGB picker (RGB only; CMYK is not supported), tag embedded as ICC in exports
- [x] Custom canvas time-lapse settings — recording quality (Max/HD/Small) is applied to the new canvas recorder
- [x] Custom canvas background color and name
- [x] Save/edit/delete custom canvas presets
- [x] Import (file or photo) — open image, PSD, .procreate; creates canvas sized to image
- [x] Preview — long-press/tap opens preview with layers and info (size, layer count, time-lapse length)
- [x] Rename artwork — tap title
- [x] Duplicate artwork
- [x] Delete artwork — with confirmation (implement Recycle Bin rather than permanent)
- [x] Share artwork — export dialog (Section 38)
- [x] Swipe-left quick actions — Share, Duplicate, Delete
- [x] Search / sort — by name or date
- [x] Autosave — every stroke committed; no manual save
- [x] Reopen last artwork on launch
- [x] Sample artworks — starter content
- [x] File types recognized — .bwk, .procreate, images (PNG/JPEG/TIFF/WebP/GIF/BMP), PSD, .brush/.brushset/.abr, .swatches/.ase, fonts (.ttf/.otf/.woff), .icc — all routed from the Gallery Import

## 6. Brush tools and library
- [x] Brush Library — set list at left, brushes at right with stroke preview
- [x] Default sets — ship starter sets (Sketching, Inking, Drawing, Calligraphy, Painting, Artistic, Airbrushing, Textures, Abstract, Charcoals, Elements, Spraypaints, Touchups, Vintage, Luminance, Industrial, Organic, Water, Retro); content is data
- [x] Recent set — auto-tracks last-used brushes
- [x] New set / rename / duplicate / delete / share / reorder sets
- [x] Reorder brushes by drag; drag to other set
- [x] Brush search
- [x] Select brush — tap; each of Paint, Smudge, Erase remembers its own brush
- [x] Optional linking — Smudge/Erase use Paint brush (Prefs "link" toggle) (toggle in the brush library footer, stored in localStorage `bw.linkBrushTools`; `AppState.linkBrushTools` for a Prefs UI)
- [x] Swipe brush left — Share, Duplicate, Delete
- [x] Open Brush Studio — tap the already-selected brush, or new (+)
- [x] Import brush — .brush, .brushset (and .abr basic) (Procreate .brush/.brushset and Photoshop .abr sampled tips are best-effort readers: formats are undocumented and were only tested with synthetic files; own .bwbrush/.bwbrushset round-trip exactly)
- [x] Export brush / set
- [x] Reset default brushes
- [x] Size/opacity per tool — sliders clamped by brush Properties min/max
- [x] Smudge tool — drags existing pixels of current layer using brush shape and Smudge Pull
- [x] Erase tool — removes alpha (or paints mask black on a mask); respects selection and alpha lock
- [x] Pen eraser end — auto-switches to eraser
- [x] Pen side button actions — configurable (eraser toggle, eyedropper, undo, QuickMenu, previous tool) (implemented by the input layer / Prefs)
- [x] Apple Pencil double-tap / squeeze — mapped to pen buttons (Windows: mapped through the pen barrel buttons in Prefs)

## 7. Brush Studio: structure
- [x] Brush Studio window — section list, detail panel, drawing pad
- [x] Drawing pad — test scribble area with clear
- [x] Live preview strip of stroke or stamp
- [x] Sections — Stroke Path, Stabilization, Taper, Shape, Grain, Rendering, Wet Mix, Color Dynamics, Dynamics, Apple Pencil (Pen), Properties, Materials (N/A), Preview, About this brush (Materials shown as N/A; Dual Brush is an extra section)
- [x] Modified-section indicator badges
- [x] Done / Cancel — commit or discard changes
- [x] Reset brush and Create new reset point (About section)
- [x] Brush file — all parameters + shape/grain images serializable

## 8. Brush Studio: Stroke Path
- [x] Spacing — distance between stamps as % of size; high = dotted
- [x] Spacing Jitter — random variation of spacing
- [x] Jitter Lateral — random offset perpendicular to stroke
- [x] Jitter Linear — random offset along stroke
- [x] Fall Off — fades stroke from full opacity to invisible along its length
- [x] Fall Off distance/persistence controls

## 9. Brush Studio: Stabilization
- [x] StreamLine Amount — 0-100% lag-smoothing of stroke
- [x] StreamLine Pressure — smooths pressure variation during streamline
- [x] Stabilization Amount — moving-average smoothing dependent on speed
- [x] Motion Filtering Amount — smoothing without averaging (keeps corners)
- [x] Motion Filtering Expression — restores expressiveness lost to filtering

## 10. Brush Studio: Taper
- [x] Pressure Taper slider — start/end taper for pen strokes (two tips)
- [x] Link Tip Sizes — same taper both ends
- [x] Taper Size — how thin the ends get
- [x] Taper Opacity — how transparent the ends get
- [x] Taper Pressure — taper reacts to pressure
- [x] Taper Tip — sharp to chunky end shape
- [x] Tip Animation — preview toggle
- [x] Touch Taper — same controls for finger/mouse input
- [x] Classic Taper — legacy behavior toggle

## 11. Brush Studio: Shape
- [x] Shape Source — import (file/photo/library), draw, or edit 1:1 grayscale shape; invert
- [x] Input Style — Touch, Azimuth, Azimuth + barrel roll
- [x] Rotation — static (0) to follows-stroke (100)
- [x] Azimuth orientation — shape follows pen azimuth
- [x] Barrel roll orientation — shape rotates with pen twist
- [x] Scatter — random rotation per stamp
- [x] Count — 1-16 stamps per point
- [x] Count Jitter
- [x] Randomized — random rotation at stroke start
- [x] Flip X / Flip Y
- [x] Roundness graph — base angle and squash handle
- [x] Pressure Roundness
- [x] Tilt Roundness
- [x] Roundness Jitter — vertical and horizontal
- [x] Shape Filtering — None, Classic, Improved

## 12. Brush Studio: Grain
- [x] Grain Source — import/draw/edit grayscale tile; invert
- [x] Moving vs Texturized — drags with stroke vs fixed to canvas
- [x] Movement — drag amount (Moving)
- [x] Scale
- [x] Zoom — Cropped (follows brush size) vs fixed
- [x] Rotation — grain angle/smear along stroke
- [x] Depth — texture contrast strength
- [x] Depth Minimum
- [x] Depth Jitter
- [x] Offset Jitter — random grain position per stroke
- [x] Grain Blend Mode — Multiply, Subtract, Darken, Linear Burn, Color Burn, Lighten, etc.
- [x] Brightness
- [x] Contrast
- [x] Grain Filtering — None, Classic, Improved
- [ ] Grain follows camera — (3D only, N/A on Windows - skip)

## 13. Brush Studio: Rendering
- [x] Rendering Mode — Light Glaze, Uniformed Glaze, Intense Glaze, Heavy Glaze, Uniform Blending, Intense Blending
- [x] Flow — paint amount per stamp
- [x] Wet Edges — pigment pooling/bleed at edges
- [x] Burnt Edges — darker overlaps at stroke edges
- [x] Burnt Edges Mode — blend mode for the darkening
- [x] Brush Blend Mode — blend mode of whole stroke
- [x] Luminance Blending — blend lightness only (approximated with the Luminosity blend of the stroke)
- [x] Alpha Threshold — hard-cut alpha to opaque/transparent
- [x] Classic Normal Combine Mode — legacy dual-brush combine toggle

## 14. Brush Studio: Wet Mix
- [x] Dilution — water-to-paint ratio; more = translucent and mixes more
- [x] Charge — paint load on brush
- [x] Attack — paint adhesion to canvas
- [x] Pull — drag strength of existing paint
- [x] Grade — texture chunkiness in mixing
- [x] Blur — blur mixed strokes
- [x] Blur Jitter
- [x] Wetness Jitter

## 15. Brush Studio: Color Dynamics
- [x] Stamp Color Jitter — Hue, Saturation, Lightness, Darkness, Secondary Color (per stamp)
- [x] Stroke Color Jitter — Hue, Saturation, Lightness, Darkness, Secondary Color (per stroke)
- [x] Pressure Color — Hue, Saturation, Brightness, Secondary Color
- [x] Tilt Color — Hue, Saturation, Lightness, Secondary Color
- [x] Barrel Roll Color — Hue, Saturation, Lightness, Secondary Color
- [x] Secondary color source — Color panel secondary swatch

## 16. Brush Studio: Dynamics
- [x] Speed Size
- [x] Speed Opacity
- [x] Speed Spacing
- [x] Jitter Size
- [x] Jitter Opacity

## 17. Brush Studio: Apple Pencil (pen)
- [x] Pressure Graph — editable curve for all pressure-driven settings
- [x] Pressure Size
- [x] Pressure Opacity
- [x] Pressure Flow
- [x] Pressure Bleed
- [x] Tilt Graph — trigger angle 0-90 degrees
- [x] Tilt Opacity
- [x] Tilt Gradation — soft shading when pen is tilted
- [x] Tilt Bleed
- [x] Tilt Size
- [x] Size Compression — keeps texture from growing with size
- [x] Barrel Roll Size (pen twist)
- [x] Barrel Roll Opacity
- [x] Barrel Roll Bleed
- [x] Cursor Outline — None, Contrast, Active Color (styles the brush cursor element; geometry stays with the interface module)
- [x] Hover Opacity
- [x] Hover Fill — None, Shape, All

## 18. Brush Studio: Properties, Preview, About, Materials
- [x] Use Stamp Preview
- [x] Orient To Screen — shape ignores canvas rotation
- [x] Preview Size
- [x] Smudge Pull — default smudge strength
- [x] Maximum / Minimum Size
- [x] Maximum / Minimum Opacity
- [x] Preview settings — Pressure Minimum, Pressure Scale, Wet Mix toggle, Tilt Angle
- [x] About — author picture, name, date created, signature, brush name
- [x] Reset points — Create New Reset Point, Reset Brush
- [ ] Materials (Metallic/Roughness amount, source, scale) — (N/A on Windows - skip; 3D only)

## 19. Dual Brush
- [x] Dual Brush toggle — combine two brush engines per brush
- [x] Secondary brush selection — pick from library
- [x] Secondary brush editing — full Brush Studio settings for the second brush
- [x] Combine blend mode — Normal, Multiply, Darken, Linear Burn, Color Burn, Lighten, Screen, Add, etc.
- [x] Dual size/opacity/flow — independent controls
- [x] Dual brush orient/scale follow options

## 20. Brush import and share
- [x] Export .brush / .brushset
- [x] Import by file open or drag-drop
- [x] Import Photoshop .abr (best effort: v1/v2 and v6+ sampled tips; computed/round tips are skipped)
- [x] Duplicate / delete brush

## 21. Color
- [x] Color panel — popover with tabs Disc, Classic, Harmony, Value, Palettes
- [x] Primary and Secondary swatches — tap to choose active; secondary feeds color dynamics
- [x] Color History — last 10 colors row
- [x] Disc — outer ring hue, inner disc saturation/brightness; HSB sliders beneath
- [x] Classic — SB square + Hue slider + Saturation/Brightness sliders
- [x] Harmony — wheel with Complementary, Split Complementary, Analogous, Triadic, Tetradic; draggable handles; swatch preview
- [x] Value — numeric HSB, RGB, Hex entry with sliders
- [x] Hex paste/entry
- [x] Palettes tab — list of palettes, Default palette
- [x] Add swatch — tap empty slot or + to store current color
- [x] Swatch actions — tap to select; hold: Set Swatch (replace), Delete
- [x] New palette — empty, from image/file, from photo (camera N/A), from Default
- [x] Palette views — compact and card
- [x] Set default palette
- [x] Rename / duplicate / delete / share palette (.swatches)
- [x] Import palettes — .swatches (and image extraction)
- [x] Eyedropper — long-press canvas; loupe ring shows new vs previous color
- [x] Eyedropper sample source — current layer or composite
- [x] Eyedropper sample size
- [x] Color Profiles — RGB (sRGB, Display P3, Adobe RGB) with Assign vs Convert, ICC import, Display P3 display buffer; CMYK is not supported
- [x] Swap primary/secondary — via QuickMenu/hotkey
- [x] ColorDrop source — drag from color circle (Section 30)

## 22. Layers
- [x] Layers panel — top-down list, thumbnail, name, blend tag "N", visibility checkbox
- [x] Max layers by canvas size — shown in Canvas Information
- [x] New layer (+) above active
- [x] Selection — primary and multi-select
- [x] Visibility toggle
- [x] Layer options popover — Rename, Select, Copy, Fill Layer, Clear, Alpha Lock, Mask, Clipping Mask, Reference, Invert, Merge Down/Combine Down, Flatten, Drawing Assist, Blend, Opacity
- [x] Rename
- [x] Select — layer alpha to selection
- [x] Copy layer to clipboard
- [x] Fill Layer — flood layer with current color
- [x] Clear — erase layer
- [x] Alpha Lock — edits only existing pixels
- [x] Mask — add layer mask (white show / black hide); mask thumbnail
- [x] Mask actions — Disable, Enable, Invert, Clear, Show (view mask), Apply/Delete
- [x] Mask editing — paint grayscale on mask with any brush
- [x] Clipping Mask — clip to layer below; indented arrow; multiple layers can clip to one base
- [x] Reference — set layer as sampling source for ColorDrop and Automatic selection
- [x] Invert colors
- [x] Merge Down
- [x] Combine Down — merge preserving blend mode
- [x] Flatten — merge all visible
- [x] Duplicate layer
- [x] Delete layer
- [x] Lock layer — prevents edits
- [x] Opacity — 0-100% slider
- [x] Blend mode picker — full list below
- [x] Blend: Normal
- [x] Blend darken group — Darken, Multiply, Color Burn, Linear Burn, Darker Color
- [x] Blend lighten group — Lighten, Screen, Color Dodge, Add, Lighter Color
- [x] Blend contrast group — Overlay, Soft Light, Hard Light, Vivid Light, Linear Light, Pin Light, Hard Mix
- [x] Blend comparative group — Difference, Exclusion, Subtract, Divide
- [x] Blend component group — Hue, Saturation, Color, Luminosity
- [x] Live blend preview while browsing
- [x] Groups — group selected layers; expand/collapse; nesting
- [x] Group options — Rename, Ungroup, Merge Group, Flatten, Duplicate, Delete, opacity, blend (default Pass Through), Alpha Lock, mask
- [x] Drag layers into/out of groups; reorder
- [x] Background color layer — color picker, hide toggle
- [x] Drawing Assist layer flag
- [x] Export single layer — PNG/PSD

## 23. Add menu
- [x] Insert a file — import image/PSD as layer then Transform
- [x] Insert a photo — image as layer (Photos library maps to file picker)
- [ ] Take a photo — (N/A on Windows - skip unless webcam desired) TODO: N/A on Windows, menu entry is disabled
- [x] Add Text — creates text layer
- [x] Cut / Copy / Copy All / Paste entries

## 24. Canvas menu
- [x] Crop and Resize (Section 36)
- [x] Animation Assist toggle (Section 33)
- [x] Drawing Guide toggle and Edit Drawing Guide (Section 28) — opening the editor turns the guide on
- [x] Drawing Assist toggle — Actions menu, per active layer
- [x] Reference toggle (Section 32) — Actions > Reference window
- [x] Flip Horizontal / Flip Vertical (Section 36)
- [x] Canvas Information (Section 36)
- [x] Page Assist toggle (Section 35)

## 25. Adjustments
- [x] Adjustments list — pick effect; applies to active layer (or selection)
- [x] Layer mode — whole layer; drag finger/pointer across canvas left-right to change main value
- [x] Pencil mode — effect painted with chosen brush; erase with eraser tool; brush selectable
- [x] Live preview
- [x] Hue, Saturation, Brightness — three sliders
- [x] Color Balance — Shadows/Midtones/Highlights with Cyan-Red, Magenta-Green, Yellow-Blue sliders
- [x] Curves — Gamma, Red, Green, Blue curves with control points; reset
- [x] Gradient Map — gradient library; edit stops (add, delete, color, location); map luminance to gradient
- [x] Recolor — pick target color, applies hue recolor (verify behavior)
- [x] Gaussian Blur — radius %
- [x] Motion Blur — amount + direction (drag), optional backward/symmetric
- [x] Perspective Blur — focal point + position; radial/perspective streak
- [x] Noise — noise amount (grain), scale, color/mono options
- [x] Sharpen — amount (unsharp)
- [x] Bloom — Transition, Size, Opacity, Burn
- [x] Glitch: Artifact — Amount, Distance
- [x] Glitch: Wave — Amount, Distance
- [x] Glitch: Displace — Amount, Distance, Offset
- [x] Glitch: Signal — Amount, Distance, Offset
- [x] Glitch: Tear — Amount, Distance, Transition
- [x] Glitch: Diverge — Amount, Distance, Transition
- [x] Halftone — types Full Color, Black & White, Screen(tone); Amount; pattern types (dot, circle/line/cross); Screen angle
- [x] Chromatic Aberration — Perspective and Displace modes; Amount, Transition, Distance
- [x] Liquify — Push, Twirl Right, Twirl Left, Pinch, Expand, Crystals, Edge, Reconstruct
- [x] Liquify parameters — Size, Pressure, Distortion, Momentum
- [x] Liquify Reset
- [x] Clone — set source point; paint offset copy of source; source cursor follows stroke; reset source
- [x] Apply / cancel — tap Adjustments icon to commit; two-finger tap/undo to revert (two-finger tap and pinch / twist / pan work while an adjustment is open)

## 26. Selection
- [x] Selection bar — Automatic, Freehand, Rectangle, Ellipse, Add, Remove, Invert, Copy & Paste, Feather, Save & Load, Color Fill, Clear
 (in-memory per document session)
- [x] Automatic — tap region to flood-select; drag left/right to set threshold; source layer or Reference
- [x] Freehand — draw loop; tap points for polygon segments; auto-close
- [x] Rectangle — drag; uniform (square) option
- [x] Ellipse — drag; uniform (circle) option
- [x] Add mode — union
- [x] Remove mode — subtraction
- [x] Invert
- [x] Color Fill — fill selection with current color
- [x] Copy & Paste — duplicate selection to new layer
- [x] Feather — 0-100% soft edge with live preview
- [x] Save & Load — store named selections; reload
 (in-memory per document session)
- [x] Clear selection
- [x] Selection mask overlay — striped tint outside selection; visibility slider
- [x] Selection limits painting/erasing/adjustments/fills
- [x] Marching ants edge display
- [x] Select Layer contents (layer option)
- [x] Transform selection contents
- [x] Selection tool settings — Selection Mask Visibility in Prefs
 (slider in the selection bar, persisted; not in Prefs panel)
- [x] Smart selection (Selection menu / bar "Smart", key W) — one tool, mode switch inside its own bar
  - [x] AI · Fast — MobileSAM (Apache-2.0), bundled (~45 MB), offline; WebGPU with WASM fallback, runs in a Worker, released after 5 idle minutes
  - [x] AI · Precise — SAM 2.1 Hiera-Small (Apache-2.0), optional ~176 MB download started by the user's click in the bar (progress, cancel, SHA-256 check, delete)
  - [x] Brush (no AI) — paint over the object, the selection grows to its edges (geodesic segmentation + colour models); Alt / pen eraser end paints "not object"
  - [x] Click = object, Alt+click / eraser end / right click / "− Remove area" = remove area, drag = box prompt, live hover preview, removable point markers, Detail (part / object / whole)
  - [x] Sample: current layer / all visible layers; "Refine in view" re-analyses the visible region for small objects; any image size
  - [x] Edge refinement: guided-filter snap to real edges, soft anti-aliased alpha, Smooth, Feather, Shift edge, Decontaminate colours
  - [x] Combine with the existing selection: New / Add / Subtract / Intersect; whole session = one undo step
  - [x] Cut-out actions (bar, Selection menu, bindable actions): Cut to new layer, Copy to new layer, Remove background (layer mask), Copy object (PNG with transparency to the clipboard)

## 27. Transform
- [x] Bounding box with 8 handles + rotation node
- [x] Freeform — independent X/Y scaling
- [x] Uniform — aspect-locked scaling
- [x] Distort — corner handles move freely (perspective)
- [x] Warp — mesh warp
- [x] Warp grid size / Advanced Mesh — adjust mesh density and individual handles
- [x] Warp Bend mode — Bend: drag the two orange edge handles to bow the top/bottom or left/right edges into a curve
- [x] Rotate — drag rotation node; snaps
- [x] Move — drag inside; arrow-key nudge
- [x] Flip Horizontal / Flip Vertical
- [x] Rotate 45 degrees
- [x] Fit to Screen
- [x] Reset
- [x] Magnetics — snap to canvas edges/center/other elements with guide lines
 (canvas edges/centre; not other layers)
- [x] Snapping — snaps to canvas edges/centre, the Drawing Guide (grid lines, symmetry axes, vanishing points; "Guides" toggle) and rotation steps; Snapping Distance / Velocity
- [x] Interpolation — Nearest Neighbor, Bilinear, Bicubic
- [x] Multi-layer / group transform
- [x] Transform with selection
- [x] Commit — tap Transform icon or Enter
- [x] Undo transform
- [x] Pinch/twist direct manipulation

## 28. Drawing Guides
- [x] Drawing Guide toggle
- [x] Edit Drawing Guide — opens panel with guide types
- [x] Guide types — 2D Grid, Isometric, Perspective, Symmetry
- [x] Common options — Opacity, Thickness, Grid Size, Guide Color (hue), Assisted Drawing toggle
- [x] 2D Grid — orthogonal grid, adjustable size/rotation
- [x] Isometric — 3-axis 30-degree grid, plane selection
- [x] Perspective — 1/2/3-point; tap to add vanishing points; drag points/horizon; delete
- [x] Symmetry Vertical
- [x] Symmetry Horizontal
- [x] Symmetry Quadrant
- [x] Symmetry Radial — configurable count of segments; Rotational Symmetry toggle
- [x] Symmetry axis handles — drag and rotate axis/center
- [x] Symmetry works with Smudge and Erase
- [x] Assisted Drawing — strokes snap to guide lines (per layer flag)
- [x] Drawing Assist — layer option enabling assist only on chosen layers
- [x] Guide persistence — saved with artwork
- [x] Done button

## 29. QuickShape and StreamLine
- [x] QuickShape trigger — hold at stroke end
- [x] Shapes — line, circle, ellipse, arc, rectangle/polygon, triangle
- [x] Edit Shape — after snap, handles reshape; convert ellipse to circle
- [x] Constrain — second finger/Shift for 15-degree angle or perfect circle/square
- [x] Snap to Drawing Guides
- [x] Shape rasterizes on next stroke
- [x] Hold delay — configurable in Gesture Controls (setting lives in the QuickShape & StreamLine panel; Gesture Controls page may link to it)
- [x] StreamLine — per-brush lag smoothing (Section 9)
- [x] Global smoothing prefs (Section 37) — Preferences > Pressure & Smoothing: pressure / touch smoothing and global StreamLine override

## 30. ColorDrop / fill
- [x] ColorDrop — drag from color circle onto canvas to flood fill
- [x] Threshold — hold after drop and drag left/right; live percentage pill
- [x] Fills contiguous similar area on current layer or Reference layer
- [x] Respects selection
- [x] Full-layer fill at max threshold
- [x] Undoable
- [x] Fill Layer option (layer menu)
- [x] Color Fill in Selection bar

## 31. Text
- [x] Add Text — creates text layer with editing box and keyboard
- [x] Edit — tap text layer or text; select word/all
- [x] Text bounding box — move, resize, rotate
- [x] Edit Style panel (Aa) — Font, Style, Design, Attributes
- [x] Fonts — system fonts + Import Font (.ttf/.otf); search
- [x] Font size
- [x] Bold / Italic / weight styles
- [x] Kerning, Tracking, Leading, Baseline
- [x] Alignment — Left, Center, Right, Justified
- [x] Vertical/horizontal text direction
- [x] Color per selection; Opacity
- [x] Underline, Strikethrough
- [x] Case — Upper, Lower, Small caps
- [x] Ligatures / stylistic design toggles
- [x] Cut/copy/paste in text
- [x] Rasterize — Layer option; automatic on painting
- [x] Transform text layer
- [x] RTL and complex script support

## 32. Reference window
- [x] Reference toggle — floating window
- [x] Canvas mode — live mirror of whole canvas
- [x] Image mode — Import Image; pinch/pan within window
- [ ] Face mode — (N/A on Windows - skip; camera)
- [x] Movable and resizable window
- [x] Eyedropper from reference — long-press to pick color
- [x] Fit/reset button; close button

## 33. Animation Assist
- [x] Toggle Animation Assist — bottom timeline appears
- [x] Frames = layers/groups — each frame contains its own layers
- [x] Add Frame (+)
- [x] Select frame; scrub timeline
- [x] Frame options — Duplicate, Delete, Hold Duration, Foreground, Background
- [x] Reorder frames by drag
- [x] Play / Pause
- [x] Playback mode — Loop, Ping-Pong, One Shot
- [x] Frames per second — 1-60
- [x] Onion Skin toggle
- [x] Onion Skin Frames — number before/after
- [x] Onion Skin Opacity
- [x] Onion Skin Filter Color — tint previous/next frames with two colors
- [x] Background / foreground frames persist across all frames
- [x] Copy/paste frames
- [x] Export animated GIF — Web Ready option, FPS
- [x] Export animated PNG (APNG)
- [x] Export MP4 (H.264)
- [ ] Export HEVC (with alpha) — (N/A on Windows: HEVC export works without alpha; alpha needs hevc_videotoolbox on macOS)
- [x] Export frames as PNG sequence

## 34. Time-lapse
- [x] Recording — auto-record all edits from creation
- [x] Toggle recording — Actions > Video
- [x] Time-lapse editor (top-bar tab, replaces Replay) — preview with play / scrub / frame step / J K L / loop, zoomable timeline with thumbnails, ruler, undo / redo of edits, non-destructive (saved in the .bwk)
- [x] Hide undone and redone actions — history-tree tagging per frame; undone strokes vanish together with the undo, redone ones appear once (default in Preferences of the time-lapse settings)
- [x] Pauses anywhere on the timeline, any length (0.05 s - 1 h), drag to move / resize
- [x] Speed: global 0.01x - 1000x (log slider + number), Fit to length (15 / 30 / 60 s or any m:ss), per-segment speed bands
- [x] Finale: hold, fade in, fade out
- [x] Export Time-lapse Video — MP4 H.264 / HEVC, WebM VP9, GIF; 1080p / 2K / 4K / canvas; 24 / 30 / 60 fps; cancel; exactly the preview timing at constant frame rate
- [x] Recording quality — Max / HD / Small (canvas setup)
- [x] Recording reset on canvas resize/crop
- [x] Recording size on disk in Canvas Information
- [x] Recording stored inside project

## 35. Page Assist
- [x] Page Assist toggle — page strip along bottom
- [x] Add page
- [x] Navigate pages
- [x] Page options — Duplicate, Delete, Foreground/Background page
- [x] Reorder pages by drag
- [x] Each page is layer group; Layers panel shows current page
- [x] Export multi-page PDF
- [x] Export pages as images

## 36. Canvas operations
- [x] Crop and Resize — drag edges; set width/height/units/DPI; Constrain proportions
- [x] Resample Canvas — scale content when resizing
- [x] Move content within cropped canvas; Reset; Done
- [x] Flip Canvas Horizontal (view mirroring) — Actions > Canvas: Flip canvas mirrors the VIEW only (pointer mapping, overlays and display shader follow); "Flip pixels horizontal" is a separate undoable pixel flip
- [x] Flip Canvas Vertical — pixel flip (Actions > Canvas: Flip pixels vertical); the view mirror is horizontal, as in Procreate
- [x] Canvas Information: Dimensions — width, height, DPI, color profile, layers used/max
- [x] Canvas Information: Stats — stroke count, tracked time, time-lapse length, size
- [x] Canvas Information: Meta — canvas name, author
- [x] Canvas Properties — background color, hide background
- [x] Color profile Assign/Convert — Assign retags; Convert transforms every layer on the GPU (one undo step)

## 37. Preferences and Gesture Controls
- [x] Interface — light/dark, right-hand, brush cursor
- [x] Project canvas — second window showing the artwork without the interface (Actions > Canvas: Project canvas, or Preferences > Advanced)
- [ ] Connect Stylus — choose pen device (N/A on Windows: Windows Ink selects the device; see Tablet Diagnostics)
- [x] Pressure and Smoothing — editable pressure curve for pen and for touch, with test pad
- [x] Smoothing — pen and touch smoothing sliders
- [x] Rapid Undo Delay slider
- [x] Selection Mask Visibility slider — Preferences and the selection bar share one setting that drives the selection overlay
- [x] Disable touch actions toggle
- [x] Gesture Controls — per-category assignable gestures
- [x] Gesture: Eyedropper — touch & hold, delay, indicator
- [x] Gesture: QuickMenu — trigger
- [x] Gesture: QuickShape — hold, delay
- [x] Gesture: Layer options — alpha lock, select, opacity
- [x] Gesture: Undo/Redo, Copy/Paste, Clear layer, Full screen
- [x] Gesture: Smudge/Erase quick-tool switching — press and hold the Smudge / Eraser toolbar button to use it temporarily (delay in Gesture Controls)
- [x] Gesture: Pencil actions — double-tap/squeeze: eraser, previous tool, palette, none
- [x] Pen button mapping — side buttons to actions
- [x] Gesture practice pad — displays recognized gesture
- [x] Reset gestures to default
- [x] Help menu — handbook link, What's New, report bug (link-outs only)
- [x] Advanced Settings — brush preview cache, graphics info, project canvas, advanced gesture timing, reset all

## 38. Import / export formats
- [x] .procreate native format — own implementation: .bwk (layers, groups, masks, guides, animation, time-lapse); real .procreate import is best-effort (LZ4 chunks)
- [ ] Share project as .procreate — not implemented: a real .procreate cannot be produced or verified without Procreate (share as .bwk / PSD instead)
- [x] PSD export — layers, blend modes, groups, masks
- [x] PSD import — text layers become editable WinCreative text layers; Hue/Saturation, Color Balance, Curves, Levels, Brightness/Contrast and Invert adjustment layers are applied to the layers below (others are reported)
- [x] PDF export — Web-ready vs Best quality; multi-page
- [x] JPEG export — quality
- [x] PNG export — transparency
- [x] TIFF export
- [x] Animated GIF export
- [x] Animated PNG export
- [x] Animated MP4 export
- [x] Animated HEVC export
- [x] Time-lapse MP4 export
- [x] Export layers individually
- [x] Copy canvas to clipboard
- [x] Image import formats — JPEG, PNG, TIFF, PSD, (WebP optional)
- [x] Font import — .ttf/.otf/.woff (Gallery Import or Text panel)
- [x] Brush import — .brush/.brushset/.abr (Gallery Import or brush library)
- [x] Palette import — .swatches/.ase (Gallery Import or Color panel)
- [x] ICC profile import — .icc/.icm sets the canvas profile (built-in spaces are recognised)
- [ ] Save to Photos / AirDrop / iCloud — (N/A on Windows - skip)
- [x] Share sheet — map to Save As dialog and drag-drop

## 39. 3D painting (all N/A)
- [ ] 3D model import (.usdz/.obj) — (N/A on Windows - skip)
- [ ] 3D painting on UV texture — (N/A on Windows - skip)
- [ ] Lighting Studio — (N/A on Windows - skip)
- [ ] 3D camera gestures — (N/A on Windows - skip)
- [ ] 3D layers/materials (Metallic, Roughness) — (N/A on Windows - skip)
- [ ] 3D export/AR — (N/A on Windows - skip)

## 40. Apple-hardware-only and pen mapping
- [x] Pen pressure — Windows Ink pressure 0-1
- [x] Pen tilt — tiltX/tiltY to azimuth/altitude
- [x] Pen barrel rotation — twist axis if supported
- [x] Pen eraser end — eraser flag
- [x] Pen side buttons — configurable actions
- [x] Pen hover — proximity events for cursor and hover gestures
- [x] Palm rejection — pen-vs-touch discrimination
- [ ] Haptics — (N/A on Windows - skip)
- [ ] Apple Pencil pairing UI — (N/A on Windows - skip)
- [ ] Widgets, Shortcuts app, Stage Manager, Split View, Sidecar — (N/A on Windows - skip)
- [ ] Camera features (Take a photo, Live Photo, Face reference) — (N/A on Windows - skip)

## Language variants (`features/langvariants/`, docs/LANGUAGE_VARIANTS.md)
- [x] Language layer: one row, one cell per language (Layers panel > Lang. button, Actions > Add > Language layer); ordinary layers are common to all languages
- [x] Language switcher in the layers panel (only when the document has a language layer), `lang.cycle` Ctrl+Alt+L, language list editor (2-4 languages), ghost of the other languages (display only)
- [x] Row operations: rename, visibility, opacity / blend, reorder, duplicate, delete, merge down (language layer onto language layer, cell by cell), flatten into the current language, copy / clear a cell, lock
- [x] Time-lapse: one frame per variant for common commits, own-language frames for writing; per-variant edit models; Copy edits; Compare versions (by drawing moment / by video time)
- [x] Export: all languages in one pass (MP4 / HEVC / WebM / GIF), current language only, one image per language, PSD with every language as layers
- [x] Tutorial lesson "Two languages, one drawing"

## Frame (`features/frame/`)
One optional **frame** per document (presets 9:16, 16:9 HD/4K, 1:1, 4:5, A4 @300 dpi, custom). Frame ON clips painting (brush / smudge / eraser strokes, filters,
fills) to the frame (shader-level, `gl/clipMask.ts`: effective clip = selection x frame, pixel exact, tile-aware on infinite canvases) and dims the outside; OFF paints
anywhere and shows a thin outline. Toggle: button at the bottom right of the canvas (right-click = settings), action `frame.toggle` (Ctrl+Shift+F, bindable / QuickMenu).
The frame defines the **time-lapse area** (frames are letterboxed into one stable size) and the **export area** (Area: Frame / All content / Whole canvas). Infinite canvas
without a frame: the time-lapse records the visible screen area. Stored in the `.bwk` (extension `frame`), undoable. `workRect(app)` = region for whole-canvas tools.
Self-test: `node scripts/selftest.mjs --out <build> frame`; QA: `scripts/qa/qa-frame.mjs`, `qa-frame-tl.mjs`.
