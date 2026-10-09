import { app, ipcMain } from 'electron'
import { join, resolve, sep } from 'path'
import { readFileSync, rmSync } from 'fs'
import { mkdir, readFile, rm, unlink, writeFile } from 'fs/promises'

/**
 * Per-document scratch files of the infinite-canvas tile memory (renderer/doc/tileMemory.ts): evicted tiles beyond the RAM budget
 * live in <userData>/scratch/<docId>/<name>. They are never the source of truth (the .bwk is), so the whole folder is wiped at
 * every app start (crash recovery) and a document's folder is removed when it closes.
 */
export function registerScratchIpc(primary = true): void {
  const root = (): string => join(process.env.BW_SCRATCH_DIR || app.getPath('userData'), 'scratch')
  // a second instance (single-instance lock lost) must NOT wipe the running instance's scratch files
  if (!primary) return
  try {
    rmSync(root(), { recursive: true, force: true })
  } catch {
    /* ignore */
  }
  const path = (doc: string, name: string): string => {
    if (typeof doc !== 'string' || typeof name !== 'string' || !/^[\w-]+$/.test(doc) || !/^[\w.-]+$/.test(name) || name.startsWith('.')) throw new Error('Bad scratch name')
    const p = resolve(root(), doc, name)
    if (!p.startsWith(resolve(root()) + sep)) throw new Error('Bad scratch path')
    return p
  }
  ipcMain.handle('scratch:put', async (_e, doc: string, name: string, data: Uint8Array) => {
    const p = path(doc, name)
    await mkdir(join(root(), doc), { recursive: true })
    await writeFile(p, data)
    return true
  })
  ipcMain.handle('scratch:get', async (_e, doc: string, name: string) => {
    try {
      return new Uint8Array(await readFile(path(doc, name)))
    } catch {
      return null
    }
  })
  ipcMain.on('scratch:getSync', (e, doc: string, name: string) => {
    try {
      e.returnValue = new Uint8Array(readFileSync(path(doc, name)))
    } catch {
      e.returnValue = null
    }
  })
  ipcMain.handle('scratch:remove', async (_e, doc: string, name: string) => {
    try {
      await unlink(path(doc, name))
      return true
    } catch {
      return false
    }
  })
  ipcMain.handle('scratch:drop', async (_e, doc: string) => {
    if (typeof doc !== 'string' || !/^[\w-]+$/.test(doc)) return false
    await rm(join(root(), doc), { recursive: true, force: true })
    return true
  })
  app.on('quit', () => {
    try {
      rmSync(root(), { recursive: true, force: true })
    } catch {
      /* ignore */
    }
  })
}
