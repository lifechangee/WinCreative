import { describe, expect, it } from 'vitest'
import { Command, UndoStack } from '../src/renderer/src/core/undo'

const mk = (log: string[], name: string, bytes = 10): Command => ({
  label: name,
  bytes,
  undo: () => log.push('u' + name),
  redo: () => log.push('r' + name),
  dispose: () => log.push('d' + name)
})

describe('UndoStack', () => {
  it('undo/redo in order', () => {
    const log: string[] = []
    const s = new UndoStack()
    s.push(mk(log, 'a'))
    s.push(mk(log, 'b'))
    s.undo()
    s.undo()
    s.redo()
    expect(log).toEqual(['ub', 'ua', 'ra'])
    expect(s.canUndo && s.canRedo).toBe(true)
  })
  it('push clears redo branch and disposes it', () => {
    const log: string[] = []
    const s = new UndoStack()
    s.push(mk(log, 'a'))
    s.undo()
    s.push(mk(log, 'b'))
    expect(s.canRedo).toBe(false)
    expect(log).toContain('da')
  })
  it('keeps at least 100 steps under byte pressure and caps at maxSteps', () => {
    const s = new UndoStack({ maxSteps: 150, maxBytes: 500, minSteps: 100 })
    for (let i = 0; i < 300; i++) s.push(mk([], 'x' + i, 10))
    expect(s.undoCount).toBe(100)
    const t = new UndoStack({ maxSteps: 150, maxBytes: 1e12, minSteps: 100 })
    for (let i = 0; i < 300; i++) t.push(mk([], 'x' + i))
    expect(t.undoCount).toBe(150)
  })
  it('evicted commands are disposed and bytes tracked', () => {
    const log: string[] = []
    const s = new UndoStack({ maxSteps: 2, maxBytes: 1e9, minSteps: 1 })
    s.push(mk(log, 'a', 5))
    s.push(mk(log, 'b', 5))
    s.push(mk(log, 'c', 5))
    expect(log).toEqual(['da'])
    expect(s.totalBytes).toBe(10)
    s.clear()
    expect(s.totalBytes).toBe(0)
  })
  it('supports 100+ sequential undos', () => {
    let n = 0
    const s = new UndoStack()
    for (let i = 0; i < 120; i++) {
      n++
      s.push({ label: 'i', bytes: 1, undo: () => n--, redo: () => n++ })
    }
    while (s.canUndo) s.undo()
    expect(n).toBe(0)
  })
})
