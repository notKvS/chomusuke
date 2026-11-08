// Reading and writing the app's own JSON files (settings, library, ratings, playlists, history) so that one damaged
// file never silently costs the user their data. Each write keeps the version it replaces as `<file>.bak`.
import { copyFile, readFile, rename, writeFile } from 'node:fs/promises'
import path from 'node:path'
import { logger } from './log.ts'
import { isRecord } from './song-ref.ts'

const log = logger('store')

type Parsed = Record<string, unknown> | 'missing' | 'damaged'

async function parse(file: string): Promise<Parsed> {
  let text: string
  try {
    text = await readFile(file, 'utf8')
  } catch (err) {
    return (err as NodeJS.ErrnoException).code === 'ENOENT' ? 'missing' : 'damaged'
  }
  try {
    const value: unknown = JSON.parse(text)
    return isRecord(value) ? value : 'damaged'
  } catch {
    return 'damaged'
  }
}

/**
 * The file's contents, or undefined on a first run. A damaged file (unreadable, not JSON, not an object) is renamed
 * to `<file>.corrupt-<time>` so it is never overwritten, and the last good copy is used instead.
 */
export async function readJsonFile(file: string): Promise<Record<string, unknown> | undefined> {
  const main = await parse(file)
  if (typeof main === 'object') return main
  if (main === 'damaged') {
    const aside = `${file}.corrupt-${Date.now()}`
    await rename(file, aside).catch(() => {})
    log.error(`${path.basename(file)} was damaged; kept it as ${path.basename(aside)}, using the last good copy`)
  }
  const backup = await parse(`${file}.bak`)
  return typeof backup === 'object' ? backup : undefined
}

/** Replaces the file atomically, keeping the version it replaces as `<file>.bak`. */
export async function writeJsonFile(file: string, body: string): Promise<void> {
  await writeFile(`${file}.tmp`, body, { encoding: 'utf8', mode: 0o600 })
  await copyFile(file, `${file}.bak`).catch(() => {}) // none yet on the first write
  await rename(`${file}.tmp`, file)
}
