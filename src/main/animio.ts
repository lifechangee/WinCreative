import { app, dialog, ipcMain, BrowserWindow } from 'electron'
import { spawn, spawnSync, ChildProcessWithoutNullStreams } from 'child_process'
import { closeSync, existsSync, mkdirSync, readdirSync, rmSync } from 'fs'
import { open, stat, writeFile, FileHandle } from 'fs/promises'
import { join } from 'path'
import ffmpegStatic from 'ffmpeg-static'
import { mt } from './i18n'

/**
 * Main-process side of the "animio" feature module:
 *  - time-lapse frame store (append-only file per document, streamed to disk so renderer memory stays flat)
 *  - ffmpeg job runner (raw-frame stdin jobs for animation export, image2pipe jobs for time-lapse export)
 * ffmpeg comes from `ffmpeg-static` (asarUnpack'd when packaged) with a fallback to `ffmpeg` on PATH.
 */

// ------------------------------------------------------------------ ffmpeg discovery
export interface FfmpegInfo {
  path: string
  source: 'bundled' | 'system'
  version: string
  encoders: string[]
}
let cached: FfmpegInfo | null | undefined

function probe(path: string): FfmpegInfo | null {
  try {
    const v = spawnSync(path, ['-hide_banner', '-version'], { encoding: 'utf8', windowsHide: true, timeout: 8000 })
    if (v.status !== 0) return null
    const enc = spawnSync(path, ['-hide_banner', '-encoders'], { encoding: 'utf8', windowsHide: true, timeout: 8000 })
    const encoders = (enc.stdout || '')
      .split('\n')
      .map((l) => l.match(/^\s*V\S*\s+(\S+)/)?.[1])
      .filter((x): x is string => !!x)
    return { path, source: 'bundled', version: (v.stdout || '').split('\n')[0], encoders }
  } catch {
    return null
  }
}

export function findFfmpeg(): FfmpegInfo | null {
  if (cached !== undefined) return cached
  let info: FfmpegInfo | null = null
  const bundled = (ffmpegStatic as unknown as string | null) ?? null
  if (bundled) {
    const p = bundled.replace('app.asar' + (process.platform === 'win32' ? '\\' : '/'), 'app.asar.unpacked' + (process.platform === 'win32' ? '\\' : '/'))
    if (existsSync(p)) info = probe(p)
  }
  if (!info) {
    info = probe('ffmpeg')
    if (info) info.source = 'system'
  }
  cached = info
  return info
}

// ------------------------------------------------------------------ time-lapse store
/** o/l = byte range of the JPEG, d = ms since the previous frame, t = commit type, s = history state id (see tlHistory.ts) */
/** r = source rectangle [x, y, w, h] (document px) this frame shows (frame / viewport recordings; features/frame/tlCapture.ts) */
/** v = language variants the frame belongs to (absent = all), g = capture group (frames written by one capture pass share it) - features/langvariants */
type TlIdx = { o: number; l: number; d: number; t?: string; s?: number; r?: number[]; v?: string[]; g?: number }
interface Rec {
  path: string
  fh: FileHandle | null
  offset: number
  index: TlIdx[]
  chain: Promise<unknown>
  /** changes whenever bytes before `offset` are rewritten (decimate / load): cached incremental packs must restart */
  gen: number
}
let recGen = 0
const recs = new Map<string, Rec>()
let tlDir = ''
const dir = (): string => {
  if (!tlDir) {
    // Per-process subfolder so two running instances never delete each other's live recordings.
    const root = join(app.getPath('userData'), 'timelapse')
    tlDir = join(root, String(process.pid))
    mkdirSync(root, { recursive: true })
    for (const name of readdirSync(root)) {
      // stale files from crashed sessions; files locked by another running instance fail and are kept
      try {
        rmSync(join(root, name), { recursive: true, force: true })
      } catch {
        /* in use */
      }
    }
    mkdirSync(tlDir, { recursive: true })
  }
  return tlDir
}
const seq = <T>(r: Rec, fn: () => Promise<T>): Promise<T> => {
  const p = r.chain.then(fn, fn)
  r.chain = p.catch(() => undefined)
  return p
}
async function startRec(id: string): Promise<Rec> {
  const old = recs.get(id)
  if (old) {
    // restart IN PLACE (queued behind every running operation): closing + re-creating leaves a window in which the id is unknown and a
    // concurrent packInfo / packRange / append of the gallery autosave fails with "No time-lapse recording"; the new generation makes such a
    // save throw 'rewritten while saving' (it is retried) instead
    return seq(old, async () => {
      await old.fh!.truncate(0)
      old.offset = 0
      old.index = []
      old.gen = ++recGen
      return old
    })
  }
  const path = join(dir(), id.replace(/[^\w-]/g, '_') + '.bin')
  // Windows: re-creating a file that was just deleted can fail with EPERM while the delete is still pending
  let fh: Awaited<ReturnType<typeof open>> | null = null
  for (let i = 0; !fh; i++) {
    try {
      fh = await open(path, 'w+')
    } catch (e) {
      if (i >= 8 || (e as NodeJS.ErrnoException).code !== 'EPERM') throw e
      await new Promise((r) => setTimeout(r, 60))
    }
  }
  const r: Rec = { path, fh, offset: 0, index: [], chain: Promise.resolve(), gen: ++recGen }
  recs.set(id, r)
  return r
}
async function closeRec(id: string): Promise<void> {
  const r = recs.get(id)
  if (!r) return
  recs.delete(id)
  await r.chain
  await r.fh?.close().catch(() => undefined)
  r.fh = null
  try {
    rmSync(r.path, { force: true })
  } catch {
    /* locked; removed on next launch */
  }
}
const need = (id: string): Rec => {
  const r = recs.get(id)
  if (!r) throw new Error('No time-lapse recording ' + id)
  return r
}

// ------------------------------------------------------------------ ffmpeg jobs
interface Job {
  proc: ChildProcessWithoutNullStreams
  err: string
  done: Promise<{ ok: boolean; error?: string; size: number }>
  out: string
}
const jobs = new Map<number, Job>()
let jobSeq = 0

function launch(inputArgs: string[], outputArgs: string[], out: string): number {
  const ff = findFfmpeg()
  if (!ff) throw new Error('ffmpeg not found (bundled ffmpeg-static missing and none on PATH)')
  const args = ['-y', '-hide_banner', '-loglevel', 'error', ...inputArgs, '-i', '-', ...outputArgs, out]
  const proc = spawn(ff.path, args, { windowsHide: true, stdio: ['pipe', 'pipe', 'pipe'] })
  const job: Job = { proc, err: '', out, done: null as never }
  proc.stderr.on('data', (d: Buffer) => {
    job.err = (job.err + d.toString()).slice(-4000)
  })
  proc.stdin.on('error', () => undefined) // EPIPE when ffmpeg dies early; surfaced via exit code
  job.done = new Promise((resolve) => {
    proc.on('error', (e) => resolve({ ok: false, error: e.message, size: 0 }))
    proc.on('close', async (code) => {
      let size = 0
      try {
        size = (await stat(out)).size
      } catch {
        /* no output */
      }
      resolve(code === 0 && size > 0 ? { ok: true, size } : { ok: false, error: job.err.trim() || 'ffmpeg exited with code ' + code, size })
    })
  })
  const id = ++jobSeq
  jobs.set(id, job)
  return id
}

function writeAll(job: Job, buf: Buffer): Promise<void> {
  return new Promise((resolve, reject) => {
    if (job.proc.stdin.destroyed) return reject(new Error('ffmpeg closed its input'))
    if (job.proc.stdin.write(buf)) resolve()
    else {
      const onDrain = (): void => {
        cleanup()
        resolve()
      }
      const onClose = (): void => {
        cleanup()
        reject(new Error('ffmpeg closed its input'))
      }
      const cleanup = (): void => {
        job.proc.stdin.off('drain', onDrain)
        job.proc.stdin.off('close', onClose)
      }
      job.proc.stdin.once('drain', onDrain)
      job.proc.stdin.once('close', onClose)
    }
  })
}

export interface TlExportOpts {
  id: string
  /** frame indices to render, in order */
  indices: number[]
  /** how many times each selected frame is written (parallel to indices; default 1) */
  repeats?: number[]
  fps: number
  width: number
  height: number
  out: string
  codec: 'h264' | 'hevc' | 'vp9' | 'gif'
  crf?: number
  /** seconds of fade from / to black (ffmpeg fade filter) */
  fadeIn?: number
  fadeOut?: number
}

/** The running time-lapse export (one at a time) */
let tlJob: { id: number; cancelled: boolean } | null = null

function tlOutputArgs(o: TlExportOpts, totalFrames: number): string[] {
  const dur = totalFrames / o.fps
  const fades: string[] = []
  if (o.fadeIn && o.fadeIn > 0) fades.push(`fade=t=in:st=0:d=${Math.min(o.fadeIn, dur).toFixed(3)}`)
  if (o.fadeOut && o.fadeOut > 0) {
    const d = Math.min(o.fadeOut, dur)
    fades.push(`fade=t=out:st=${Math.max(0, dur - d).toFixed(3)}:d=${d.toFixed(3)}`)
  }
  const pre = [`scale=${o.width}:${o.height}:flags=lanczos`, ...fades]
  if (o.codec === 'gif') return ['-vf', pre.join(',') + `,fps=${o.fps},split[a][b];[a]palettegen=stats_mode=diff[p];[b][p]paletteuse=dither=bayer:bayer_scale=4`, '-loop', '0']
  const vf = [...pre, 'format=yuv420p'].join(',')
  if (o.codec === 'vp9') return ['-vf', vf, '-r', String(o.fps), '-c:v', 'libvpx-vp9', '-b:v', '0', '-crf', String(o.crf ?? 32), '-row-mt', '1', '-deadline', 'good', '-cpu-used', '4']
  if (o.codec === 'hevc') return ['-vf', vf, '-r', String(o.fps), '-c:v', 'libx265', '-preset', 'medium', '-crf', String(o.crf ?? 23), '-tag:v', 'hvc1', '-movflags', '+faststart']
  return ['-vf', vf, '-r', String(o.fps), '-c:v', 'libx264', '-preset', 'medium', '-crf', String(o.crf ?? 18), '-movflags', '+faststart']
}

export function registerAnimioIpc(getWin: () => BrowserWindow | null): void {
  ipcMain.handle('tl:start', async (_e, id: string) => {
    await startRec(id)
  })
  ipcMain.handle('tl:append', (_e, id: string, bytes: Uint8Array, dtMs: number, meta?: { t?: string; s?: number; r?: number[]; v?: string[]; g?: number }) => {
    const r = need(id)
    return seq(r, async () => {
      const buf = Buffer.from(bytes.buffer, bytes.byteOffset, bytes.byteLength)
      await r.fh!.write(buf, 0, buf.length, r.offset)
      const e: TlIdx = { o: r.offset, l: buf.length, d: Math.round(dtMs) }
      if (meta && typeof meta.s === 'number') {
        e.s = meta.s
        if (typeof meta.t === 'string') e.t = meta.t.slice(0, 24)
      }
      if (Array.isArray(meta?.r) && meta!.r.length === 4 && meta!.r.every((n) => Number.isFinite(n))) e.r = meta!.r.map((n) => Math.round(n))
      if (Array.isArray(meta?.v) && meta!.v.length) e.v = meta!.v.filter((x) => typeof x === 'string').map((x) => x.slice(0, 8)).slice(0, 8)
      if (typeof meta?.g === 'number' && Number.isFinite(meta.g)) e.g = Math.floor(meta.g)
      r.index.push(e)
      r.offset += buf.length
      return { count: r.index.length, bytes: r.offset }
    })
  })
  ipcMain.handle('tl:info', (_e, id: string) => {
    const r = recs.get(id)
    return r ? { count: r.index.length, bytes: r.offset } : null
  })
  ipcMain.handle('tl:frame', (_e, id: string, i: number) => {
    const r = need(id)
    return seq(r, async () => {
      const e = r.index[i]
      if (!e) return null
      const b = Buffer.alloc(e.l)
      await r.fh!.read(b, 0, e.l, e.o)
      return new Uint8Array(b.buffer, b.byteOffset, b.length)
    })
  })
  /** Whole recording as one blob + index, for embedding into .bwk. */
  ipcMain.handle('tl:pack', (_e, id: string) => {
    const r = need(id)
    return seq(r, async () => {
      const b = Buffer.alloc(r.offset)
      if (r.offset) await r.fh!.read(b, 0, r.offset, 0)
      return { data: new Uint8Array(b.buffer, b.byteOffset, b.length), index: r.index.map((x) => ({ ...x })) }
    })
  })
  /** Incremental pack: recording size + index + generation; the renderer then fetches only the new byte range. */
  ipcMain.handle('tl:packInfo', (_e, id: string) => {
    const r = need(id)
    return seq(r, async () => ({ offset: r.offset, index: r.index.map((x) => ({ ...x })), gen: r.gen }))
  })
  ipcMain.handle('tl:packRange', (_e, id: string, from: number, len: number) => {
    const r = need(id)
    return seq(r, async () => {
      const n = Math.max(0, Math.min(len, r.offset - from))
      const b = Buffer.alloc(n)
      if (n) await r.fh!.read(b, 0, n, from)
      return new Uint8Array(b.buffer, b.byteOffset, b.length)
    })
  })
  ipcMain.handle('tl:load', async (_e, id: string, data: Uint8Array, index: TlIdx[]) => {
    const r = await startRec(id)
    const buf = Buffer.from(data.buffer, data.byteOffset, data.byteLength)
    await r.fh!.write(buf, 0, buf.length, 0)
    r.offset = buf.length
    r.index = index.filter((e) => e.o + e.l <= buf.length)
    return { count: r.index.length, bytes: r.offset }
  })
  /** Keep every second frame (and the last) - bounds disk/memory for marathon sessions. */
  ipcMain.handle('tl:decimate', (_e, id: string) => {
    const r = need(id)
    return seq(r, async () => {
      const keep: TlIdx[] = []
      const survivors: number[] = []
      const src = r.index
      const n = src.length
      // thinning runs per "lane" (frames sharing one variant tag), so every language keeps an even sampling; the last frame of each lane survives
      const lane = (e: TlIdx): string => (e.v ? e.v.join(',') : '*')
      const cnt = new Map<string, number>()
      const lastOf = new Map<string, number>()
      src.forEach((e, i) => lastOf.set(lane(e), i))
      for (let i = 0; i < n; i++) {
        const l = lane(src[i])
        const c = cnt.get(l) ?? 0
        cnt.set(l, c + 1)
        // dropped frames donate their time to the survivor so tracked time stays the same
        if (c % 2 === 0) {
          keep.push({ ...src[i], d: src[i].d + (i + 1 < n - 1 && lane(src[i + 1]) === l ? src[i + 1].d : 0) })
          survivors.push(i)
        } else if (lastOf.get(l) === i) {
          keep.push({ ...src[i] })
          survivors.push(i)
        }
      }
      // compact into a fresh file to actually reclaim disk
      const tmp = r.path + '.tmp'
      const out = await open(tmp, 'w+')
      let off = 0
      const ni: typeof keep = []
      for (const e of keep) {
        const b = Buffer.alloc(e.l)
        await r.fh!.read(b, 0, e.l, e.o)
        await out.write(b, 0, e.l, off)
        ni.push({ ...e, o: off })
        off += e.l
      }
      await out.close()
      await r.fh!.close()
      const { rename } = await import('fs/promises')
      await rename(tmp, r.path)
      r.fh = await open(r.path, 'r+')
      r.index = ni
      r.offset = off
      r.gen = ++recGen
      return { count: ni.length, bytes: off, survivors }
    })
  })
  ipcMain.handle('tl:close', (_e, id: string) => closeRec(id))
  ipcMain.handle('tl:index', (_e, id: string) => recs.get(id)?.index.map((x) => x.d) ?? [])
  /** Per-frame metadata for the time-lapse editor: ms since previous frame, commit type, history state id. */
  ipcMain.handle('tl:tags', (_e, id: string) => recs.get(id)?.index.map((x) => ({ d: x.d, t: x.t, s: x.s, r: x.r, v: x.v, g: x.g })) ?? [])

  ipcMain.handle('tl:export', async (e, o: TlExportOpts) => {
    const r = need(o.id)
    let total = 0
    for (let i = 0; i < o.indices.length; i++) total += o.repeats?.[i] ?? 1
    const id = launch(['-f', 'image2pipe', '-framerate', String(o.fps), '-c:v', 'mjpeg'], tlOutputArgs(o, total), o.out)
    const job = jobs.get(id)!
    const state = { id, cancelled: false }
    tlJob = state
    let written = 0
    let lastSent = 0
    try {
      for (let i = 0; i < o.indices.length && !state.cancelled; i++) {
        const ent = r.index[o.indices[i]]
        if (!ent) continue
        const b = await seq(r, async () => {
          const buf = Buffer.alloc(ent.l)
          await r.fh!.read(buf, 0, ent.l, ent.o)
          return buf
        })
        const rep = o.repeats?.[i] ?? 1
        for (let k = 0; k < rep && !state.cancelled; k++) {
          await writeAll(job, b)
          written++
          const now = Date.now()
          if (now - lastSent > 100) {
            lastSent = now
            e.sender.send('an:progress', { job: 'tl', done: written, total })
          }
        }
      }
    } catch {
      /* fall through: the exit code tells the story */
    }
    if (state.cancelled) {
      job.proc.kill()
      await job.done
      jobs.delete(id)
      tlJob = null
      try {
        rmSync(o.out, { force: true })
      } catch {
        /* ignore */
      }
      return { ok: false, error: 'cancelled', cancelled: true, size: 0 }
    }
    job.proc.stdin.end()
    const res = await job.done
    jobs.delete(id)
    tlJob = null
    e.sender.send('an:progress', { job: 'tl', done: total, total })
    return res
  })
  ipcMain.handle('tl:exportCancel', () => {
    if (tlJob) {
      tlJob.cancelled = true
      jobs.get(tlJob.id)?.proc.kill()
    }
  })

  ipcMain.handle('ff:caps', () => {
    const f = findFfmpeg()
    return f ? { path: f.path, source: f.source, version: f.version, encoders: f.encoders } : null
  })
  ipcMain.handle('ff:pickPath', async (_e, opts: { defaultName: string; filters: Electron.FileFilter[] }) => {
    const w = getWin()
    const o = { title: mt('dialog.save'), defaultPath: opts.defaultName, filters: opts.filters }
    const r = await (w ? dialog.showSaveDialog(w, o) : dialog.showSaveDialog(o))
    return r.canceled || !r.filePath ? null : r.filePath
  })
  ipcMain.handle('ff:pickDir', async (_e, title: string) => {
    const w = getWin()
    const o: Electron.OpenDialogOptions = { title: title || mt('dialog.pickFolder'), properties: ['openDirectory', 'createDirectory'] }
    const r = await (w ? dialog.showOpenDialog(w, o) : dialog.showOpenDialog(o))
    return r.canceled || !r.filePaths[0] ? null : r.filePaths[0]
  })
  ipcMain.handle('ff:begin', (_e, o: { inputArgs: string[]; outputArgs: string[]; out: string }) => launch(o.inputArgs, o.outputArgs, o.out))
  ipcMain.handle('ff:write', async (_e, id: number, data: Uint8Array, repeat = 1) => {
    const job = jobs.get(id)
    if (!job) throw new Error('No such ffmpeg job')
    const buf = Buffer.from(data.buffer, data.byteOffset, data.byteLength)
    for (let i = 0; i < repeat; i++) await writeAll(job, buf)
  })
  ipcMain.handle('ff:end', async (_e, id: number) => {
    const job = jobs.get(id)
    if (!job) throw new Error('No such ffmpeg job')
    job.proc.stdin.end()
    const res = await job.done
    jobs.delete(id)
    return res
  })
  ipcMain.handle('ff:abort', (_e, id: number) => {
    const job = jobs.get(id)
    if (!job) return
    job.proc.kill()
    jobs.delete(id)
    try {
      rmSync(job.out, { force: true })
    } catch {
      /* ignore */
    }
  })
  /** Write a set of files into a folder (frame sequences, per-layer PNGs). */
  ipcMain.handle('fs:writeFiles', async (_e, folder: string, files: { name: string; data: Uint8Array }[]) => {
    for (const f of files) await writeFile(join(folder, f.name.replace(/[\\/:*?"<>|]/g, '_')), f.data)
    return files.length
  })
  /** Selftest helper: verify + inspect a produced file with ffprobe (system) when available. */
  ipcMain.handle('ff:probe', (_e, file: string) => {
    const ff = findFfmpeg()
    if (!ff) return null
    const probeExe = ff.path.replace(/ffmpeg(\.exe)?$/i, (m) => m.replace('ffmpeg', 'ffprobe'))
    const tryRun = (exe: string): string | null => {
      const r = spawnSync(exe, ['-v', 'error', '-count_frames', '-select_streams', 'v:0', '-show_entries', 'stream=codec_name,width,height,nb_read_frames,r_frame_rate,pix_fmt:format=duration,size', '-of', 'json', file], { encoding: 'utf8', windowsHide: true })
      return r.status === 0 ? r.stdout : null
    }
    return tryRun(probeExe) ?? tryRun('ffprobe')
  })
  /** BW_ANIMIO_TEST=1 BW_ANIMIO_OUT=<dir>: run the animio end-to-end self-test (features/animio/selftest.ts). */
  ipcMain.handle('an:testConfig', () => (process.env.BW_ANIMIO_TEST === '1' ? { out: process.env.BW_ANIMIO_OUT ?? '' } : null))
  app.on('will-quit', () => {
    for (const r of recs.values()) {
      // Windows refuses to delete an open file (EPERM): close the handle synchronously first, never throw here.
      try {
        if (r.fh) closeSync(r.fh.fd)
      } catch {
        /* already closed */
      }
      try {
        rmSync(r.path, { force: true })
      } catch {
        /* removed on next launch */
      }
    }
    for (const j of jobs.values()) j.proc.kill()
  })
}
