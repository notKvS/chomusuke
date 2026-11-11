import { readFile, writeFile } from 'node:fs/promises'
import os from 'node:os'
import path from 'node:path'
import { app, type BrowserWindow, dialog } from 'electron'
import type { SaveTorrentResult } from '../shared/types.ts'
import { buildLogExport, logDir, logger } from './log.ts'

const log = logger('log-export')

/** The log file and the one before it (see log.ts), oldest first. */
const LOG_FILES = ['main.old.log', 'main.log']

/**
 * Asks where to save the log and writes it there as one text file: a header for whoever reads it (`extra` lines go
 * under it), then the older log file and the current one. Null when the user cancels. Used by Settings → Updates and
 * by the crash dialog (with no window: the window may be the thing that crashed).
 */
export async function saveLogFile(parent: BrowserWindow | null, extra: string[] = []): Promise<SaveTorrentResult> {
  const options = {
    title: 'Save the log',
    defaultPath: path.join(app.getPath('downloads'), `chomusuke-log-${new Date().toISOString().slice(0, 10)}.txt`),
    filters: [{ name: 'Text file', extensions: ['txt'] }]
  }
  const picked = parent ? await dialog.showSaveDialog(parent, options) : await dialog.showSaveDialog(options)
  if (picked.canceled || !picked.filePath) return null
  try {
    const files = await Promise.all(LOG_FILES.map(name => readFile(path.join(logDir(), name), 'utf8').catch(() => '')))
    const header = [
      `Chomusuke ${app.getVersion()} log, saved ${new Date().toISOString()}`,
      `System: ${os.type()} ${os.release()} (${process.arch}), Electron ${process.versions.electron}`,
      ...extra,
      'Lines saying a source "returned no results" show which source found nothing, and for what.'
    ]
    await writeFile(picked.filePath, buildLogExport(header, files), 'utf8')
    return { ok: true, path: picked.filePath }
  } catch (err) {
    log.error('couldn’t save the log:', err)
    return { ok: false, error: 'Couldn’t save the log file.' }
  }
}
