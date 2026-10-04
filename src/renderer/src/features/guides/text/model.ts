/** Pure text-layer data model + line layout (measurement injected so it is testable without a DOM). */

export type TextAlign = 'left' | 'center' | 'right' | 'justify'
export type TextCase = 'none' | 'upper' | 'lower' | 'small'

export interface TextStyle {
  family: string
  /** document px */
  size: number
  bold: boolean
  italic: boolean
  color: string
  /** letter spacing, px */
  tracking: number
  kerning: boolean
  /** line height multiplier */
  leading: number
  /** vertical shift, px (positive = up) */
  baseline: number
  align: TextAlign
  underline: boolean
  strike: boolean
  /** outline width px (0 = none) */
  outlineWidth: number
  outlineColor: string
  caps: TextCase
  vertical: boolean
  ligatures: boolean
}

export interface TextSpan {
  start: number
  end: number
  color: string
}

export interface TextData {
  text: string
  style: TextStyle
  /** per-selection colour overrides */
  spans: TextSpan[]
  /** box top-left (before rotation), document px */
  x: number
  y: number
  /** box width (horizontal text wraps to it) */
  w: number
  /** radians, about the box centre */
  rot: number
}

export const DEFAULT_TEXT_STYLE: TextStyle = {
  family: 'Segoe UI',
  size: 96,
  bold: false,
  italic: false,
  color: '#000000',
  tracking: 0,
  kerning: true,
  leading: 1.2,
  baseline: 0,
  align: 'left',
  underline: false,
  strike: false,
  outlineWidth: 0,
  outlineColor: '#ffffff',
  caps: 'none',
  vertical: false,
  ligatures: true
}

export function cloneText(t: TextData): TextData {
  return { ...t, style: { ...t.style }, spans: t.spans.map((s) => ({ ...s })) }
}

export function normalizeText(raw: any): TextData | null {
  if (!raw || typeof raw !== 'object' || typeof raw.text !== 'string') return null
  const st = { ...DEFAULT_TEXT_STYLE, ...(raw.style ?? {}) } as TextStyle
  return {
    text: raw.text,
    style: st,
    spans: Array.isArray(raw.spans) ? raw.spans.filter((s: any) => s && isFinite(s.start) && isFinite(s.end) && typeof s.color === 'string') : [],
    x: Number(raw.x) || 0,
    y: Number(raw.y) || 0,
    w: Math.max(20, Number(raw.w) || 400),
    rot: Number(raw.rot) || 0
  }
}

export function applyCase(text: string, caps: TextCase): string {
  if (caps === 'upper') return text.toUpperCase().length === text.length ? text.toUpperCase() : text
  if (caps === 'lower') return text.toLowerCase().length === text.length ? text.toLowerCase() : text
  return text
}

export interface Line {
  text: string
  /** index of the first char in the source text */
  start: number
  width: number
  /** last line of a paragraph (not justified) */
  last: boolean
}

/** Greedy word wrap. `measure` returns the advance width of a string. Hard newlines always break. */
export function layoutLines(text: string, measure: (s: string) => number, width: number): Line[] {
  const out: Line[] = []
  let offset = 0
  for (const para of text.split('\n')) {
    if (para === '') {
      out.push({ text: '', start: offset, width: 0, last: true })
      offset += 1
      continue
    }
    // tokens: words with their trailing spaces
    const tokens = para.match(/\S+\s*|\s+/g) ?? [para]
    let cur = ''
    let curStart = offset
    let pos = offset
    for (const tok of tokens) {
      const trial = cur + tok
      if (cur !== '' && measure(trial.replace(/\s+$/, '')) > width) {
        out.push({ text: cur.replace(/\s+$/, ''), start: curStart, width: measure(cur.replace(/\s+$/, '')), last: false })
        cur = tok
        curStart = pos
      } else cur = trial
      // very long single word: break by characters
      while (measure(cur.replace(/\s+$/, '')) > width && cur.length > 1) {
        let n = cur.length - 1
        while (n > 1 && measure(cur.slice(0, n)) > width) n--
        out.push({ text: cur.slice(0, n), start: curStart, width: measure(cur.slice(0, n)), last: false })
        curStart += n
        cur = cur.slice(n)
      }
      pos += tok.length
    }
    const t = cur.replace(/\s+$/, '')
    out.push({ text: t, start: curStart, width: measure(t), last: true })
    offset += para.length + 1
  }
  return out
}

/** Vertical writing: one column per paragraph line (no wrapping), characters stacked top to bottom. */
export function layoutColumns(text: string): { chars: string[]; start: number }[] {
  const cols: { chars: string[]; start: number }[] = []
  let off = 0
  for (const para of text.split('\n')) {
    cols.push({ chars: Array.from(para), start: off })
    off += para.length + 1
  }
  return cols
}

const RTL = /[֐-ࣿיִ-﷿ﹰ-﻿]/
export const isRtl = (s: string): boolean => RTL.test(s)

/** Colour at a source index given the spans (last matching span wins). */
export function colorAt(t: TextData, i: number): string {
  for (let k = t.spans.length - 1; k >= 0; k--) if (i >= t.spans[k].start && i < t.spans[k].end) return t.spans[k].color
  return t.style.color
}

/** Apply a colour to [start,end): splits/overrides existing spans. */
export function paintSpan(spans: TextSpan[], start: number, end: number, color: string): TextSpan[] {
  if (end <= start) return spans
  const out: TextSpan[] = []
  for (const s of spans) {
    if (s.end <= start || s.start >= end) out.push(s)
    else {
      if (s.start < start) out.push({ start: s.start, end: start, color: s.color })
      if (s.end > end) out.push({ start: end, end: s.end, color: s.color })
    }
  }
  out.push({ start, end, color })
  return out.sort((a, b) => a.start - b.start)
}

/** Keep spans aligned with an edit that replaced oldText by newText (simple common-prefix/suffix diff). */
export function remapSpans(spans: TextSpan[], oldText: string, newText: string): TextSpan[] {
  let p = 0
  while (p < oldText.length && p < newText.length && oldText[p] === newText[p]) p++
  let s = 0
  while (s < oldText.length - p && s < newText.length - p && oldText[oldText.length - 1 - s] === newText[newText.length - 1 - s]) s++
  const delta = newText.length - oldText.length
  const oldEnd = oldText.length - s
  const out: TextSpan[] = []
  for (const sp of spans) {
    const l1 = Math.min(sp.end, p)
    if (l1 > sp.start) out.push({ start: sp.start, end: l1, color: sp.color })
    if (sp.end > oldEnd) {
      const a = Math.max(sp.start, oldEnd) + delta
      const b = sp.end + delta
      if (b > a) out.push({ start: a, end: b, color: sp.color })
    }
  }
  return out
}
