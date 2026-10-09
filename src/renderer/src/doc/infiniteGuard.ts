import { t } from '../i18n'

/**
 * Hooks used by code that must refuse an operation on an infinite canvas without knowing about the UI.
 * The app wires `notify` to its toast; the default only logs (unit tests, headless use).
 */
export const guardHooks: { notify: (msg: string) => void } = {
  notify: (m) => void console.warn('[infinite]', m)
}

/** Show the translated "Not available on infinite canvas yet" toast. */
export function notAvailable(): void {
  guardHooks.notify(t('ui.inf.unavailable'))
}

/** Structural check without importing Document (avoids import cycles): `doc.kind === 'infinite'`. */
export const isInfiniteDoc = (doc: { kind?: string } | null | undefined): boolean => !!doc && doc.kind === 'infinite'

/** Actions-menu items that DO work on an infinite canvas; every other pixel-touching menu item is refused (see docs/INFINITE_CANVAS.md). */
const ACTIONS_OK = new Set([
  'export-png', 'export-png-bg', 'export-jpg', 'fit', 'reset-rot', 'prefs', 'prefs-pressure', 'prefs-gestures', 'prefs-shortcuts', 'prefs-diag',
  'cheatsheet', 'help', 'whatsnew', 'about', 'tutorial', 'tutorial-guide', 'brush-studio', 'brush-import', 'canvas-info', 'canvas-mirror',
  'quickshape-settings', 'project-canvas', 'add-camera', 'frame-panel', 'canvas-anim', 'canvas-page', 'share-pages-img', 'video-toggle', 'video-replay', 'video-export', 'video-settings', 'share-image', 'guide-toggle', 'guide-assist', 'guide-edit', 'text-style', 'text-raster', 'reference-window',
  // layer ops, clipboard, insert (tile-wise on infinite canvases)
  'add-file', 'add-photo', 'add-text', 'cp-cut', 'cp-copy', 'cp-copyall', 'cp-dup', 'cp-cutpaste', 'cp-paste', 'cp-menu', 'layer-flatten',
  'color-fill-layer', 'color-recolor-layer', 'color-fill-last',
  // bounded-canvas bridge: convert, flip around the work rect, PSD / PDF / layer export of the frame (else content bounds)
  'canvas-crop', 'canvas-to-infinite', 'canvas-flip-h', 'canvas-flip-v', 'share-psd', 'share-layers-png', 'share-layers-pdf', 'share-copy', 'share-pdf', 'canvas-profile'
])

/** true = this top-bar menu item must not run on an infinite canvas (the caller shows `notAvailable()`). */
export function blockedMenuItem(menu: string, id: string): boolean {
  if (menu === 'gallery') return false
  if (menu === 'actions') return !(ACTIONS_OK.has(id) || id.startsWith('inf-'))
  return false // adjustments, selection, transform all work on infinite canvases
}

/** Bindable actions (shortcuts / pen buttons / QuickMenu) that change whole layers or need selections. */
export const ACTIONS_BLOCKED = new Set<string>([])
