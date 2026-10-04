import { describe, expect, it } from 'vitest'
import {
  BASE_FPS,
  addPause,
  applySegment,
  buildSchedule,
  cloneEdit,
  defaultEdit,
  fadeAlpha,
  halveEditIndices,
  formatClock,
  itemAt,
  normalizeEdit,
  outputPlan,
  parseDuration,
  removePause,
  removeSegment,
  resizeSegment,
  segmentSpeedAt,
  sliderToSpeed,
  solveFitSpeed,
  speedToSlider,
  splitSegment,
  timeOfSource,
  updatePause
} from '../src/renderer/src/features/animio/tlModel'

const range = (n: number): number[] => Array.from({ length: n }, (_, i) => i)
const noFinale = () => {
  const e = defaultEdit()
  e.finale.holdSeconds = 0
  return e
}

describe('schedule', () => {
  it('plain: one frame per 1/30 s at speed 1, plus the finale hold', () => {
    const e = defaultEdit()
    const s = buildSchedule(range(90), e)
    expect(s.items.length).toBe(90)
    expect(s.total).toBeCloseTo(3 + 2, 9)
    expect(s.items[1].startTime).toBeCloseTo(1 / BASE_FPS, 9)
    expect(s.items[89].duration).toBeCloseTo(1 / BASE_FPS + 2, 9)
  })
  it('monotonic, gapless, total == sum of durations for random edits', () => {
    let seed = 7
    const rnd = (): number => ((seed = (seed * 1103515245 + 12345) & 0x7fffffff) / 0x7fffffff)
    for (let round = 0; round < 60; round++) {
      const n = 5 + Math.floor(rnd() * 300)
      const kept = range(n).filter(() => rnd() > 0.2)
      if (!kept.length) continue
      let e = defaultEdit()
      e.globalSpeed = 0.1 + rnd() * 20
      for (let k = 0; k < 4; k++) e = applySegment(e, Math.floor(rnd() * n), Math.floor(rnd() * n), 0.2 + rnd() * 8)
      for (let k = 0; k < 4; k++) e = addPause(e, Math.floor(rnd() * n), 0.1 + rnd() * 5)
      e.finale.holdSeconds = rnd() * 4
      const s = buildSchedule(kept, e)
      let t = 0
      for (const it of s.items) {
        expect(it.startTime).toBeCloseTo(t, 9)
        expect(it.duration).toBeGreaterThan(0)
        t += it.duration
      }
      expect(s.total).toBeCloseTo(t, 9)
      expect(s.total).toBeCloseTo(s.body + s.pauses + s.hold, 6)
      const idx = s.items.map((i) => i.frameIndex)
      expect(idx).toEqual([...idx].sort((a, b) => a - b))
    }
  })
  it('global speed scales only the moving part', () => {
    const e = defaultEdit()
    e.finale.holdSeconds = 1
    e.globalSpeed = 3
    e.pauses = []
    const s = buildSchedule(range(300), e)
    expect(s.body).toBeCloseTo(300 / 30 / 3, 9)
    expect(s.total).toBeCloseTo(300 / 30 / 3 + 1, 9)
  })
  it('segments multiply the speed relative to global', () => {
    let e = noFinale()
    e.globalSpeed = 2
    e = applySegment(e, 30, 60, 3) // 30 frames at 6x
    const s = buildSchedule(range(90), e)
    expect(s.body).toBeCloseTo(60 / 30 / 2 + 30 / 30 / 6, 9)
    expect(segmentSpeedAt(e.segments, 29)).toBe(1)
    expect(segmentSpeedAt(e.segments, 30)).toBe(3)
    expect(segmentSpeedAt(e.segments, 60)).toBe(1)
  })
  it('a pause holds the frame it is anchored to', () => {
    let e = noFinale()
    e = addPause(e, 10, 2.5)
    const s = buildSchedule(range(30), e)
    expect(s.items[10].duration).toBeCloseTo(1 / 30 + 2.5, 9)
    expect(s.items[10].pause).toBeCloseTo(2.5, 9)
    expect(s.total).toBeCloseTo(1 + 2.5, 9)
    const p = outputPlan(s, 30)
    const k = p.indices.indexOf(10)
    expect(p.repeats[k]).toBe(Math.round((1 / 30 + 2.5) * 30))
  })
  it('a pause on a hidden frame holds the previous shown frame; before the first it holds the first', () => {
    let e = noFinale()
    e = addPause(e, 5, 1)
    const s = buildSchedule([0, 2, 8, 9], e)
    expect(s.items[1].pause).toBe(1) // raw 5 -> last shown <= 5 is raw 2
    let e2 = noFinale()
    e2 = addPause(e2, 0, 1)
    expect(buildSchedule([3, 4], e2).items[0].pause).toBe(1)
  })
  it('several pauses, including ones at the same frame, add up', () => {
    let e = noFinale()
    e = addPause(e, 3, 1)
    e = addPause(e, 3, 0.5)
    e = addPause(e, 20, 60)
    const s = buildSchedule(range(30), e)
    expect(s.pauses).toBeCloseTo(61.5, 9)
    expect(s.total).toBeCloseTo(1 + 61.5, 9)
  })
  it('empty recording', () => {
    const s = buildSchedule([], defaultEdit())
    expect(s.total).toBe(0)
    expect(outputPlan(s, 30).frames).toBe(0)
  })
})

describe('fit to duration', () => {
  it('total is exact (pauses and hold count toward it)', () => {
    let e = defaultEdit()
    e = addPause(e, 100, 3)
    e = applySegment(e, 200, 400, 4)
    e.finale.holdSeconds = 2
    for (const target of [15, 30, 45, 60, 90]) {
      e.fitDuration = target
      const s = buildSchedule(range(1000), e)
      expect(s.fitOk).toBe(true)
      expect(s.total).toBeCloseTo(target, 6)
      const p = outputPlan(s, 30)
      expect(Math.abs(p.duration - target)).toBeLessThanOrEqual(1 / 30)
      const p60 = outputPlan(s, 60)
      expect(Math.abs(p60.duration - target)).toBeLessThanOrEqual(1 / 60)
    }
  })
  it('breakdown: body = target - pauses - hold', () => {
    let e = defaultEdit()
    e = addPause(e, 5, 4)
    e.finale.holdSeconds = 1
    e.fitDuration = 20
    const s = buildSchedule(range(500), e)
    expect(s.body).toBeCloseTo(15, 6)
    expect(s.pauses).toBe(4)
    expect(s.hold).toBe(1)
  })
  it('infeasible when pauses + hold exceed the target', () => {
    let e = defaultEdit()
    e = addPause(e, 0, 40)
    e.fitDuration = 30
    const s = buildSchedule(range(100), e)
    expect(s.fitOk).toBe(false)
    expect(solveFitSpeed(range(100), e, 30).ok).toBe(false)
  })
  it('a fit can slow down a short recording', () => {
    const e = defaultEdit()
    e.fitDuration = 30
    const s = buildSchedule(range(30), e)
    expect(s.speed).toBeLessThan(1)
    expect(s.total).toBeCloseTo(30, 6)
  })
})

describe('output plan (constant frame rate)', () => {
  it('frame count = round(total * fps), last frame is always the last source frame', () => {
    const e = defaultEdit()
    e.globalSpeed = 100
    const s = buildSchedule(range(3000), e)
    for (const fps of [24, 30, 60]) {
      const p = outputPlan(s, fps)
      expect(p.frames).toBe(Math.round(s.total * fps))
      expect(p.indices[p.indices.length - 1]).toBe(2999)
      expect(p.repeats.reduce((a, b) => a + b, 0)).toBe(p.frames)
      expect(Math.abs(p.duration - s.total)).toBeLessThanOrEqual(0.5 / fps + 1e-9)
    }
  })
  it('indices ascend and every shown frame is a kept one', () => {
    const kept = [0, 3, 4, 9, 20, 21, 50]
    const s = buildSchedule(kept, defaultEdit())
    const p = outputPlan(s, 30)
    expect(p.indices).toEqual(kept)
    for (let i = 1; i < p.indices.length; i++) expect(p.indices[i]).toBeGreaterThan(p.indices[i - 1])
  })
  it('slow motion repeats frames, matching the schedule', () => {
    const e = noFinale()
    e.globalSpeed = 0.5
    const s = buildSchedule(range(10), e)
    const p = outputPlan(s, 30)
    expect(p.repeats).toEqual(new Array(10).fill(2))
  })
  it('preview lookup agrees with the export plan', () => {
    let e = defaultEdit()
    e = addPause(e, 12, 1.2)
    e = applySegment(e, 20, 40, 0.5)
    e.globalSpeed = 1.7
    const s = buildSchedule(range(80), e)
    const p = outputPlan(s, 30)
    let k = 0
    for (let r = 0; r < p.indices.length; r++)
      for (let i = 0; i < p.repeats[r]; i++, k++) {
        const t = k / 30
        const it = s.items[itemAt(s, t)]
        if (k < p.frames - 1) expect(it.frameIndex).toBe(p.indices[r])
      }
  })
  it('timeOfSource maps source frames to output time', () => {
    const s = buildSchedule([0, 2, 8], noFinale())
    expect(timeOfSource(s, 0)).toBe(0)
    expect(timeOfSource(s, 2)).toBeCloseTo(1 / 30, 9)
    expect(timeOfSource(s, 5)).toBeCloseTo(2 / 30, 9) // hidden -> next shown
    expect(timeOfSource(s, 99)).toBeCloseTo(2 / 30, 9)
  })
})

describe('segments editing', () => {
  it('overlapping range replaces / cuts existing segments', () => {
    let e = defaultEdit()
    e = applySegment(e, 10, 50, 4)
    e = applySegment(e, 30, 70, 0.5)
    expect(e.segments.map((s) => [s.from, s.to, s.speed])).toEqual([[10, 30, 4], [30, 70, 0.5]])
    e = applySegment(e, 20, 25, 2) // inside the first
    expect(e.segments.map((s) => [s.from, s.to, s.speed])).toEqual([[10, 20, 4], [20, 25, 2], [25, 30, 4], [30, 70, 0.5]])
  })
  it('speed 1 clears the range', () => {
    let e = applySegment(defaultEdit(), 0, 100, 3)
    e = applySegment(e, 20, 40, 1)
    expect(e.segments.map((s) => [s.from, s.to])).toEqual([[0, 20], [40, 100]])
  })
  it('split / remove / resize', () => {
    let e = applySegment(defaultEdit(), 10, 50, 3)
    e = splitSegment(e, 30)
    expect(e.segments.map((s) => [s.from, s.to])).toEqual([[10, 30], [30, 50]])
    e = resizeSegment(e, e.segments[0].id, 5, 45, 100) // right edge clamps to the neighbour
    expect(e.segments[0].from).toBe(5)
    expect(e.segments[0].to).toBe(30)
    e = removeSegment(e, e.segments[1].id)
    expect(e.segments.length).toBe(1)
  })
  it('ids stay unique', () => {
    let e = defaultEdit()
    for (let i = 0; i < 20; i++) e = applySegment(e, i * 10, i * 10 + 5, 2)
    e = applySegment(e, 3, 120, 0.5)
    const ids = [...e.segments, ...e.pauses].map((x) => x.id)
    expect(new Set(ids).size).toBe(ids.length)
  })
})

describe('thinned recordings', () => {
  it('segment and pause indices follow the halving', () => {
    let e = applySegment(defaultEdit(), 11, 21, 3)
    e = addPause(e, 9, 1)
    const h = halveEditIndices(e)
    expect(h.segments.map((s) => [s.from, s.to])).toEqual([[6, 11]])
    expect(h.pauses[0].at).toBe(4)
  })
})

describe('pauses editing', () => {
  it('add / update / move / remove', () => {
    let e = addPause(defaultEdit(), 40, 2)
    e = addPause(e, 10, 0.3)
    expect(e.pauses.map((p) => p.at)).toEqual([10, 40])
    e = updatePause(e, e.pauses[0].id, { at: 90, seconds: 75 })
    expect(e.pauses.map((p) => [p.at, p.seconds])).toEqual([[40, 2], [90, 75]])
    e = removePause(e, e.pauses[0].id)
    expect(e.pauses.length).toBe(1)
  })
  it('clamps absurd durations', () => {
    const e = addPause(defaultEdit(), 0, 1e9)
    expect(e.pauses[0].seconds).toBeLessThanOrEqual(3600)
  })
})

describe('normalize / persist', () => {
  it('round-trips through JSON', () => {
    let e = defaultEdit(false)
    e = applySegment(e, 5, 15, 3)
    e = addPause(e, 9, 1.5)
    e.fitDuration = 45
    e.finale = { holdSeconds: 3, fadeIn: 0.5, fadeOut: 1 }
    expect(normalizeEdit(JSON.parse(JSON.stringify(e)))).toEqual(e)
  })
  it('repairs garbage', () => {
    const e = normalizeEdit({ globalSpeed: -5, segments: [{ from: 9, to: 3 }, { from: 0, to: 10, speed: 1e9 }, { from: 5, to: 20, speed: 2 }], pauses: [{ at: -1 }, { at: 3, seconds: 0 }], finale: { holdSeconds: 'x' } })
    expect(e.globalSpeed).toBeGreaterThan(0)
    expect(e.segments.length).toBe(2)
    expect(e.segments[1].from).toBe(e.segments[0].to) // overlap resolved
    expect(e.segments[0].speed).toBeLessThanOrEqual(100)
    expect(e.pauses.length).toBe(1)
    expect(e.pauses[0].seconds).toBeGreaterThan(0)
    expect(e.finale.holdSeconds).toBe(2)
    expect(normalizeEdit(null, false).hideUndone).toBe(false)
  })
  it('cloneEdit is deep', () => {
    const a = addPause(defaultEdit(), 1, 1)
    const b = cloneEdit(a)
    b.pauses[0].seconds = 9
    expect(a.pauses[0].seconds).toBe(1)
  })
})

describe('helpers', () => {
  it('fade alpha', () => {
    expect(fadeAlpha(0, 10, 2, 2)).toBe(1)
    expect(fadeAlpha(1, 10, 2, 2)).toBeCloseTo(0.5)
    expect(fadeAlpha(5, 10, 2, 2)).toBe(0)
    expect(fadeAlpha(9, 10, 2, 2)).toBeCloseTo(0.5)
    expect(fadeAlpha(10, 10, 2, 2)).toBe(1)
    expect(fadeAlpha(5, 10, 0, 0)).toBe(0)
  })
  it('duration parsing', () => {
    expect(parseDuration('45')).toBe(45)
    expect(parseDuration('1:30')).toBe(90)
    expect(parseDuration('0:07,5')).toBe(7.5)
    expect(parseDuration('1:02:03')).toBe(3723)
    expect(parseDuration('abc')).toBeNull()
    expect(parseDuration('')).toBeNull()
  })
  it('clock format', () => {
    expect(formatClock(5.25)).toBe('0:05.3')
    expect(formatClock(59.96)).toBe('1:00.0')
    expect(formatClock(3723.4, 0)).toBe('1:02:03')
  })
  it('logarithmic speed slider', () => {
    expect(speedToSlider(0.1)).toBeCloseTo(0)
    expect(speedToSlider(100)).toBeCloseTo(1)
    expect(speedToSlider(1)).toBeCloseTo(1 / 3)
    expect(sliderToSpeed(1 / 3)).toBe(1)
    expect(sliderToSpeed(1)).toBe(100)
    expect(sliderToSpeed(0)).toBe(0.1)
  })
})
