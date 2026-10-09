import { contextBridge, ipcRenderer, webFrame } from 'electron'
import './animio'
import './gallery'
import './smartselect'
import './scratch'

webFrame.setVisualZoomLevelLimits(1, 1)

const api = {
  saveFile: (opts: { defaultName: string; filters: { name: string; extensions: string[] }[]; data: Uint8Array }): Promise<string | null> =>
    ipcRenderer.invoke('file:save', opts),
  openFile: (opts: { filters: { name: string; extensions: string[] }[] }): Promise<{ path: string; data: Uint8Array } | null> =>
    ipcRenderer.invoke('file:open', opts),
  hasOpenFiles: (): Promise<boolean> => ipcRenderer.invoke('app:hasOpenFiles'),
  takeOpenFiles: (): Promise<{ path: string; data: Uint8Array }[]> => ipcRenderer.invoke('app:takeOpenFiles'),
  onOpenFile: (cb: (f: { path: string; data: Uint8Array }) => void): (() => void) => {
    const h = (_e: unknown, f: { path: string; data: Uint8Array }): void => cb(f)
    ipcRenderer.on('app:openFile', h)
    return () => ipcRenderer.off('app:openFile', h)
  },
  /** main-process window state changes (maximize / restore / fullscreen / resized / snap): re-measure the canvas */
  onWindowState: (cb: () => void): void => {
    ipcRenderer.on('win:state', () => cb())
  },
  /** ask main to re-fit the web contents to the window client area */
  syncContent: (): Promise<void> => ipcRenderer.invoke('ui:syncContent'),
  isSelfTest: (): Promise<boolean> => ipcRenderer.invoke('app:isSelfTest'),
  setTitleBar: (o: { color: string; symbolColor: string }): Promise<void> => ipcRenderer.invoke('ui:titlebar', o),
  setFullScreen: (on: boolean): Promise<void> => ipcRenderer.invoke('ui:fullscreen', on),
  /** language forced by the main process (`BW_LANG` env / self-tests, `--bw-lang=xx`); null = follow the preference */
  bootLang: (process.argv.find((a) => a.startsWith('--bw-lang=')) ?? '').slice('--bw-lang='.length) || null,
  /** tell main the UI language so native dialogs / window titles match (i18n) */
  setLanguage: (lang: string): Promise<void> => ipcRenderer.invoke('i18n:set', lang),
  /** self-test only: drive the native window (maximize / unmaximize / size WxH / fullscreen:on|off / bounds x,y,w,h) */
  selfTestContent: (): Promise<{ w: number; h: number; zoom: number } | null> => ipcRenderer.invoke('selftest:content'),
  selfTestWindow: (op: string): Promise<void> => ipcRenderer.invoke('selftest:window', op),
  selfTestShot:(tag: string): Promise<void> => ipcRenderer.invoke('selftest:shot', tag),
  selfTestDone: (info: { ok: boolean }): Promise<void> => ipcRenderer.invoke('selftest:done', info),
  /** append a line to the local diagnostics log (<userData>/logs/diag.log) */
  diag: (line: string): void => ipcRenderer.send('diag:log', line),
  /** translated notice when this page load follows a crash / GPU reset (null otherwise; returned once) */
  takeRecoveryNotice: (): Promise<string | null> => ipcRenderer.invoke('app:takeRecoveryNotice'),
  /** the WebGL context is gone for good: ask main to reload the window (the last artwork reopens from the autosave) */
  gpuLost: (): void => ipcRenderer.send('app:gpuLost'),
  /** self-test only: kill the renderer process */
  selfTestCrash: (): Promise<void> => ipcRenderer.invoke('selftest:crashRenderer')
}
contextBridge.exposeInMainWorld('brushwork', api)
// layers feature: OS clipboard images
contextBridge.exposeInMainWorld('brushworkClip', {
  writeImage: (png: Uint8Array): Promise<boolean> => ipcRenderer.invoke('layers:clipboardWriteImage', png),
  readImage: (): Promise<Uint8Array | null> => ipcRenderer.invoke('layers:clipboardReadImage'),
  testMode: (): Promise<boolean> => ipcRenderer.invoke('layers:testMode'),
  testLog: (s: string): Promise<void> => ipcRenderer.invoke('layers:testLog', s),
  testDone: (ok: boolean): Promise<void> => ipcRenderer.invoke('layers:testDone', ok)
})
export type BrushworkApi = typeof api
