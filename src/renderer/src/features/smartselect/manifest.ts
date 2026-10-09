/**
 * Models manifest for Smart selection (pure; imported by the main process too).
 * Every file has a size and a SHA-256 that is verified after download / before load. Download URLs are pinned to a commit
 * of the model authors' official Hugging Face repository and are the only hosts the main process will contact.
 */
import type { ModelFamily } from './region'
import models from './models.json'

export type ModelId = 'fast' | 'precise'

export interface ModelFile {
  /** file name as the runtime expects it (external-data files keep the name referenced inside the .onnx) */
  name: string
  size: number
  sha256: string
  /** pinned download URL (only for downloadable models) */
  url?: string
}

export interface ModelDef {
  id: ModelId
  family: ModelFamily
  /** display names are translated: smartselect.model.<id>.name */
  title: string
  license: string
  source: string
  /** shipped inside the installer (resources/models/<id>) */
  bundled: boolean
  encoder: ModelFile
  decoder: ModelFile
  /** external weights referenced by the .onnx files */
  extra: ModelFile[]
}

export const MODELS = models as unknown as Record<ModelId, ModelDef>

export const modelFiles = (m: ModelDef): ModelFile[] => [m.encoder, m.decoder, ...m.extra]
export const modelBytes = (m: ModelDef): number => modelFiles(m).reduce((s, f) => s + f.size, 0)

/** Only these hosts (and their sub-domains) may be contacted for model downloads, including redirect targets. */
export const DOWNLOAD_HOSTS = ['huggingface.co', 'hf.co']

export function hostAllowed(url: string): boolean {
  let u: URL
  try {
    u = new URL(url)
  } catch {
    return false
  }
  if (u.protocol !== 'https:') return false
  return DOWNLOAD_HOSTS.some((h) => u.hostname === h || u.hostname.endsWith('.' + h))
}

/** Hex SHA-256 comparison helper that tolerates case/whitespace. */
export const sameHash = (a: string, b: string): boolean => a.trim().toLowerCase() === b.trim().toLowerCase()

export interface ModelStatus {
  id: ModelId
  bundled: boolean
  /** all files present (and verified when they were downloaded) */
  installed: boolean
  bytes: number
  /** on-disk bytes (downloaded models) */
  diskBytes: number
}
