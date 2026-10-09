import type { Document } from '../../doc/document'
import { clipMask } from '../../gl/clipMask'
import { Emitter } from '../../core/events'
import { normalizeFrame, sameRect, type FrameData } from './model'

/** Per-document frame storage + the glue to the GPU clip state (gl/clipMask.ts). */
const frames = new WeakMap<Document, FrameData | null>()
let active: Document | null = null

export const frameEvents = new Emitter<{ change: Document; commit: Document }>()

export function getFrame(doc: Document): FrameData | null {
  return frames.get(doc) ?? null
}

/** The document whose frame drives the GPU clip state. */
export function setActiveDoc(doc: Document | null): void {
  active = doc
  syncClip()
}

/** Push the active document's frame into `clipMask` (shaders). */
export function syncClip(): void {
  const doc = active
  const f = doc ? getFrame(doc) : null
  if (doc) clipMask.canvas = { w: doc.width, h: doc.height }
  clipMask.frame = f && f.enabled ? { x: f.x, y: f.y, w: f.w, h: f.h } : null
}

/** Set / clear the frame without an undo step (loading, live dragging). */
export function setFrameRaw(doc: Document, f: FrameData | null): void {
  const next = f ? normalizeFrame(f, doc.isInfinite ? undefined : { w: doc.width, h: doc.height }) : null
  frames.set(doc, next)
  if (doc === active) syncClip()
  frameEvents.emit('change', doc)
  doc.events.emit('change', { rect: null })
}

const same = (a: FrameData | null, b: FrameData | null): boolean => (!a || !b ? a === b : sameRect(a, b) && a.enabled === b.enabled && a.visible === b.visible)

/** Record `before -> after` (already applied or not) as ONE undo step and a commit event (autosave). */
export function commitFrame(doc: Document, before: FrameData | null, after: FrameData | null, label: string): void {
  if (same(before, after)) return
  setFrameRaw(doc, after)
  const b = before ? { ...before } : null
  const a = after ? { ...getFrame(doc)! } : null
  doc.pushCommand({ label, bytes: 0, undo: () => setFrameRaw(doc, b), redo: () => setFrameRaw(doc, a) })
  doc.emitCommit('frame', null, null, label)
  frameEvents.emit('commit', doc)
}

/** Undoable change of the frame (null removes it). `patch` merges into the current frame. */
export function editFrame(doc: Document, next: Partial<FrameData> | null, label: string): void {
  const before = getFrame(doc)
  if (next === null) return commitFrame(doc, before, null, label)
  if (!before && (next.w === undefined || next.h === undefined)) return
  const base: FrameData = before ?? { x: 0, y: 0, w: next.w!, h: next.h!, enabled: true, visible: true }
  commitFrame(doc, before, { ...base, ...next }, label)
}
