/**
 * Off-main-thread half of the async .bwk save (io/asyncSave.ts).
 *  - PNG jobs: the main thread streams straight-alpha RGBA8 row bands (read back from the GPU through pixel-pack buffers);
 *    this worker filters + deflates them incrementally (fflate Zlib stream) and returns one PNG.
 *  - Archive role: keeps the encoded PNG of every layer (keyed by surface uid, tagged with the pixel revision) so an
 *    incremental save only re-encodes layers that changed, then builds the zip (stored, level 0).
 */
import { zipSync } from 'fflate'
import { PngStream } from './pngStream'

type In =
  | { t: 'begin'; id: number; w: number; h: number }
  | { t: 'rows'; id: number; buf: ArrayBuffer }
  | { t: 'end'; id: number }
  | { t: 'cancel'; id: number }
  | { t: 'store'; doc: string; key: string; png: ArrayBuffer }
  | { t: 'zip'; id: number; doc: string; entries: { name: string; keys: string[] }[]; files: Record<string, Uint8Array>; keep: string[] }
  | { t: 'drop'; doc: string }
  | { t: 'cat'; id: number; doc: string; keys: string[] }

const scope = self as unknown as { onmessage: ((e: MessageEvent<In>) => void) | null; postMessage(m: unknown, t?: Transferable[]): void }

// ------------------------------------------------------------------ PNG
const jobs = new Map<number, PngStream>()

// ------------------------------------------------------------------ archive
const store = new Map<string, Map<string, Uint8Array>>()
const docOrder: string[] = []
function docMap(doc: string): Map<string, Uint8Array> {
  let m = store.get(doc)
  if (!m) {
    store.set(doc, (m = new Map()))
    docOrder.push(doc)
    while (docOrder.length > 3) store.delete(docOrder.shift()!)
  }
  return m
}

scope.onmessage = (e): void => {
  const m = e.data
  try {
    switch (m.t) {
      case 'begin':
        jobs.set(m.id, new PngStream(m.w, m.h))
        break
      case 'rows':
        jobs.get(m.id)?.push(new Uint8Array(m.buf))
        break
      case 'end': {
        const j = jobs.get(m.id)
        if (!j) break
        jobs.delete(m.id)
        const png = j.finish()
        scope.postMessage({ t: 'png', id: m.id, png: png.buffer }, [png.buffer as ArrayBuffer])
        break
      }
      case 'cancel':
        jobs.delete(m.id)
        break
      case 'store':
        docMap(m.doc).set(m.key, new Uint8Array(m.png))
        break
      case 'drop':
        store.delete(m.doc)
        break
      case 'cat': {
        const mp = docMap(m.doc)
        const parts = m.keys.map((k) => mp.get(k) ?? new Uint8Array(0))
        const b = new Uint8Array(parts.reduce((a, p) => a + p.length, 0))
        let o = 0
        for (const p of parts) (b.set(p, o), (o += p.length))
        scope.postMessage({ t: 'zip', id: m.id, zip: b.buffer }, [b.buffer as ArrayBuffer])
        break
      }
      case 'zip': {
        const mp = docMap(m.doc)
        const files: Record<string, [Uint8Array, { level: 0 }]> = {}
        for (const en of m.entries) {
          const parts = en.keys.map((k) => {
            const b = mp.get(k)
            if (!b) throw new Error('archive is missing ' + en.name)
            return b
          })
          let b = parts[0]
          if (parts.length > 1) {
            // several cached chunks form one file (time-lapse recording): concatenated here, off the main thread
            b = new Uint8Array(parts.reduce((a, p) => a + p.length, 0))
            let o = 0
            for (const p of parts) (b.set(p, o), (o += p.length))
          }
          files[en.name] = [b, { level: 0 }]
        }
        for (const [k, v] of Object.entries(m.files)) files[k] = [v, { level: 0 }]
        const keep = new Set(m.keep)
        for (const k of [...mp.keys()]) if (!keep.has(k)) mp.delete(k)
        const zip = zipSync(files as never)
        scope.postMessage({ t: 'zip', id: m.id, zip: zip.buffer }, [zip.buffer as ArrayBuffer])
        break
      }
    }
  } catch (err) {
    scope.postMessage({ t: 'err', id: (m as { id?: number }).id ?? -1, error: String(err) })
  }
}
