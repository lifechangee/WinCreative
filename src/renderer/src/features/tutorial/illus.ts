/**
 * Animated illustrations (inline SVG, SMIL + a little CSS). Every scene uses one 3 s loop:
 * 0-10 % rest, 10-60 % the gesture, 60-100 % hold the result. Scenes are named; `keys:Ctrl+Z` draws key caps.
 */
import { prefs } from '../../input/prefs'

let uid = 0
const D = 3
const KT = '0;.1;.6;1'

// ---- SMIL helpers (all share the loop above)
const anim = (attr: string, a: string | number, b: string | number, d = D, kt = KT): string =>
  `<animate attributeName="${attr}" values="${a};${a};${b};${b}" keyTimes="${kt}" dur="${d}s" repeatCount="indefinite"/>`
const animT = (type: string, a: string, b: string, d = D): string =>
  `<animateTransform attributeName="transform" type="${type}" values="${a};${a};${b};${b}" keyTimes="${KT}" dur="${d}s" repeatCount="indefinite"/>`
const mv = (path: string, d = D, kt = KT, kp = '0;0;1;1'): string => `<animateMotion dur="${d}s" repeatCount="indefinite" path="${path}" keyPoints="${kp}" keyTimes="${kt}" calcMode="linear"/>`
/** scale / rotate a group about a point */
const about = (cx: number, cy: number, inner: string, a: string): string => `<g transform="translate(${cx} ${cy})"><g>${a}<g transform="translate(${-cx} ${-cy})">${inner}</g></g></g>`

const paper = (extra = ''): string => `<rect class="il-paper" x="48" y="10" width="144" height="100" rx="7" ${extra}/>`
const ink = (d: string, cls = ''): string => `<path class="il-ink il-draw ${cls}" pathLength="100" d="${d}"/>`
const finger = (press = ''): string => `<g class="il-fg"><g class="${press}"><circle class="il-ring" r="11"/><circle class="il-dot" r="7.5"/></g></g>`
const fingerAt = (x: number, y: number, press = 'il-press'): string => `<g transform="translate(${x} ${y})">${finger(press)}</g>`
const fingerMv = (path: string, press = ''): string => `<g>${mv(path)}${finger(press)}</g>`
const pen = (rot = 28): string =>
  `<g transform="rotate(${rot})"><path d="M0 0 L-3 -10 L3 -10Z" fill="#8d94ab"/><rect x="-3" y="-44" width="6" height="34" rx="2.5" fill="#f2f3f8"/><rect class="il-btn" x="-3" y="-30" width="6" height="8" rx="1.5"/><rect x="-3" y="-11" width="6" height="2.4" fill="#3b82f6"/></g>`
const penMv = (path: string, rot = 28): string => `<g>${mv(path)}${pen(rot)}</g>`
const arrow = (d: string): string => `<path class="il-arrow" d="${d}"/>`
const cap = (x: number, y: number, label: string, cls = '', delay = 0): string => {
  const w = Math.max(20, label.length * 7 + 14)
  return `<g transform="translate(${x - w / 2} ${y})"><g class="il-key ${cls}" style="animation-delay:${delay}s"><rect width="${w}" height="20" rx="5"/><text x="${w / 2}" y="14" text-anchor="middle">${label}</text></g></g>`
}
const cursor = (): string => `<path d="M0 0 L0 15 L4 11.5 L7 18 L9.5 17 L6.5 10.5 L11.5 10.5Z" fill="#fff" stroke="#000" stroke-width="1"/>`
const pill = (x: number, y: number, w: number, text: string): string => `<g><rect x="${x}" y="${y}" width="${w}" height="16" rx="8" class="il-pill"/><text x="${x + w / 2}" y="${y + 11.5}" text-anchor="middle" class="il-txt">${text}</text></g>`
const grad = (id: string): string => `<linearGradient id="${id}" x1="0" x2="1"><stop offset="0" stop-color="#e5484d"/><stop offset=".5" stop-color="#f5a524"/><stop offset="1" stop-color="#3b82f6"/></linearGradient>`
const ring = (cx: number, cy: number, r: number, kt = '0;.1;.6;1', v = '100;100;0;0'): string =>
  `<circle cx="${cx}" cy="${cy}" r="${r}" fill="none" stroke="var(--accent)" stroke-width="3" pathLength="100" stroke-dasharray="100" transform="rotate(-90 ${cx} ${cy})"><animate attributeName="stroke-dashoffset" values="${v}" keyTimes="${kt}" dur="${D}s" repeatCount="indefinite"/></circle>`
const fade = (v: string, kt = KT): string => `<animate attributeName="opacity" values="${v}" keyTimes="${kt}" dur="${D}s" repeatCount="indefinite"/>`

const wave = 'M66 80 C 84 32 104 98 126 52 S 168 34 176 72'

type Scene = (arg: string) => string

const rowSvg = (y: number, label: string, on = false): string =>
  `<g transform="translate(0 ${y})"><rect x="40" y="0" width="160" height="26" rx="6" class="${on ? 'il-row on' : 'il-row'}"/><rect x="46" y="4" width="18" height="18" rx="3" class="il-fillw"/><rect x="72" y="10" width="${26 + label.length * 5}" height="5" rx="2.5" fill="#b8bccb"/></g>`

const scenes: Record<string, Scene> = {
  devices: () => {
    const hi = (i: number): string => `<animate attributeName="opacity" values="${[0, 1, 2].map((k) => (k === i ? 1 : 0.3)).join(';')};${[0, 1, 2].map((k) => (k === i ? 1 : 0.3)).join(';')}" keyTimes="0;.33;.66;1" calcMode="discrete" dur="4.5s" repeatCount="indefinite"/>`
    const seq = (i: number): string => `<animate attributeName="opacity" values="${[0, 1, 2, 3].map((k) => (k === i ? 1 : 0.3)).join(';')}" keyTimes="0;.33;.66;1" calcMode="discrete" dur="4.5s" repeatCount="indefinite"/>`
    void hi
    return `<g transform="translate(64 78)" opacity=".3">${seq(0)}${pen(30)}</g>
      <g transform="translate(108 44)" opacity=".3">${seq(1)}<rect width="26" height="40" rx="12" class="il-fillw"/><path d="M13 0v16M0 16h26" class="il-thin"/></g>
      <g transform="translate(180 62)" opacity=".3">${seq(2)}${finger('')}</g>
      <path d="M40 104 H200" class="il-thin il-dash"/>`
  },
  penDraw: () => `${paper()}${ink(wave)}${penMv(wave)}`,
  done: () => `<circle cx="120" cy="60" r="38" fill="none" stroke="#34c759" stroke-width="5" class="il-draw" pathLength="100" transform="rotate(-90 120 60)" style="animation-duration:2.4s"/><path d="M102 62 L115 75 L140 47" fill="none" stroke="#34c759" stroke-width="6" stroke-linecap="round" stroke-linejoin="round" class="il-draw" pathLength="100" style="animation-name:il-draw3;animation-duration:2.4s"/>`,
  fingerDraw: () => `${paper()}${ink(wave)}${fingerMv(wave)}`,
  penPressure: () => {
    const id = 'c' + ++uid
    const poly = 'M62 62 C 90 58 120 56 180 50 L180 70 C 130 66 100 62 62 63Z'
    return `<defs><clipPath id="${id}"><rect x="40" y="0" height="120" width="0">${anim('width', 0, 150)}</rect></clipPath></defs>${paper()}
      <path d="${poly}" fill="#2a2f45" clip-path="url(#${id})"/>${penMv('M62 62 L178 60', 24)}
      <rect x="60" y="94" width="120" height="7" rx="3.5" class="il-track"/><rect x="60" y="94" width="8" height="7" rx="3.5" fill="var(--accent)">${anim('width', 8, 120)}</rect>
      <text x="60" y="90" class="il-lbl">0 &#8594; 100 %</text>`
  },
  penTilt: () => `${paper()}<path d="M62 74 C 90 70 120 66 178 58" class="il-soft il-draw" pathLength="100"/>
    <g>${mv('M62 74 C 90 70 120 66 178 58')}<g><animateTransform attributeName="transform" type="rotate" values="10;10;62;62" keyTimes="${KT}" dur="${D}s" repeatCount="indefinite"/>${pen(0)}</g></g>
    <path d="M196 96 A 28 28 0 0 0 206 60" class="il-thin"/>`,
  penEraser: () =>
    `${paper()}<path d="M66 66 H176" class="il-ink" style="stroke-width:7"/><path d="M66 66 H176" class="il-erase il-draw2" pathLength="100"/>
      <g>${mv('M66 66 L176 66', D, '0;.2;.3;.75;1', '0;0;0;1;1')}<g><animateTransform attributeName="transform" type="rotate" values="0;0;180;180;180" keyTimes="0;.12;.3;.75;1" dur="${D}s" repeatCount="indefinite"/>${pen(28)}</g></g>`,
  penButton: () => `${paper()}
    <g transform="translate(110 78)"><g class="il-hover">${pen(20)}</g></g>
    <circle cx="121" cy="88" r="4" fill="none" stroke="var(--accent)" stroke-width="1.5"><animate attributeName="r" values="4;4;22;22" keyTimes="${KT}" dur="${D}s" repeatCount="indefinite"/>${fade('0;1;0;0')}</circle>
    <circle cx="156" cy="40" r="11" fill="#e5484d" stroke="#fff" stroke-width="2" opacity="0">${fade('0;0;1;1')}</circle>${arrow('M96 40 L112 34')}`,
  penHover: () => `${paper()}<g><animateTransform attributeName="transform" type="translate" values="0 0;0 0;40 -10;40 -10" keyTimes="${KT}" dur="${D}s" repeatCount="indefinite"/>
      <ellipse cx="100" cy="84" rx="11" ry="3" fill="#0004"/><circle cx="100" cy="82" r="7" fill="none" stroke="#000" stroke-width="1"/><circle cx="100" cy="82" r="6" fill="none" stroke="#fff" stroke-width="1" opacity=".8"/>
      <path d="M100 82 V62" class="il-thin il-dash"/><g transform="translate(100 62)"><g class="il-hover">${pen(20)}</g></g></g>`,
  penHoverAdjust: () => `${paper()}<circle cx="120" cy="80" fill="none" stroke="#000" stroke-width="1.2"><animate attributeName="r" values="5;5;22;22" keyTimes="${KT}" dur="${D}s" repeatCount="indefinite"/></circle>
    <g transform="translate(120 62)"><g class="il-hover">${pen(20)}</g></g>${arrow('M150 92 H178 M172 87 L178 92 L172 97')}${cap(72, 90, 'Shift', 'il-glow')}`,
  penHold: () => {
    const wob = 'M64 84 C 80 74 96 88 112 66 S 140 60 176 34'
    const k = '0;.1;.62;.7;1'
    return `${paper()}<path d="${wob}" class="il-ink il-draw" pathLength="100">${fade('1;1;1;0;0', k)}</path>
      <path d="M64 84 L176 34" class="il-ink il-acc" opacity="0">${fade('0;0;0;1;1', k)}</path>
      <g>${mv(wob, D, '0;.1;.6;1', '0;0;1;1')}${pen(28)}${ring(0, 0, 13, '0;.1;.6;.9;1', '100;100;100;0;0')}</g>`
  },
  ring: () => `${ring(120, 64, 22, KT, '100;100;0;0')}<g transform="translate(120 64)"><g transform="translate(6 4)">${pen(26)}</g></g>
      <g opacity="0">${fade('0;0;0;1')}<circle cx="120" cy="64" r="30" fill="none" stroke="#e5484d" stroke-width="4"/><path d="M99 85 L141 43" stroke="#e5484d" stroke-width="4"/></g>`,
  curve: () => `<path d="M70 100 H180 M70 100 V16" class="il-thin"/><path d="M70 100 L180 16" class="il-thin il-dash"/><path d="M70 100 C 100 96 120 40 180 22" class="il-acc-line il-draw" pathLength="100"/>
    <circle r="5" fill="#fff" stroke="var(--accent)" stroke-width="2">${mv('M70 100 C 100 96 120 40 180 22')}</circle>`,
  diag: () => `<rect x="52" y="14" width="136" height="92" rx="8" class="il-paper"/><path d="M60 92 C 84 88 90 40 110 44 S 140 82 156 52 L180 30" class="il-acc-line il-draw" pathLength="100"/>
    ${pill(60, 20, 40, '0.62')}${pill(106, 20, 40, '34&deg;')}<g>${mv('M60 92 C 84 88 90 40 110 44 S 140 82 156 52 L180 30')}<circle r="4" fill="#fff" stroke="#000" stroke-width=".8"/></g>`,
  dragColor: () =>
    `${paper()}<circle cx="120" cy="64" r="30" fill="none" class="il-ink" style="stroke-width:3"/>
      <circle cx="120" cy="64" r="28" fill="#f5a524" opacity="0">${fade('0;0;0;1', '0;.1;.55;.65')}</circle>
      <circle cx="212" cy="14" r="10" fill="#f5a524" stroke="#fff" stroke-width="2.5" opacity=".3"/>
      <g>${mv('M212 14 C 200 30 160 60 122 64')}<circle r="10" fill="#f5a524" stroke="#fff" stroke-width="2.5"/></g>`,
  threshold: () => `${paper()}<circle cx="120" cy="62" r="34" class="il-ink" style="stroke-width:2.5;stroke-dasharray:5 4" fill="none"/>
    <circle cx="120" cy="62" fill="#f5a524" opacity=".85"><animate attributeName="r" values="14;14;33;33" keyTimes="${KT}" dur="${D}s" repeatCount="indefinite"/></circle>
    ${pill(100, 96, 40, '15 %')}${arrow('M84 62 H62 M68 57 L62 62 L68 67')}${arrow('M156 62 H178 M172 57 L178 62 L172 67')}<g>${mv('M100 62 L146 62')}${finger()}</g>`,
  slideCanvas: () => {
    const g = 'g' + ++uid
    return `<defs>${grad(g)}</defs><g class="il-hue"><rect x="48" y="10" width="144" height="100" rx="7" fill="url(#${g})"/></g>
    ${arrow('M70 94 H170 M162 89 L170 94 L162 99')}${pill(102, 16, 36, '+ 24')}<g>${mv('M80 62 L160 62')}${finger()}</g>`
  },
  pencilMode: () => {
    const g = 'g' + ++uid
    return `<defs>${grad(g)}</defs><rect x="48" y="10" width="144" height="100" rx="7" fill="#9aa0b4"/>
    <path d="${wave}" fill="none" stroke="url(#${g})" stroke-width="16" stroke-linecap="round" class="il-draw" pathLength="100"/>${penMv(wave)}`
  },
  quickShape: () => {
    const wob = 'M92 36 C 130 26 158 44 152 70 C 148 94 100 96 88 74 C 82 60 88 44 96 36'
    const k = '0;.1;.62;.7;1'
    return `${paper()}<path d="${wob}" class="il-ink il-draw" pathLength="100">${fade('1;1;1;0;0', k)}</path>
      <ellipse cx="120" cy="62" rx="34" ry="30" class="il-ink il-acc" opacity="0">${fade('0;0;0;1;1', k)}</ellipse>
      <g>${mv(wob, D, '0;.1;.6;1', '0;0;1;1')}${pen(28)}${ring(0, 0, 13, '0;.1;.6;.9;1', '100;100;100;0;0')}</g>
      <g opacity="0">${fade('0;0;0;0;1', '0;.1;.6;.7;.85')}${pill(104, 98, 32, '&#10003;')}</g>`
  },
  streamline: () => `${paper()}<path d="M62 80 L72 68 L80 84 L92 62 L100 76 L114 54 L124 70 L138 46 L148 62 L162 40 L176 52" class="il-thin il-draw" style="stroke:#8a8fa5" pathLength="100"/>
    <path d="M62 80 C 90 74 110 60 128 52 S 160 44 176 46" class="il-acc-line il-draw" pathLength="100"/>${penMv('M62 80 C 90 74 110 60 128 52 S 160 44 176 46')}`,
  symmetry: () => `${paper()}<path d="M120 12 V108" class="il-thin il-dash" style="stroke:var(--accent)"/>
    <path d="M100 96 C 76 80 96 54 82 34" class="il-ink il-draw" pathLength="100"/><path d="M140 96 C 164 80 144 54 158 34" class="il-ink il-draw" pathLength="100"/>${penMv('M100 96 C 76 80 96 54 82 34')}`,
  guides: () => `${paper()}${[1, 2, 3, 4].map((i) => `<path d="M${48 + 36 * i - 36} 10 V110" class="il-grid"/>`).join('')}${[1, 2, 3].map((i) => `<path d="M48 ${10 + 25 * i} H192" class="il-grid"/>`).join('')}
    <path d="M66 86 L 156 38" class="il-ink il-draw" pathLength="100"/>${penMv('M66 86 L 156 38')}`,
  select: () => `${paper()}<rect x="70" y="30" width="0" height="0" fill="var(--accent)" fill-opacity=".12" stroke="var(--accent)" stroke-width="1.6" stroke-dasharray="5 4">${anim('width', 0, 78)}${anim('height', 0, 52)}<animate attributeName="stroke-dashoffset" values="0;18" dur=".8s" repeatCount="indefinite"/></rect>
    <g>${mv('M70 30 L148 82')}${finger()}</g>`,
  transform: () =>
    `${paper()}${about(120, 62, `<rect x="90" y="42" width="60" height="40" rx="3" fill="#f5a524" stroke="var(--accent)" stroke-width="1.6"/>${[[90, 42], [150, 42], [90, 82], [150, 82]].map(([x, y]) => `<circle cx="${x}" cy="${y}" r="4" fill="#fff" stroke="var(--accent)" stroke-width="1.5"/>`).join('')}`, animT('scale', '1 1', '1.5 1.3'))}`,
  tap: (n) => {
    const k = Number(n) || 2
    const xs = k === 2 ? [-18, 18] : k === 3 ? [-30, 0, 30] : [-40, -14, 14, 40]
    return `${paper('opacity=".5"')}${xs.map((x, i) => fingerAt(120 + x, 62 + (i % 2 ? -6 : 4), 'il-tapx')).join('')}`
  },
  hold: (n) => {
    const k = Number(n) || 2
    const xs = k === 2 ? [-18, 18] : [-30, 0, 30]
    return `${paper('opacity=".5"')}${xs.map((x, i) => fingerAt(120 + x, 62 + (i % 2 ? -6 : 4), 'il-holdx')).join('')}${ring(120, 62, k === 2 ? 40 : 50, '0;.1;.75;1', '100;100;0;0')}`
  },
  scrub3: () => `${paper()}<g><animateTransform attributeName="transform" type="translate" values="-16 0;-16 0;16 0;-16 0;16 0;-16 0;-16 0" keyTimes="0;.08;.26;.44;.62;.8;1" dur="${D}s" repeatCount="indefinite"/>${[-28, 0, 28].map((x, i) => fingerAt(120 + x, 62 + (i === 1 ? -6 : 4), '')).join('')}</g>${arrow('M64 98 H176 M72 93 L64 98 L72 103 M168 93 L176 98 L168 103')}`,
  swipe3: () => `${paper()}<g><animateTransform attributeName="transform" type="translate" values="0 -22;0 -22;0 26;0 26" keyTimes="${KT}" dur="${D}s" repeatCount="indefinite"/>${[-28, 0, 28].map((x, i) => fingerAt(120 + x, 60 + (i === 1 ? -6 : 4), '')).join('')}</g>${arrow('M184 30 V92 M179 84 L184 92 L189 84')}`,
  pinch: (a) => {
    const inn = a === 'in'
    const [s0, s1] = inn ? [46, 16] : [14, 46]
    return `${about(120, 62, paper(), animT('scale', inn ? '1.35' : '0.85', inn ? '0.85' : '1.35'))}
      <g>${mv(`M${120 - s0} ${62 + s0 * 0.5} L${120 - s1} ${62 + s1 * 0.5}`)}${finger()}</g><g>${mv(`M${120 + s0} ${62 - s0 * 0.5} L${120 + s1} ${62 - s1 * 0.5}`)}${finger()}</g>`
  },
  twist: () =>
    `${about(120, 62, paper(), animT('rotate', '0', '40'))}${about(120, 62, `<g transform="translate(90 80)">${finger()}</g><g transform="translate(150 44)">${finger()}</g>`, animT('rotate', '0', '40'))}${arrow('M104 104 A 44 44 0 0 0 158 94 M150 92 L158 94 L156 102')}`,
  pan2: () => `<g>${animT('translate', '0 0', '34 16')}${paper()}</g><g>${animT('translate', '0 0', '34 16')}${fingerAt(84, 48, '')}${fingerAt(112, 60, '')}</g>`,
  quickPinch: () =>
    `${about(120, 62, paper(), animT('scale', '1.4', '1', D))}<g>${mv('M84 84 L108 70', D, '0;.1;.3;1', '0;0;1;1')}${finger()}</g><g>${mv('M156 40 L132 54', D, '0;.1;.3;1', '0;0;1;1')}${finger()}</g>
    <rect x="48" y="10" width="144" height="100" rx="7" fill="none" stroke="var(--accent)" stroke-width="2" stroke-dasharray="6 4" opacity="0">${fade('0;0;1;0', '0;.28;.4;1')}</rect>`,
  touchHold: () => `${paper('opacity=".6"')}<g transform="translate(110 78)">${finger('il-holdx')}${ring(0, 0, 17, '0;.1;.6;1', '100;100;0;0')}</g>
    <g opacity="0">${fade('0;0;0;1', '0;.1;.6;.7')}<circle cx="110" cy="38" r="15" fill="#f5a524" stroke="#fff" stroke-width="4"/></g>`,
  slider: (n) => `<rect x="104" y="8" width="32" height="104" rx="16" class="il-track"/><rect x="104" y="80" width="32" height="32" rx="16" fill="var(--accent)"><animate attributeName="y" values="80;80;20;20" keyTimes="${KT}" dur="${D}s" repeatCount="indefinite"/><animate attributeName="height" values="32;32;92;92" keyTimes="${KT}" dur="${D}s" repeatCount="indefinite"/></rect>
    ${n === 'opacity' ? '' : `<circle cx="164" cy="60" fill="#fff" opacity=".9"><animate attributeName="r" values="3;3;12;12" keyTimes="${KT}" dur="${D}s" repeatCount="indefinite"/></circle>`}<g>${mv('M120 96 L120 32')}${finger()}</g>${arrow('M74 92 V30 M69 38 L74 30 L79 38')}`,
  keys: (k) => {
    const parts = (k || 'Ctrl+Z').split('+')
    const w = (s: string): number => Math.max(20, s.length * 7 + 14)
    const total = parts.reduce((a, s) => a + w(s) + 8, -8)
    let x = 120 - total / 2
    return parts
      .map((p, i) => {
        const cx = x + w(p) / 2
        x += w(p) + 8
        return cap(cx, 50, p, 'il-glow', i * 0.12)
      })
      .join('')
  },
  mouse: (k) => `${paper()}${k ? cap(72, 92, k, 'il-glow') : ''}<g>${mv('M90 40 L158 78')}<g class="il-press">${cursor()}<circle r="9" fill="none" stroke="var(--accent)" stroke-width="1.5" opacity=".6"/></g></g>${arrow('M100 100 H176 M168 95 L176 100 L168 105')}`,
  wheel: () => `${about(120, 62, paper(), animT('scale', '0.85', '1.4'))}<g transform="translate(212 60)"><rect x="-9" y="-16" width="18" height="32" rx="9" class="il-fillw"/><rect x="-1.5" y="-10" width="3" height="8" rx="1.5" fill="#8d94ab"><animate attributeName="y" values="-10;-10;-4;-4" keyTimes="${KT}" dur="${D}s" repeatCount="indefinite"/></rect></g>`,
  layerRow: (mode) => {
    let extra = ''
    let top = rowSvg(9, 'Layer 3', mode !== 'swipeL' && mode !== 'drag')
    let mid = rowSvg(35, 'Layer 2', mode === 'swipeR')
    if (mode === 'swipeR') extra = `<rect x="40" y="35" width="0" height="26" rx="6" fill="var(--accent)" opacity=".35">${anim('width', 0, 160)}</rect><g>${mv('M60 48 L170 48')}${finger()}</g>`
    else if (mode === 'swipeL') {
      mid = `<g><animateTransform attributeName="transform" type="translate" values="0 0;0 0;-56 0;-56 0" keyTimes="${KT}" dur="${D}s" repeatCount="indefinite"/>${rowSvg(35, 'Layer 2', true)}</g>`
      extra = `<g transform="translate(0 35)" opacity="0">${fade('0;0;1;1')}<rect x="146" y="0" width="16" height="26" rx="4" fill="#3b82f6"/><rect x="164" y="0" width="16" height="26" rx="4" fill="#f5a524"/><rect x="182" y="0" width="16" height="26" rx="4" fill="#e5484d"/></g><g>${mv('M170 48 L110 48')}${finger()}</g>`
    } else if (mode === 'alpha') extra = `${fingerAt(96, 42, '')}${fingerAt(124, 54, '')}<g opacity="0">${fade('0;0;1;1')}${pill(160, 40, 26, '&#945;')}</g>${arrow('M84 76 H150 M142 71 L150 76 L142 81')}`
    else if (mode === 'tap2') extra = `${fingerAt(100, 48, 'il-tapx')}${fingerAt(126, 48, 'il-tapx')}<g opacity="0">${fade('0;0;0;1', '0;.1;.3;.4')}<rect x="60" y="72" width="120" height="22" rx="11" class="il-pill"/><rect x="72" y="82" width="96" height="3" rx="1.5" fill="#666"/><rect x="72" y="82" width="60" height="3" rx="1.5" fill="var(--accent)"/></g>`
    else if (mode === 'altDrag') extra = `${cap(66, 96, 'Alt', 'il-glow')}<g>${mv('M80 48 L160 48')}<g class="il-press">${cursor()}</g></g>${pill(150, 14, 42, '35 %')}`
    else if (mode === 'pinch') extra = `<g>${mv('M56 40 L100 56', D, KT, '0;0;1;1')}${finger()}</g><g>${mv('M56 96 L100 80')}${finger()}</g>`
    else if (mode === 'drag') {
      top = ''
      extra = `<g><animateTransform attributeName="transform" type="translate" values="0 0;0 0;0 52;0 52" keyTimes="${KT}" dur="${D}s" repeatCount="indefinite"/>${rowSvg(9, 'Layer 3', true)}<g transform="translate(120 22)">${finger('')}</g></g>`
    }
    return `${top}${mid}${rowSvg(61, 'Layer 1')}${extra}`
  },
  clip: () => {
    const id = 'cl' + ++uid
    return `<defs><clipPath id="${id}"><circle cx="112" cy="62" r="34"/></clipPath></defs><circle cx="112" cy="62" r="34" fill="#9aa0b4"/>
    <path d="M70 100 L160 20" class="il-draw" stroke="#e5484d" stroke-width="14" stroke-linecap="round" fill="none" pathLength="100" clip-path="url(#${id})"/>${penMv('M70 100 L160 20')}`
  },
  mask: () => {
    const id = 'mk' + ++uid
    return `<defs><linearGradient id="${id}" x1="0" x2="1"><stop offset="0" stop-color="#3b82f6"/><stop offset="1" stop-color="#3b82f6" stop-opacity="0"><animate attributeName="offset" values="1;1;.35;.35" keyTimes="${KT}" dur="${D}s" repeatCount="indefinite"/></stop></linearGradient></defs>
    <rect x="52" y="20" width="136" height="80" rx="8" fill="#f4f4f8" opacity=".25"/><rect x="52" y="20" width="136" height="80" rx="8" fill="url(#${id})"/><g>${mv('M170 60 L84 60')}${finger()}</g>`
  },
  blend: () => `<circle cx="104" cy="62" r="32" fill="#3b82f6"/><circle cx="136" cy="62" r="32" fill="#f5a524" style="mix-blend-mode:multiply"><animate attributeName="opacity" values=".55;.55;1;1" keyTimes="${KT}" dur="${D}s" repeatCount="indefinite"/></circle>`,
  opacity: () => `<circle cx="104" cy="62" r="32" fill="#3b82f6"/><circle cx="136" cy="62" r="32" fill="#f5a524"><animate attributeName="opacity" values="1;1;.3;.3" keyTimes="${KT}" dur="${D}s" repeatCount="indefinite"/></circle>`,
  qm: () => {
    const R = 40
    const slots = [0, 1, 2, 3, 4, 5].map((i) => {
      const a = ((-90 + i * 60) * Math.PI) / 180
      return `<circle cx="${(120 + Math.cos(a) * R).toFixed(1)}" cy="${(62 + Math.sin(a) * R).toFixed(1)}" r="14" class="${i === 1 ? 'il-slot hot' : 'il-slot'}"><animate attributeName="r" values="0;0;14;14" keyTimes="0;.1;.35;1" dur="${D}s" repeatCount="indefinite"/></circle>`
    })
    return `<circle cx="120" cy="62" r="${R}" fill="none" class="il-thin il-dash"/>${slots.join('')}<circle cx="120" cy="62" r="10" class="il-slot"/>${cap(48, 92, 'Q', 'il-glow')}${fingerAt(150, 36, 'il-tapx')}`
  },
  cheat: () =>
    `<rect x="60" y="10" width="120" height="100" rx="8" class="il-paper"/>${[0, 1, 2, 3, 4]
      .map((i) => `<g><rect x="70" y="${22 + i * 17}" width="${40 + (i % 3) * 14}" height="6" rx="3" fill="#b8bccb"/><rect x="146" y="${19 + i * 17}" width="26" height="12" rx="3" fill="#2a2f45" opacity="0">${fade(`0;0;1;1`, `0;${(0.12 + i * 0.08).toFixed(2)};${(0.2 + i * 0.08).toFixed(2)};1`)}</rect></g>`)
      .join('')}${cap(30, 50, 'F1', 'il-glow')}`,
  hideUI: () =>
    `<rect x="30" y="8" width="180" height="104" rx="8" class="il-paper"/><rect x="30" y="8" width="180" height="16" rx="8" fill="#2a2a2d">${fade('1;1;0;0')}</rect><rect x="36" y="34" width="10" height="56" rx="5" fill="#2a2a2d">${fade('1;1;0;0')}</rect>${cap(120, 84, 'Tab', 'il-glow')}`,
  timelapse: () =>
    `${paper()}${ink(wave)}<rect x="60" y="98" width="120" height="6" rx="3" class="il-track"/><rect x="60" y="98" width="0" height="6" rx="3" fill="var(--accent)">${anim('width', 0, 120)}</rect><path d="M108 40 L132 54 L108 68Z" fill="#fff" opacity=".7"/>`,
  export: () =>
    `<g transform="translate(46 22) scale(.62)">${paper()}</g>${arrow('M112 62 H140 M132 56 L140 62 L132 68')}<g transform="translate(150 36)" opacity="0">${fade('0;0;1;1')}<rect width="34" height="44" rx="4" class="il-fillw"/><text x="17" y="28" text-anchor="middle" class="il-txt2">PNG</text></g>`,
  gallery: () =>
    `${[0, 1, 2].map((i) => [0, 1].map((j) => `<rect x="${52 + i * 50}" y="${14 + j * 48}" width="42" height="40" rx="5" class="il-paper ${i === 1 && j === 0 ? 'il-tapx' : ''}" opacity="${i === 1 && j === 0 ? 1 : 0.65}"/>`).join('')).join('')}${fingerAt(126, 42, 'il-tapx')}`,
  menu: (rows) => {
    const items = (rows || 'a,b,c,d').split(',')
    const hot = Math.max(0, items.length - 2)
    return `<rect x="70" y="6" width="100" height="${items.length * 22 + 10}" rx="8" class="il-paper"/>${items
      .map((r, i) => `<g><rect x="76" y="${11 + i * 22}" width="88" height="19" rx="5" fill="var(--accent)" opacity="0">${i === hot ? fade('0;0;.9;.9') : ''}</rect><rect x="84" y="${18 + i * 22}" width="${Math.max(26, Math.min(64, r.length * 6))}" height="5" rx="2.5" fill="#b8bccb"/></g>`)
      .join('')}<g>${mv(`M190 108 L150 ${11 + hot * 22 + 12}`)}${cursor()}</g>`
  },
  click: () => `<g transform="translate(112 50)"><g class="il-press">${cursor()}</g></g><circle cx="112" cy="50" r="6" fill="none" stroke="var(--accent)" stroke-width="2"><animate attributeName="r" values="4;4;22;22" keyTimes="0;.15;.45;1" dur="${D}s" repeatCount="indefinite"/>${fade('0;1;0;0', '0;.15;.45;1')}</circle>`
}

const CSS = `
.tt-ill{width:100%;height:100%;display:block;overflow:hidden}
.il-paper{fill:#f4f4f8;stroke:#0003}
.il-ink{fill:none;stroke:#2a2f45;stroke-width:3.2;stroke-linecap:round;stroke-linejoin:round}
.il-ink.il-acc{stroke:var(--accent)}
.il-acc-line{fill:none;stroke:var(--accent);stroke-width:3;stroke-linecap:round}
.il-soft{fill:none;stroke:#5b6180;stroke-width:16;stroke-linecap:round;opacity:.45}
.il-erase{fill:none;stroke:#f4f4f8;stroke-width:9;stroke-linecap:round}
.il-draw{stroke-dasharray:100;stroke-dashoffset:100;animation:il-draw 3s linear infinite}
.il-draw2{stroke-dasharray:100;stroke-dashoffset:100;animation:il-draw2 3s linear infinite}
.il-thin{fill:none;stroke:#8d94ab;stroke-width:1.5;stroke-linecap:round}
.il-dash{stroke-dasharray:4 4}
.il-grid{stroke:#c9ccda;stroke-width:1;fill:none}
.il-arrow{fill:none;stroke:var(--accent);stroke-width:2.2;stroke-linecap:round;stroke-linejoin:round;opacity:.9}
.il-dot{fill:#fff;fill-opacity:.94}
.il-ring{fill:none;stroke:#fff;stroke-opacity:.5;stroke-width:1.5}
.il-fillw{fill:#e8e8ee;stroke:#0004}
.il-track{fill:#3a3a40}
.il-pill{fill:#000a}
.il-txt{fill:#fff;font:600 9px "Segoe UI",sans-serif}
.il-txt2{fill:#2a2f45;font:600 10px "Segoe UI",sans-serif}
.il-txt3{fill:#e8e8ea;font:600 10px "Segoe UI",sans-serif}
.il-lbl{fill:#9a9aa2;font:600 9px "Segoe UI",sans-serif}
.il-row{fill:#3a3a40}
.il-row.on{fill:var(--accent);fill-opacity:.45}
.il-slot{fill:#3a3a40;stroke:#5a5a62}
.il-slot.hot{fill:var(--accent);stroke:none}
.il-btn{fill:#c9cad1;animation:il-btn 3s linear infinite}
.il-key rect{fill:#3a3a40;stroke:#6a6a72;stroke-width:1}
.il-key text{fill:#fff;font:600 10px Consolas,monospace}
.il-glow{animation:il-key 3s ease-in-out infinite}
.il-hover{animation:il-hover 3s ease-in-out infinite}
.il-hue{animation:il-hue 3s ease-in-out infinite}
.il-fg,.il-press,.il-tapx,.il-holdx,.il-hover{transform-box:fill-box;transform-origin:center}
.il-press,.il-tapx{animation:il-tap 3s ease-in-out infinite}
.il-holdx{animation:il-hold 3s ease-in-out infinite}
@keyframes il-draw{0%,10%{stroke-dashoffset:100}60%,100%{stroke-dashoffset:0}}
@keyframes il-draw3{0%,25%{stroke-dashoffset:100}60%,100%{stroke-dashoffset:0}}
@keyframes il-draw2{0%,30%{stroke-dashoffset:100}75%,100%{stroke-dashoffset:0}}
@keyframes il-tap{0%,12%{transform:scale(1)}20%{transform:scale(.72)}30%,100%{transform:scale(1)}}
@keyframes il-hold{0%,10%{transform:scale(1)}18%,75%{transform:scale(.8)}85%,100%{transform:scale(1)}}
@keyframes il-key{0%,10%{transform:translateY(0)}18%,55%{transform:translateY(2px)}65%,100%{transform:translateY(0)}}
@keyframes il-btn{0%,10%{fill:#c9cad1}20%,50%{fill:#e5484d}60%,100%{fill:#c9cad1}}
@keyframes il-hover{0%,100%{transform:translateY(0)}50%{transform:translateY(-3px)}}
@keyframes il-hue{0%,10%{filter:hue-rotate(0)}60%,100%{filter:hue-rotate(110deg)}}
.reduced-motion .tt-ill *{animation:none!important}
.reduced-motion .il-draw,.reduced-motion .il-draw2{stroke-dashoffset:0}
`

let cssIn = false
/** Inject the illustration stylesheet once. */
export function ensureIllusCss(): void {
  if (cssIn) return
  cssIn = true
  const s = document.createElement('style')
  s.textContent = CSS
  document.head.append(s)
}

/** SVG markup for a named scene; `name:arg` passes an argument (`keys:Ctrl+Z`, `tap:3`, `menu:A,B,C`). */
export function illustration(spec: string): string {
  const i = spec.indexOf(':')
  const name = i < 0 ? spec : spec.slice(0, i)
  const arg = i < 0 ? '' : spec.slice(i + 1)
  const scene = scenes[name] ?? scenes.penDraw
  let inner = ''
  try {
    inner = scene(arg)
  } catch (e) {
    console.error('[tutorial] illustration', spec, e)
  }
  return `<svg class="tt-ill" viewBox="0 0 240 120" preserveAspectRatio="xMidYMid meet" aria-hidden="true">${inner}</svg>`
}

/** Put an illustration into `el` (freezes it when the user asked for reduced motion). */
export function mountIllustration(el: HTMLElement, spec: string): void {
  ensureIllusCss()
  el.innerHTML = illustration(spec)
  if (prefs.v.reducedMotion) (el.querySelector('svg') as SVGSVGElement | null)?.pauseAnimations()
}

/** Every scene name (self-test / reference sanity). */
export const SCENE_NAMES = Object.keys(scenes)
