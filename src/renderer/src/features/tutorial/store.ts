import { Emitter } from '../../core/events'

/** Persisted tutorial state (localStorage): lesson checkmarks, seen hints, "show tips" switch, welcome flag. */
interface Saved {
  done: Record<string, boolean>
  hints: string[]
  showTips: boolean
  welcomed: boolean
}

const KEY = 'wincreative.tutorial.v1'
const fresh = (): Saved => ({ done: {}, hints: [], showTips: true, welcomed: false })

function load(): Saved {
  try {
    const raw = localStorage.getItem(KEY)
    if (!raw) return fresh()
    const j = JSON.parse(raw) as Partial<Saved>
    return {
      done: j.done && typeof j.done === 'object' ? j.done : {},
      hints: Array.isArray(j.hints) ? j.hints.filter((x) => typeof x === 'string') : [],
      showTips: j.showTips !== false,
      welcomed: !!j.welcomed
    }
  } catch {
    return fresh()
  }
}

class TutorialStore {
  readonly events = new Emitter<{ change: void }>()
  private s = load()

  private save(): void {
    try {
      localStorage.setItem(KEY, JSON.stringify(this.s))
    } catch {
      /* storage unavailable: progress lives for this session only */
    }
    this.events.emit('change', undefined)
  }

  isDone(id: string): boolean {
    return !!this.s.done[id]
  }
  doneCount(ids: string[]): number {
    return ids.filter((i) => this.s.done[i]).length
  }
  setDone(id: string, v = true): void {
    this.s.done[id] = v
    this.save()
  }
  resetProgress(): void {
    this.s.done = {}
    this.s.hints = []
    this.save()
  }

  get showTips(): boolean {
    return this.s.showTips
  }
  set showTips(v: boolean) {
    this.s.showTips = v
    this.save()
  }
  get welcomed(): boolean {
    return this.s.welcomed
  }
  set welcomed(v: boolean) {
    this.s.welcomed = v
    this.save()
  }
  hintSeen(id: string): boolean {
    return this.s.hints.includes(id)
  }
  markHint(id: string): void {
    if (!this.s.hints.includes(id)) {
      this.s.hints.push(id)
      this.save()
    }
  }
}

export const store = new TutorialStore()
