import type { App } from '../../app/app'
import { t } from '../../i18n'

/**
 * "Project canvas": show the flattened artwork (no interface) in a second window, e.g. on another monitor or projector.
 * Updates shortly after every committed change, never while a stroke is being drawn.
 */
let win: Window | null = null
let off: (() => void) | null = null
let offDoc: (() => void) | null = null
let timer = 0

export const isProjecting = (): boolean => !!win && !win.closed

function paint(app: App): void {
  if (!win || win.closed) return stop()
  const doc = app.doc
  const px = app.compositor.readFlattened(true)
  const cv = win.document.getElementById('c') as HTMLCanvasElement | null
  if (!cv) return
  if (cv.width !== doc.width || cv.height !== doc.height) {
    cv.width = doc.width
    cv.height = doc.height
  }
  cv.getContext('2d')!.putImageData(new ImageData(px as unknown as Uint8ClampedArray<ArrayBuffer>, doc.width, doc.height), 0, 0)
}

function stop(): void {
  clearTimeout(timer)
  off?.()
  offDoc?.()
  off = offDoc = null
  if (win && !win.closed) win.close()
  win = null
}

export function toggleProjector(app: App): boolean {
  if (isProjecting()) {
    stop()
    app.notify(t('interface.projector.closed'))
    return false
  }
  const w = window.open('', 'bw-projector', 'popup,width=1024,height=768')
  if (!w) {
    app.notify(t('interface.projector.failed'))
    return false
  }
  win = w
  w.document.title = t('interface.projector.windowTitle')
  w.document.body.style.cssText = 'margin:0;background:#000;height:100vh;display:grid;place-items:center;overflow:hidden'
  const cv = w.document.createElement('canvas')
  cv.id = 'c'
  cv.style.cssText = 'max-width:100vw;max-height:100vh;object-fit:contain;image-rendering:auto'
  w.document.body.replaceChildren(cv)
  w.addEventListener('dblclick', () => void w.document.documentElement.requestFullscreen?.())
  w.addEventListener('beforeunload', () => stop())
  const schedule = (): void => {
    clearTimeout(timer)
    timer = window.setTimeout(() => paint(app), 250)
  }
  const bind = (): void => {
    off?.()
    const o1 = app.doc.events.on('commit', schedule)
    off = () => o1()
    schedule()
  }
  bind()
  offDoc = app.events.on('doc', bind)
  paint(app)
  app.notify(t('interface.projector.started'))
  return true
}
