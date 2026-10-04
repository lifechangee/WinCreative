import { contextBridge, ipcRenderer } from 'electron'

/** Preload bridge for the animio feature module (time-lapse store, ffmpeg jobs, folder writes). */
type Idx = { o: number; l: number; d: number; t?: string; s?: number }
const inv = (ch: string, ...a: unknown[]): Promise<any> => ipcRenderer.invoke(ch, ...a)

const api = {
  tl: {
    start: (id: string): Promise<void> => inv('tl:start', id),
    append: (id: string, bytes: Uint8Array, dtMs: number, meta?: { t?: string; s?: number }): Promise<{ count: number; bytes: number }> => inv('tl:append', id, bytes, dtMs, meta),
    info: (id: string): Promise<{ count: number; bytes: number } | null> => inv('tl:info', id),
    frame: (id: string, i: number): Promise<Uint8Array | null> => inv('tl:frame', id, i),
    pack: (id: string): Promise<{ data: Uint8Array; index: Idx[] }> => inv('tl:pack', id),
    packInfo: (id: string): Promise<{ offset: number; index: Idx[]; gen: number }> => inv('tl:packInfo', id),
    packRange: (id: string, from: number, len: number): Promise<Uint8Array> => inv('tl:packRange', id, from, len),
    load: (id: string, data: Uint8Array, index: Idx[]): Promise<{ count: number; bytes: number }> => inv('tl:load', id, data, index),
    decimate: (id: string): Promise<{ count: number; bytes: number }> => inv('tl:decimate', id),
    close: (id: string): Promise<void> => inv('tl:close', id),
    index: (id: string): Promise<number[]> => inv('tl:index', id),
    tags: (id: string): Promise<{ d: number; t?: string; s?: number }[]> => inv('tl:tags', id),
    export: (o: {
      id: string
      indices: number[]
      repeats?: number[]
      fps: number
      width: number
      height: number
      out: string
      codec: 'h264' | 'hevc' | 'vp9' | 'gif'
      crf?: number
      fadeIn?: number
      fadeOut?: number
    }): Promise<{ ok: boolean; error?: string; cancelled?: boolean; size: number }> => inv('tl:export', o),
    exportCancel: (): Promise<void> => inv('tl:exportCancel')
  },
  ff: {
    caps: (): Promise<{ path: string; source: 'bundled' | 'system'; version: string; encoders: string[] } | null> => inv('ff:caps'),
    pickPath: (opts: { defaultName: string; filters: { name: string; extensions: string[] }[] }): Promise<string | null> => inv('ff:pickPath', opts),
    pickDir: (title: string): Promise<string | null> => inv('ff:pickDir', title),
    begin: (o: { inputArgs: string[]; outputArgs: string[]; out: string }): Promise<number> => inv('ff:begin', o),
    write: (id: number, data: Uint8Array, repeat = 1): Promise<void> => inv('ff:write', id, data, repeat),
    end: (id: number): Promise<{ ok: boolean; error?: string; size: number }> => inv('ff:end', id),
    abort: (id: number): Promise<void> => inv('ff:abort', id),
    probe: (file: string): Promise<string | null> => inv('ff:probe', file)
  },
  testConfig: (): Promise<{ out: string } | null> => inv('an:testConfig'),
  writeFiles: (folder: string, files: { name: string; data: Uint8Array }[]): Promise<number> => inv('fs:writeFiles', folder, files),
  onProgress: (cb: (p: { job: string; done: number; total: number }) => void): (() => void) => {
    const h = (_e: unknown, p: { job: string; done: number; total: number }): void => cb(p)
    ipcRenderer.on('an:progress', h)
    return () => ipcRenderer.off('an:progress', h)
  }
}
contextBridge.exposeInMainWorld('animio', api)
export type AnimioApi = typeof api
