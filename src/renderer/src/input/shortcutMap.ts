/** Pure shortcut logic: key event -> combo string, binding table with user overrides and conflict handling. */

export interface KeyLike {
  key: string
  code?: string
  ctrlKey?: boolean
  metaKey?: boolean
  shiftKey?: boolean
  altKey?: boolean
}

const CODE_NAMES: Record<string, string> = {
  BracketLeft: '[',
  BracketRight: ']',
  Equal: '=',
  Minus: '-',
  Slash: '/',
  Backslash: '\\',
  Comma: ',',
  Period: '.',
  Semicolon: ';',
  Quote: "'",
  Backquote: '`',
  Space: 'Space',
  Escape: 'Esc',
  Enter: 'Enter',
  NumpadEnter: 'Enter',
  Backspace: 'Backspace',
  Delete: 'Delete',
  Tab: 'Tab',
  ArrowUp: 'Up',
  ArrowDown: 'Down',
  ArrowLeft: 'Left',
  ArrowRight: 'Right',
  Home: 'Home',
  End: 'End',
  PageUp: 'PageUp',
  PageDown: 'PageDown',
  NumpadAdd: '=',
  NumpadSubtract: '-'
}

const MODIFIER_KEYS: Record<string, string> = { Control: 'Ctrl', Shift: 'Shift', Alt: 'Alt', Meta: 'Ctrl', AltGraph: 'Alt' }

/** Name of the non-modifier part of a key event ('' for pure modifier presses). */
export function keyName(e: KeyLike): string {
  if (e.key in MODIFIER_KEYS) return ''
  const c = e.code
  if (c) {
    if (/^Key[A-Z]$/.test(c)) return c.slice(3)
    if (/^Digit[0-9]$/.test(c)) return c.slice(5)
    if (/^Numpad[0-9]$/.test(c)) return c.slice(6)
    if (/^F([1-9]|1[0-9]|2[0-4])$/.test(c)) return c
    if (CODE_NAMES[c]) return CODE_NAMES[c]
  }
  if (e.key === ' ') return 'Space'
  if (e.key === 'Escape') return 'Esc'
  if (e.key.length === 1) return e.key.toUpperCase()
  return e.key
}

/** Canonical combo string: modifiers in order Ctrl, Alt, Shift then key ("Ctrl+Shift+Z"). Pure modifier = "Alt". */
export function comboFromEvent(e: KeyLike): string {
  const ctrl = !!(e.ctrlKey || e.metaKey)
  const alt = !!e.altKey
  const shift = !!e.shiftKey
  const name = keyName(e)
  const parts: string[] = []
  if (name === '') {
    const m = MODIFIER_KEYS[e.key]
    return m ?? e.key
  }
  if (ctrl) parts.push('Ctrl')
  if (alt) parts.push('Alt')
  if (shift) parts.push('Shift')
  parts.push(name)
  return parts.join('+')
}

/** Normalise a hand-written combo ("shift+ctrl+z") to canonical form. */
export function normalizeCombo(s: string): string {
  const bits = s.split('+').map((x) => x.trim()).filter(Boolean)
  if (s.endsWith('++')) bits.push('+')
  let ctrl = false
  let alt = false
  let shift = false
  let key = ''
  for (const b of bits) {
    const l = b.toLowerCase()
    if (l === 'ctrl' || l === 'cmd' || l === 'control' || l === 'meta') ctrl = true
    else if (l === 'alt') alt = true
    else if (l === 'shift') shift = true
    else key = b.length === 1 ? b.toUpperCase() : b[0].toUpperCase() + b.slice(1)
  }
  if (!key) return [ctrl && 'Ctrl', alt && 'Alt', shift && 'Shift'].filter(Boolean).join('+')
  return [ctrl && 'Ctrl', alt && 'Alt', shift && 'Shift', key].filter(Boolean).join('+')
}

/** True for combos made only of a single modifier (used for hold-modifier bindings such as Alt). */
export const isModifierOnly = (combo: string): boolean => combo === 'Ctrl' || combo === 'Alt' || combo === 'Shift'

export interface BindableAction {
  id: string
  defaultKeys?: string[]
}

/** Binding table. Overrides replace an action's default keys entirely; assigning a used combo steals it. */
export class ShortcutMap {
  constructor(
    private actions: () => BindableAction[],
    public overrides: Record<string, string[]> = {}
  ) {}

  keysFor(id: string): string[] {
    if (id in this.overrides) return this.overrides[id]
    return (this.actions().find((a) => a.id === id)?.defaultKeys ?? []).map(normalizeCombo)
  }

  /** combo -> action id (first match wins by registration order). */
  actionFor(combo: string): string | null {
    for (const a of this.actions()) if (this.keysFor(a.id).includes(combo)) return a.id
    return null
  }

  /** Which other action currently owns this combo? */
  conflict(combo: string, exceptId?: string): string | null {
    for (const a of this.actions()) if (a.id !== exceptId && this.keysFor(a.id).includes(combo)) return a.id
    return null
  }

  /** Add a combo to an action, removing it from any other action. Returns the ids that lost it. */
  bind(id: string, combo: string, replace = true): string[] {
    combo = normalizeCombo(combo)
    const lost: string[] = []
    for (const a of this.actions()) {
      if (a.id === id) continue
      const k = this.keysFor(a.id)
      if (k.includes(combo)) {
        this.overrides[a.id] = k.filter((c) => c !== combo)
        lost.push(a.id)
      }
    }
    const mine = this.keysFor(id)
    this.overrides[id] = replace ? [combo] : mine.includes(combo) ? mine : [...mine, combo]
    return lost
  }

  unbind(id: string, combo?: string): void {
    this.overrides[id] = combo ? this.keysFor(id).filter((c) => c !== combo) : []
  }

  reset(id?: string): void {
    if (id) delete this.overrides[id]
    else this.overrides = {}
  }
}
