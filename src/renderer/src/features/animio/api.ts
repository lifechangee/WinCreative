import type { AnimioApi } from '../../../../preload/animio'

declare global {
  interface Window {
    animio?: AnimioApi
  }
}

export const animioApi = (): AnimioApi => {
  if (!window.animio) throw new Error('Electron bridge unavailable')
  return window.animio
}

export interface FfmpegCaps {
  path: string
  source: 'bundled' | 'system'
  version: string
  encoders: string[]
}
let capsCache: Promise<FfmpegCaps | null> | null = null
export const ffmpegCaps = (): Promise<FfmpegCaps | null> => (capsCache ??= animioApi().ff.caps())

/** Progress subscription helper. */
export function onProgress(cb: (p: { job: string; done: number; total: number }) => void): () => void {
  return animioApi().onProgress(cb)
}

export const downloadOrSave = async (defaultName: string, ext: string[], label: string, data: Uint8Array): Promise<string | null> => {
  if (!window.brushwork) throw new Error('Electron bridge unavailable')
  return window.brushwork.saveFile({ defaultName, filters: [{ name: label, extensions: ext }], data })
}
