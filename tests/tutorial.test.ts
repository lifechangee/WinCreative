import { describe, expect, it } from 'vitest'
import { SCENE_NAMES, illustration } from '../src/renderer/src/features/tutorial/illus'

describe('tutorial illustrations', () => {
  const specs = [...SCENE_NAMES, 'keys:Ctrl+Shift+Z', 'tap:3', 'tap:4', 'hold:3', 'pinch:in', 'mouse:Space', 'layerRow:swipeR', 'layerRow:swipeL', 'layerRow:alpha', 'layerRow:tap2', 'layerRow:altDrag', 'layerRow:pinch', 'layerRow:drag', 'menu:A,B,C,D', 'slider:opacity']

  it.each(specs)('%s renders well-formed inline SVG', (spec) => {
    const svg = illustration(spec)
    expect(svg.startsWith('<svg')).toBe(true)
    expect(svg.endsWith('</svg>')).toBe(true)
    expect(svg).not.toMatch(/undefined|NaN|\[object/)
    expect((svg.match(/<g[\s>]/g) ?? []).length).toBe((svg.match(/<\/g>/g) ?? []).length)
    // every element is closed: paired tags or self-closing
    const opens = [...svg.matchAll(/<([a-zA-Z][\w-]*)\b[^>]*?(\/?)>/g)].filter((m) => m[2] !== '/').map((m) => m[1])
    const closes = (svg.match(/<\/[a-zA-Z]+>/g) ?? []).map((t) => t.slice(2, -1))
    expect(opens.sort()).toEqual(closes.sort())
  })

  it('ids are unique across scenes drawn one after another (several on one page)', () => {
    const a = illustration('penPressure')
    const b = illustration('penPressure')
    const id = (s: string): string => /id="(c\d+)"/.exec(s)![1]
    expect(id(a)).not.toBe(id(b))
  })
})
