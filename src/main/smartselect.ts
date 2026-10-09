import { app, ipcMain, type WebContents } from 'electron'
import { createHash } from 'crypto'
import { createReadStream, createWriteStream, existsSync, mkdirSync, readFileSync, renameSync, rmSync, statSync, writeFileSync } from 'fs'
import { readFile } from 'fs/promises'
import type { IncomingMessage } from 'http'
import { get as httpsGet } from 'https'
import { join } from 'path'
import { hostAllowed, MODELS, modelBytes, modelFiles, sameHash, type ModelDef, type ModelFile, type ModelId, type ModelStatus } from '../renderer/src/features/smartselect/manifest'

/**
 * Smart selection models (main process): serves the bundled MobileSAM files from resources/models, downloads the optional
 * "Precise" model into userData/models with a pinned URL list, host allow-list, size + SHA-256 verification, progress and cancel.
 * Downloads only ever start from an explicit renderer request (the user's click on "Download").
 */
const bundledDir = (): string => (app.isPackaged ? join(process.resourcesPath, 'models') : join(__dirname, '..', '..', 'resources', 'models'))
const userDir = (): string => join(app.getPath('userData'), 'models')
const dirOf = (m: ModelDef): string => (m.bundled ? join(bundledDir(), m.id) : join(userDir(), m.id))

interface Job {
  abort: boolean
  req: ReturnType<typeof httpsGet> | null
}
const jobs = new Map<ModelId, Job>()
const verified = new Set<string>()

/** rm that survives Windows keeping a just-destroyed stream's handle open for a moment (retried, never throws) */
function safeRm(path: string, recursive = false, tries = 8): void {
  try {
    rmSync(path, { recursive, force: true })
  } catch {
    if (tries > 0) setTimeout(() => safeRm(path, recursive, tries - 1), 250)
  }
}

const sha256File = (p: string): Promise<string> =>
  new Promise((res, rej) => {
    const h = createHash('sha256')
    createReadStream(p)
      .on('data', (d) => h.update(d))
      .on('end', () => res(h.digest('hex')))
      .on('error', rej)
  })

function sizesOk(m: ModelDef): boolean {
  try {
    return modelFiles(m).every((f) => statSync(join(dirOf(m), f.name)).size === f.size)
  } catch {
    return false
  }
}

const markerPath = (m: ModelDef): string => join(dirOf(m), 'verified.json')

function status(m: ModelDef): ModelStatus {
  let installed = sizesOk(m)
  if (installed && !m.bundled) {
    // downloaded models carry a marker written after the SHA-256 check; a missing marker means an interrupted install
    try {
      const mk = JSON.parse(readFileSync(markerPath(m), 'utf8')) as Record<string, string>
      installed = modelFiles(m).every((f) => mk[f.name] && sameHash(mk[f.name], f.sha256))
    } catch {
      installed = false
    }
  }
  return { id: m.id, bundled: m.bundled, installed, bytes: modelBytes(m), diskBytes: m.bundled ? 0 : installed ? modelBytes(m) : 0 }
}

/** Follow redirects manually so every hop is checked against the host allow-list. */
function fetchStream(url: string, job: Job, hops = 0): Promise<IncomingMessage> {
  return new Promise((res, rej) => {
    if (!hostAllowed(url)) return rej(new Error('host not allowed: ' + url))
    if (hops > 6) return rej(new Error('too many redirects'))
    const req = httpsGet(url, { headers: { 'User-Agent': 'WinCreative' } }, (r) => {
      const code = r.statusCode ?? 0
      if (code >= 300 && code < 400 && r.headers.location) {
        r.resume()
        fetchStream(new URL(r.headers.location, url).toString(), job, hops + 1).then(res, rej)
      } else if (code === 200) res(r)
      else {
        r.resume()
        rej(new Error('HTTP ' + code))
      }
    })
    job.req = req
    req.on('error', rej)
    req.setTimeout(30000, () => req.destroy(new Error('timeout')))
  })
}

async function downloadFile(m: ModelDef, f: ModelFile, job: Job, onBytes: (n: number) => void): Promise<string> {
  const dir = dirOf(m)
  mkdirSync(dir, { recursive: true })
  const dst = join(dir, f.name)
  const part = dst + '.part'
  const r = await fetchStream(f.url!, job)
  const hash = createHash('sha256')
  let got = 0
  await new Promise<void>((res, rej) => {
    const ws = createWriteStream(part)
    r.on('data', (d: Buffer) => {
      got += d.length
      hash.update(d)
      onBytes(d.length)
    })
    r.on('error', rej)
    ws.on('error', rej)
    ws.on('finish', () => res())
    r.on('aborted', () => rej(new Error('aborted')))
    r.pipe(ws)
    const poll = setInterval(() => {
      if (job.abort) {
        clearInterval(poll)
        r.destroy()
        ws.destroy()
        rej(new Error('cancelled'))
      }
    }, 150)
    ws.on('close', () => clearInterval(poll))
  })
  const digest = hash.digest('hex')
  if (got !== f.size) throw new Error(`size mismatch for ${f.name}: ${got} != ${f.size}`)
  if (!sameHash(digest, f.sha256)) throw new Error(`SHA-256 mismatch for ${f.name}`)
  renameSync(part, dst)
  return digest
}

async function download(m: ModelDef, wc: WebContents): Promise<{ ok: boolean; error?: string }> {
  if (m.bundled || jobs.has(m.id)) return { ok: false, error: 'not downloadable' }
  const job: Job = { abort: false, req: null }
  jobs.set(m.id, job)
  const total = modelBytes(m)
  let done = 0
  let last = 0
  const send = (state: string, extra: Record<string, unknown> = {}): void => {
    if (!wc.isDestroyed()) wc.send('ss:progress', { id: m.id, state, done, total, ...extra })
  }
  try {
    send('start')
    const marker: Record<string, string> = {}
    for (const f of modelFiles(m)) {
      const dst = join(dirOf(m), f.name)
      // keep files that already verify (re-download after a partial install)
      if (existsSync(dst) && statSync(dst).size === f.size && sameHash(await sha256File(dst), f.sha256)) {
        marker[f.name] = f.sha256
        done += f.size
        continue
      }
      marker[f.name] = await downloadFile(m, f, job, (n) => {
        done += n
        const now = Date.now()
        if (now - last > 120) {
          last = now
          send('progress', { file: f.name })
        }
      })
    }
    writeFileSync(markerPath(m), JSON.stringify(marker))
    send('done')
    return { ok: true }
  } catch (e) {
    for (const f of modelFiles(m)) safeRm(join(dirOf(m), f.name + '.part'))
    if (job.abort) safeRm(dirOf(m), true) // cancelled by the user: leave nothing behind
    const msg = (e as Error).message
    send(job.abort ? 'cancelled' : 'error', { error: msg })
    return { ok: false, error: job.abort ? 'cancelled' : msg }
  } finally {
    jobs.delete(m.id)
  }
}

export function registerSmartSelectIpc(): void {
  // SharedArrayBuffer (without cross-origin isolation, which would change window.open semantics for the projector window) so the
  // WASM fallback of onnxruntime-web can use several threads
  app.commandLine.appendSwitch('enable-blink-features', 'SharedArrayBuffer')
  ipcMain.handle('ss:status', () => (Object.values(MODELS) as ModelDef[]).map(status))
  ipcMain.handle('ss:read', async (_e, id: ModelId, name: string) => {
    const m = MODELS[id]
    const f = m && modelFiles(m).find((x) => x.name === name)
    if (!m || !f) throw new Error('unknown model file')
    const p = join(dirOf(m), f.name)
    if (!status(m).installed) throw new Error('model not installed')
    if (m.bundled && !verified.has(p)) {
      if (!sameHash(await sha256File(p), f.sha256)) throw new Error('bundled model failed its SHA-256 check: ' + f.name)
      verified.add(p)
    }
    return new Uint8Array(await readFile(p))
  })
  ipcMain.handle('ss:download', (e, id: ModelId) => (MODELS[id] ? download(MODELS[id], e.sender) : { ok: false, error: 'unknown model' }))
  ipcMain.handle('ss:cancel', (_e, id: ModelId) => {
    const j = jobs.get(id)
    if (j) {
      j.abort = true
      j.req?.destroy()
    }
  })
  ipcMain.handle('ss:delete', (_e, id: ModelId) => {
    const m = MODELS[id]
    if (!m || m.bundled || jobs.has(id)) return false
    rmSync(dirOf(m), { recursive: true, force: true })
    return true
  })
  ipcMain.handle('ss:testMode', () => process.env.BW_SS_TEST === '1')
  ipcMain.handle('ss:testLog', (_e, s: string) => console.log('[ss-test]', s))
  ipcMain.handle('ss:testDone', (_e, ok: boolean) => {
    console.log('[ss-test] done ok=' + ok)
    setTimeout(() => app.exit(ok ? 0 : 1), 100)
  })
}
