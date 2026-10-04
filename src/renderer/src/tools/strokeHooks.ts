import type { Sample } from '../core/types'
import type { PaintMode } from '../gl/brushEngine'

/**
 * Stroke post-processing hooks used by PaintTool (Drawing Assist, symmetry, QuickShape, text auto-rasterize).
 * Feature modules register a factory; PaintTool asks every factory at stroke begin and chains the adapters.
 *
 *   raw sample -> adapter.input() [snap / hold-detect] -> for each channel: channel.sample() -> smoother -> path -> dabs
 */
export interface StrokeChannel {
  /** map an input sample to this channel's copy (mirror / rotate) */
  sample(s: Sample): Sample
  /** optional: adjust a dab (e.g. mirror its brush angle) for this channel */
  dab?<D extends { angle: number }>(d: D): D
}

/** Handle passed to adapters so they can rewrite the stroke drawn so far (QuickShape). */
export interface StrokeApi {
  readonly layerId: string
  readonly mode: PaintMode
  /** Discard the live stroke and re-stamp it from these samples (no smoothing). Ignored for smudge. */
  replace(samples: Sample[]): void
}

export interface StrokeAdapter {
  /** Parallel copies of the stroke. Omit for a single identity channel. */
  channels?: StrokeChannel[]
  /** Bypass the StreamLine smoother (exact geometry). */
  bypassSmoothing?: boolean
  /** Filter each raw sample (including the first). Return the samples to feed on. */
  input(s: Sample, api: StrokeApi): Sample[]
  /** Pointer released: return final samples to flush. */
  end?(api: StrokeApi): Sample[]
  cancel?(): void
}

export interface StrokeContext {
  first: Sample
  layerId: string
  mode: PaintMode
  toolId: string
}

type Factory = (ctx: StrokeContext) => StrokeAdapter | null
type BeforeBegin = (layerId: string) => void

class StrokeHooks {
  private factories: { id: string; make: Factory; order: number }[] = []
  private before: BeforeBegin[] = []
  /** Consumed by the next stroke instead of the factories (programmatic strokes, e.g. QuickShape re-render). */
  oneShot: StrokeAdapter | null = null

  register(id: string, make: Factory, order = 0): void {
    this.factories = this.factories.filter((f) => f.id !== id)
    this.factories.push({ id, make, order })
    this.factories.sort((a, b) => a.order - b.order)
  }

  /** Called before a stroke starts on a layer (e.g. rasterize a text layer). */
  onBeforeBegin(fn: BeforeBegin): void {
    this.before.push(fn)
  }
  beforeBegin(layerId: string): void {
    for (const f of this.before) {
      try {
        f(layerId)
      } catch (e) {
        console.error('beforeBegin hook failed', e)
      }
    }
  }

  create(ctx: StrokeContext): StrokeAdapter | null {
    if (this.oneShot) {
      const a = this.oneShot
      this.oneShot = null
      return a
    }
    const list: StrokeAdapter[] = []
    for (const f of this.factories) {
      try {
        const a = f.make(ctx)
        if (a) list.push(a)
      } catch (e) {
        console.error('stroke hook failed', e)
      }
    }
    if (!list.length) return null
    if (list.length === 1) return list[0]
    return combine(list)
  }
}

function combine(list: StrokeAdapter[]): StrokeAdapter {
  const channels = list.flatMap((a) => a.channels ?? [])
  return {
    channels: channels.length ? channels : undefined,
    get bypassSmoothing() {
      return list.some((a) => a.bypassSmoothing)
    },
    input(s, api) {
      let cur: Sample[] = [s]
      for (const a of list) {
        const next: Sample[] = []
        for (const c of cur) next.push(...a.input(c, api))
        cur = next
      }
      return cur
    },
    end(api) {
      let out: Sample[] = []
      for (let i = 0; i < list.length; i++) {
        let cur = list[i].end?.(api) ?? []
        // flush through the remaining adapters
        for (let j = i + 1; j < list.length; j++) {
          const next: Sample[] = []
          for (const c of cur) next.push(...list[j].input(c, api))
          cur = next
        }
        out = out.concat(cur)
      }
      return out
    },
    cancel() {
      for (const a of list) a.cancel?.()
    }
  }
}

export const strokeHooks = new StrokeHooks()
