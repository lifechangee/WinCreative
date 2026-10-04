import type { Document } from '../../doc/document'
import { registerBwkExtension } from '../../io/bwk'
import { SRGB, buildIcc, embedIcc, iccDescription, spaceFromLabel } from '../../io/colorProfile'

/** Per-document metadata owned by the animio module (Canvas Information: Meta / Dimensions). Persisted in the .bwk. */
export interface DocMeta {
  author: string
  dpi: number
  /** colour profile tag of the pixel values (see io/colorProfile.ts); 'Custom: <name>' when `icc` is set */
  profile: string
  /** imported ICC profile that is not one of the built-in spaces (embedded as-is in exports) */
  icc?: Uint8Array | null
}

const metas = new WeakMap<Document, DocMeta>()
export const DEFAULT_META: DocMeta = { author: '', dpi: 132, profile: 'sRGB IEC61966-2.1' }

export function docMeta(doc: Document): DocMeta {
  let m = metas.get(doc)
  if (!m) metas.set(doc, (m = { ...DEFAULT_META }))
  return m
}
/** Called after a document's colour profile changed (display colour space, UI). */
export const profileListeners = new Set<(doc: Document) => void>()

export function setDocMeta(doc: Document, m: Partial<DocMeta>): void {
  Object.assign(docMeta(doc), m)
  if ('profile' in m || 'icc' in m) for (const f of profileListeners) f(doc)
}

const iccCache = new Map<string, Uint8Array>()
/** The ICC profile to embed in exports of this document: the imported one, else a generated one for its space. */
export function docIcc(doc: Document): { name: string; icc: Uint8Array } {
  const m = docMeta(doc)
  if (m.icc) return { name: iccDescription(m.icc) ?? 'Custom', icc: m.icc }
  const s = spaceFromLabel(m.profile) ?? SRGB
  let icc = iccCache.get(s.id)
  if (!icc) iccCache.set(s.id, (icc = buildIcc(s)))
  return { name: s.desc, icc }
}

/** Embed the document's profile in PNG / JPEG / PSD bytes (other kinds are returned unchanged). */
export function embedDocProfile(doc: Document, kind: string, bytes: Uint8Array): Uint8Array {
  const { name, icc } = docIcc(doc)
  return embedIcc(kind, bytes, name, icc)
}

registerBwkExtension({
  id: 'animio.meta',
  save: (doc) => {
    const { icc, ...rest } = docMeta(doc)
    return icc ? { extra: { ...rest, hasIcc: true }, files: { 'meta/profile.icc': icc } } : { extra: rest }
  },
  load: (doc, extra, entries) => {
    const e = (extra ?? {}) as Partial<DocMeta>
    setDocMeta(doc, {
      author: typeof e.author === 'string' ? e.author : '',
      dpi: Number.isFinite(e.dpi) && (e.dpi as number) > 0 ? (e.dpi as number) : DEFAULT_META.dpi,
      profile: typeof e.profile === 'string' ? e.profile : DEFAULT_META.profile,
      icc: (e as { hasIcc?: boolean }).hasIcc ? (entries?.['meta/profile.icc'] ?? null) : null
    })
  }
})
