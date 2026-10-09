import { app, ipcMain } from 'electron'
import { join, resolve, sep } from 'path'
import { appendFile, copyFile, link, mkdir, open as fsOpen, readdir, readFile, rename, stat, unlink, writeFile } from 'fs/promises'
import { verifyZipFile } from './zipVerify'
import type { FileHandle } from 'fs/promises'

/**
 * Gallery storage: a flat folder <userData>/Gallery holding index.json, <id>.bwk and <id>.png thumbnails.
 * All paths coming from the renderer are file names inside that folder (no separators allowed).
 */
export function registerGalleryIpc(): void {
  const root = (): string => join(process.env.BW_GALLERY_DIR || app.getPath('userData'), 'Gallery')
  const safe = async (name: string): Promise<string> => {
    if (typeof name !== 'string' || !name || /[\\/]/.test(name) || name.startsWith('.')) throw new Error('Bad gallery file name')
    await mkdir(root(), { recursive: true })
    const p = resolve(root(), name)
    if (!p.startsWith(resolve(root()) + sep)) throw new Error('Bad gallery path')
    return p
  }
  /**
   * Replace `dest` by the finished temp file: a .bwk is verified first (central directory + every entry inflated, CRC-32 compared) so a corrupt
   * write can never replace a good file; the previous version is kept as <name>.bwk~ (hard link, copy as fallback) until the next good save.
   */
  const commit = async (tmp: string, dest: string): Promise<void> => {
    if (dest.endsWith('.bwk')) {
      try {
        await verifyZipFile(tmp)
      } catch (e) {
        await unlink(tmp).catch(() => undefined)
        throw new Error('save verification failed: ' + (e as Error).message)
      }
      const bak = dest + '~'
      await unlink(bak).catch(() => undefined)
      await link(dest, bak).catch(() => copyFile(dest, bak).catch(() => undefined)) // no previous version yet -> nothing to keep
    }
    await rename(tmp, dest)
  }
  ipcMain.handle('gallery:dir', async () => {
    await mkdir(root(), { recursive: true })
    return root()
  })
  ipcMain.handle('gallery:list', async () => {
    await mkdir(root(), { recursive: true })
    const out: { name: string; size: number; mtime: number }[] = []
    for (const n of await readdir(root())) {
      const s = await stat(join(root(), n)).catch(() => null)
      if (s?.isFile()) out.push({ name: n, size: s.size, mtime: s.mtimeMs })
    }
    return out
  })
  ipcMain.handle('gallery:read', async (_e, name: string) => {
    try {
      return new Uint8Array(await readFile(await safe(name)))
    } catch {
      return null
    }
  })
  // write via temp file + rename so a crash mid-autosave never corrupts an artwork
  ipcMain.handle('gallery:write', async (_e, name: string, data: Uint8Array) => {
    const p = await safe(name)
    const tmp = p + '.' + ++tmpSeq + '.tmp' // unique: two writes of the same file must not fight over one temp name
    await writeFile(tmp, data)
    await commit(tmp, p)
    return true
  })
  // chunked write (renderer sends ~1 MB pieces so a 40 MB artwork never blocks the UI in one huge IPC message)
  let tmpSeq = 0
  const writers = new Map<number, { fh: FileHandle; tmp: string; dest: string }>()
  let writerSeq = 0
  ipcMain.handle('gallery:wbegin', async (_e, name: string) => {
    const dest = await safe(name)
    const tmp = dest + '.' + ++tmpSeq + '.tmp'
    const fh = await fsOpen(tmp, 'w')
    const id = ++writerSeq
    writers.set(id, { fh, tmp, dest })
    return id
  })
  ipcMain.handle('gallery:wchunk', async (_e, id: number, data: Uint8Array) => {
    const w = writers.get(id)
    if (!w) throw new Error('no such writer')
    await w.fh.write(data)
    return true
  })
  ipcMain.handle('gallery:wend', async (_e, id: number) => {
    const w = writers.get(id)
    if (!w) throw new Error('no such writer')
    writers.delete(id)
    await w.fh.close()
    await commit(w.tmp, w.dest)
    return true
  })
  ipcMain.handle('gallery:wabort', async (_e, id: number) => {
    const w = writers.get(id)
    if (!w) return false
    writers.delete(id)
    await w.fh.close().catch(() => undefined)
    await unlink(w.tmp).catch(() => undefined)
    return true
  })
  // append-only crash journal
  ipcMain.handle('gallery:append', async (_e, name: string, data: Uint8Array) => {
    await appendFile(await safe(name), data)
    return true
  })
  ipcMain.handle('gallery:truncate', async (_e, name: string) => {
    const p = await safe(name)
    await writeFile(p, new Uint8Array(0))
    return true
  })
  ipcMain.handle('gallery:remove', async (_e, name: string) => {
    try {
      await unlink(await safe(name))
      return true
    } catch {
      return false
    }
  })
  ipcMain.handle('gallery:env', (_e, key: string) => (typeof key === 'string' && key.startsWith('BW_') ? process.env[key] ?? null : null))
}
