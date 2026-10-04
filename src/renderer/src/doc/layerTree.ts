/**
 * Pure helpers for the layer tree. The document keeps layers in ONE flat array (bottom -> top) where
 * `parentId` links members to their group. Invariant (established by normalizeOrder): a group's
 * descendants are contiguous and immediately BELOW the group entry, i.e. the group is the last item
 * of its own block. This keeps every existing `doc.layers.forEach` consumer working.
 */
export interface TreeItem {
  id: string
  parentId: string | null
  isGroup: boolean
}

export const MAX_GROUP_DEPTH = 6

export function childrenOf<T extends TreeItem>(layers: readonly T[], parentId: string | null): T[] {
  return layers.filter((l) => (l.parentId ?? null) === parentId)
}

export function descendantsOf<T extends TreeItem>(layers: readonly T[], id: string): T[] {
  const out: T[] = []
  const walk = (pid: string): void => {
    for (const l of layers) {
      if (l.parentId === pid) {
        walk(l.id)
        out.push(l)
      }
    }
  }
  walk(id)
  return out
}

export function isDescendant<T extends TreeItem>(layers: readonly T[], id: string, ancestorId: string): boolean {
  const by = new Map(layers.map((l) => [l.id, l]))
  let cur = by.get(id)?.parentId ?? null
  let guard = 0
  while (cur && guard++ < 64) {
    if (cur === ancestorId) return true
    cur = by.get(cur)?.parentId ?? null
  }
  return false
}

export function depthOf<T extends TreeItem>(layers: readonly T[], id: string): number {
  const by = new Map(layers.map((l) => [l.id, l]))
  let d = 0
  let cur = by.get(id)?.parentId ?? null
  while (cur && d < 64) {
    d++
    cur = by.get(cur)?.parentId ?? null
  }
  return d
}

/** Height of the subtree under `id` (0 for a leaf). */
export function subtreeHeight<T extends TreeItem>(layers: readonly T[], id: string): number {
  let best = 0
  for (const c of childrenOf(layers, id)) best = Math.max(best, 1 + subtreeHeight(layers, c.id))
  return best
}

/**
 * Re-establish the block invariant. Items whose parent does not exist (or is not a group, or is
 * part of a cycle) are moved to the root. Relative order of siblings is preserved.
 */
export function normalizeOrder<T extends TreeItem>(layers: readonly T[]): T[] {
  const ids = new Map(layers.map((l) => [l.id, l]))
  for (const l of layers) {
    const p = l.parentId ? ids.get(l.parentId) : null
    if (l.parentId && (!p || !p.isGroup || l.parentId === l.id)) l.parentId = null
  }
  // break cycles
  for (const l of layers) {
    if (l.parentId && isDescendant(layers, l.parentId, l.id)) l.parentId = null
  }
  const out: T[] = []
  const emit = (pid: string | null): void => {
    for (const l of layers) {
      if ((l.parentId ?? null) !== pid) continue
      if (l.isGroup) emit(l.id)
      out.push(l)
    }
  }
  emit(null)
  return out
}

export interface Row<T> {
  layer: T
  depth: number
}

/** Top-down display rows. Children of collapsed groups are omitted. */
export function displayRows<T extends TreeItem & { collapsed: boolean }>(layers: readonly T[]): Row<T>[] {
  const rows: Row<T>[] = []
  const walk = (pid: string | null, depth: number): void => {
    const sibs = childrenOf(layers, pid)
    for (let i = sibs.length - 1; i >= 0; i--) {
      const l = sibs[i]
      rows.push({ layer: l, depth })
      if (l.isGroup && !l.collapsed) walk(l.id, depth + 1)
    }
  }
  walk(null, 0)
  return rows
}

/**
 * Where can a layer be dropped? Computes new flat order after moving `id` (with its subtree).
 * where: 'above' / 'below' a reference layer (becoming its sibling), or 'into' a group (top of it).
 * Returns null if the move is illegal (into itself/descendant, depth limit).
 */
export function moveRelative<T extends TreeItem>(layers: readonly T[], id: string, refId: string, where: 'above' | 'below' | 'into'): { order: T[]; parentId: string | null } | null {
  const x = layers.find((l) => l.id === id)
  const ref = layers.find((l) => l.id === refId)
  if (!x || !ref || id === refId) return null
  if (isDescendant(layers, refId, id)) return null
  const parentId = where === 'into' ? (ref.isGroup ? ref.id : null) : ref.parentId
  if (where === 'into' && !ref.isGroup) return null
  if (parentId !== null && x.isGroup) {
    if (depthOf(layers, parentId) + 1 + subtreeHeight(layers, id) >= MAX_GROUP_DEPTH) return null
  }
  if (parentId !== null && !x.isGroup && depthOf(layers, parentId) + 1 >= MAX_GROUP_DEPTH) return null
  const block = [...descendantsOf(layers, id), x]
  const blockSet = new Set(block)
  const rest = layers.filter((l) => !blockSet.has(l))
  let at: number
  if (where === 'into') {
    at = rest.indexOf(ref) // just below the group header = top of its children
  } else if (where === 'above') {
    at = rest.indexOf(ref) + 1
  } else {
    // below `ref`: before ref's block start
    const desc = ref.isGroup ? descendantsOf(rest, ref.id) : []
    at = desc.length ? Math.min(...desc.map((d) => rest.indexOf(d))) : rest.indexOf(ref)
  }
  x.parentId = parentId
  const merged = [...rest.slice(0, at), ...block, ...rest.slice(at)]
  return { order: normalizeOrder(merged), parentId }
}

/** Procreate-like layer limit from canvas size: ~2.5 GiB of layer memory minus scratch buffers. */
export function maxLayersFor(width: number, height: number, bytesPerPixel: number): number {
  const budget = 2.5 * 1024 ** 3
  const per = width * height * bytesPerPixel
  const reserve = 5
  return Math.max(2, Math.min(999, Math.floor(budget / per) - reserve))
}
