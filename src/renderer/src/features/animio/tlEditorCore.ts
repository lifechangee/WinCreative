import { Emitter } from '../../core/events'
import { prefs } from '../../input/prefs'
import type { TimelapseRecorder } from './timelapse'
import { FrameTag, KeepResult, computeKeep } from './tlHistory'
import { Schedule, TlEdit, buildSchedule, cloneEdit, clampEditToFrames, defaultEdit, editsEqual } from './tlModel'

/**
 * Non-visual state of the time-lapse editor: the edit model with its own undo / redo stack, the frame tags, the kept
 * frames (hide undone actions) and the schedule everything (preview, timeline, export) is derived from. Frames are
 * decoded lazily from the on-disk store through small LRU caches - the recording never has to fit in memory.
 */
export interface CoreEvents {
  /** edit / kept frames / schedule changed */
  change: void
  history: void
}

const FULL_CACHE = 36
const THUMB_CACHE = 900
export const THUMB_W = 96

export class TlEditorCore {
  readonly events = new Emitter<CoreEvents>()
  tags: (FrameTag & { d: number })[] = []
  keepInfo!: KeepResult
  /** per source frame: shown in the video */
  shown: boolean[] = []
  /** source indices of shown frames, ascending */
  kept: number[] = []
  /** nextKept[i] = first shown frame index >= i (n when none) */
  nextKept: Int32Array = new Int32Array(0)
  schedule!: Schedule
  private undoStack: TlEdit[] = []
  private redoStack: TlEdit[] = []
  private dragBase: TlEdit | null = null
  private disposed = false

  private full = new Map<number, ImageBitmap>()
  private fullLoads = new Map<number, Promise<ImageBitmap | null>>()
  private thumbs = new Map<number, ImageBitmap>()
  private thumbLoads = new Map<number, Promise<ImageBitmap | null>>()
  private thumbQueue: (() => void)[] = []
  private thumbActive = 0

  constructor(readonly rec: TimelapseRecorder) {}

  get n(): number {
    return this.tags.length
  }
  get edit(): TlEdit {
    return this.rec.edit
  }
  get canUndo(): boolean {
    return this.undoStack.length > 0
  }
  get canRedo(): boolean {
    return this.redoStack.length > 0
  }

  async load(): Promise<void> {
    this.tags = await this.rec.tags()
    this.recompute()
  }

  /** Can undone actions be hidden for this recording (frames carry history metadata)? */
  get hideSupported(): boolean {
    return this.keepInfo.supported
  }

  recompute(): void {
    const n = this.tags.length
    const fixed = clampEditToFrames(this.rec.edit, n)
    if (!editsEqual(fixed, this.rec.edit)) this.rec.edit = fixed
    this.keepInfo = computeKeep(this.tags, this.rec.tracker.parents)
    const useKeep = this.rec.edit.hideUndone && this.keepInfo.supported
    this.shown = useKeep ? this.keepInfo.keep : new Array(n).fill(true)
    this.kept = []
    for (let i = 0; i < n; i++) if (this.shown[i]) this.kept.push(i)
    if (!this.kept.length && n) {
      // never an empty video: fall back to the last frame
      this.kept = [n - 1]
      this.shown[n - 1] = true
    }
    this.nextKept = new Int32Array(n + 1)
    this.nextKept[n] = n
    for (let i = n - 1; i >= 0; i--) this.nextKept[i] = this.shown[i] ? i : this.nextKept[i + 1]
    this.schedule = buildSchedule(this.kept, this.rec.edit)
    this.events.emit('change', undefined)
  }

  // ------------------------------------------------------------ editing (own undo / redo)
  /** Apply a finished edit as ONE undo step. */
  commit(next: TlEdit): void {
    if (editsEqual(next, this.rec.edit)) return
    this.undoStack.push(cloneEdit(this.rec.edit))
    if (this.undoStack.length > 200) this.undoStack.shift()
    this.redoStack = []
    this.rec.setEdit(next)
    this.recompute()
    this.events.emit('history', undefined)
  }
  /** Start a continuous change (drag): `live()` updates without history, `end()` records one undo step. */
  begin(): void {
    this.dragBase = cloneEdit(this.rec.edit)
  }
  live(next: TlEdit): void {
    if (!this.dragBase) this.begin()
    this.rec.setEdit(next)
    this.recompute()
  }
  end(): void {
    const base = this.dragBase
    this.dragBase = null
    if (!base || editsEqual(base, this.rec.edit)) return
    this.undoStack.push(base)
    this.redoStack = []
    this.events.emit('history', undefined)
  }
  undo(): void {
    const prev = this.undoStack.pop()
    if (!prev) return
    this.redoStack.push(cloneEdit(this.rec.edit))
    this.rec.setEdit(prev)
    this.recompute()
    this.events.emit('history', undefined)
  }
  redo(): void {
    const next = this.redoStack.pop()
    if (!next) return
    this.undoStack.push(cloneEdit(this.rec.edit))
    this.rec.setEdit(next)
    this.recompute()
    this.events.emit('history', undefined)
  }
  /** Back to the untouched recording (undoable). */
  reset(): void {
    this.commit(defaultEdit(prefs.v.timelapseHideUndone))
  }

  // ------------------------------------------------------------ frames
  /** Full-size frame (LRU). */
  frame(i: number): Promise<ImageBitmap | null> {
    const hit = this.full.get(i)
    if (hit) {
      this.full.delete(i)
      this.full.set(i, hit)
      return Promise.resolve(hit)
    }
    let p = this.fullLoads.get(i)
    if (!p) {
      p = this.rec.frame(i).then(async (bytes) => {
        this.fullLoads.delete(i)
        if (!bytes || this.disposed) return null
        const bmp = await createImageBitmap(new Blob([bytes as unknown as BlobPart], { type: 'image/jpeg' }))
        if (this.disposed) {
          bmp.close()
          return null
        }
        this.full.set(i, bmp)
        while (this.full.size > FULL_CACHE) {
          const k = this.full.keys().next().value as number
          this.full.get(k)?.close()
          this.full.delete(k)
        }
        return bmp
      })
      this.fullLoads.set(i, p)
    }
    return p
  }
  /** Cached thumbnail, or null (and a lazy load is queued; `onReady` fires when it arrives). */
  thumb(i: number, onReady: () => void): ImageBitmap | null {
    const hit = this.thumbs.get(i)
    if (hit) return hit
    if (!this.thumbLoads.has(i)) {
      const p = new Promise<ImageBitmap | null>((resolve) => {
        const run = (): void => {
          this.thumbActive++
          this.rec
            .frame(i)
            .then(async (bytes) => {
              if (!bytes || this.disposed) return null
              return createImageBitmap(new Blob([bytes as unknown as BlobPart], { type: 'image/jpeg' }), { resizeWidth: THUMB_W, resizeQuality: 'low' })
            })
            .catch(() => null)
            .then((bmp) => {
              this.thumbActive--
              this.thumbQueue.shift()?.()
              resolve(bmp)
            })
        }
        if (this.thumbActive < 3) run()
        else this.thumbQueue.push(run)
      }).then((bmp) => {
        this.thumbLoads.delete(i)
        if (bmp) {
          if (this.disposed) bmp.close()
          else {
            this.thumbs.set(i, bmp)
            while (this.thumbs.size > THUMB_CACHE) {
              const k = this.thumbs.keys().next().value as number
              this.thumbs.get(k)?.close()
              this.thumbs.delete(k)
            }
            onReady()
          }
        }
        return bmp
      })
      this.thumbLoads.set(i, p)
    }
    return null
  }
  dispose(): void {
    this.disposed = true
    for (const b of this.full.values()) b.close()
    for (const b of this.thumbs.values()) b.close()
    this.full.clear()
    this.thumbs.clear()
  }
}
