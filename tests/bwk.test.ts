import { describe, expect, it } from 'vitest'
import { validateManifest } from '../src/renderer/src/io/bwk'
import { normalizeBrush } from '../src/renderer/src/core/brush'
import { generateDefaultTextures, getTextureDef } from '../src/renderer/src/brush/textures'

describe('bwk manifest', () => {
  const good = { format: 'brushwork', version: 1, width: 100, height: 50, layers: [{ id: 'a', file: 'layers/a.png', name: 'x', opacity: 2, blendMode: 'bogus' }] }
  it('validates and sanitises', () => {
    const m = validateManifest(good)
    expect(m.layers[0].opacity).toBe(1)
    expect(m.layers[0].blendMode).toBe('normal')
    expect(m.activeLayer).toBe('a')
    expect(m.background.visible).toBe(true)
  })
  it('rejects garbage', () => {
    expect(() => validateManifest({})).toThrow()
    expect(() => validateManifest({ ...good, version: 9 })).toThrow()
    expect(() => validateManifest({ ...good, width: 0 })).toThrow()
    expect(() => validateManifest({ ...good, layers: [] })).toThrow()
  })
})

describe('brush data', () => {
  it('presets are JSON-serialisable and normalised', () => {
    const p = normalizeBrush({ id: 'z', name: 'Z', hardness: 0.3 })
    expect(JSON.parse(JSON.stringify(p))).toEqual(p)
    expect(p.dynamics.pressureSize).toBeDefined()
  })
  it('procedural textures generate with sane ranges', () => {
    generateDefaultTextures()
    for (const id of ['grain-paper', 'grain-pencil', 'grain-canvas', 'tip-chalk', 'tip-blot', 'tip-bristle']) {
      const t = getTextureDef(id)!
      expect(t.data.length).toBe(t.size * t.size)
      const mean = t.data.reduce((a, b) => a + b, 0) / t.data.length
      expect(mean).toBeGreaterThan(5)
      expect(mean).toBeLessThan(250)
    }
    expect(getTextureDef('tip-chalk')!.data[0]).toBe(0)
  })
})
