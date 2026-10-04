import { describe, expect, it } from 'vitest'
import { FrameTag, HistSig, HistoryTracker, computeKeep, pathToRoot } from '../src/renderer/src/features/animio/tlHistory'

/** A fake document history: the same counters UndoStack keeps, plus a recorder that tags a frame per commit. */
class Sim {
  sig: HistSig = { pushes: 0, undos: 0, redos: 0, clears: 0, undoCount: 0, redoCount: 0 }
  tracker: HistoryTracker
  frames: FrameTag[] = []
  limit: number
  constructor(limit = 300, init?: ConstructorParameters<typeof HistoryTracker>[1]) {
    this.limit = limit
    this.tracker = new HistoryTracker(this.sig, init)
  }
  private frame(type: string): number {
    const r = this.tracker.observe({ ...this.sig }, type)
    this.frames.push({ s: r.state, t: type })
    return r.state
  }
  /** a recorded initial frame (new canvas) */
  init(): void {
    this.frames.push({ s: this.tracker.curr, t: 'init' })
  }
  push(type = 'stroke'): number {
    this.sig.pushes++
    this.sig.redoCount = 0
    this.sig.undoCount = Math.min(this.limit, this.sig.undoCount + 1)
    return this.frame(type)
  }
  undo(): number {
    this.sig.undos++
    this.sig.undoCount--
    this.sig.redoCount++
    return this.frame('undo')
  }
  redo(): number {
    this.sig.redos++
    this.sig.redoCount--
    this.sig.undoCount++
    return this.frame('redo')
  }
  clear(): void {
    this.sig.clears++
    this.sig.undoCount = 0
    this.sig.redoCount = 0
  }
  keep(): boolean[] {
    return computeKeep(this.frames, this.tracker.parents).keep
  }
  /** t:s labels of the kept frames, to read assertions easily */
  kept(): string[] {
    const k = this.keep()
    return this.frames.filter((_, i) => k[i]).map((f) => `${f.t}:${f.s}`)
  }
}

describe('HistoryTracker', () => {
  it('push creates children, undo / redo reuse existing ids', () => {
    const s = new Sim()
    s.init()
    const a = s.push()
    const b = s.push()
    expect(s.tracker.parents).toEqual([-1, 0, 1])
    expect(s.undo()).toBe(a)
    expect(s.redo()).toBe(b)
    expect(s.tracker.parents).toEqual([-1, 0, 1]) // no new states
  })
  it('a push after undo starts a branch and drops the redo stack', () => {
    const s = new Sim()
    s.init()
    s.push()
    s.push()
    s.undo()
    const c = s.push()
    expect(s.tracker.parents[c]).toBe(1)
    expect(s.tracker.parents).toEqual([-1, 0, 1, 1])
  })
  it('undo to the very bottom returns to the root', () => {
    const s = new Sim()
    s.init()
    s.push()
    expect(s.undo()).toBe(0)
  })
  it('commits without a history change keep the state', () => {
    const s = new Sim()
    s.init()
    s.push()
    const r = s.tracker.observe({ ...s.sig }, 'layer-props')
    expect(r).toEqual({ state: 1, kind: 'none' })
  })
  it('history truncated at the step limit still undoes to the right states', () => {
    const s = new Sim(3)
    s.init()
    const ids = [s.push(), s.push(), s.push(), s.push(), s.push()] // states 1..5, stack keeps the last 3 (3,4,5)
    expect(s.sig.undoCount).toBe(3)
    expect(s.undo()).toBe(ids[3])
    expect(s.undo()).toBe(ids[2])
    expect(s.undo()).toBe(ids[1]) // the base: state 2 (after the dropped command 2)
    expect(s.redo()).toBe(ids[2])
  })
  it('history cleared: later pushes continue from the current state', () => {
    const s = new Sim()
    s.init()
    s.push()
    const b = s.push()
    s.clear()
    const c = s.push()
    expect(s.tracker.parents[c]).toBe(b)
    expect(s.undo()).toBe(b)
  })
  it('new / load commits continue from the last state', () => {
    const s = new Sim()
    s.init()
    const a = s.push()
    const r = s.tracker.observe({ ...s.sig }, 'load')
    expect(r.kind).toBe('reset')
    expect(s.tracker.parents[r.state]).toBe(a)
  })
  it('several history ops between two commits fall back to a fresh state', () => {
    const s = new Sim()
    s.init()
    s.push()
    s.sig.pushes += 2
    s.sig.undoCount += 2
    expect(s.tracker.observe({ ...s.sig }, 'stroke').kind).toBe('jump')
  })
  it('reopened document: restored tree, new states continue from the last state', () => {
    const s = new Sim()
    s.init()
    s.push()
    s.push()
    s.undo() // session 1 ends at state 1
    const s2 = new Sim(300, { parents: s.tracker.parents, curr: s.tracker.curr })
    s2.frames = [...s.frames]
    const c = s2.push()
    expect(s2.tracker.parents[c]).toBe(1)
    expect(s2.undo()).toBe(1)
  })
})

describe('computeKeep (hide undone actions)', () => {
  it('linear history keeps everything', () => {
    const s = new Sim()
    s.init()
    s.push()
    s.push()
    s.push()
    expect(s.keep()).toEqual([true, true, true, true])
    expect(computeKeep(s.frames, s.tracker.parents).hiddenActions).toBe(0)
  })
  it('a stroke that was undone disappears together with the undo', () => {
    const s = new Sim()
    s.init()
    s.push() // A
    s.push() // B
    s.undo()
    expect(s.kept()).toEqual(['init:0', 'stroke:1'])
    const r = computeKeep(s.frames, s.tracker.parents)
    expect(r.hiddenActions).toBe(1)
    expect(r.hiddenFrames).toBe(2)
  })
  it('undo then redo: the stroke stays, shown once, no flicker', () => {
    const s = new Sim()
    s.init()
    s.push()
    s.push()
    s.undo()
    s.redo()
    expect(s.kept()).toEqual(['init:0', 'stroke:1', 'stroke:2'])
  })
  it('multiple undos, partial redo', () => {
    const s = new Sim()
    s.init()
    s.push() // 1
    s.push() // 2
    s.push() // 3
    s.undo() // ->2
    s.undo() // ->1
    s.redo() // ->2
    expect(s.kept()).toEqual(['init:0', 'stroke:1', 'stroke:2']) // 3 was undone and not redone
  })
  it('branch after undo: the abandoned branch is hidden', () => {
    const s = new Sim()
    s.init()
    s.push() // 1 A
    s.push() // 2 B
    s.undo() // ->1
    s.push() // 3 C (branch from 1)
    expect(s.kept()).toEqual(['init:0', 'stroke:1', 'stroke:3'])
  })
  it('undo/redo storm followed by new work', () => {
    const s = new Sim()
    s.init()
    s.push()
    s.push()
    for (let i = 0; i < 5; i++) {
      s.undo()
      s.redo()
    }
    s.push()
    expect(s.kept()).toEqual(['init:0', 'stroke:1', 'stroke:2', 'stroke:3'])
  })
  it('undo to the root and everything is hidden except the start', () => {
    const s = new Sim()
    s.init()
    s.push()
    s.push()
    s.undo()
    s.undo()
    expect(s.kept()).toEqual(['init:0'])
  })
  it('mid-stroke frames belong to the stroke state', () => {
    const s = new Sim()
    s.init()
    const next = s.tracker.nextId
    s.frames.push({ s: next, t: 'live' })
    s.frames.push({ s: next, t: 'live' })
    expect(s.push()).toBe(next)
    s.undo()
    // stroke undone: live frames and the stroke frame are all hidden
    expect(s.kept()).toEqual(['init:0'])
    const s2 = new Sim()
    s2.init()
    const n2 = s2.tracker.nextId
    s2.frames.push({ s: n2, t: 'live' })
    s2.push()
    expect(s2.kept()).toEqual(['init:0', 'live:1', 'stroke:1'])
  })
  it('a state whose own frame was coalesced is shown by the undo frame that reaches it', () => {
    // A and B committed within one capture window: only a frame for B exists; undo B -> A has the only A frame
    const s = new Sim()
    s.init()
    s.push() // A (no frame recorded)
    s.frames.pop()
    s.push() // B
    s.undo() // -> A (nav frame)
    expect(s.kept()).toEqual(['init:0', 'undo:1'])
    // when B is then redone, the nav frame must not show A after B
    s.redo()
    expect(s.kept()).toEqual(['init:0', 'stroke:2'])
  })
  it('long session: the path is evaluated against the LAST recorded state', () => {
    const s = new Sim(100)
    s.init()
    for (let i = 0; i < 400; i++) s.push()
    for (let i = 0; i < 100; i++) s.undo() // all 100 stack steps undone: state 300
    const fin = computeKeep(s.frames, s.tracker.parents)
    expect(fin.finalState).toBe(300)
    expect(fin.keep.filter(Boolean).length).toBe(1 + 300)
    expect(fin.hiddenActions).toBe(100)
    // redo 50 -> final 350
    for (let i = 0; i < 50; i++) s.redo()
    expect(computeKeep(s.frames, s.tracker.parents).keep.filter(Boolean).length).toBe(1 + 350)
  })
  it('reopened document keeps earlier work and hides what was undone before closing', () => {
    const s = new Sim()
    s.init()
    s.push() // 1
    s.push() // 2
    s.undo() // ->1 (2 undone, session ends here)
    const s2 = new Sim(300, { parents: s.tracker.parents, curr: s.tracker.curr })
    s2.frames = [...s.frames]
    s2.push() // 3 child of 1
    expect(s2.kept()).toEqual(['init:0', 'stroke:1', 'stroke:3'])
  })
  it('crash-journal style restart: unknown state ids are dropped, tagged frames stay', () => {
    const parents = [-1, 0]
    const frames: FrameTag[] = [{ s: 0, t: 'init' }, { s: 1, t: 'stroke' }, { s: 7, t: 'stroke' }]
    const r = computeKeep(frames, parents)
    expect(r.keep).toEqual([true, true, false])
    expect(r.finalState).toBe(1)
  })
  it('old recordings without metadata: unsupported, everything kept', () => {
    const r = computeKeep([{}, {}, {}], [])
    expect(r.supported).toBe(false)
    expect(r.keep).toEqual([true, true, true])
  })
  it('mixed old + new frames: old frames always kept', () => {
    const r = computeKeep([{}, {}, { s: 0, t: 'init' }, { s: 1, t: 'stroke' }, { s: 2, t: 'stroke' }, { s: 1, t: 'undo' }], [-1, 0, 1])
    expect(r.keep).toEqual([true, true, true, true, false, false])
  })
  it('pathToRoot is cycle safe', () => {
    expect([...pathToRoot([1, 0], 0)].sort()).toEqual([0, 1])
  })
})
