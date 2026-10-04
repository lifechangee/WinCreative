// interface module: preferences, shortcuts cheat sheet, QuickMenu, help. Keys: 'interface.<area>.<name>'.
const dict: Record<string, string> = {
  'interface.prefs.interface_theme': 'Interface theme',

  'interface.prefs.right_hand_interface': 'Right-hand interface',

  'interface.prefs.moves_the_sidebar_to_the_right_side_of': 'Moves the sidebar to the right side of the screen',

  'interface.prefs.brush_cursor': 'Brush cursor',

  'interface.prefs.outline_shown_at_the_pen_pointer': 'Outline shown at the pen / pointer',

  'interface.prefs.dynamic_brush_scaling': 'Dynamic brush scaling',

  'interface.prefs.keep_the_brush_the_same_size_on_screen': 'Keep the brush the same size on screen while zooming',

  'interface.prefs.canvas_rotation_snapping': 'Canvas rotation snapping',

  'interface.prefs.snap_to_0_90_180_270_degrees_while_rot': 'Snap to 0/90/180/270 degrees while rotating with two fingers',

  'interface.prefs.zoom_rotation_readout': 'Zoom / rotation readout',

  'interface.prefs.tooltips': 'Tooltips',

  'interface.prefs.selection_mask_visibility': 'Selection mask visibility',

  'interface.prefs.opacity_of_the_selection_overlay': 'Opacity of the selection overlay',

  'interface.prefs.mouse_wheel_zooms': 'Mouse wheel zooms',

  'interface.prefs.off_wheel_pans_ctrl_wheel_always_zooms': 'Off = wheel pans (Ctrl+wheel always zooms)',

  'interface.prefs.hold_ctrl_to_show_shortcuts': 'Hold Ctrl to show shortcuts',

  'interface.prefs.high_contrast': 'High contrast',

  'interface.prefs.larger_interface_text': 'Larger interface text',

  'interface.prefs.reduce_motion': 'Reduce motion',

  'interface.prefs.disables_interface_animations': 'Disables interface animations',

  'interface.prefs.finger_pressure_source': 'Finger pressure source',

  'interface.prefs.used_when_the_screen_reports_no_touch': 'Used when the screen reports no touch force',

  'interface.prefs.reset_touch_curve': 'Reset touch curve',

  'interface.prefs.pressure_smoothing': 'Pressure smoothing',

  'interface.prefs.low_pass_filter_on_pen_pressure': 'Low-pass filter on pen pressure',

  'interface.prefs.touch_smoothing': 'Touch smoothing',

  'interface.prefs.smooths_finger_strokes': 'Smooths finger strokes',

  'interface.prefs.global_streamline': 'Global StreamLine',

  'interface.prefs.override_every_brush_s_own_streamline': 'Override every brush\'s own StreamLine amount',

  'interface.prefs.streamline_amount': 'StreamLine amount',

  'interface.prefs.mouse_pressure': 'Mouse pressure',

  'interface.prefs.simulated_pressure_for_mouse_users': 'Simulated pressure for mouse users',

  'interface.prefs.auto_calibrate_pen_pressure': 'Auto-calibrate pen pressure',

  'interface.prefs.detects_drivers_that_never_reach_full': 'Detects drivers that never reach full pressure and rescales',

  'interface.prefs.reset_pressure_curve': 'Reset pressure curve',

  'interface.prefs.draw_with_finger': 'Draw with finger',

  'interface.prefs.off_fingers_only_navigate_disable_touc': 'Off = fingers only navigate (Disable touch actions for painting)',

  'interface.prefs.palm_rejection': 'Palm rejection',

  'interface.prefs.ignore_touches_while_a_pen_is_in_range': 'Ignore touches while a pen is in range',

  'interface.prefs.touch_and_hold_delay': 'Touch and hold delay',

  'interface.prefs.pen_hold_delay_0_off': 'Pen hold delay (0 = off)',

  'interface.prefs.rapid_undo_delay': 'Rapid Undo delay',

  'interface.prefs.interval_between_repeated_undo_redo_wh': 'Interval between repeated undo / redo while holding two / three fingers',

  'interface.prefs.tap_duration': 'Tap duration',

  'interface.prefs.longest_finger_down_time_that_still_co': 'Longest finger-down time that still counts as a tap',

  'interface.prefs.movement_tolerance': 'Movement tolerance',

  'interface.prefs.how_far_fingers_may_drift_during_a_tap': 'How far fingers may drift during a tap or hold',

  'interface.prefs.two_three_finger_hold_time': 'Two / three-finger hold time',

  'interface.prefs.delay_before_a_held_multi_finger_tap_s': 'Delay before a held multi-finger tap starts repeating',

  'interface.prefs.hold_smudge_eraser_to_quick_switch': 'Hold Smudge / Eraser to quick-switch',

  'interface.prefs.press_and_hold_the_tool_button_to_use': 'Press and hold the tool button to use it temporarily; release to go back (0 = off)',

  'interface.prefs.reset_gestures_to_default': 'Reset gestures to default',

  'interface.prefs.barrel_button': 'Barrel button',

  'interface.prefs.second_barrel_button': 'Second barrel button',

  'interface.prefs.eraser_end_of_the_pen': 'Eraser end of the pen',

  'interface.prefs.show_brush_outline_while_hovering': 'Show brush outline while hovering',

  'interface.prefs.uses_pen_proximity_events': 'Uses pen proximity events',

  'interface.prefs.hover_size_opacity': 'Hover size / opacity',

  'interface.prefs.hovering_pen_shift_move_sideways_brush': 'Hovering pen: Shift + move sideways = brush size, Ctrl+Shift + move = opacity',

  'interface.prefs.predict_stroke_tip': 'Predict stroke tip',

  'interface.prefs.shows_where_the_pen_is_heading_display': 'Shows where the pen is heading (display only, never painted) to reduce perceived latency',

  'interface.prefs.right_button': 'Right button',

  'interface.prefs.middle_button': 'Middle button',

  'interface.prefs.modify_button_hold': 'Modify button (hold)',

  'interface.prefs.the_square_button_between_the_sliders': 'The square button between the sliders',

  'interface.prefs.brush_preview_cache': 'Brush preview cache',

  'interface.prefs.rendered_stroke_previews_used_in_the_b': 'Rendered stroke previews used in the brush library. Clear it if previews look stale.',

  'interface.prefs.graphics_device': 'Graphics device',

  'interface.prefs.max_texture_size': 'Max texture size',

  'interface.prefs.second_window': 'Second window',

  'interface.prefs.shows_the_artwork_without_the_interfac': 'Shows the artwork without the interface, e.g. on a projector or another monitor. Double-click it for full screen.',

  'interface.prefs.reset_all_preferences': 'Reset all preferences',

  'interface.prefs.restores_every_setting_on_every_tab_sh': 'Restores every setting on every tab (shortcuts included)',

  'interface.prefs.appearance': 'Appearance',

  'interface.prefs.accessibility': 'Accessibility',

  'interface.prefs.pressure_curve': 'Pressure curve',

  'interface.prefs.touch_pressure_curve': 'Touch pressure curve',

  'interface.prefs.smoothing': 'Smoothing',

  'interface.prefs.devices': 'Devices',

  'interface.prefs.touch': 'Touch',

  'interface.prefs.delays': 'Delays',

  'interface.prefs.advanced_gesture_settings': 'Advanced gesture settings',

  'interface.prefs.gesture_assignments': 'Gesture assignments',

  'interface.prefs.gesture_practice_pad': 'Gesture practice pad',

  'interface.prefs.pen_buttons_windows_ink_wacom_huion_xp': 'Pen buttons (Windows Ink / Wacom / Huion / XP-Pen / Surface)',

  'interface.prefs.mouse': 'Mouse',

  'interface.prefs.sidebar_modify_button': 'Sidebar modify button',

  'interface.prefs.windows_tip': 'Windows tip',

  'interface.prefs.tablet_diagnostics': 'Tablet diagnostics',

  'interface.prefs.brush_cache': 'Brush cache',

  'interface.prefs.rendering': 'Rendering',

  'interface.prefs.project_canvas': 'Project canvas',

  'interface.prefs.reset': 'Reset',

  'interface.prefs.drag_points_to_shape_the_response_clic': 'Drag points to shape the response. Click to add a point, double-click or right-click a point to remove it. The orange marker shows live pen pressure.',

  'interface.prefs.draw_on_the_test_pad_with_your_pen_to': 'Draw on the test pad with your pen to feel the curve.',

  'interface.prefs.applied_to_finger_strokes_devices_that': 'Applied to finger strokes (devices that report touch force use it; otherwise the source below).',

  'interface.prefs.buttons_are_read_from_the_pointer_even': 'Buttons are read from the Pointer Events "buttons" bitmask: barrel = 2, second barrel = 4, eraser end = 32. Use Tablet diagnostics to see what your pen reports. Hold-type actions (eyedropper, pan...) stay active while the button is held.',

  'interface.prefs.if_windows_shows_a_circle_when_you_hol': 'If Windows shows a circle when you hold the pen still, turn off "Press and hold for right-clicking" in Settings > Bluetooth & devices > Pen & Windows Ink (or your tablet driver panel). WinCreative suppresses the right-click menu itself, but that Windows-level ring is drawn by the OS.',

  'interface.prefs.assigning_a_key_that_is_already_used_m': 'Assigning a key that is already used moves it to the new action. Modifier-only keys (e.g. Alt) work for hold actions.',

  'interface.prefs.the_quickmenu_opens_with_the_quickmenu': 'The QuickMenu opens with the "QuickMenu" action: press Q, or map it to a pen button, a touch-and-hold or a gesture in the other tabs. Up to 5 menus; use the centre button to cycle.',

  'interface.prefs.add_key': 'Add key',

  'interface.prefs.reset_all_shortcuts': 'Reset all shortcuts',

  'interface.prefs.remove_this_menu': 'Remove this menu',

  'interface.prefs.add_quickmenu': 'Add QuickMenu',

  'interface.prefs.reset_quickmenus': 'Reset QuickMenus',

  'interface.prefs.clear_cache': 'Clear cache',

  'interface.prefs.reset_everything': 'Reset everything',

  'interface.prefs.done': 'Done',

  'interface.prefs.dark': 'Dark',

  'interface.prefs.light': 'Light',

  'interface.prefs.contrast_outline': 'Contrast outline',

  'interface.prefs.active_color_outline': 'Active color outline',

  'interface.prefs.none': 'None',

  'interface.prefs.constant': 'Constant',

  'interface.prefs.speed_based': 'Speed based',

  'interface.prefs.two_finger_tap': 'Two-finger tap',

  'interface.prefs.three_finger_tap': 'Three-finger tap',

  'interface.prefs.four_finger_tap': 'Four-finger tap',

  'interface.prefs.two_finger_tap_and_hold_repeats': 'Two-finger tap and hold (repeats)',

  'interface.prefs.three_finger_tap_and_hold_repeats': 'Three-finger tap and hold (repeats)',

  'interface.prefs.three_finger_scrub': 'Three-finger scrub',

  'interface.prefs.three_finger_swipe_down': 'Three-finger swipe down',

  'interface.prefs.quick_pinch': 'Quick pinch',

  'interface.prefs.touch_and_hold_finger': 'Touch and hold (finger)',

  'interface.prefs.touch_and_hold_pen_tip': 'Touch and hold (pen tip)',

  'interface.prefs.erase': 'Erase',

  'interface.prefs.ignore_paint': 'Ignore (paint)',

  'interface.prefs.none_paren': '(none)',

  'interface.prefs.touch_the_pad_with_1_4_fingers': 'Touch the pad with 1-4 fingers',

  'interface.prefs.filter_actions': 'Filter actions...',

  'interface.prefs.click_to_remove': 'Click to remove',

  'interface.prefs.press_keys': 'Press keys... (Esc cancels)',

  'interface.prefs.tab.interface': 'Interface',
  'interface.prefs.tab.pressure': 'Pressure & Smoothing',
  'interface.prefs.tab.gestures': 'Touch & Gestures',
  'interface.prefs.tab.pen': 'Pen & Buttons',
  'interface.prefs.tab.shortcuts': 'Keyboard Shortcuts',
  'interface.prefs.tab.quickmenu': 'QuickMenu',
  'interface.prefs.tab.diagnostics': 'Tablet Diagnostics',
  'interface.prefs.tab.advanced': 'Advanced',

  'interface.prefs.fmt.ms': '{n} ms',
  'interface.prefs.fmt.px': '{n} px',
  'interface.prefs.fmt.off': 'off',

  'interface.prefs.quickmenu_n': 'QuickMenu {n}',

  'interface.prefs.slot_n': 'Slot {n}',

  'interface.prefs.cache_cleared': 'Brush preview cache cleared',

  'interface.prefs.reset_done': 'Preferences reset',

  'interface.prefs.language': 'Language / Язык',

  'interface.prefs.language_hint': 'Applies immediately. "System default" follows your Windows language.',

  'interface.prefs.language_auto': 'System default',

  'interface.prefs.title': 'Preferences',

  'interface.prefs.pad.tap_one': '{count}-finger tap',
  'interface.prefs.pad.tap_other': '{count}-finger tap',
  'interface.prefs.pad.hold_one': '{count}-finger hold ({phase})',
  'interface.prefs.pad.hold_other': '{count}-finger hold ({phase})',
  'interface.prefs.pad.scrub': 'three-finger scrub',
  'interface.prefs.pad.swipeDown': 'three-finger swipe down',
  'interface.prefs.pad.longPress': 'touch and hold',
  'interface.prefs.pad.recognized': 'Recognized: {what}',

  'interface.cheat.title': 'Keyboard shortcuts',

  'interface.cheat.hint': 'Rebind in Actions > Preferences > Shortcuts. Hold Ctrl for a moment to show this list.',

  'interface.action.prefs': 'Preferences',

  'interface.action.diagnostics': 'Tablet diagnostics',

  'interface.action.help': 'Help',

  'interface.action.project': 'Project canvas (second window)',

  'interface.action.cheatsheet': 'Shortcuts cheat sheet',

  'interface.action.quickMenu': 'QuickMenu',

  'interface.quickmenu.next': 'Next QuickMenu',

  'interface.menu.project': 'Project canvas (second window)',

  'interface.menu.prefs': 'Preferences...',

  'interface.menu.pressure': 'Pressure curve...',

  'interface.menu.gestures': 'Gesture controls...',

  'interface.menu.shortcuts': 'Keyboard shortcuts...',

  'interface.menu.diagnostics': 'Tablet diagnostics...',

  'interface.menu.cheatsheet': 'Shortcut cheat sheet',

  'interface.menu.help': 'Help',

  'interface.menu.whatsnew': 'What\'s new',

  'interface.menu.about': 'About WinCreative',

  'interface.help.title': 'Help',

  'interface.help.intro': 'WinCreative is a Procreate-inspired painting app. Everything below can be changed in Actions > Preferences.',

  'interface.help.touchTitle': 'Touch gestures',

  'interface.help.touch1': 'One finger paints. Two fingers pinch, twist and pan the canvas.',

  'interface.help.touch2': 'Two-finger tap = undo, three-finger tap = redo (hold to repeat).',

  'interface.help.touch3': 'Three-finger scrub clears the layer. Four-finger tap hides the interface.',

  'interface.help.touch4': 'Touch and hold on the canvas = eyedropper. Quick pinch = fit to screen.',

  'interface.help.penTitle': 'Pen',

  'interface.help.pen1': 'Pressure, tilt and barrel rotation are used by brushes that support them. The pen eraser end erases.',

  'interface.help.pen2': 'Barrel button = eyedropper by default, second button = QuickMenu. Remap under Pen & Buttons.',

  'interface.help.pen3': 'Pressure feels wrong? Edit the curve under Pressure & Smoothing, and check Tablet Diagnostics.',

  'interface.help.kbTitle': 'Keyboard',

  'interface.help.kb1': 'Hold Ctrl for a moment or press F1 to see all shortcuts. Rebind them under Keyboard Shortcuts.',

  'interface.help.kb2': 'Space+drag pans, R+drag rotates, I or Alt picks a color, [ ] changes brush size, Tab hides the interface, Q opens the QuickMenu.',

  'interface.help.aboutText': 'WinCreative {version} - a Procreate-inspired painting app for Windows. Independent project, not affiliated with Savage Interactive.',

  'interface.help.aboutLicense': 'License: {license}. Free software: you may use, study, modify and share it under the terms of the license.',

  'interface.help.aboutSource': 'Source code',

  'interface.help.aboutNotices': 'Third-party notices: video export uses a bundled FFmpeg build (GPL-3.0); see THIRD_PARTY_NOTICES.md and the licenses folder next to the application.',

  'interface.help.aboutTablet': 'Tablet support uses Windows Ink through Pointer Events: Wacom, Huion, XP-Pen and Surface pens report pressure, tilt, twist and buttons.',

  'interface.help.new1': 'Full pen support: auto-calibrated pressure, editable pressure curve, barrel buttons, hover cursor, tablet diagnostics.',

  'interface.help.new2': 'Gestures: two/three/four-finger taps, hold to repeat, scrub, swipe, quick pinch, touch-and-hold eyedropper.',

  'interface.help.new3': 'QuickMenu, rebindable shortcuts, shortcut cheat sheet, light theme and right-hand interface.',

  'interface.projector.closed': 'Projection closed',

  'interface.projector.failed': 'Could not open the projection window',

  'interface.projector.windowTitle': 'WinCreative - projected canvas',

  'interface.projector.started': 'Projecting the canvas (double-click that window for full screen)',

  'interface.hidden': 'Interface hidden - press Tab to restore',

  'interface.prefs.preset.linear': 'Linear',
  'interface.prefs.preset.soft': 'Soft',
  'interface.prefs.preset.firm': 'Firm',
  'interface.prefs.preset.s_curve': 'S-curve',
  'interface.prefs.preset.light_touch': 'Light touch',

  'interface.diag.resetCalibration': 'Reset calibration & max',

  'interface.diag.instructions': 'Move a pen (or finger / mouse) over the pad, hover, press, tilt, twist and click barrel buttons. Values are live.',

  'interface.diag.pressure': 'Pressure',

  'interface.diag.clearPad': 'Clear pad',
  'interface.diag.cell.type': 'Pointer type',
  'interface.diag.cell.pressure': 'Pressure (raw)',
  'interface.diag.cell.cal': 'Pressure (calibrated)',
  'interface.diag.cell.curve': 'After curve',
  'interface.diag.cell.tilt': 'Tilt X / Y (deg)',
  'interface.diag.cell.az': 'Azimuth (deg)',
  'interface.diag.cell.alt': 'Altitude (deg)',
  'interface.diag.cell.twist': 'Twist / barrel (deg)',
  'interface.diag.cell.buttons': 'Buttons mask',
  'interface.diag.cell.btnname': 'Buttons',
  'interface.diag.cell.size': 'Contact w x h',
  'interface.diag.cell.rate': 'Report rate (Hz)',
  'interface.diag.cell.coal': 'Coalesced / predicted',
  'interface.diag.cell.state': 'State',
  'interface.diag.cell.max': 'Max pressure seen',
  'interface.diag.cell.id': 'Pointer id',
  'interface.diag.testPad': 'Test pad - draw with your pen',
  'interface.diag.state.idle': 'no pen activity yet',
  'interface.diag.state.lifted': 'lifted',
  'interface.diag.state.contact': 'contact',
  'interface.diag.state.hover': 'hover / proximity',
  'interface.diag.state.out': 'out of range',
  'interface.diag.calActive': 'Auto-calibration active: driver ceiling {peak} is mapped to 1.0 (scale x{scale}).',
  'interface.diag.calNone': 'Auto-calibration: no driver ceiling detected (highest plateau {peak}). It activates when a pen repeatedly tops out below 1.0.',
  'interface.curve.penPressure': 'pen pressure',
  'interface.prefs.stopProjecting': 'Stop projecting',
  'interface.prefs.projectCanvas': 'Project canvas',
}
export default dict
