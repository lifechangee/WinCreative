import type { BrushPreset } from './brush'
import type { RGB } from './colorDyn'
import { DabEx, DynamicsContext, applyEndTaper, computeDabs, makeRng, spacingPx, taperActive } from './dynamics'
import { InputStabilizer } from './stabilizer'
import { PathPoint, StrokeBuilder } from './stroke'
import type { Sample } from './types'

export type PaintMode = 'paint' | 'erase' | 'smudge'

/** Receives finished dabs. target 0 = primary brush, 1 = dual (secondary) brush. */
export interface DabSink {
  stamp(dabs: DabEx[], target: 0 | 1): void
  /** clear the stroke buffers: the same dabs are about to be stamped again (end taper) */
  restart(): void
}

export interface PipelineOptions {
  preset: BrushPreset
  /** diameter in px */
  size: number
  mode: PaintMode
  color: RGB
  secondary: RGB
  /** global pressure curve */
  curve: (p: number) => number
  /** resolved StreamLine settings (amount already includes overrides) */
  smoothing: { amount: number; mode: 'exp' | 'lazy'; lazyRadius: number }
  seed: number
  /** canvas rotation (radians) to cancel when the brush is oriented to the screen */
  orientOffset?: number
  /** feed samples through unfiltered (exact geometry: QuickShape, guides) */
  raw?: boolean
}

const DEG = Math.PI / 180

class Track {
  builder: StrokeBuilder
  ctx: DynamicsContext
  stored: DabEx[] | null = null
  prs: number[] = []
  lastDist = 0
  private prevDist = 0

  constructor(
    readonly b: BrushPreset,
    readonly target: 0 | 1,
    readonly opts: PipelineOptions,
    baseSize: number,
    seed: number,
    store: boolean
  ) {
    this.ctx = {
      baseSize,
      curve: opts.curve,
      rand: makeRng(seed),
      color: opts.color,
      secondary: opts.secondary,
      orientOffset: b.props.orientToScreen ? opts.orientOffset ?? 0 : 0
    }
    this.builder = new StrokeBuilder((s) => spacingPx(b, this.ctx, s))
    if (store) this.stored = []
  }

  convert(pts: PathPoint[], pick: { x: number; y: number; init: boolean } | null, parent: BrushPreset | null, dualFlow: number): DabEx[] {
    const out: DabEx[] = []
    const b = this.b
    for (const pt of pts) {
      this.ctx.pointerType = pt.pointerType
      const gap = pt.distance - this.prevDist
      this.prevDist = pt.distance
      this.lastDist = pt.distance
      const ds = computeDabs(b, pt, this.ctx)
      const pr = this.ctx.curve(pt.pressure)
      for (let i = 0; i < ds.length; i++) {
        const d = ds[i]
        // spacing is clamped to >= 0.25px: compensate so coverage matches the intended dab density for tiny brushes
        if (i === 0 && gap > 0 && gap < 0.5) {
          const nominal = d.size * b.spacing
          if (nominal < gap * 0.98 && d.alpha < 1) d.alpha = 1 - Math.pow(1 - d.alpha, gap / nominal)
        }
        if (parent) d.angle += parent.angle * DEG + parent.shape.follow * pt.angle
        d.alpha *= dualFlow
        if (pick) {
          if (!pick.init) {
            pick.x = d.x
            pick.y = d.y
            pick.init = true
          }
          d.px = pick.x
          d.py = pick.y
          pick.x += (d.x - pick.x) * 0.35
          pick.y += (d.y - pick.y) * 0.35
        }
        out.push(d)
        this.stored?.push(d)
        this.prs.push(pr)
      }
    }
    return out
  }
}

/**
 * Turns raw samples into GPU-ready dabs: stabilisation -> speed -> path (Catmull-Rom + spacing)
 * -> dynamics (pressure/tilt/roll/speed/jitter/colour) -> optional dual brush -> sink.
 * Pure logic: the sink is the only thing that touches the GPU, so previews reuse this class.
 */
export class StrokePipeline {
  private stab: InputStabilizer
  private tracks: Track[] = []
  private pick: { x: number; y: number; init: boolean } | null = null
  private prevOut: Sample | null = null
  private speed = 0
  private lastPointer: 'pen' | 'mouse' | 'touch' | undefined
  private ended = false

  constructor(
    private opts: PipelineOptions,
    private sink: DabSink
  ) {
    const b = opts.preset
    const st = b.stab
    this.stab = new InputStabilizer({
      amount: opts.smoothing.amount,
      mode: opts.smoothing.mode,
      lazyRadius: opts.smoothing.lazyRadius,
      streamlinePressure: st.streamlinePressure,
      stabilization: st.stabilization,
      motionFiltering: st.motionFiltering,
      motionExpression: st.motionExpression
    })
    const ta = taperActive(b)
    const store = opts.mode !== 'smudge' && ta.end
    this.tracks.push(new Track(b, 0, opts, opts.size, opts.seed, store))
    const d = b.dual
    if (opts.mode !== 'smudge' && d.enabled && d.brush) {
      const sb = d.brush
      const size = Math.max(0.5, d.scaleFollow ? opts.size * d.size : sb.defaultSize * d.size)
      this.tracks.push(new Track(sb, 1, opts, size, opts.seed + 7919, store))
    }
    if (opts.mode === 'smudge') this.pick = { x: 0, y: 0, init: false }
  }

  /** Feed one raw pointer sample (document coordinates). */
  push(raw: Sample): void {
    if (this.ended) return
    this.lastPointer = raw.pointerType ?? this.lastPointer
    this.feed(this.opts.raw ? { ...raw } : this.stab.push(raw))
  }

  private feed(s: Sample): void {
    if (this.prevOut) {
      const dt = Math.max(1, s.t - this.prevOut.t)
      const v = Math.hypot(s.x - this.prevOut.x, s.y - this.prevOut.y) / dt
      this.speed += (v - this.speed) * 0.35
    }
    this.prevOut = s
    s.speed = this.speed
    if (this.lastPointer && !s.pointerType) s.pointerType = this.lastPointer
    this.emit(this.tracks.map((t) => t.builder.push(s)))
  }

  private emit(perTrack: PathPoint[][]): void {
    for (let i = 0; i < this.tracks.length; i++) {
      const t = this.tracks[i]
      const pts = perTrack[i]
      if (!pts.length) continue
      const parent = i > 0 && this.opts.preset.dual.followOrient ? this.opts.preset : null
      const dabs = t.convert(pts, i === 0 ? this.pick : null, parent, i > 0 ? this.opts.preset.dual.flow : 1)
      if (dabs.length) this.sink.stamp(dabs, t.target)
    }
  }

  /** Flush lag and the final path segment. Call restamp() afterwards if needsRestamp. */
  finish(): void {
    if (this.ended) return
    if (!this.opts.raw) for (const s of this.stab.finish()) this.feed(s)
    this.emit(this.tracks.map((t) => t.builder.end()))
    this.ended = true
  }

  /** true when the end taper needs the whole stroke to be stamped again with the final length known */
  get needsRestamp(): boolean {
    const t0 = this.tracks[0]
    return !!t0.stored && t0.stored.length > 0 && t0.lastDist > 6
  }

  /** Stamp the stored dabs again with end taper applied (the sink buffers were cleared by the caller). */
  restamp(): void {
    const t0 = this.tracks[0]
    if (!t0.stored) return
    const total = t0.lastDist
    const ptype = this.lastPointer
    for (let i = 0; i < t0.stored.length; i++) applyEndTaper(t0.b, t0.stored[i], total - t0.stored[i].dist, t0.ctx.baseSize, ptype, t0.prs[i])
    for (let i = 0; i < t0.stored.length; i += 2048) this.sink.stamp(t0.stored.slice(i, i + 2048), 0)
    // the dual brush follows the same path but has no end taper of its own: restamp unchanged
    for (let k = 1; k < this.tracks.length; k++) {
      const tk = this.tracks[k]
      if (tk.stored) for (let i = 0; i < tk.stored.length; i += 2048) this.sink.stamp(tk.stored.slice(i, i + 2048), 1)
    }
  }

  /** Finish the stroke: flush lag, final segment, end taper (single pipeline convenience). */
  end(): void {
    if (this.ended) return
    this.finish()
    if (this.needsRestamp) {
      this.sink.restart()
      this.restamp()
    }
  }
}
