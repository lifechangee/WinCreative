/** Byte-run RLE for selection masks: [count(1..255), value]* pairs. Masks are mostly 0 / 255 runs, so this is tiny. */
export function rleEncode(d: Uint8Array): Uint8Array {
  const out: number[] = []
  for (let i = 0; i < d.length; ) {
    const v = d[i]
    let n = 1
    while (n < 255 && i + n < d.length && d[i + n] === v) n++
    out.push(n, v)
    i += n
  }
  return Uint8Array.from(out)
}

export function rleDecode(b: Uint8Array, len: number): Uint8Array {
  const d = new Uint8Array(len)
  let o = 0
  for (let i = 0; i + 1 < b.length && o < len; i += 2) {
    const n = Math.min(b[i], len - o)
    d.fill(b[i + 1], o, o + n)
    o += n
  }
  return d
}
