import type { App } from '../../app/app'
import { t } from '../../i18n'
import type { Document } from '../../doc/document'
import { FS_VERT } from '../../gl/gpu'
import { PROFILE_LABELS, RgbSpace, SPACES, SRGB, convertMatrix, decodeTrc, encodeTrc, extractIcc, iccColorSpace, iccDescription, identifyIcc, spaceFromLabel } from '../../io/colorProfile'
import { docMeta, setDocMeta } from '../animio/docMeta'

/**
 * GPU colour conversion of layer pixels between RGB working spaces. Layers are premultiplied: un-premultiply, decode
 * the source curve, matrix (linear light), encode the destination curve, gamut clip, premultiply again.
 */
const FS = `#version 300 es
precision highp float;
uniform sampler2D uSrc;
uniform vec3 uM0; uniform vec3 uM1; uniform vec3 uM2;
uniform float uSrcG; // 0 = sRGB curve, else gamma
uniform float uDstG;
out vec4 o;
vec3 dec(vec3 v){
  if (uSrcG > 0.0) return pow(max(v, 0.0), vec3(uSrcG));
  return mix(pow((max(v, 0.0) + 0.055) / 1.055, vec3(2.4)), v / 12.92, lessThanEqual(v, vec3(0.04045)));
}
vec3 enc(vec3 v){
  v = clamp(v, 0.0, 1.0);
  if (uDstG > 0.0) return pow(v, vec3(1.0 / uDstG));
  return mix(1.055 * pow(v, vec3(1.0 / 2.4)) - 0.055, v * 12.92, lessThanEqual(v, vec3(0.0031308)));
}
void main(){
  vec4 s = texelFetch(uSrc, ivec2(gl_FragCoord.xy), 0);
  if (s.a <= 0.0) { o = s; return; }
  vec3 c = dec(clamp(s.rgb / s.a, 0.0, 1.0));
  c = vec3(dot(uM0, c), dot(uM1, c), dot(uM2, c));
  o = vec4(enc(c) * s.a, s.a);
}`

const gammaOf = (s: RgbSpace): number => (s.trc.kind === 'gamma' ? s.trc.g : 0)

/** The space a document's pixels are tagged with (unknown / custom tags are treated as sRGB for maths). */
export const docSpace = (doc: Document): RgbSpace => spaceFromLabel(docMeta(doc).profile) ?? SRGB

/**
 * Convert every layer (and the background colour) from the document's current space to `to`, then re-tag it.
 * One undo step (pixels + tag).
 */
export function convertDocument(app: App, to: RgbSpace): boolean {
  const doc = app.doc
  const from = docSpace(doc)
  if (from === to && !docMeta(doc).icc) return false
  const gpu = app.gpu
  const gl = gpu.gl
  const m = convertMatrix(from, to)
  const full = { x: 0, y: 0, w: doc.width, h: doc.height }
  const before = { profile: docMeta(doc).profile, icc: docMeta(doc).icc ?? null }
  const bg = doc.background
  doc.transaction('Convert colour profile', 'filter', null, () => {
    for (const l of doc.layers) {
      if (l.isGroup) continue
      if (l.tiles) {
        // infinite canvas: tile by tile (evicted tiles are restored on demand), one undo entry per layer
        const store = l.tiles
        const tr = { x: 0, y: 0, w: store.size, h: store.size }
        const tmp = gpu.surface(store.size, store.size, store.fmt, 0) // allocate before binding textures
        const edit = doc.beginPixelEdit(l, 'Convert profile')
        for (const key of [...store.keys()]) {
          edit.saveKey(key)
          const s = store.getKey(key)!
          gpu.blit(s, tr, tmp, 0, 0)
          const p = gpu.program('profile-convert', FS_VERT, FS).use()
          gpu.bindTex(0, tmp.tex)
          p.i('uSrc', 0).v3('uM0', m[0], m[1], m[2]).v3('uM1', m[3], m[4], m[5]).v3('uM2', m[6], m[7], m[8]).f('uSrcG', gammaOf(from)).f('uDstG', gammaOf(to))
          gl.disable(gl.BLEND)
          gpu.bindTarget(s, null)
          gpu.fullscreen()
        }
        tmp.dispose()
        edit.finish()
        continue
      }
      const edit = doc.beginPixelEdit(l, 'Convert profile')
      edit.save(full)
      gpu.blit(l.pixels, full, doc.scratch, 0, 0)
      const p = gpu.program('profile-convert', FS_VERT, FS).use()
      gpu.bindTex(0, doc.scratch.tex)
      p.i('uSrc', 0).v3('uM0', m[0], m[1], m[2]).v3('uM1', m[3], m[4], m[5]).v3('uM2', m[6], m[7], m[8]).f('uSrcG', gammaOf(from)).f('uDstG', gammaOf(to))
      gl.disable(gl.BLEND)
      gpu.bindTarget(l.pixels, null)
      gpu.fullscreen()
      edit.finish()
    }
    // background paper colour follows
    const nc = [0, 1, 2].map((k) => m[k * 3] * decodeTrc(from.trc, bg.color[0]) + m[k * 3 + 1] * decodeTrc(from.trc, bg.color[1]) + m[k * 3 + 2] * decodeTrc(from.trc, bg.color[2])).map((v) => encodeTrc(to.trc, v)) as [number, number, number]
    doc.setBackground(nc, bg.visible)
    // the tag change is part of the same undo step
    const apply = (profile: string, icc: Uint8Array | null): void => setDocMeta(doc, { profile, icc })
    apply(to.label, null)
    doc.pushCommand({ label: t('color.profile.undoTag'), bytes: 0, undo: () => apply(before.profile, before.icc), redo: () => apply(to.label, null) })
  })
  doc.events.emit('change', { rect: null })
  return true
}

/** Change only the tag (Assign profile): pixel values are kept and reinterpreted. Undoable. */
export function assignProfile(app: App, label: string, icc: Uint8Array | null = null): void {
  const doc = app.doc
  const before = { profile: docMeta(doc).profile, icc: docMeta(doc).icc ?? null }
  if (before.profile === label && before.icc === icc) return
  const apply = (profile: string, i: Uint8Array | null): void => setDocMeta(doc, { profile, icc: i })
  apply(label, icc)
  doc.pushCommand({ label: t('color.profile.undoAssign'), bytes: icc?.length ?? 0, undo: () => apply(before.profile, before.icc), redo: () => apply(label, icc) })
}

/** Use an ICC file as the document's profile: built-in spaces are recognised, other RGB profiles are kept as "custom". */
export function importIccProfile(app: App, bytes: Uint8Array): { ok: boolean; message: string } {
  const sig = String.fromCharCode(...bytes.slice(36, 40))
  if (bytes.length < 132 || sig !== 'acsp') return { ok: false, message: t('color.profile.notIcc') }
  const cs = String.fromCharCode(...bytes.slice(16, 20))
  if (cs !== 'RGB ') return { ok: false, message: t('color.profile.onlyRgb', { cs: cs.trim() }) }
  const known = identifyIcc(bytes)
  if (known) {
    assignProfile(app, known.label)
    return { ok: true, message: t('color.profile.recognised', { label: known.label }) }
  }
  const name = iccDescription(bytes) ?? 'Imported profile'
  assignProfile(app, 'Custom: ' + name, bytes)
  return { ok: true, message: t('color.profile.custom', { name }) }
}

export { PROFILE_LABELS, SPACES }

/** Import: pick up the profile embedded in a PNG / JPEG so a Display P3 photo stays Display P3. */
export function tagFromFile(doc: Document, bytes: Uint8Array): void {
  const icc = extractIcc(bytes)
  if (!icc || iccColorSpace(icc) !== 'RGB ') return
  const known = identifyIcc(icc)
  if (known) setDocMeta(doc, { profile: known.label, icc: null })
  else setDocMeta(doc, { profile: 'Custom: ' + (iccDescription(icc) ?? 'Embedded profile'), icc })
}
