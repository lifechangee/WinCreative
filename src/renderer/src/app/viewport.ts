import type { App } from './app'

/**
 * Keeps the GL canvas (and, through the single 'resize' app event, every overlay canvas) in sync with the stage.
 * Sources: ResizeObserver (device-pixel box when available), window / visualViewport resize, DPR changes,
 * main-process window-state events, and a slow watchdog for compositors that drop observer deliveries
 * (frameless window maximize / snap / fullscreen on Windows). All of them coalesce into one rAF pass.
 * The view stores the document point at the viewport centre, so the picture stays centred while resizing.
 */
export function installViewport(app: App): void {
  const stage = app.canvas.parentElement!
  let raf = 0
  let dpBox: { w: number; h: number } | undefined
  const run = (): void => {
    raf = 0
    app.resize(dpBox)
    dpBox = undefined
  }
  const schedule = (): void => {
    if (!raf) raf = requestAnimationFrame(run)
    // rAF may be starved while the window is being moved between states: also settle on a timer
    setTimeout(() => app.resize(), 120)
  }
  const ro = new ResizeObserver((entries) => {
    const b = entries[entries.length - 1]?.devicePixelContentBoxSize?.[0]
    dpBox = b ? { w: b.inlineSize, h: b.blockSize } : undefined
    // only trust the snapped box when it agrees with the layout size (guards odd zoom / partial updates)
    if (dpBox && Math.abs(dpBox.w - stage.clientWidth * (window.devicePixelRatio || 1)) > 2) dpBox = undefined
    schedule()
  })
  try {
    ro.observe(stage, { box: 'device-pixel-content-box' })
  } catch {
    ro.observe(stage)
  }
  window.addEventListener('resize', schedule)
  window.visualViewport?.addEventListener('resize', schedule)
  document.addEventListener('fullscreenchange', schedule)
  window.brushwork?.onWindowState?.(schedule)
  let mq: MediaQueryList | null = null
  const watchDpr = (): void => {
    mq?.removeEventListener('change', onDpr)
    mq = window.matchMedia(`(resolution: ${window.devicePixelRatio || 1}dppx)`)
    mq.addEventListener('change', onDpr, { once: true })
  }
  const onDpr = (): void => {
    schedule()
    watchDpr()
  }
  watchDpr()
  let lastSync = 0
  setInterval(() => {
    // web contents smaller than its window (stale native view size): ask main to re-fit it
    if (window.outerWidth - window.innerWidth > 32 || window.outerHeight - window.innerHeight > 32) {
      if (Date.now() - lastSync > 1000) {
        lastSync = Date.now()
        void window.brushwork?.syncContent?.()
      }
    }
    app.resize()
  }, 500)
}
