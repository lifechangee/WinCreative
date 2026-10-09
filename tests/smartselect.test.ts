import { existsSync } from 'node:fs'
import { describe, expect, it } from 'vitest'
import { boxMean, decontaminate, distanceTo, gaussBlur, guidedFilter, iou, resizeRGBA, shiftEdge, signedDistance } from '../src/renderer/src/features/smartselect/imgops'
import { encodeGeom, encodePrompt, flattenOnGrey, fieldBounds, pickCandidate, planEncodeRegion, upsampleLogits } from '../src/renderer/src/features/smartselect/region'
import { refineField } from '../src/renderer/src/features/smartselect/refine'
import { fakeLogits, makeScene } from '../src/renderer/src/features/smartselect/synth'

describe('imgops', () => {
  it('boxMean of a constant plane is constant, also at the borders', () => {
    const a = new Float32Array(30 * 20).fill(0.7)
    const m = boxMean(a, 30, 20, 4)
    expect(Math.max(...m.map((v) => Math.abs(v - 0.7)))).toBeLessThan(1e-5)
  })
  it('gaussBlur preserves the mean', () => {
    const a = new Float32Array(64 * 64)
    a[32 * 64 + 32] = 1
    const b = gaussBlur(a, 64, 64, 3)
    expect(b.reduce((s, v) => s + v, 0)).toBeCloseTo(1, 3)
    expect(b[32 * 64 + 32]).toBeLessThan(0.1)
  })
  it('distanceTo is euclidean', () => {
    const t = new Uint8Array(21 * 21)
    t[10 * 21 + 10] = 1
    const d = distanceTo(t, 21, 21)
    expect(d[10 * 21 + 10]).toBe(0)
    expect(d[10 * 21 + 13]).toBeCloseTo(3, 4)
    expect(d[13 * 21 + 14]).toBeCloseTo(5, 4)
  })
  it('signedDistance is positive inside, negative outside', () => {
    const m = new Uint8Array(20 * 20)
    for (let y = 5; y < 15; y++) for (let x = 5; x < 15; x++) m[y * 20 + x] = 1
    const s = signedDistance(m, 20, 20)
    expect(s[10 * 20 + 10]).toBeGreaterThan(3.9)
    expect(s[5 * 20 + 2]).toBeLessThan(-1.9)
    expect(Math.abs(s[10 * 20 + 5])).toBeLessThan(1)
  })
  it('guided filter snaps a blurry mask to a sharp image edge', () => {
    const w = 80
    const h = 40
    const g = new Uint8ClampedArray(w * h * 4)
    const p = new Float32Array(w * h)
    for (let y = 0; y < h; y++)
      for (let x = 0; x < w; x++) {
        const v = x < 40 ? 30 : 220
        g.set([v, v, v, 255], (y * w + x) * 4)
        p[y * w + x] = Math.min(1, Math.max(0, (x - 34) / 12)) // edge in the mask is misplaced + soft
      }
    const q = guidedFilter(g, p, w, h, 8, 1e-3)
    expect(q[20 * w + 38]).toBeLessThan(0.25)
    expect(q[20 * w + 42]).toBeGreaterThan(0.75)
  })
  it('shiftEdge expands and contracts by the requested distance', () => {
    const w = 60
    const a = new Float32Array(w * w)
    for (let y = 20; y < 40; y++) for (let x = 20; x < 40; x++) a[y * w + x] = 1
    const grow = shiftEdge(a, w, w, 3)
    expect(grow[30 * w + 18]).toBeGreaterThan(0.9)
    expect(grow[30 * w + 15]).toBeLessThan(0.1)
    const shrink = shiftEdge(a, w, w, -3)
    expect(shrink[30 * w + 22]).toBeLessThan(0.1)
    expect(shrink[30 * w + 25]).toBeGreaterThan(0.9)
  })
  it('decontaminate pulls the object colour into semi-transparent edge pixels', () => {
    const w = 30
    const h = 10
    const rgba = new Uint8ClampedArray(w * h * 4)
    const alpha = new Float32Array(w * h)
    for (let y = 0; y < h; y++)
      for (let x = 0; x < w; x++) {
        // object (red) for x < 15, 2px blended edge with a blue background fringe
        const a = x < 14 ? 1 : x === 14 ? 0.7 : x === 15 ? 0.3 : 0
        alpha[y * w + x] = a
        const o = (y * w + x) * 4
        rgba[o] = 255 * a
        rgba[o + 2] = 255 * (1 - a)
        rgba[o + 3] = 255
      }
    decontaminate(rgba, alpha, w, h, 4)
    expect(rgba[(5 * w + 14) * 4 + 2]).toBeLessThan(20) // blue fringe gone
    expect(rgba[(5 * w + 15) * 4]).toBeGreaterThan(235)
  })
  it('resizeRGBA keeps flat colours and does not bleed transparent pixels', () => {
    const src = new Uint8ClampedArray(8 * 8 * 4)
    for (let i = 0; i < 64; i++) src.set(i % 8 < 4 ? [200, 100, 50, 255] : [0, 0, 0, 0], i * 4)
    const d = resizeRGBA(src, 8, 8, 4, 4)
    expect(d[0]).toBe(200)
    expect(d[1]).toBe(100)
    expect(d[3]).toBe(255)
    expect(d[(0 * 4 + 3) * 4 + 3]).toBe(0)
  })
})

describe('region + prompts', () => {
  it('sam1 geometry keeps aspect, sam2 squashes to the frame', () => {
    const r = { x: 100, y: 50, w: 2000, h: 1000 }
    const g1 = encodeGeom(r, 'sam1')
    expect(g1.rw).toBe(1024)
    expect(g1.rh).toBe(512)
    const g2 = encodeGeom(r, 'sam2')
    expect(g2.sx).toBeCloseTo(1024 / 2000)
    expect(g2.sy).toBeCloseTo(1024 / 1000)
  })
  it('prompt encoding: sam1 pads with a -1 point, boxes become labels 2/3; sam2 keeps the box', () => {
    const g = encodeGeom({ x: 10, y: 20, w: 1024, h: 1024 }, 'sam1')
    const p = encodePrompt(g, { points: [{ x: 110, y: 120, label: 1 }] })
    expect([...p.labels]).toEqual([1, -1])
    expect([...p.coords].slice(0, 2)).toEqual([100, 100])
    const pb = encodePrompt(g, { points: [], box: { x: 10, y: 20, w: 100, h: 50 } })
    expect([...pb.labels]).toEqual([2, 3])
    const g2 = encodeGeom({ x: 0, y: 0, w: 512, h: 2048 }, 'sam2')
    const q = encodePrompt(g2, { points: [{ x: 256, y: 1024, label: 0 }], box: { x: 0, y: 0, w: 512, h: 1024 } })
    expect([...q.coords]).toEqual([512, 512])
    expect([...q.box!]).toEqual([0, 0, 1024, 512])
    expect(q.labels[0]).toBe(0)
  })
  it('planEncodeRegion works away from the origin and clamps to the content', () => {
    const content = { x: -500, y: 300, w: 4000, h: 3000 }
    expect(planEncodeRegion(content, null)).toEqual(content)
    const v = planEncodeRegion(content, { x: 100, y: 600, w: 400, h: 300 })
    expect(v.x).toBeGreaterThanOrEqual(content.x)
    expect(v.w).toBeLessThan(500)
    const tiny = planEncodeRegion(content, { x: 0, y: 700, w: 10, h: 10 })
    expect(tiny.w).toBeGreaterThanOrEqual(96)
    const out = planEncodeRegion(content, { x: 9000, y: 9000, w: 100, h: 100 })
    expect(out).toEqual(content)
  })
  it('pickCandidate: sam1 uses the single mask for multi-prompts and the best multimask otherwise', () => {
    expect(pickCandidate([0.1, 0.5, 0.9, 0.7], 'sam1', 1, false)).toBe(2)
    expect(pickCandidate([0.9, 0.5, 0.2, 0.7], 'sam1', 2, false)).toBe(0)
    expect(pickCandidate([0.3, 0.8, 0.5], 'sam2', 1, false)).toBe(1)
    expect(pickCandidate([0.3, 0.8, 0.5], 'sam2', 1, false, 3)).toBe(2)
  })
  it('upsampleLogits maps frame cells back to document pixels (offset region)', () => {
    const g = encodeGeom({ x: 1000, y: 2000, w: 512, h: 512 }, 'sam2')
    const L = new Float32Array(256 * 256).fill(-5)
    for (let v = 0; v < 128; v++) for (let u = 0; u < 128; u++) L[v * 256 + u] = 5 // top-left quarter
    const up = upsampleLogits(L, g, { x: 1000, y: 2000, w: 512, h: 512 }, 1)
    expect(up.data[10 * 512 + 10]).toBeGreaterThan(4)
    expect(up.data[400 * 512 + 400]).toBeLessThan(-4)
    expect(fieldBounds(up.data, up.w, up.h, { x: 1000, y: 2000, w: 512, h: 512 }, 1)!.w).toBeGreaterThan(250)
  })
  it('flattenOnGrey blends transparent pixels with grey', () => {
    const a = new Uint8ClampedArray([255, 0, 0, 0, 255, 0, 0, 128])
    flattenOnGrey(a, 100)
    expect(a[0]).toBe(100)
    expect(a[3]).toBe(255)
    expect(a[4]).toBeGreaterThan(150)
  })
})

describe('edge refinement quality (synthetic ground truth)', () => {
  const run = (kind: 'clean' | 'textured' | 'lowContrast', err: number): { coarse: number; refined: number } => {
    const s = makeScene(kind, 640, 480)
    const g = encodeGeom({ x: 0, y: 0, w: s.w, h: s.h }, 'sam1')
    const L = fakeLogits(s, err)
    const up = upsampleLogits(L, g, { x: 0, y: 0, w: s.w, h: s.h }, 1)
    const coarse = iou(up.data.map((v) => (v > 0 ? 1 : 0)), s.gt)
    const a = refineField(up.data, s.rgba, s.w, s.h, { cellPx: 4 / g.sx, smooth: 0.25, feather: 0, shift: 0 })
    return { coarse, refined: iou(a, s.gt) }
  }
  it('clean object: IoU >= 0.95 and better than the coarse mask', () => {
    const r = run('clean', 1.2)
    expect(r.refined).toBeGreaterThanOrEqual(0.95)
    expect(r.refined).toBeGreaterThanOrEqual(r.coarse - 0.002)
  })
  it('textured background: IoU >= 0.95', () => {
    expect(run('textured', 1.2).refined).toBeGreaterThanOrEqual(0.95)
  })
  it('low contrast object stays >= 0.93', () => {
    expect(run('lowContrast', 1.0).refined).toBeGreaterThanOrEqual(0.93)
  })
  it('alpha along the edge is a smooth ramp (no stair-steps): few isolated mid values, monotone profile', () => {
    const s = makeScene('clean', 640, 480)
    const g = encodeGeom({ x: 0, y: 0, w: s.w, h: s.h }, 'sam1')
    const up = upsampleLogits(fakeLogits(s, 0.8), g, { x: 0, y: 0, w: s.w, h: s.h }, 1)
    const a = refineField(up.data, s.rgba, s.w, s.h, { cellPx: 4 / g.sx, smooth: 0.4, feather: 0, shift: 0 })
    // edge width: count of pixels with 0.05<a<0.95 per boundary pixel should be small (crisp but anti-aliased)
    let mid = 0
    let edge = 0
    for (let i = 0; i < a.length; i++) {
      if (a[i] > 0.05 && a[i] < 0.95) mid++
      if (a[i] >= 0.5) edge++
    }
    expect(mid).toBeGreaterThan(200)
    expect(mid / Math.sqrt(edge)).toBeLessThan(40)
  })
  it('shift and feather change the area monotonically', () => {
    const s = makeScene('clean', 320, 240)
    const g = encodeGeom({ x: 0, y: 0, w: s.w, h: s.h }, 'sam1')
    const up = upsampleLogits(fakeLogits(s, 0.5), g, { x: 0, y: 0, w: s.w, h: s.h }, 1)
    const area = (shift: number, feather = 0): number => refineField(up.data, s.rgba, s.w, s.h, { cellPx: 2, smooth: 0.2, feather, shift }).reduce((t, v) => t + v, 0)
    expect(area(4)).toBeGreaterThan(area(0))
    expect(area(-4)).toBeLessThan(area(0))
    expect(Math.abs(area(0, 8) - area(0))).toBeLessThan(area(0) * 0.03)
  })
})

describe('brush (no AI) segmentation', () => {
  it('grows from a scribble to the object edge on synthetic scenes (IoU >= 0.93, hair >= 0.9)', async () => {
    const { brushSegment, rasterizeSeeds } = await import('../src/renderer/src/features/smartselect/brushSeg')
    for (const [kind, min] of [['clean', 0.95], ['textured', 0.93], ['lowContrast', 0.93], ['hair', 0.9]] as const) {
      const s = makeScene(kind, 480, 360)
      const seeds = rasterizeSeeds([{ pts: [{ x: s.cx - 50, y: s.cy }, { x: s.cx + 50, y: s.cy + 8 }, { x: s.cx, y: s.cy - 30 }], radii: [6, 6, 6], label: 1 }], s.w, s.h)
      const f = brushSegment(s.rgba, seeds, s.w, s.h, {})
      expect(iou(f.map((v) => (v > 0 ? 1 : 0)), s.gt), kind).toBeGreaterThanOrEqual(min)
    }
  })
  it('negative strokes carve a region out', async () => {
    const { brushSegment, rasterizeSeeds } = await import('../src/renderer/src/features/smartselect/brushSeg')
    const s = makeScene('clean', 240, 180)
    const fg = { pts: [{ x: s.cx, y: s.cy }], radii: [10], label: 1 as const }
    const bg = { pts: [{ x: s.cx + 55, y: s.cy }], radii: [8], label: 0 as const }
    const f = brushSegment(s.rgba, rasterizeSeeds([fg, bg], s.w, s.h), s.w, s.h, {})
    expect(f[Math.round(s.cy) * s.w + Math.round(s.cx + 55)]).toBeLessThan(0)
    expect(f[Math.round(s.cy) * s.w + Math.round(s.cx - 20)]).toBeGreaterThan(0)
  })
})

describe('models manifest', () => {
  it('lists pinned, checksummed files and a bundled fast model of about 45 MB', async () => {
    const { MODELS, modelFiles, modelBytes, hostAllowed, sameHash } = await import('../src/renderer/src/features/smartselect/manifest')
    expect(MODELS.fast.bundled).toBe(true)
    expect(MODELS.precise.bundled).toBe(false)
    expect(modelBytes(MODELS.fast)).toBeGreaterThan(40e6)
    expect(modelBytes(MODELS.fast)).toBeLessThan(50e6)
    for (const m of Object.values(MODELS)) {
      for (const f of modelFiles(m)) {
        expect(f.sha256).toMatch(/^[0-9a-f]{64}$/)
        expect(f.size).toBeGreaterThan(1000)
        expect(f.url).toMatch(/^https:\/\/huggingface\.co\/.+\/resolve\/[0-9a-f]{40}\//) // commit-pinned, not "main"
        expect(hostAllowed(f.url!)).toBe(true)
      }
    }
  })
  it('only allows https downloads from the Hugging Face hosts (redirect targets included)', async () => {
    const { hostAllowed } = await import('../src/renderer/src/features/smartselect/manifest')
    expect(hostAllowed('https://huggingface.co/a/b/resolve/x/y.onnx')).toBe(true)
    expect(hostAllowed('https://cas-bridge.xethub.hf.co/xet-bridge-us/abc')).toBe(true)
    expect(hostAllowed('http://huggingface.co/a')).toBe(false)
    expect(hostAllowed('https://evilhuggingface.co/a')).toBe(false)
    expect(hostAllowed('https://huggingface.co.evil.com/a')).toBe(false)
    expect(hostAllowed('file:///C:/x')).toBe(false)
    expect(hostAllowed('not a url')).toBe(false)
  })
  it('hash comparison ignores case and whitespace', async () => {
    const { sameHash } = await import('../src/renderer/src/features/smartselect/manifest')
    expect(sameHash(' AbC123 ', 'abc123')).toBe(true)
    expect(sameHash('abc', 'abd')).toBe(false)
  })
  // The weights are not in git (resources/models is ignored; `npm run models` fetches them for installers). A clean checkout / CI therefore skips this
  // check; whenever the files ARE present (developer machine, release build) they must match exactly.
  const modelsPresent = (): boolean => existsSync('resources/models/fast/mobile_sam_image_encoder.onnx') && existsSync('resources/models/fast/sam_mask_decoder_multi.onnx')
  it.skipIf(!modelsPresent())('the bundled model files match their SHA-256 (offline integrity check)', async () => {
    const { createHash } = await import('node:crypto')
    const { readFileSync } = await import('node:fs')
    const { MODELS, modelFiles } = await import('../src/renderer/src/features/smartselect/manifest')
    for (const f of modelFiles(MODELS.fast)) {
      const p = `resources/models/fast/${f.name}`
      expect(createHash('sha256').update(readFileSync(p)).digest('hex')).toBe(f.sha256)
    }
  })
})
