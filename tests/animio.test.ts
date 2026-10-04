import { describe, expect, it } from 'vitest'
import { lz4Block, parseBplist } from '../src/renderer/src/io/procreate'
import { buildPdf } from '../src/renderer/src/io/pdf'
import { onionFrames, playbackSequence, selectFrames, sequenceTicks, stepAtTick, timelapsePlan, tlFrameSize, trackedTime, videoSize } from '../src/renderer/src/features/animio/schedule'

describe('frame scheduling', () => {
  it('loop / oneshot: each frame once, holds respected', () => {
    const s = playbackSequence([1, 3, 1], 'loop')
    expect(s.map((x) => x.frame)).toEqual([0, 1, 2])
    expect(sequenceTicks(s)).toBe(5)
    expect(playbackSequence([1, 1], 'oneshot').length).toBe(2)
  })
  it('ping-pong does not repeat the end frames', () => {
    expect(playbackSequence([1, 1, 1, 1], 'pingpong').map((x) => x.frame)).toEqual([0, 1, 2, 3, 2, 1])
    expect(playbackSequence([1], 'pingpong').map((x) => x.frame)).toEqual([0])
    expect(playbackSequence([1, 1], 'pingpong').map((x) => x.frame)).toEqual([0, 1])
  })
  it('stepAtTick loops and finishes one-shots', () => {
    const s = playbackSequence([1, 2, 1], 'loop') // ticks: 0 | 1,2 | 3
    expect(stepAtTick(s, 0, false).step).toBe(0)
    expect(stepAtTick(s, 2, false).step).toBe(1)
    expect(stepAtTick(s, 3, false).step).toBe(2)
    expect(stepAtTick(s, 4, false).step).toBe(0)
    expect(stepAtTick(s, 4, true)).toEqual({ step: 2, done: true })
  })
})

describe('onion skin math', () => {
  it('limits to existing frames and fades with distance', () => {
    const o = onionFrames(1, 4, 2, 2, 0.6)
    expect(o.map((x) => x.frame)).toEqual([0, 2, 3])
    const near = o.find((x) => x.offset === 1)!.opacity
    const far = o.find((x) => x.offset === 2)!.opacity
    expect(near).toBeCloseTo(0.6)
    expect(far).toBeLessThan(near)
    expect(onionFrames(0, 1, 3, 3, 1)).toEqual([])
  })
})

describe('time-lapse frame selection', () => {
  it('selects evenly incl. first and last', () => {
    const s = selectFrames(1000, 10)
    expect(s.length).toBe(10)
    expect(s[0]).toBe(0)
    expect(s[9]).toBe(999)
    expect([...s].sort((a, b) => a - b)).toEqual(s)
    expect(new Set(s).size).toBe(10)
    expect(selectFrames(5, 50)).toEqual([0, 1, 2, 3, 4])
    expect(selectFrames(0, 5)).toEqual([])
  })
  it('30 second plan never exceeds 30 s and holds the last frame', () => {
    const p = timelapsePlan(5000, 'short', 30, 1)
    expect(p.duration).toBeCloseTo(30, 5)
    expect(p.frames).toBe(900)
    expect(p.indices[p.indices.length - 1]).toBe(4999)
    expect(p.repeats[p.repeats.length - 1]).toBe(31)
    const short = timelapsePlan(60, 'short', 30, 1)
    expect(short.frames).toBe(60 + 30)
  })
  it('full length uses every frame', () => {
    const p = timelapsePlan(200, 'full', 30, 0)
    expect(p.indices.length).toBe(200)
    expect(p.frames).toBe(200)
  })
  it('sizes: even dimensions, fit inside box', () => {
    expect(videoSize(2048, 2048, '1080p')).toEqual({ width: 1080, height: 1080 })
    expect(videoSize(4000, 3000, '4k')).toEqual({ width: 2880, height: 2160 })
    expect(videoSize(1001, 501, 'canvas')).toEqual({ width: 1002, height: 502 })
    expect(tlFrameSize(4096, 2048, 'small')).toEqual({ width: 960, height: 480 })
    expect(tlFrameSize(800, 600, 'max')).toEqual({ width: 800, height: 600 })
  })
  it('tracked time credits at most the idle threshold per gap', () => {
    expect(trackedTime([100, 200, 60000], 5000)).toBe(5300)
  })
})

describe('procreate helpers', () => {
  it('lz4 block decode', () => {
    // "abcabcabcabc" : literal "abc" then match offset 3 length 9  -> token 0x35 (lit 3, matchlen 5+4)
    const src = new Uint8Array([0x35, 0x61, 0x62, 0x63, 0x03, 0x00])
    expect(Array.from(lz4Block(src, 12))).toEqual(Array.from(new TextEncoder().encode('abcabcabcabc')))
  })
  it('binary plist: dict with int, string, array, bool', () => {
    // {"a": 5, "b": [true, "hi"]}  hand-encoded
    const objs: number[][] = [
      [0xd2, 1, 2, 3, 4], // 0 dict: keys refs 1,2 ; values refs 3,4
      [0x51, 0x61], // 1 "a"
      [0x51, 0x62], // 2 "b"
      [0x10, 5], // 3 int 5
      [0xa2, 5, 6], // 4 array [5,6]
      [0x09], // 5 true
      [0x52, 0x68, 0x69] // 6 "hi"
    ]
    const body: number[] = [...new TextEncoder().encode('bplist00')]
    const offs: number[] = []
    for (const o of objs) {
      offs.push(body.length)
      body.push(...o)
    }
    const tableOff = body.length
    body.push(...offs)
    const trailer = new Uint8Array(32)
    trailer[6] = 1
    trailer[7] = 1
    trailer[15] = objs.length
    trailer[23] = 0
    trailer[31] = tableOff
    const buf = new Uint8Array([...body, ...trailer])
    expect(parseBplist(buf)).toEqual({ a: 5, b: [true, 'hi'] })
  })
})

describe('pdf', () => {
  it('builds a multi-page PDF with dpi-based page size', async () => {
    // 1x1 white PNG
    const png = Uint8Array.from(atob('iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mP8z8BQDwAEhQGAhKmMIQAAAABJRU5ErkJggg=='), (c) => c.charCodeAt(0))
    const bytes = await buildPdf([{ image: png, format: 'png', width: 132, height: 264 }, { image: png, format: 'png', width: 132, height: 264 }], 132)
    expect(String.fromCharCode(...bytes.slice(0, 5))).toBe('%PDF-')
    const { PDFDocument } = await import('pdf-lib')
    const d = await PDFDocument.load(bytes)
    expect(d.getPageCount()).toBe(2)
    expect(d.getPage(0).getWidth()).toBeCloseTo(72, 3)
    expect(d.getPage(0).getHeight()).toBeCloseTo(144, 3)
  })
})
