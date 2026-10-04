import { applyRef, isRef, tEl } from '../i18n'

type Attrs = Record<string, any> | null
type I18nRefLike = import('../i18n').I18nRef

/**
 * Tiny hyperscript helper: h('div', {class:'x', onclick: fn}, child, 'text')
 * i18n: an attribute value (text, title, placeholder, aria-label, data-tip, label, alt, value) or a child may be a
 * `tk('key', params?)` ref - it is translated now and re-translated on every language change.
 */
export function h<K extends keyof HTMLElementTagNameMap>(tag: K, attrs?: Attrs, ...children: (Node | string | null | undefined | false | I18nRefLike)[]): HTMLElementTagNameMap[K] {
  const el = document.createElement(tag)
  if (attrs) {
    for (const [k, v] of Object.entries(attrs)) {
      if (v === undefined || v === null || v === false) continue
      if (isRef(v)) applyRef(el, k === 'ariaLabel' ? 'aria-label' : k, v)
      else if (k === 'class') el.className = v
      else if (k === 'style' && typeof v === 'string') el.style.cssText = v
      else if (k === 'text') el.textContent = v
      else if (k === 'icon') el.append(icon(v, attrs.iconSize ?? 16)) // one inline-SVG icon set (see ICONS)
      else if (k === 'iconSize') continue
      else if (k.startsWith('on') && typeof v === 'function') el.addEventListener(k.slice(2).toLowerCase(), v)
      else if (k in el && k !== 'list') (el as any)[k] = v
      else el.setAttribute(k, v === true ? '' : String(v))
    }
  }
  for (const c of children) if (c) el.append(isRef(c) ? tEl(document.createElement('span'), c.key, c.params) : c)
  return el
}

const ICONS: Record<string, string> = {
  undo: '<path d="M9 14 4 9l5-5"/><path d="M4 9h10a6 6 0 0 1 0 12h-3"/>',
  redo: '<path d="m15 14 5-5-5-5"/><path d="M20 9H10a6 6 0 0 0 0 12h3"/>',
  brush: '<path d="M18.4 2.6a2 2 0 0 1 2.9 2.9L11 15.8l-3.4-3.4z"/><path d="M7.6 12.4C5 12.6 4 14 4 16c0 2-1 3-2 3.5 3 1 8 .5 9-3.5"/>',
  smudge: '<path d="M8 21c-2 0-4-1.5-4-4 0-3 4-4 4-8V4a2 2 0 0 1 4 0v6l5 1.5a3 3 0 0 1 2 2.9V17c0 2.2-1.800 4-4 4z"/>',
  eraser: '<path d="m7 21-4.3-4.3a1 1 0 0 1 0-1.4l10-10a1 1 0 0 1 1.4 0l5.6 5.6a1 1 0 0 1 0 1.4L11 21z"/><path d="M22 21H7"/><path d="m5 11 9 9"/>',
  layers: '<path d="m12 2 10 5-10 5L2 7z"/><path d="m2 12 10 5 10-5"/><path d="m2 17 10 5 10-5"/>',
  plus: '<path d="M12 5v14M5 12h14"/>',
  trash: '<path d="M3 6h18"/><path d="M8 6V4h8v2"/><path d="m6 6 1 14h10l1-14"/>',
  copy: '<rect x="8" y="8" width="13" height="13" rx="2"/><path d="M4 16V5a1 1 0 0 1 1-1h11"/>',
  eye: '<path d="M2 12s3.500-7 10-7 10 7 10 7-3.500 7-10 7S2 12 2 12z"/><circle cx="12" cy="12" r="3"/>',
  eyeoff: '<path d="M3 3l18 18"/><path d="M10.600 6.100A9.800 9.800 0 0 1 12 5c6.500 0 10 7 10 7a17 17 0 0 1-3.200 4"/><path d="M6.600 6.600A16.800 16.800 0 0 0 2 12s3.500 7 10 7c1.500 0 2.900-.4 4.100-1"/>',
  lock: '<rect x="5" y="11" width="14" height="10" rx="2"/><path d="M8 11V8a4 4 0 0 1 8 0v3"/>',
  clear: '<path d="M4 4l16 16M20 4 4 20"/>',
  minus: '<path d="M5 12h14"/>',
  check: '<path d="m5 12 5 5 9-10"/>',
  star: '<path d="m12 3 2.700 5.600 6.100.900-4.400 4.300 1 6.100L12 17l-5.400 2.900 1-6.100-4.400-4.300 6.100-.900z"/>',
  starfill: '<path fill="currentColor" d="m12 3 2.700 5.600 6.100.900-4.400 4.300 1 6.100L12 17l-5.400 2.900 1-6.100-4.400-4.300 6.100-.900z"/>',
  share: '<path d="M12 15V3"/><path d="m7 8 5-5 5 5"/><path d="M5 12v7a2 2 0 0 0 2 2h10a2 2 0 0 0 2-2v-7"/>',
  ungroup: '<rect x="3" y="3" width="8" height="8" rx="1"/><rect x="13" y="13" width="8" height="8" rx="1"/>',
  up: '<path d="M12 19V5"/><path d="m5 12 7-7 7 7"/>',
  info: '<circle cx="12" cy="12" r="9"/><path d="M12 11v5"/><path d="M12 8h.01"/>',
  crosshair: '<circle cx="12" cy="12" r="6"/><path d="M12 2v5M12 17v5M2 12h5M17 12h5"/>',
  grid: '<rect x="3" y="3" width="7" height="7" rx="1"/><rect x="14" y="3" width="7" height="7" rx="1"/><rect x="3" y="14" width="7" height="7" rx="1"/><rect x="14" y="14" width="7" height="7" rx="1"/>',
  list: '<path d="M8 6h13M8 12h13M8 18h13"/><path d="M3 6h.010M3 12h.010M3 18h.010"/>',
  more: '<path d="M5 12h.010M12 12h.010M19 12h.010" stroke-width="3"/>',
  chevr: '<path d="m9 6 6 6-6 6"/>',
  chevd: '<path d="m6 9 6 6 6-6"/>',
  pipette: '<path d="m2 22 1-1h3l9-9"/><path d="M3 21v-3l9-9"/><path d="m15 6 3.400-3.400a2.100 2.100 0 1 1 3 3L18 9l.400.400a2.100 2.100 0 1 1-3 3l-3.800-3.800a2.100 2.100 0 1 1 3-3l.400.400Z"/>'
}

export function icon(name: string, size = 20): SVGElement {
  const s = document.createElementNS('http://www.w3.org/2000/svg', 'svg')
  s.setAttribute('viewBox', '0 0 24 24')
  s.setAttribute('width', String(size))
  s.setAttribute('height', String(size))
  s.setAttribute('fill', 'none')
  s.setAttribute('stroke', 'currentColor')
  s.setAttribute('stroke-width', '1.8')
  s.setAttribute('stroke-linecap', 'round')
  s.setAttribute('stroke-linejoin', 'round')
  s.innerHTML = ICONS[name] ?? ''
  return s
}
