/**
 * Cheap 32-bit checksum of a compressed tile blob (pure). Every evicted / spilled tile blob carries one; it is re-computed on restore so a blob
 * that was altered in RAM or in its scratch file is detected (and the other copy used) instead of feeding garbage to the PNG decoder.
 * 4 bytes per step, ~1 GB/s: a 300 KB blob costs well under a millisecond. Not cryptographic.
 */
export function blobSum(b: Uint8Array): number {
  const n = b.length
  const n4 = n & ~3
  let h = (0x811c9dc5 ^ n) | 0
  let i = 0
  for (; i < n4; i += 4) {
    h = Math.imul(h ^ (b[i] | (b[i + 1] << 8) | (b[i + 2] << 16) | (b[i + 3] << 24)), 0x01000193)
    h ^= h >>> 15
  }
  for (; i < n; i++) h = Math.imul(h ^ b[i], 0x01000193)
  return (h ^ (h >>> 13)) >>> 0
}
