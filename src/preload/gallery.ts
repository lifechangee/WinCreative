import { contextBridge, ipcRenderer } from 'electron'

/** Preload bridge for the colour/gallery feature module (Gallery folder in userData). */
const inv = (ch: string, ...a: unknown[]): Promise<any> => ipcRenderer.invoke(ch, ...a)

const api = {
  dir: (): Promise<string> => inv('gallery:dir'),
  list: (): Promise<{ name: string; size: number; mtime: number }[]> => inv('gallery:list'),
  read: (name: string): Promise<Uint8Array | null> => inv('gallery:read', name),
  write: (name: string, data: Uint8Array): Promise<boolean> => inv('gallery:write', name, data),
  wbegin: (name: string): Promise<number> => inv('gallery:wbegin', name),
  wchunk: (id: number, data: Uint8Array): Promise<boolean> => inv('gallery:wchunk', id, data),
  wend: (id: number): Promise<boolean> => inv('gallery:wend', id),
  wabort: (id: number): Promise<boolean> => inv('gallery:wabort', id),
  append: (name: string, data: Uint8Array): Promise<boolean> => inv('gallery:append', name, data),
  truncate: (name: string): Promise<boolean> => inv('gallery:truncate', name),
  remove: (name: string): Promise<boolean> => inv('gallery:remove', name),
  env: (key: string): Promise<string | null> => inv('gallery:env', key)
}
contextBridge.exposeInMainWorld('bwGallery', api)
export type GalleryApi = typeof api
