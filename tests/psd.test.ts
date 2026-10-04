import { describe, expect, it } from 'vitest'
import { BLEND_MODES } from '../src/renderer/src/core/blend'
import { decodePsd, encodePsd, flattenGroups, fromPsdBlend, toPsdBlend } from '../src/renderer/src/io/psd'
import type { ExLayer } from '../src/renderer/src/io/psd'

const solid = (w: number, h: number, rgba: [number, number, number, number]): Uint8ClampedArray => {
  const d = new Uint8ClampedArray(w * h * 4)
  for (let i = 0; i < d.length; i += 4) d.set(rgba, i)
  return d
}

describe('PSD roundtrip', () => {
  it('every blend mode maps to a PSD mode and back', () => {
    for (const m of BLEND_MODES) expect(fromPsdBlend(toPsdBlend(m))).toBe(m)
  })

  it('preserves layers, order, opacity, visibility, blend mode, clipping and pixels', () => {
    const layers: ExLayer[] = [
      { name: 'Base', visible: true, opacity: 1, blendMode: 'normal', clipping: false, pixels: { x: 0, y: 0, width: 8, height: 6, data: solid(8, 6, [200, 30, 40, 255]) } },
      { name: 'Shade', visible: true, opacity: 0.5, blendMode: 'multiply', clipping: true, pixels: { x: 0, y: 0, width: 8, height: 6, data: solid(8, 6, [10, 200, 90, 128]) } },
      { name: 'Hidden glow', visible: false, opacity: 0.25, blendMode: 'softLight', clipping: false, pixels: { x: 0, y: 0, width: 8, height: 6, data: solid(8, 6, [255, 255, 0, 255]) } }
    ]
    const bytes = encodePsd(8, 6, layers)
    expect(String.fromCharCode(...bytes.slice(0, 4))).toBe('8BPS')
    const d = decodePsd(bytes)
    expect(d.width).toBe(8)
    expect(d.height).toBe(6)
    expect(d.layers.map((l) => l.name)).toEqual(['Base', 'Shade', 'Hidden glow'])
    expect(d.layers.map((l) => l.blendMode)).toEqual(['normal', 'multiply', 'softLight'])
    expect(d.layers.map((l) => l.visible)).toEqual([true, true, false])
    expect(d.layers[1].opacity).toBeCloseTo(0.5, 1)
    expect(d.layers[2].opacity).toBeCloseTo(0.25, 1)
    expect(d.layers[1].clipping).toBe(true)
    const p = d.layers[0].pixels!
    expect(Array.from(p.data.slice(0, 4))).toEqual([200, 30, 40, 255])
    const q = d.layers[1].pixels!
    expect(q.data[3]).toBe(128)
    expect(q.data[1]).toBe(200)
  })

  it('preserves groups and supports offset (trimmed) layers, background layer', () => {
    const inner: ExLayer = { name: 'Dot', visible: true, opacity: 1, blendMode: 'normal', clipping: false, pixels: { x: 0, y: 0, width: 10, height: 10, data: new Uint8ClampedArray(10 * 10 * 4) } }
    inner.pixels!.data.set([255, 0, 0, 255], (3 * 10 + 4) * 4) // single opaque pixel at (4,3)
    const g: ExLayer = { name: 'Group A', visible: true, opacity: 0.8, blendMode: 'normal', clipping: false, children: [inner] }
    const d = decodePsd(encodePsd(10, 10, [g], { background: [1, 1, 1] }))
    expect(d.layers[0].name).toBe('Background color')
    const grp = d.layers[1]
    expect(grp.children).toBeTruthy()
    expect(grp.opacity).toBeCloseTo(0.8, 1)
    const dot = grp.children![0]
    // trimmed to the single pixel: offset is preserved
    expect(dot.pixels!.x).toBe(4)
    expect(dot.pixels!.y).toBe(3)
    expect(Array.from(dot.pixels!.data.slice(0, 4))).toEqual([255, 0, 0, 255])
    const flat = flattenGroups(d.layers)
    expect(flat.map((l) => l.name)).toEqual(['Background color', 'Group A / Dot'])
    expect(flat[1].opacity).toBeCloseTo(0.8, 1)
  })
})
