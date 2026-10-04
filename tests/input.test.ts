import { describe, expect, it } from 'vitest'
import { insertCurvePoint, makePressureCurve, moveCurvePoint, removeCurvePoint, sanitizeCurve, PRESSURE_PRESETS } from '../src/renderer/src/core/pressure'
import { DEFAULT_GESTURE_CONFIG, Gesture, HoldDetector, TouchGestures } from '../src/renderer/src/input/gestures'
import { PressureCalibrator, PressureSmoother, sphericalToTilt, tiltToSpherical } from '../src/renderer/src/input/penMath'
import { comboFromEvent, normalizeCombo, ShortcutMap } from '../src/renderer/src/input/shortcutMap'

describe('pressure curve editing', () => {
  it('sanitize adds end points and sorts', () => {
    const c = sanitizeCurve([[0.5, 0.7], [0.2, 0.1]])
    expect(c.points[0][0]).toBe(0)
    expect(c.points[c.points.length - 1][0]).toBe(1)
    for (let i = 1; i < c.points.length; i++) expect(c.points[i][0]).toBeGreaterThan(c.points[i - 1][0])
  })
  it('insert / move / remove', () => {
    const c = { points: [[0, 0], [1, 1]] as [number, number][] }
    const i = insertCurvePoint(c, 0.5, 0.8)
    expect(i).toBe(1)
    expect(insertCurvePoint(c, 0.505, 0.5)).toBe(-1)
    moveCurvePoint(c, 1, 2, 0.3)
    expect(c.points[1][0]).toBeLessThan(1)
    expect(c.points[1][1]).toBeCloseTo(0.3)
    expect(removeCurvePoint(c, 0)).toBe(false)
    expect(removeCurvePoint(c, 1)).toBe(true)
  })
  it('presets are valid monotone curves', () => {
    for (const p of Object.values(PRESSURE_PRESETS)) {
      const f = makePressureCurve(p)
      let prev = -1
      for (let i = 0; i <= 50; i++) {
        const v = f(i / 50)
        expect(v).toBeGreaterThanOrEqual(prev - 1e-9)
        prev = v
      }
      expect(f(1)).toBeCloseTo(1)
    }
  })
})

describe('pen math', () => {
  it('tilt <-> spherical roundtrip', () => {
    const s = tiltToSpherical(30, -20)
    const t = sphericalToTilt(s.azimuth, s.altitude)
    expect(t.tiltX).toBeCloseTo(30, 3)
    expect(t.tiltY).toBeCloseTo(-20, 3)
  })
  it('upright pen has altitude 90', () => {
    expect(tiltToSpherical(0, 0).altitude).toBeCloseTo(Math.PI / 2)
  })
  it('calibrator detects a 0.87 driver ceiling', () => {
    const c = new PressureCalibrator()
    for (let i = 0; i < 30; i++) c.observe(0.3 + i * 0.019)
    expect(c.scale).toBe(1)
    for (let i = 0; i < 15; i++) c.observe(0.87)
    expect(c.scale).toBeCloseTo(0.87)
    expect(c.normalize(0.87)).toBeCloseTo(1)
    expect(c.normalize(0.435)).toBeCloseTo(0.5)
  })
  it('calibrator is not fooled by a steady hand (jitter, no identical plateau)', () => {
    const c = new PressureCalibrator()
    let seed = 7
    const r = (): number => ((seed = (seed * 1664525 + 1013904223) >>> 0) / 4294967296)
    for (let i = 0; i < 400; i++) c.observe(0.62 + (r() - 0.5) * 0.01)
    expect(c.scale).toBe(1)
    expect(c.normalize(0.62)).toBeCloseTo(0.62)
  })
  it('calibrator: a plateau needs consecutive identical samples', () => {
    const c = new PressureCalibrator()
    for (let i = 0; i < 40; i++) {
      c.observe(0.8)
      c.observe(0.5)
    }
    expect(c.scale).toBe(1)
    for (let i = 0; i < 12; i++) c.observe(0.8)
    expect(c.scale).toBeCloseTo(0.8)
  })
  it('calibrator ignores a true 1.0 pen', () => {
    const c = new PressureCalibrator()
    for (let i = 0; i < 40; i++) c.observe(1)
    expect(c.scale).toBe(1)
  })
  it('smoother converges and passes through at 0', () => {
    const s = new PressureSmoother()
    expect(s.apply(0.5, 0.8)).toBe(0.5)
    let v = 0
    for (let i = 0; i < 100; i++) v = s.apply(1, 0.8)
    expect(v).toBeGreaterThan(0.99)
    const z = new PressureSmoother()
    z.apply(0.2, 0)
    expect(z.apply(0.9, 0)).toBe(0.9)
  })
})

function harness(cfg = {}): { g: TouchGestures; ev: Gesture[] } {
  const ev: Gesture[] = []
  const g = new TouchGestures({ ...DEFAULT_GESTURE_CONFIG, ...cfg }, (x) => ev.push(x))
  return { g, ev }
}
const types = (ev: Gesture[]): string[] => ev.filter((e) => e.type !== 'transform').map((e) => (e.type === 'tap' ? `tap${e.fingers}` : e.type))

describe('touch gesture recognizer', () => {
  it('two-finger tap', () => {
    const { g, ev } = harness()
    g.down(1, 100, 100, 0)
    g.down(2, 200, 100, 20)
    g.up(1, 100)
    g.up(2, 110)
    expect(types(ev)).toEqual(['tap2'])
  })
  it('three and four finger taps', () => {
    const a = harness()
    for (let i = 0; i < 3; i++) a.g.down(i, 100 + i * 60, 100, i * 10)
    for (let i = 0; i < 3; i++) a.g.up(i, 120 + i)
    expect(types(a.ev)).toEqual(['tap3'])
    const b = harness()
    for (let i = 0; i < 4; i++) b.g.down(i, 100 + i * 60, 100, i * 10)
    for (let i = 0; i < 4; i++) b.g.up(i, 120 + i)
    expect(types(b.ev)).toEqual(['tap4'])
  })
  it('slow touch is not a tap', () => {
    const { g, ev } = harness()
    g.down(1, 0, 0, 0)
    g.down(2, 100, 0, 5)
    g.up(1, 900)
    g.up(2, 905)
    expect(types(ev)).toEqual([])
  })
  it('pinch emits transform, not a tap', () => {
    const { g, ev } = harness()
    g.down(1, 100, 100, 0)
    g.down(2, 200, 100, 5)
    g.move(2, 260, 100, 30)
    g.up(1, 60)
    g.up(2, 61)
    const tr = ev.find((e) => e.type === 'transform')
    expect(tr && tr.type === 'transform' && tr.scale).toBeGreaterThan(1)
    expect(types(ev)).toEqual([])
  })
  it('two-finger hold starts, repeats, ends and suppresses the tap', () => {
    const { g, ev } = harness({ holdMs: 400, repeatMs: 100 })
    g.down(1, 100, 100, 0)
    g.down(2, 200, 100, 10)
    g.tick(200)
    expect(ev.length).toBe(0)
    g.tick(500)
    g.tick(620)
    g.tick(730)
    g.up(1, 800)
    g.up(2, 801)
    const holds = ev.filter((e) => e.type === 'hold').map((e) => (e as { phase: string }).phase)
    expect(holds).toEqual(['start', 'repeat', 'repeat', 'end'])
    expect(types(ev).includes('tap2')).toBe(false)
  })
  it('three-finger scrub', () => {
    const { g, ev } = harness()
    for (let i = 0; i < 3; i++) g.down(i, 200 + i * 50, 200, i)
    let x = 0
    const xs = [60, -60, 60, -60, 60, -60, 60]
    let t = 10
    for (const dx of xs) {
      x += dx
      for (let i = 0; i < 3; i++) g.move(i, 200 + i * 50 + x, 200, (t += 5))
    }
    expect(types(ev)).toContain('scrub')
    for (let i = 0; i < 3; i++) g.up(i, 400)
    expect(types(ev).includes('tap3')).toBe(false)
  })
  it('three-finger swipe down', () => {
    const { g, ev } = harness()
    for (let i = 0; i < 3; i++) g.down(i, 200 + i * 50, 100, i)
    for (let s = 1; s <= 6; s++) for (let i = 0; i < 3; i++) g.move(i, 200 + i * 50 + 3, 100 + s * 25, 10 + s * 10)
    expect(types(ev)).toContain('swipeDown')
  })
  it('single finger long press fires once when stationary', () => {
    const { g, ev } = harness({ longPressMs: 500 })
    g.down(1, 50, 50, 0)
    g.tick(300)
    g.tick(600)
    g.tick(900)
    expect(types(ev)).toEqual(['longPress'])
  })
  it('long press is cancelled by movement', () => {
    const { g, ev } = harness({ longPressMs: 500 })
    g.down(1, 50, 50, 0)
    g.move(1, 120, 50, 100)
    g.tick(700)
    expect(types(ev)).toEqual([])
  })
  it('quick pinch', () => {
    const { g, ev } = harness()
    g.down(1, 100, 100, 0)
    g.down(2, 400, 100, 5)
    g.move(1, 200, 100, 60)
    g.move(2, 300, 100, 65)
    g.move(1, 240, 100, 90)
    g.move(2, 260, 100, 95)
    g.up(1, 150)
    g.up(2, 151)
    expect(types(ev)).toContain('quickPinch')
  })
  it('hold detector', () => {
    const h = new HoldDetector(300, 8)
    h.start(10, 10, 0)
    expect(h.check(200)).toBe(false)
    expect(h.check(320)).toBe(true)
    expect(h.check(400)).toBe(false)
    h.start(10, 10, 1000)
    h.move(50, 50)
    expect(h.check(1400)).toBe(false)
  })
})

describe('shortcut map', () => {
  const acts = [
    { id: 'undo', defaultKeys: ['Ctrl+Z'] },
    { id: 'redo', defaultKeys: ['Ctrl+Shift+Z', 'Ctrl+Y'] },
    { id: 'pan', defaultKeys: ['Space'] },
    { id: 'eyedrop', defaultKeys: ['I', 'Alt'] }
  ]
  it('combos from events', () => {
    expect(comboFromEvent({ key: 'z', code: 'KeyZ', ctrlKey: true })).toBe('Ctrl+Z')
    expect(comboFromEvent({ key: 'Z', code: 'KeyZ', ctrlKey: true, shiftKey: true })).toBe('Ctrl+Shift+Z')
    expect(comboFromEvent({ key: '{', code: 'BracketLeft', shiftKey: true })).toBe('Shift+[')
    expect(comboFromEvent({ key: ' ', code: 'Space' })).toBe('Space')
    expect(comboFromEvent({ key: 'Alt', code: 'AltLeft', altKey: true })).toBe('Alt')
    expect(comboFromEvent({ key: 'Tab', code: 'Tab' })).toBe('Tab')
    expect(comboFromEvent({ key: 'a' })).toBe('A')
  })
  it('normalizes', () => {
    expect(normalizeCombo('shift+ctrl+z')).toBe('Ctrl+Shift+Z')
  })
  it('lookup, rebind steals combos, reset', () => {
    const m = new ShortcutMap(() => acts)
    expect(m.actionFor('Ctrl+Y')).toBe('redo')
    expect(m.actionFor('Alt')).toBe('eyedrop')
    const lost = m.bind('pan', 'Ctrl+Z')
    expect(lost).toEqual(['undo'])
    expect(m.actionFor('Ctrl+Z')).toBe('pan')
    expect(m.keysFor('undo')).toEqual([])
    expect(m.keysFor('pan')).toEqual(['Ctrl+Z'])
    m.reset()
    expect(m.actionFor('Ctrl+Z')).toBe('undo')
  })
  it('add without replacing and unbind', () => {
    const m = new ShortcutMap(() => acts)
    m.bind('pan', 'H', false)
    expect(m.keysFor('pan')).toEqual(['Space', 'H'])
    m.unbind('pan', 'Space')
    expect(m.keysFor('pan')).toEqual(['H'])
  })
})
