/**
 * View transform. (cx,cy) is the DOCUMENT point displayed at the screen centre.
 *   screen = S/2 + M * zoom * R(rot) * (p - c)      (M = diag(-1,1) when `mirror`, else identity)
 * All screen values are CSS pixels.
 */
export interface View {
  cx: number
  cy: number
  zoom: number
  /** radians, clockwise on screen */
  rot: number
  /** view-only horizontal mirror (Procreate "Flip canvas": the view is flipped, pixels are not) */
  mirror?: boolean
}

export const MIN_ZOOM = 0.02
export const MAX_ZOOM = 64

export function screenToDoc(v: View, sx: number, sy: number, sw: number, sh: number): { x: number; y: number } {
  const dx = (v.mirror ? -1 : 1) * (sx - sw / 2)
  const dy = sy - sh / 2
  const c = Math.cos(v.rot)
  const s = Math.sin(v.rot)
  return { x: v.cx + (c * dx + s * dy) / v.zoom, y: v.cy + (-s * dx + c * dy) / v.zoom }
}

export function docToScreen(v: View, px: number, py: number, sw: number, sh: number): { x: number; y: number } {
  const dx = px - v.cx
  const dy = py - v.cy
  const c = Math.cos(v.rot)
  const s = Math.sin(v.rot)
  return { x: sw / 2 + (v.mirror ? -1 : 1) * v.zoom * (c * dx - s * dy), y: sh / 2 + v.zoom * (s * dx + c * dy) }
}

/** Toggle the view-only horizontal mirror (pixels untouched). */
export function toggleMirrorView(v: View): View {
  const { mirror, ...rest } = v
  return mirror ? rest : { ...rest, mirror: true }
}

export const clampZoom = (z: number): number => Math.min(MAX_ZOOM, Math.max(MIN_ZOOM, z))

/** Return a view where document point (px,py) appears at screen (sx,sy) with given zoom/rot. */
export function anchorView(px: number, py: number, sx: number, sy: number, zoom: number, rot: number, sw: number, sh: number, mirror = false): View {
  zoom = clampZoom(zoom)
  const dx = (mirror ? -1 : 1) * (sx - sw / 2)
  const dy = sy - sh / 2
  const c = Math.cos(rot)
  const s = Math.sin(rot)
  return mirror ? { cx: px - (c * dx + s * dy) / zoom, cy: py - (-s * dx + c * dy) / zoom, zoom, rot, mirror } : { cx: px - (c * dx + s * dy) / zoom, cy: py - (-s * dx + c * dy) / zoom, zoom, rot }
}

export function zoomAt(v: View, sx: number, sy: number, factor: number, sw: number, sh: number): View {
  const p = screenToDoc(v, sx, sy, sw, sh)
  return anchorView(p.x, p.y, sx, sy, v.zoom * factor, v.rot, sw, sh, v.mirror)
}

export function rotateAt(v: View, sx: number, sy: number, dRot: number, sw: number, sh: number): View {
  const p = screenToDoc(v, sx, sy, sw, sh)
  // on-screen clockwise rotation is anticlockwise in document terms when the view is mirrored
  return anchorView(p.x, p.y, sx, sy, v.zoom, v.rot + (v.mirror ? -dRot : dRot), sw, sh, v.mirror)
}

export function panBy(v: View, dsx: number, dsy: number): View {
  const c = Math.cos(v.rot)
  const s = Math.sin(v.rot)
  if (v.mirror) dsx = -dsx
  return { ...v, cx: v.cx - (c * dsx + s * dsy) / v.zoom, cy: v.cy - (-s * dsx + c * dsy) / v.zoom }
}

/** Two-finger gesture step: previous & current centroid, distance ratio and angle delta. */
export function gestureStep(v: View, prev: { x: number; y: number }, cur: { x: number; y: number }, scale: number, dRot: number, sw: number, sh: number): View {
  const p = screenToDoc(v, prev.x, prev.y, sw, sh)
  return anchorView(p.x, p.y, cur.x, cur.y, v.zoom * scale, v.rot + (v.mirror ? -dRot : dRot), sw, sh, v.mirror)
}

export function fitView(docW: number, docH: number, sw: number, sh: number, margin = 48, mirror = false): View {
  const z = clampZoom(Math.min((sw - margin * 2) / docW, (sh - margin * 2) / docH))
  return mirror ? { cx: docW / 2, cy: docH / 2, zoom: z, rot: 0, mirror } : { cx: docW / 2, cy: docH / 2, zoom: z, rot: 0 }
}
