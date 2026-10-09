import { app, crashReporter, ipcMain, type WebContents } from 'electron'
import { appendFileSync, mkdirSync } from 'fs'
import { join } from 'path'

/**
 * Crash diagnostics. Local only: minidumps are written to app.getPath('crashDumps') and NEVER uploaded. Every process-gone event
 * and (optionally) a once-per-second memory sample go to <userData>/logs/diag.log, so a crash always leaves evidence.
 * BW_DIAG_METRICS=1 enables the sampler (QA / stress runs); BW_DIAG_LOG overrides the log path.
 */
let logFile = ''
export function diagLog(line: string): void {
  const text = `${new Date().toISOString()} ${line}\n`
  try {
    if (!logFile) {
      const dir = join(app.getPath('userData'), 'logs')
      mkdirSync(dir, { recursive: true })
      logFile = process.env.BW_DIAG_LOG || join(dir, 'diag.log')
    }
    appendFileSync(logFile, text)
  } catch {
    /* diagnostics must never break the app */
  }
}

export function startCrashReporting(): void {
  try {
    crashReporter.start({ uploadToServer: false, submitURL: '', compress: true, ignoreSystemCrashHandler: false })
  } catch (e) {
    diagLog('crashReporter.start failed ' + String(e))
  }
  app.on('child-process-gone', (_e, d) => diagLog(`child-process-gone ${JSON.stringify(d)}`))
  ipcMain.on('diag:log', (_e, line: unknown) => {
    if (typeof line === 'string') diagLog('[renderer] ' + line.slice(0, 500))
  })
  if (process.env.BW_DIAG_METRICS === '1') {
    const mb = (n: number): number => Math.round(n / 1048576)
    setInterval(() => {
      try {
        const m = app.getAppMetrics()
        const row = m.map((p) => `${p.type}:${p.pid}:ws${mb(p.memory.workingSetSize * 1024)}:priv${mb((p.memory.privateBytes ?? 0) * 1024)}`).join(' ')
        diagLog('metrics ' + row)
      } catch {
        /* ignore */
      }
    }, 1000).unref()
  }
}

/** Log a renderer death with everything Electron tells us (reason: crashed / oom / killed / launch-failed / integrity-failure). */
export function logRenderGone(wc: WebContents | null, d: Electron.RenderProcessGoneDetails): void {
  diagLog(`render-process-gone reason=${d.reason} exitCode=${d.exitCode} url=${wc && !wc.isDestroyed() ? wc.getURL().slice(0, 80) : '?'}`)
}
