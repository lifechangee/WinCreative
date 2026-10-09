import { contextBridge, ipcRenderer } from 'electron'

/** Preload bridge for the smartselect feature (model files, optional model download). */
type Progress = { id: string; state: 'start' | 'progress' | 'done' | 'error' | 'cancelled'; done: number; total: number; file?: string; error?: string }

contextBridge.exposeInMainWorld('smartselectApi', {
  status: (): Promise<{ id: string; bundled: boolean; installed: boolean; bytes: number; diskBytes: number }[]> => ipcRenderer.invoke('ss:status'),
  read: (id: string, name: string): Promise<Uint8Array> => ipcRenderer.invoke('ss:read', id, name),
  download: (id: string): Promise<{ ok: boolean; error?: string }> => ipcRenderer.invoke('ss:download', id),
  cancel: (id: string): Promise<void> => ipcRenderer.invoke('ss:cancel', id),
  remove: (id: string): Promise<boolean> => ipcRenderer.invoke('ss:delete', id),
  onProgress: (cb: (p: Progress) => void): (() => void) => {
    const h = (_e: unknown, p: Progress): void => cb(p)
    ipcRenderer.on('ss:progress', h)
    return () => ipcRenderer.off('ss:progress', h)
  },
  testMode: (): Promise<boolean> => ipcRenderer.invoke('ss:testMode'),
  testLog: (s: string): Promise<void> => ipcRenderer.invoke('ss:testLog', s),
  testDone: (ok: boolean): Promise<void> => ipcRenderer.invoke('ss:testDone', ok)
})
