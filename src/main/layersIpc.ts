import { app, clipboard, ipcMain, nativeImage } from 'electron'

/** OS clipboard image in/out for the Layers feature (Copy / Paste / Copy All). */
export function registerLayersIpc(): void {
  // BW_LAYERS_TEST=1: renderer runs features/layers/selftest.ts and reports through these
  ipcMain.handle('layers:testMode', () => process.env.BW_LAYERS_TEST === '1')
  ipcMain.handle('layers:testLog', (_e, s: string) => console.log('[layers-test]', s))
  ipcMain.handle('layers:testDone', (_e, ok: boolean) => {
    console.log('[layers-test] done ok=' + ok)
    setTimeout(() => app.exit(ok ? 0 : 1), 100)
  })
  ipcMain.handle('layers:clipboardWriteImage', (_e, png: Uint8Array) => {
    (clipboard as any).writeImage(nativeImage.createFromBuffer(Buffer.from(png)))
    return true
  })
  ipcMain.handle('layers:clipboardReadImage', () => {
    const img = (clipboard as any).readImage()
    return img.isEmpty() ? null : new Uint8Array(img.toPNG())
  })
}
