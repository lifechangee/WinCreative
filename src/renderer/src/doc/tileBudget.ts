/**
 * Pure policy of the tile memory system (no GL / DOM; unit-tested): budgets derived from the device and LRU victim selection.
 *   tier 1  GPU     resident tile surfaces (+ undo snapshots)           budget.gpu
 *   tier 2  CPU     compressed PNG blobs of evicted / saved tiles         budget.cpu
 *   tier 3  disk    per-document scratch files (main process)             unlimited (OS disk)
 */
const MB = 1024 * 1024

export interface MemBudget {
  gpu: number
  cpu: number
}
export interface DeviceInfo {
  /** navigator.deviceMemory (GB, capped at 8 by browsers); undefined = unknown */
  deviceMemoryGB?: number
  /** GPU texture limit hint (MAX_TEXTURE_SIZE): <= 8192 suggests an integrated / old GPU */
  maxTexture?: number
}
export interface BudgetOverride {
  /** MB; 0 / undefined = automatic */
  gpuMB?: number
  cpuMB?: number
}

/** Default budgets: ~15 % of the (capped) device memory for GPU tiles, clamped to 384 MB .. 1.25 GB; CPU blobs ~ 10 % clamped 256 MB .. 1 GB. */
export function deriveBudget(dev: DeviceInfo = {}, ov: BudgetOverride = {}): MemBudget {
  const gb = dev.deviceMemoryGB && dev.deviceMemoryGB > 0 ? dev.deviceMemoryGB : 8
  let gpu = Math.min(1280 * MB, Math.max(384 * MB, gb * 0.15 * 1024 * MB))
  if (dev.maxTexture && dev.maxTexture <= 8192) gpu = Math.min(gpu, 512 * MB)
  const cpu = Math.min(1024 * MB, Math.max(256 * MB, gb * 0.1 * 1024 * MB))
  return {
    gpu: ov.gpuMB && ov.gpuMB > 0 ? Math.round(ov.gpuMB * MB) : Math.round(gpu),
    cpu: ov.cpuMB && ov.cpuMB > 0 ? Math.round(ov.cpuMB * MB) : Math.round(cpu)
  }
}

export interface Candidate {
  id: number
  /** logical clock of the last use (larger = more recent) */
  stamp: number
  bytes: number
}

/**
 * LRU: the least recently used candidates whose stamp is older than `pinFrom` (recently used = pinned), oldest first, until at least
 * `need` bytes are covered. Stable for equal stamps (input order).
 */
export function pickVictims(cands: Candidate[], need: number, pinFrom: number): Candidate[] {
  if (need <= 0) return []
  const old = cands.filter((c) => c.stamp < pinFrom).sort((a, b) => a.stamp - b.stamp)
  const out: Candidate[] = []
  let got = 0
  for (const c of old) {
    if (got >= need) break
    out.push(c)
    got += c.bytes
  }
  return out
}

/** Eviction target: start when `used > budget`, stop at 90 % of the budget (hysteresis keeps eviction in bursts). */
export const EVICT_LOW = 0.9
export const bytesToEvict = (used: number, budget: number): number => (used > budget ? used - Math.floor(budget * EVICT_LOW) : 0)

/** Restore queue order: nearest to the viewport centre first; ties by request order. */
export function priorityOf(tx: number, ty: number, cx: number, cy: number): number {
  return Math.hypot(tx - cx, ty - cy)
}
