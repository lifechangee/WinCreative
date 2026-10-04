import { describe, expect, it } from 'vitest'
import { cloneBrush, defaultBrush, normalizeBrush, clampBrushSize } from '../src/renderer/src/core/brush'
import { computeDabs, makeRng, spacingPx, taperFactors, applyEndTaper, speedNorm, tiltAmount } from '../src/renderer/src/core/dynamics'
import { StrokePipeline, DabSink } from '../src/renderer/src/core/pipeline'
import { InputStabilizer } from '../src/renderer/src/core/stabilizer'
import type { PathPoint } from '../src/renderer/src/core/stroke'
import type { Sample } from '../src/renderer/src/core/types'

const S = (x: number, y: number, p = 1, t = 0): Sample => ({ x, y, pressure: p, tiltX: 0, tiltY: 0, twist: 0, t, pointerType: 'pen' })
const PT = (o: Partial<PathPoint> = {}): PathPoint => ({ x: 10, y: 10, pressure: 1, tiltX: 0, tiltY: 0, twist: 0, t: 0, angle: 0, distance: 500, ...o })
const ctx = (o = {}) => ({ baseSize: 100, curve: (p: number) => p, rand: makeRng(7), color: [1, 0, 0] as [number, number, number], ...o })

describe('normalizeBrush', () => {
  it('fills every group with defaults', () => {
    const b = normalizeBrush({ id: 'a', name: 'A' })
    expect(b.path.fallOffLength).toBe(400)
    expect(b.taper.pressure.size).toBeGreaterThan(0)
    expect(b.grain.filtering).toBe('improved')
    expect(b.dual.enabled).toBe(false)
    expect(b.props.maxSize).toBeGreaterThan(b.props.minSize)
  })
  it('migrates legacy dynamics flags', () => {
    const b = normalizeBrush({ id: 'a', name: 'A', dynamics: { followStroke: true, tiltAngle: true } as never })
    expect(b.shape.follow).toBe(1)
    expect(b.shape.inputStyle).toBe('azimuth')
    expect(b.dynamics.followStroke).toBeUndefined()
  })
  it('deep merges partial nested objects and keeps the dual secondary normalized', () => {
    const b = normalizeBrush({ id: 'a', name: 'A', taper: { pressure: { start: 0.4 } }, dual: { enabled: true, brush: { id: 'd', name: 'D', spacing: 0.5 } } })
    expect(b.taper.pressure.start).toBe(0.4)
    expect(b.taper.pressure.end).toBe(0)
    expect(b.dual.brush?.spacing).toBe(0.5)
    expect(b.dual.brush?.dual.enabled).toBe(false)
  })
  it('survives a JSON round trip', () => {
    const b = normalizeBrush({ id: 'a', name: 'A', dynamics: { pressureCurve: [[0, 0], [0.5, 0.8], [1, 1]] }, dual: { enabled: true, brush: { id: 'd', name: 'D' } } })
    const c = normalizeBrush(JSON.parse(JSON.stringify(b)))
    expect(c).toEqual(b)
    expect(cloneBrush(b)).toEqual(b)
  })
  it('size clamp follows Properties', () => {
    const b = normalizeBrush({ id: 'a', name: 'A', props: { maxSize: 50, minSize: 5 } })
    expect(clampBrushSize(b, 500)).toBe(50)
    expect(clampBrushSize(b, 1)).toBe(5)
  })
})

describe('dynamics', () => {
  it('speed drives size, opacity and spacing', () => {
    const b = normalizeBrush({ id: 'a', name: 'A', dynamics: { pressureSize: 0, speedSize: -0.5, speedOpacity: -0.5, speedSpacing: 1 } })
    const noSize = normalizeBrush({ id: 'a', name: 'A', dynamics: { pressureSize: 0, speedSpacing: 1 } })
    const slow = computeDabs(b, PT({ speed: 0 }), ctx())[0]
    const fast = computeDabs(b, PT({ speed: 3 }), ctx())[0]
    expect(fast.size).toBeLessThan(slow.size)
    expect(fast.alpha).toBeLessThan(slow.alpha)
    const sp0 = spacingPx(noSize, ctx(), { pressure: 1, tiltX: 0, tiltY: 0, speed: 0 })
    const sp1 = spacingPx(noSize, ctx(), { pressure: 1, tiltX: 0, tiltY: 0, speed: 3 })
    expect(sp1).toBeGreaterThan(sp0)
    expect(speedNorm(99)).toBe(1)
  })
  it('tilt trigger angle delays the tilt effect', () => {
    const b = normalizeBrush({ id: 'a', name: 'A', dynamics: { tiltTrigger: 45, tiltOpacity: 1 } })
    expect(tiltAmount(b, 30, 0)).toBe(0)
    expect(tiltAmount(b, 90, 0)).toBe(1)
    expect(computeDabs(b, PT({ tiltX: 30 }), ctx())[0].alpha).toBe(1)
    expect(computeDabs(b, PT({ tiltX: 90 }), ctx())[0].alpha).toBeCloseTo(0, 5)
  })
  it('pressure graph reshapes pressure', () => {
    const b = normalizeBrush({ id: 'a', name: 'A', dynamics: { pressureSize: 1, pressureCurve: [[0, 0], [0.5, 1], [1, 1]] } })
    expect(computeDabs(b, PT({ pressure: 0.5 }), ctx())[0].size).toBeGreaterThan(90)
  })
  it('count creates several stamps and jitter offsets them', () => {
    const b = normalizeBrush({ id: 'a', name: 'A', shape: { count: 5 }, path: { lateralJitter: 1 } })
    const d = computeDabs(b, PT(), ctx())
    expect(d.length).toBe(5)
    expect(new Set(d.map((x) => x.y.toFixed(3))).size).toBeGreaterThan(1)
  })
  it('roundness jitter keeps roundness in range and swaps axes when needed', () => {
    const b = normalizeBrush({ id: 'a', name: 'A', shape: { roundnessJitterH: 1, roundnessJitterV: 0 } })
    for (let i = 0; i < 40; i++) {
      const d = computeDabs(b, PT(), ctx({ rand: makeRng(i) }))[0]
      expect(d.roundness).toBeGreaterThanOrEqual(0.05)
      expect(d.roundness).toBeLessThanOrEqual(1)
    }
  })
  it('orient to screen cancels canvas rotation', () => {
    const b = normalizeBrush({ id: 'a', name: 'A', angle: 30 })
    const d = computeDabs(b, PT(), ctx({ orientOffset: 0.5 }))[0]
    expect(d.angle).toBeCloseTo((30 * Math.PI) / 180 - 0.5, 6)
  })
  it('colour dynamics: secondary colour, hue jitter and pressure colour', () => {
    const sec = normalizeBrush({ id: 'a', name: 'A', color: { pressure: { secondary: 1 } } })
    const d = computeDabs(sec, PT({ pressure: 1 }), ctx({ secondary: [0, 0, 1] }))[0]
    expect([d.r, d.g, d.b]).toEqual([0, 0, 1])
    const jit = normalizeBrush({ id: 'a', name: 'A', color: { stampJitter: { hue: 1 } } })
    const c = ctx()
    const hues = new Set(Array.from({ length: 20 }, () => computeDabs(jit, PT(), c)[0].g.toFixed(2)))
    expect(hues.size).toBeGreaterThan(5)
    const plain = computeDabs(normalizeBrush({ id: 'a', name: 'A' }), PT(), ctx())[0]
    expect([plain.r, plain.g, plain.b]).toEqual([1, 0, 0])
  })
  it('stroke colour jitter is constant within a stroke', () => {
    const b = normalizeBrush({ id: 'a', name: 'A', color: { strokeJitter: { hue: 1 } } })
    const c = ctx()
    const a1 = computeDabs(b, PT(), c)[0]
    const a2 = computeDabs(b, PT({ distance: 900 }), c)[0]
    expect([a1.r, a1.g, a1.b]).toEqual([a2.r, a2.g, a2.b])
  })
  it('fall off fades the stroke along its length', () => {
    const b = normalizeBrush({ id: 'a', name: 'A', path: { fallOff: 1, fallOffLength: 200 } })
    expect(computeDabs(b, PT({ distance: 0 }), ctx())[0].alpha).toBeCloseTo(1, 5)
    expect(computeDabs(b, PT({ distance: 400 }), ctx())[0].alpha).toBeCloseTo(0, 5)
  })
  it('taper factors ramp from thin to full', () => {
    const b = normalizeBrush({ id: 'a', name: 'A', taper: { pressure: { start: 0.5, end: 0.5, size: 1, opacity: 0.5, tip: 0 } } })
    const side = b.taper.pressure
    const f0 = taperFactors(b, side, 'start', 0, 20, 1)
    const f1 = taperFactors(b, side, 'start', 1e6, 20, 1)
    expect(f0.size).toBeLessThan(0.1)
    expect(f0.alpha).toBeCloseTo(0.5, 5)
    expect(f1).toEqual({ size: 1, alpha: 1 })
    const chunky = normalizeBrush({ id: 'a', name: 'A', taper: { pressure: { start: 0.5, size: 1, tip: 1 } } })
    expect(taperFactors(chunky, chunky.taper.pressure, 'start', 20, 20, 1).size).toBeGreaterThan(taperFactors(b, side, 'start', 20, 20, 1).size)
    const d = computeDabs(b, PT(), ctx())[0]
    const before = d.size
    applyEndTaper(b, d, 0, 100, 'pen', 1)
    expect(d.size).toBeLessThan(before * 0.2)
  })
})

describe('stabilizer', () => {
  const settings = { amount: 0, mode: 'exp' as const, lazyRadius: 0, streamlinePressure: 0, stabilization: 0, motionFiltering: 0, motionExpression: 0.3 }
  const noisy = (): Sample[] => Array.from({ length: 80 }, (_, i) => S(i * 3 + (i % 2 ? 1.5 : -1.5), 50 + (i % 2 ? 1 : -1), 1, i * 8))
  const wobble = (out: Sample[]): number => out.slice(10).reduce((a, s, i, arr) => (i ? a + Math.abs(s.y - arr[i - 1].y) : a), 0)
  it('motion filtering reduces jitter', () => {
    const run = (s: typeof settings): Sample[] => {
      const st = new InputStabilizer(s)
      return noisy().map((p) => st.push(p))
    }
    expect(wobble(run({ ...settings, motionFiltering: 0.9 }))).toBeLessThan(wobble(run(settings)) * 0.6)
    expect(wobble(run({ ...settings, stabilization: 0.8 }))).toBeLessThan(wobble(run(settings)) * 0.6)
  })
  it('finish catches up with the last raw sample', () => {
    const st = new InputStabilizer({ ...settings, amount: 0.7, stabilization: 0.5, motionFiltering: 0.5 })
    const pts = Array.from({ length: 30 }, (_, i) => S(i * 5, 0, 1, i * 8))
    let last: Sample | null = null
    for (const p of pts) last = st.push(p)
    expect(last!.x).toBeLessThan(pts[29].x - 1)
    const extra = st.finish()
    const end = extra[extra.length - 1]
    expect(Math.hypot(end.x - pts[29].x, end.y - pts[29].y)).toBeLessThan(0.5)
  })
  it('streamline pressure smooths pressure spikes', () => {
    const st = new InputStabilizer({ ...settings, streamlinePressure: 0.9 })
    st.push(S(0, 0, 0.2, 0))
    const o = st.push(S(5, 0, 1, 8))
    expect(o.pressure).toBeLessThan(0.6)
  })
})

describe('StrokePipeline', () => {
  const run = (b: ReturnType<typeof normalizeBrush>, pts: Sample[]) => {
    const calls: { n: number; target: number }[] = []
    let restarts = 0
    const sink: DabSink = { stamp: (d, t) => calls.push({ n: d.length, target: t }), restart: () => restarts++ }
    const p = new StrokePipeline({ preset: b, size: 20, mode: 'paint', color: [0, 0, 0], secondary: [1, 1, 1], curve: (x) => x, smoothing: { amount: 0, mode: 'exp', lazyRadius: 0 }, seed: 3 }, sink)
    for (const s of pts) p.push(s)
    p.end()
    return { calls, restarts }
  }
  const line = Array.from({ length: 60 }, (_, i) => S(i * 4, 0, 1, i * 4))
  it('stamps dabs along the path', () => {
    const r = run(normalizeBrush({ id: 'a', name: 'A', spacing: 0.25 }), line)
    expect(r.calls.reduce((a, c) => a + c.n, 0)).toBeGreaterThan(40)
    expect(r.restarts).toBe(0)
  })
  it('end taper restamps the stroke once', () => {
    const b = normalizeBrush({ id: 'a', name: 'A', taper: { pressure: { end: 0.5 }, linked: false } })
    const r = run(b, line)
    expect(r.restarts).toBe(1)
  })
  it('a single tap is not tapered away', () => {
    const b = normalizeBrush({ id: 'a', name: 'A', taper: { pressure: { end: 1 }, linked: false } })
    expect(run(b, [S(5, 5), S(5.01, 5, 1, 8)]).restarts).toBe(0)
  })
  it('dual brush emits to target 1', () => {
    const b = normalizeBrush({ id: 'a', name: 'A', dual: { enabled: true, brush: { id: 'd', name: 'D', spacing: 0.3 } } })
    const r = run(b, line)
    expect(r.calls.some((c) => c.target === 1)).toBe(true)
    expect(r.calls.some((c) => c.target === 0)).toBe(true)
  })
  it('tiny brushes compensate for the 0.25px spacing clamp', () => {
    const b = normalizeBrush({ id: 'a', name: 'A', flow: 0.5, spacing: 0.05, hardness: 1 })
    const alphas: number[] = []
    const sink: DabSink = { stamp: (d) => d.forEach((x) => alphas.push(x.alpha)), restart() {} }
    const p = new StrokePipeline({ preset: b, size: 1, mode: 'paint', color: [0, 0, 0], secondary: [1, 1, 1], curve: (x) => x, smoothing: { amount: 0, mode: 'exp', lazyRadius: 0 }, seed: 1 }, sink)
    for (let i = 0; i < 20; i++) p.push(S(i * 3, 0, 1, i * 4))
    p.end()
    expect(alphas.length).toBeGreaterThan(100)
    expect(Math.min(...alphas.slice(2))).toBeGreaterThan(0.8)
  })
  it('default brush sanity', () => {
    expect(defaultBrush('x', 'X').spacing).toBeGreaterThan(0)
  })
})
