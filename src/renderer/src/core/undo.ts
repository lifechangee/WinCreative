import { historyLabel } from '../i18n'
export interface Command {
  label: string
  /** Optional metadata forwarded to the commit event bus on undo/redo. */
  layerId?: string | null
  dirtyRect?: { x: number; y: number; w: number; h: number } | null
  /** Approximate memory held by this command (bytes), for budgeting. */
  bytes: number
  undo(): void
  redo(): void
  /** Called when the command is evicted or discarded, to free resources. */
  dispose?(): void
}

export interface UndoOptions {
  /** Hard cap of steps kept. */
  maxSteps: number
  /** Memory budget; oldest steps beyond `minSteps` are dropped when exceeded. */
  maxBytes: number
  /** Never drop below this many steps because of the byte budget. */
  minSteps: number
}

export const DEFAULT_UNDO: UndoOptions = { maxSteps: 300, maxBytes: 1.5 * 1024 ** 3, minSteps: 100 }

export class UndoStack {
  private done: Command[] = []
  private undone: Command[] = []
  private bytes = 0
  onChange: (() => void) | null = null
  /** Monotonic operation counters (the time-lapse recorder mirrors the history tree from them). */
  pushes = 0
  undos = 0
  redos = 0
  clears = 0

  constructor(private opts: UndoOptions = DEFAULT_UNDO) {}

  get canUndo(): boolean {
    return this.done.length > 0
  }
  get canRedo(): boolean {
    return this.undone.length > 0
  }
  get undoCount(): number {
    return this.done.length
  }
  get redoCount(): number {
    return this.undone.length
  }
  get totalBytes(): number {
    return this.bytes
  }
  get nextUndoLabel(): string | null {
    return this.done.length ? this.done[this.done.length - 1].label : null
  }

  /** Push an already-applied command. Clears the redo branch. */
  push(cmd: Command): void {
    for (const c of this.undone) this.drop(c)
    this.undone = []
    cmd.label = historyLabel(cmd.label)
    this.pushes++
    this.done.push(cmd)
    this.bytes += cmd.bytes
    while (this.done.length > this.opts.maxSteps || (this.bytes > this.opts.maxBytes && this.done.length > this.opts.minSteps)) {
      this.drop(this.done.shift()!)
    }
    this.onChange?.()
  }

  undo(): Command | null {
    const c = this.done.pop()
    if (!c) return null
    c.undo()
    this.undos++
    this.undone.push(c)
    this.onChange?.()
    return c
  }

  redo(): Command | null {
    const c = this.undone.pop()
    if (!c) return null
    c.redo()
    this.redos++
    this.done.push(c)
    this.onChange?.()
    return c
  }

  clear(): void {
    this.clears++
    for (const c of this.done) this.drop(c)
    for (const c of this.undone) this.drop(c)
    this.done = []
    this.undone = []
    this.bytes = 0
    this.onChange?.()
  }

  private drop(c: Command): void {
    this.bytes -= c.bytes
    c.dispose?.()
  }
}
