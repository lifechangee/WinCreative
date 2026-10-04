import { gammaCurve } from '../core/pressure'
import { brushName, listBrushPresets } from '../brush/presets'
import { I18nText, t, tk } from '../i18n'
import type { BrushCategory, BrushPreset } from '../core/brush'
import type { ToolId } from '../app/state'
import { h } from './dom'
import type { UIContext } from './registry'

const CATEGORY_OF: Record<ToolId, BrushCategory> = { brush: 'paint', smudge: 'smudge', eraser: 'erase' }

function preview(p: BrushPreset): HTMLCanvasElement {
  const c = h('canvas', { width: 96, height: 28, class: 'bprev' })
  const g = c.getContext('2d')!
  g.fillStyle = '#e8e8ea'
  const r = Math.min(11, 3 + p.defaultSize / 12)
  for (let x = 8; x <= 88; x += 2) {
    const y = 14 + Math.sin(x / 11) * 5
    const grad = g.createRadialGradient(x, y, 0, x, y, r)
    grad.addColorStop(0, `rgba(232,232,234,${Math.min(1, 0.25 + p.flow)})`)
    grad.addColorStop(Math.max(0.01, p.hardness), `rgba(232,232,234,${Math.min(1, 0.2 + p.flow) * 0.9})`)
    grad.addColorStop(1, 'rgba(232,232,234,0)')
    g.fillStyle = grad
    g.beginPath()
    g.arc(x, y, r, 0, 7)
    g.fill()
  }
  return c
}

/**
 * Brush library popover (stub for the brush-library agent: replace/extend this panel).
 * Also hosts stabilisation / pressure / input settings.
 */
export function renderBrushPanel(toolId: ToolId) {
  return (body: HTMLElement, ctx: UIContext): (() => void) => {
    const state = ctx.app.state
    const list = h('div', { class: 'brush-list' })
    const fill = (): void => {
      list.replaceChildren()
      for (const p of listBrushPresets(CATEGORY_OF[toolId])) {
        const row = h(
          'div',
          {
            class: 'brush-row' + (state.toolSettings[toolId].presetId === p.id ? ' sel' : ''),
            onclick: () => {
              state.setPreset(toolId, p.id)
              state.setTool(toolId)
              fill()
            }
          },
          h('span', { class: 'bname', text: brushName(p) }),
          preview(p)
        )
        list.append(row)
      }
    }
    fill()

    const slider = (label: I18nText, min: number, max: number, val: number, on: (v: number) => void, fmt: (v: number) => string): HTMLElement => {
      const v = h('span', { class: 'val', text: fmt(val) })
      const i = h('input', { type: 'range', min, max, step: 1, value: val })
      i.addEventListener('input', () => {
        on(Number(i.value))
        v.textContent = fmt(Number(i.value))
      })
      return h('div', { class: 'row' }, h('span', { class: 'lbl', text: label }), i, v)
    }
    const sm = slider('StreamLine', 0, 100, Math.round((state.smoothingOverride ?? state.preset.streamline) * 100), (v) => (state.smoothingOverride = v / 100), (v) => v + '%')
    const pr = slider(tk('brushes.studio.pressure'), 40, 250, 100, (v) => (state.pressureCurve = gammaCurve(v / 100)), (v) => (v < 100 ? t('brushes.panel.soft') : v > 100 ? t('brushes.panel.firm') : t('brushes.panel.linear')))
    const mouse = h('select', null, h('option', { value: 'constant', text: tk('brushes.panel.mouseFull') }), h('option', { value: 'velocity', text: tk('brushes.panel.mouseSpeed') }))
    mouse.value = state.mousePressure
    mouse.addEventListener('change', () => (state.mousePressure = mouse.value as 'constant' | 'velocity'))
    const touch = h('input', { type: 'checkbox', checked: state.touchDraws })
    touch.addEventListener('change', () => (state.touchDraws = touch.checked))
    body.append(list, h('div', { class: 'sep' }), sm, pr, h('div', { class: 'row' }, mouse), h('label', { class: 'chk' }, touch, tk('brushes.panel.fingerPaints')))
    return () => {}
  }
}
