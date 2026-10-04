import { describe, expect, it } from 'vitest'
import { descendantsOf, displayRows, maxLayersFor, moveRelative, normalizeOrder, TreeItem } from '../src/renderer/src/doc/layerTree'

interface L extends TreeItem {
  collapsed: boolean
}
const mk = (id: string, parentId: string | null = null, isGroup = false): L => ({ id, parentId, isGroup, collapsed: false })
const ids = (a: L[]): string[] => a.map((l) => l.id)

describe('layer tree', () => {
  it('normalizes so a group follows its children', () => {
    const layers = [mk('g', null, true), mk('a', 'g'), mk('b'), mk('c', 'g')]
    expect(ids(normalizeOrder(layers))).toEqual(['a', 'c', 'g', 'b'])
  })
  it('reparents orphans and breaks cycles', () => {
    const layers = [mk('a', 'missing'), mk('g1', 'g2', true), mk('g2', 'g1', true)]
    const out = normalizeOrder(layers)
    expect(out.length).toBe(3)
    expect(layers[0].parentId).toBeNull()
  })
  it('display rows are top-down and honour collapse', () => {
    const layers = [mk('a', 'g'), mk('b', 'g'), mk('g', null, true), mk('c')]
    expect(displayRows(layers).map((r) => r.layer.id + ':' + r.depth)).toEqual(['c:0', 'g:0', 'b:1', 'a:1'])
    layers[2].collapsed = true
    expect(displayRows(layers).map((r) => r.layer.id)).toEqual(['c', 'g'])
  })
  it('moves into a group, above and below', () => {
    const layers = [mk('a'), mk('b'), mk('g', null, true), mk('c')]
    const into = moveRelative(layers, 'a', 'g', 'into')!
    expect(ids(into.order)).toEqual(['b', 'a', 'g', 'c'])
    expect(into.order.find((l) => l.id === 'a')!.parentId).toBe('g')
    const above = moveRelative(into.order, 'c', 'b', 'below')!
    expect(ids(above.order)).toEqual(['c', 'b', 'a', 'g'])
  })
  it('refuses to move a group into itself', () => {
    const layers = [mk('a', 'g'), mk('g', null, true)]
    expect(moveRelative(layers, 'g', 'a', 'above')).toBeNull()
    expect(descendantsOf(layers, 'g').map((l) => l.id)).toEqual(['a'])
  })
  it('layer limit shrinks with canvas size', () => {
    expect(maxLayersFor(2048, 2048, 8)).toBeGreaterThan(maxLayersFor(4096, 4096, 8))
    expect(maxLayersFor(20000, 20000, 8)).toBeGreaterThanOrEqual(2)
  })
})
