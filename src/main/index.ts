import { app, BrowserWindow, dialog, ipcMain, Menu, screen } from 'electron'
import { join } from 'path'
import { readFile, writeFile } from 'fs/promises'
import { existsSync, readFileSync, writeFileSync } from 'fs'
import { registerAnimioIpc } from './animio'
import { registerGalleryIpc } from './gallery'
import { registerLayersIpc } from './layersIpc'
import { forcedLang, mt, registerI18nIpc } from './i18n'

// GPU / input flags. Must be set before app is ready.
app.commandLine.appendSwitch('ignore-gpu-blocklist')
app.commandLine.appendSwitch('enable-gpu-rasterization')
app.commandLine.appendSwitch('disable-pinch') // no browser pinch-zoom; we do our own gestures
// Pen/touch: no touch drag&drop ghost, no history swipe navigation; canvas uses touch-action:none + preventDefault
// on pointer events so Windows Ink press-and-hold (right-click ring) and flicks are not triggered by Chromium.
app.commandLine.appendSwitch('disable-touch-drag-drop')
app.commandLine.appendSwitch('disable-features', 'CalculateNativeWinOcclusion,TouchpadOverscrollHistoryNavigation')
app.commandLine.appendSwitch('enable-features', 'WebViewTouchEvents')

const SELFTEST = process.env.BW_SELFTEST === '1'
let win: BrowserWindow | null = null

// Preserve userData from old app name (brushwork -> wincreative) if it exists,
// unless an explicit --user-data-dir was given (selftests / QA isolate their profile that way)
const oldUserDataPath = join(app.getPath('appData'), 'brushwork')
if (!app.commandLine.hasSwitch('user-data-dir') && existsSync(oldUserDataPath)) {
  app.setPath('userData', oldUserDataPath)
}

// ---- file association (.bwk / images / psd): argv on first launch, second-instance for later ones
const OPENABLE = /.(bwk|psd|procreate|png|jpe?g|webp|tiff?|gif|bmp)$/i
const filesFromArgv = (argv: string[]): string[] => argv.slice(1).filter((a) => !a.startsWith('-') && OPENABLE.test(a) && existsSync(a))
const pendingFiles: string[] = filesFromArgv(process.argv)
const readOpen = async (paths: string[]): Promise<{ path: string; data: Uint8Array }[]> => {
  const out: { path: string; data: Uint8Array }[] = []
  for (const p of paths) {
    try {
      out.push({ path: p, data: new Uint8Array(await readFile(p)) })
    } catch {
      /* unreadable: skip */
    }
  }
  return out
}
ipcMain.handle('app:hasOpenFiles', () => pendingFiles.length > 0)
ipcMain.handle('app:takeOpenFiles', () => readOpen(pendingFiles.splice(0)))
// one running instance per profile (test runs use BW_*TEST env vars and skip the lock)
const TESTING = Object.keys(process.env).some((k) => /^BW_.*(TEST|MULTI)/.test(k))
if (!TESTING && !app.requestSingleInstanceLock()) app.quit()
else
  app.on('second-instance', (_e, argv) => {
    if (win) {
      if (win.isMinimized()) win.restore()
      win.focus()
    }
    void readOpen(filesFromArgv(argv)).then((fs) => fs.forEach((f) => win?.webContents.send('app:openFile', f)))
  })

// ---- window bounds / maximized state (restored only if still on a connected display)
type WinState = { x: number; y: number; width: number; height: number; maximized: boolean }
const winStateFile = (): string => join(app.getPath('userData'), 'window-state.json')
function loadWinState(): WinState | null {
  try {
    const st = JSON.parse(readFileSync(winStateFile(), 'utf8')) as WinState
    if (![st.x, st.y, st.width, st.height].every(Number.isFinite) || st.width < 800 || st.height < 500) return null
    const onScreen = screen.getAllDisplays().some((d) => {
      const b = d.workArea
      return st.x + 100 < b.x + b.width && st.x + st.width - 100 > b.x && st.y + 40 < b.y + b.height && st.y > b.y - 40
    })
    if (!onScreen) return null
    const wa = screen.getDisplayMatching(st).workArea // display resized / replaced: keep the window inside it
    const width = Math.min(st.width, wa.width)
    const height = Math.min(st.height, wa.height)
    return { ...st, width, height, x: Math.max(wa.x, Math.min(st.x, wa.x + wa.width - width)), y: Math.max(wa.y, Math.min(st.y, wa.y + wa.height - height)) }
  } catch {
    return null
  }
}
function saveWinState(w: BrowserWindow): void {
  try {
    const b = w.getNormalBounds()
    writeFileSync(winStateFile(), JSON.stringify({ ...b, maximized: w.isMaximized() }))
  } catch {
    /* non-fatal */
  }
}

/** The page's layout viewport must cover the window client area. On Windows (frameless + titleBarOverlay) it can stay stale and smaller
 * (fixed panels and the canvas stop short of the window edge); a 1px bounds nudge forces the native relayout. */
let syncing = false
async function syncContentBounds(w: BrowserWindow | null): Promise<void> {
  if (syncing || !w || w.isDestroyed() || w.isMinimized() || w.isFullScreen()) return
  if (w.webContents.getZoomFactor() !== 1) w.webContents.setZoomFactor(1) // page zoom is never used: it would shrink/stretch the whole UI against the window
  syncing = true
  try {
    const [cw, ch] = w.getContentSize()
    const [iw, ih] = (await w.webContents.executeJavaScript('[innerWidth, innerHeight]')) as [number, number]
    if (iw >= cw - 24 && ih >= ch - 24) return
    if (w.isMaximized()) {
      w.unmaximize()
      w.maximize()
    } else {
      const b = w.getBounds()
      w.setBounds({ ...b, width: b.width + 1 })
      w.setBounds(b)
    }
  } catch {
    /* page not ready */
  } finally {
    syncing = false
  }
}

function createWindow(): void {
  const saved = process.env.BW_NO_WINSTATE === '1' || process.env.BW_SELFTEST === '1' ? null : loadWinState()
  win = new BrowserWindow({
    width: saved?.width ?? 1440,
    height: saved?.height ?? 900,
    ...(saved ? { x: saved.x, y: saved.y } : {}),
    minWidth: 800,
    minHeight: 500,
    backgroundColor: '#1c1c1e',
    title: 'WinCreative',
    show: true,
    titleBarStyle: 'hidden',
    titleBarOverlay: { color: '#1c1c1e', symbolColor: '#e8e8ea', height: 44 },
    webPreferences: {
      preload: join(__dirname, '../preload/index.js'),
      additionalArguments: forcedLang() ? [`--bw-lang=${forcedLang()}`] : [], // BW_LANG / self-tests: language override (read by preload)
      contextIsolation: true,
      sandbox: true,
      backgroundThrottling: false
    }
  })
  Menu.setApplicationMenu(null)
  if (saved?.maximized) win.maximize()
  win.on('close', () => win && saveWinState(win))
  for (const ev of ['maximize', 'unmaximize', 'enter-full-screen', 'leave-full-screen', 'resized', 'restore', 'show'] as const)
    win.on(ev as 'maximize', () => {
      setTimeout(() => void syncContentBounds(win), 100)
      win?.webContents.send('win:state', ev)
    })
  win.on('will-resize', () => setTimeout(() => void syncContentBounds(win), 200))
  // Chromium page zoom (Ctrl+wheel / persisted per-origin zoom) must never apply: the app does its own canvas zoom
  win.webContents.setVisualZoomLevelLimits(1, 1)
  win.webContents.on('zoom-changed', () => win?.webContents.setZoomFactor(1))
  win.webContents.on('did-finish-load', () => {
    win?.webContents.setZoomFactor(1)
    for (const ms of [0, 300, 1500]) setTimeout(() => void syncContentBounds(win), ms)
  })
  win.webContents.on('console-message', (_e, level, message, line, source) => {
    if (SELFTEST || process.env.BW_INTEG_TEST === '1' || process.env.BW_PERF_SELFTEST === '1' || level >= 2) console.log(`[renderer:${level}] ${message} (${source}:${line})`)
  })
  win.webContents.on('render-process-gone', (_e, d) => console.log('[main] render-process-gone', d.reason))
  // Block accidental navigation / new windows (except the "Project canvas" presentation window, an inert about:blank page)
  win.webContents.setWindowOpenHandler(({ frameName }) =>
    frameName === 'bw-projector'
      ? { action: 'allow', overrideBrowserWindowOptions: { title: mt('window.projector'), backgroundColor: '#000000', autoHideMenuBar: true, webPreferences: { sandbox: true, contextIsolation: true } } }
      : { action: 'deny' }
  )
  win.webContents.on('will-navigate', (e) => e.preventDefault())

  if (process.env['ELECTRON_RENDERER_URL']) win.loadURL(process.env['ELECTRON_RENDERER_URL'])
  else win.loadFile(join(__dirname, '../renderer/index.html'))
}

ipcMain.handle('file:save', async (_e, opts: { defaultName: string; filters: Electron.FileFilter[]; data: Uint8Array }) => {
  const r = await dialog.showSaveDialog(win!, { title: mt('dialog.save'), defaultPath: opts.defaultName, filters: opts.filters })
  if (r.canceled || !r.filePath) return null
  await writeFile(r.filePath, opts.data)
  return r.filePath
})

ipcMain.handle('file:open', async (_e, opts: { filters: Electron.FileFilter[] }) => {
  const r = await dialog.showOpenDialog(win!, { title: mt('dialog.open'), properties: ['openFile'], filters: opts.filters })
  if (r.canceled || !r.filePaths[0]) return null
  const data = await readFile(r.filePaths[0])
  return { path: r.filePaths[0], data: new Uint8Array(data) }
})

// Self-test support: renderer asks main to screenshot and quit.
ipcMain.handle('selftest:done', async (_e, info: { ok: boolean }) => {
  const png = process.env.BW_SELFTEST_PNG
  if (png && win) {
    const img = await win.webContents.capturePage()
    await writeFile(png, img.toPNG())
  }
  console.log('[selftest] done ok=' + info.ok)
  setTimeout(() => app.exit(info.ok ? 0 : 1), 100)
})
ipcMain.handle('selftest:shot', async (_e, tag: string) => {
  const png = process.env.BW_SELFTEST_PNG
  if (png && win) await writeFile(png.replace(/.png$/, '-' + tag + '.png'), (await win.webContents.capturePage()).toPNG())
})
ipcMain.handle('app:isSelfTest', () => SELFTEST)
// Interface prefs: window chrome colours (light/dark theme) and true full screen
ipcMain.handle('ui:titlebar', (_e, o: { color: string; symbolColor: string }) => {
  try {
    win?.setTitleBarOverlay({ color: o.color, symbolColor: o.symbolColor, height: 44 })
    win?.setBackgroundColor(o.color)
  } catch {
    /* overlay not supported */
  }
})
ipcMain.handle('selftest:window', (_e, op: string) => {
  if (!SELFTEST || !win) return
  if (op === 'maximize') win.maximize()
  else if (op === 'unmaximize') win.unmaximize()
  else if (op.startsWith('zoom:')) win.webContents.setZoomFactor(Number(op.slice(5)))
  else if (op.startsWith('fullscreen:')) win.setFullScreen(op.endsWith('on'))
  else if (op.startsWith('size:')) win.setSize(...(op.slice(5).split('x').map(Number) as [number, number]))
  else if (op.startsWith('bounds:')) {
    const [x, y, width, height] = op.slice(7).split(',').map(Number)
    win.setBounds({ x, y, width, height })
  }
})
ipcMain.handle('selftest:content', () => (SELFTEST && win ? { w: win.getContentBounds().width, h: win.getContentBounds().height, zoom: win.webContents.getZoomFactor() } : null))
ipcMain.handle('ui:syncContent', () => syncContentBounds(win))
ipcMain.handle('ui:fullscreen', (_e, on: boolean) => win?.setFullScreen(!!on))

registerI18nIpc()
registerAnimioIpc(() => win)
registerGalleryIpc()
registerLayersIpc()
app.whenReady().then(createWindow)
app.on('window-all-closed', () => app.quit())
