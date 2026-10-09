import { app, clipboard, ClipboardItem, ipcMain } from 'electron'

/** OS clipboard image in/out for the Layers feature (Copy / Paste / Copy All). */
export function registerLayersIpc(): void {
  // BW_LAYERS_TEST=1: renderer runs features/layers/selftest.ts and reports through these
  ipcMain.handle('layers:testMode', () => process.env.BW_LAYERS_TEST === '1')
  ipcMain.handle('layers:testLog', (_e, s: string) => console.log('[layers-test]', s))
  ipcMain.handle('layers:testDone', (_e, ok: boolean) => {
    console.log('[layers-test] done ok=' + ok)
    setTimeout(() => app.exit(ok ? 0 : 1), 100)
  })
  // Electron >= 44: the main-process clipboard is the async W3C-style API (write/read of ClipboardItem); writeImage/readImage are gone.
  ipcMain.handle('layers:clipboardWriteImage', async (_e, png: Uint8Array) => {
    await clipboard.write([new ClipboardItem({ 'image/png': new Blob([Buffer.from(png)], { type: 'image/png' }) })])
    return true
  })
  ipcMain.handle('layers:clipboardReadImage', async () => {
    const items = await clipboard.read()
    const it = items.find((i) => i.types.includes('image/png'))
    if (!it) return null
    const blob = (await it.getType('image/png')) as Blob
    const buf = new Uint8Array(await blob.arrayBuffer())
    return buf.length ? buf : null
  })
}
