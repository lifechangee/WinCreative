/**
 * Pure history-tree logic for "hide undone actions" in the time-lapse editor (no DOM / GL, unit-tested).
 *
 * The recorder mirrors the document's undo stack with a `HistoryTracker`: every committed operation either creates a
 * new history STATE (a node of a tree, `parents[id]` = the state it was derived from), or moves between existing
 * states (undo / redo reuse the ids, so redo after undo returns to the SAME state). Every captured frame is tagged
 * with the state it shows and the commit type. `computeKeep` then keeps the frames that lie on the path from the
 * root to the FINAL state; undone-and-not-redone branches vanish together with the undo/redo frames that visited
 * them.
 */

/** Counters + sizes read from `doc.history` (see UndoStack: pushes / undos / redos / clears are monotonic). */
export interface HistSig {
  pushes: number
  undos: number
  redos: number
  clears: number
  undoCount: number
  redoCount: number
}

export type TrackKind = 'push' | 'undo' | 'redo' | 'none' | 'reset' | 'jump'

export interface TrackerInit {
  parents: number[]
  /** the state the document is in (last recorded) */
  curr: number
}

export class HistoryTracker {
  /** parents[id] = parent state (-1 for the root) */
  parents: number[]
  curr: number
  /** state reached by undoing everything that is still on the (possibly truncated) undo stack */
  private base: number
  private done: number[] = []
  private undone: number[] = []
  private last: HistSig

  /**
   * @param sig  history counters right now (the baseline: only later changes count)
   * @param init a restored tree (reopened document: the undo stack is gone, a new state continues from `curr`)
   */
  constructor(sig: HistSig, init?: TrackerInit) {
    if (init && init.parents.length) {
      this.parents = init.parents.slice()
      this.curr = init.curr >= 0 && init.curr < this.parents.length ? init.curr : this.parents.length - 1
    } else {
      this.parents = [-1]
      this.curr = 0
    }
    this.base = this.curr
    this.last = { ...sig }
  }

  /** id the next created state will get (mid-stroke frames are tagged with it). */
  get nextId(): number {
    return this.parents.length
  }

  private alloc(): number {
    this.parents.push(this.curr)
    return this.parents.length - 1
  }

  /** Update from a commit event; returns the state the document is in now and what happened. */
  observe(sig: HistSig, type: string): { state: number; kind: TrackKind } {
    const dp = sig.pushes - this.last.pushes
    const du = sig.undos - this.last.undos
    const dr = sig.redos - this.last.redos
    const dc = sig.clears - this.last.clears
    this.last = { ...sig }
    if (dc > 0) {
      // history cleared (limit / explicit): the states stay, but nothing can be undone any more
      this.done = []
      this.undone = []
      this.base = this.curr
    }
    if (type === 'new' || type === 'load') {
      // the whole document was replaced: continue from the last state as a new child, nothing to undo
      this.curr = this.alloc()
      this.done = []
      this.undone = []
      this.base = this.curr
      return { state: this.curr, kind: 'reset' }
    }
    const ops = dp + du + dr
    let kind: TrackKind = 'none'
    if (ops === 0) {
      kind = 'none'
    } else if (ops === 1 && dp === 1) {
      this.curr = this.alloc()
      this.done.push(this.curr)
      this.undone = []
      kind = 'push'
    } else if (ops === 1 && du === 1) {
      const s = this.done.pop()
      if (s === undefined) kind = this.jump()
      else {
        this.undone.push(s)
        this.curr = this.done.length ? this.done[this.done.length - 1] : this.base
        kind = 'undo'
      }
    } else if (ops === 1 && dr === 1) {
      const s = this.undone.pop()
      if (s === undefined) kind = this.jump()
      else {
        this.done.push(s)
        this.curr = s
        kind = 'redo'
      }
    } else {
      kind = this.jump()
    }
    this.reconcile(sig)
    return { state: this.curr, kind }
  }

  /** Several history operations between two commit events (or an unknown one): continue with a fresh state. */
  private jump(): TrackKind {
    this.curr = this.alloc()
    this.done = []
    this.undone = []
    this.base = this.curr
    return 'jump'
  }

  /** Keep the shadow stack the size of the real one (the undo stack drops its oldest steps beyond its limit). */
  private reconcile(sig: HistSig): void {
    while (this.done.length > sig.undoCount) this.base = this.done.shift()!
    while (this.undone.length > sig.redoCount) this.undone.shift()
  }
}

// ------------------------------------------------------------------ keep computation

export interface FrameTag {
  /** history state id the frame shows; undefined = recorded without metadata (old recordings) */
  s?: number
  /** commit type that produced the frame ('stroke', 'undo', 'redo', 'live' = mid-stroke, ...) */
  t?: string
}

export interface KeepResult {
  /** per frame: shown in the edited video */
  keep: boolean[]
  /** metadata is present, so hiding undone actions is meaningful */
  supported: boolean
  /** final state of the recording (-1 = unknown) */
  finalState: number
  /** number of distinct undone (off-path) states that had frames */
  hiddenActions: number
  /** number of frames removed */
  hiddenFrames: number
}

export const isNavType = (t: string | undefined): boolean => t === 'undo' || t === 'redo'

/** Ancestors of `s` including itself (root last). Cycle-safe. */
export function pathToRoot(parents: number[], s: number): Set<number> {
  const out = new Set<number>()
  let c = s
  while (c >= 0 && c < parents.length && !out.has(c)) {
    out.add(c)
    c = parents[c]
  }
  return out
}

/** Depth of a state in the tree (root = 0), memoised. */
function depthOf(parents: number[], s: number, memo: Map<number, number>): number {
  const chain: number[] = []
  let c = s
  while (c >= 0 && c < parents.length && !memo.has(c) && chain.length <= parents.length) {
    chain.push(c)
    c = parents[c]
  }
  let d = c >= 0 && memo.has(c) ? memo.get(c)! : -1
  for (let i = chain.length - 1; i >= 0; i--) memo.set(chain[i], ++d)
  return memo.get(s) ?? 0
}

/**
 * Which frames survive "hide undone actions".
 *
 *  - A frame whose state is not on the root -> FINAL path is dropped (its action was undone and never redone, or it
 *    belongs to a branch abandoned by drawing after an undo).
 *  - Undo / redo frames are navigation: they re-show a state that already has its own frame, so they are dropped
 *    unless they show a state deeper than anything shown so far (the state's own frame was merged into a neighbour by
 *    capture coalescing). This removes all undo / redo flicker: a redone stroke appears once.
 *  - Frames without metadata are always kept.
 * FINAL = the state of the last recorded frame that has a known state (long sessions: the path is evaluated against
 * the LAST recorded state, not the history stack depth).
 */
export function computeKeep(frames: FrameTag[], parents: number[]): KeepResult {
  const n = frames.length
  const known = (s: number | undefined): s is number => s !== undefined && s >= 0 && s < parents.length
  const supported = parents.length > 0 && frames.some((f) => f.s !== undefined)
  if (!supported) return { keep: new Array(n).fill(true), supported: false, finalState: -1, hiddenActions: 0, hiddenFrames: 0 }
  let finalState = -1
  for (let i = n - 1; i >= 0; i--)
    if (known(frames[i].s)) {
      finalState = frames[i].s!
      break
    }
  const onPath = pathToRoot(parents, finalState)
  const memo = new Map<number, number>()
  const keep: boolean[] = new Array(n)
  let maxDepth = -1
  const hidden = new Set<number>()
  let hiddenFrames = 0
  for (let i = 0; i < n; i++) {
    const f = frames[i]
    let k: boolean
    if (f.s === undefined) k = true
    else if (!known(f.s) || !onPath.has(f.s)) k = false
    else if (isNavType(f.t)) k = depthOf(parents, f.s, memo) > maxDepth
    else k = true
    if (k && known(f.s)) maxDepth = Math.max(maxDepth, depthOf(parents, f.s, memo))
    keep[i] = k
    if (!k) {
      hiddenFrames++
      if (known(f.s) && !onPath.has(f.s) && f.t !== 'live') hidden.add(f.s)
    }
  }
  return { keep, supported: true, finalState, hiddenActions: hidden.size, hiddenFrames }
}
