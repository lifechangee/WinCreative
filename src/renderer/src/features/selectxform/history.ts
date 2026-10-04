import type { Command } from '../../core/undo'
import type { Document } from '../../doc/document'

/**
 * Run `fn` and collapse every history entry it pushes (layer add, pixel edits, ...) into ONE undo step.
 * Extra commands (e.g. a selection change) may be appended by `fn` through the returned list.
 */
export function groupHistory<T>(doc: Document, label: string, fn: (extra: Command[]) => T): T {
  const h = doc.history as any
  const got: Command[] = []
  const extra: Command[] = []
  h.push = (c: Command): void => void got.push(c)
  let r: T
  try {
    r = fn(extra)
  } finally {
    delete h.push
  }
  const all = [...got, ...extra]
  if (all.length) {
    const last = all[all.length - 1]
    const cmd: Command = {
      label,
      layerId: last.layerId ?? null,
      dirtyRect: last.dirtyRect ?? null,
      bytes: all.reduce((s, c) => s + c.bytes, 0),
      undo: () => {
        for (let i = all.length - 1; i >= 0; i--) all[i].undo()
      },
      redo: () => {
        for (const c of all) c.redo()
      },
      dispose: () => all.forEach((c) => c.dispose?.())
    }
    doc.history.push(cmd)
  }
  return r
}
