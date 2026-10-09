import { contextBridge, ipcRenderer } from 'electron'

/** Scratch-file bridge of the tile memory system (main/scratch.ts). */
const api = {
  put: (doc: string, name: string, data: Uint8Array): Promise<boolean> => ipcRenderer.invoke('scratch:put', doc, name, data),
  get: (doc: string, name: string): Promise<Uint8Array | null> => ipcRenderer.invoke('scratch:get', doc, name),
  getSync: (doc: string, name: string): Uint8Array | null => ipcRenderer.sendSync('scratch:getSync', doc, name),
  remove: (doc: string, name: string): Promise<boolean> => ipcRenderer.invoke('scratch:remove', doc, name),
  drop: (doc: string): Promise<boolean> => ipcRenderer.invoke('scratch:drop', doc)
}
contextBridge.exposeInMainWorld('bwScratch', api)
