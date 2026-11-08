import { normalizeText } from '../shared/fingerprint.ts'
import type { PlayedSong } from '../shared/types.ts'
import { readJsonFile, writeJsonFile } from './json-file.ts'
import { isoDate, isRecord, text } from './song-ref.ts'

/** The songs you played lately, kept in `<userData>/history.json` to suggest more of what you listen to. */

const MAX_PLAYS = 500
const FILE_VERSION = 1
/** The newest plays count double, so what you're into now outweighs what you played months ago. */
const RECENT_PLAYS = 30

export interface Play extends PlayedSong {
  playedAt: string
}

/** A song from the renderer or from disk; anything without a title is dropped. */
export function sanitizePlay(raw: unknown): Play | undefined {
  if (!isRecord(raw)) return undefined
  const title = text(raw.title, 300)
  if (!title) return undefined
  return {
    title,
    artist: text(raw.artist, 200),
    album: text(raw.album, 300),
    playedAt: isoDate(raw.playedAt) ?? new Date().toISOString()
  }
}

/** The artist as named first in a credit like "Artist, Guest" or "Artist feat. Guest". */
export const leadArtist = (credit: string): string => credit.split(/\s*(?:,|&|\bfeat\.?|\bft\.?|\bwith\b)\s*/i)[0]

const sameSong = (a: Play, b: Play) =>
  normalizeText(a.title) === normalizeText(b.title) && normalizeText(a.artist ?? '') === normalizeText(b.artist ?? '')

/** The last songs played, newest last; held in memory and written after every change (temp file + rename). */
export class PlayHistory {
  private readonly file: string
  private plays: Play[] = []

  constructor(file: string) {
    this.file = file
  }

  async load(): Promise<void> {
    const raw = await readJsonFile(this.file)
    const list = isRecord(raw) && Array.isArray(raw.plays) ? raw.plays : []
    this.plays = list
      .slice(-MAX_PLAYS)
      .map(sanitizePlay)
      .filter((play): play is Play => play !== undefined)
  }

  get size(): number {
    return this.plays.length
  }

  /** Remembers a play. The same song twice in a row (a replay or a restart) counts once. */
  async record(raw: unknown): Promise<void> {
    const play = sanitizePlay({ ...(isRecord(raw) ? raw : {}), playedAt: new Date().toISOString() })
    if (!play) return
    const last = this.plays.at(-1)
    if (last && sameSong(last, play)) this.plays[this.plays.length - 1] = play
    else this.plays.push(play)
    if (this.plays.length > MAX_PLAYS) this.plays.splice(0, this.plays.length - MAX_PLAYS)
    await this.persist()
  }

  async clear(): Promise<void> {
    this.plays = []
    await this.persist()
  }

  /** The artists played most (the newest plays weigh more), best first. */
  topArtists(limit: number): string[] {
    const scores = new Map<string, { name: string; score: number }>()
    this.plays.forEach((play, index) => {
      if (!play.artist) return
      const name = leadArtist(play.artist)
      const key = normalizeText(name)
      if (!key) return
      const entry = scores.get(key) ?? { name, score: 0 }
      entry.score += index >= this.plays.length - RECENT_PLAYS ? 2 : 1
      scores.set(key, entry)
    })
    return [...scores.values()]
      .sort((a, b) => b.score - a.score)
      .slice(0, limit)
      .map(entry => entry.name)
  }

  private async persist(): Promise<void> {
    const body = JSON.stringify({ version: FILE_VERSION, plays: this.plays })
    await writeJsonFile(this.file, body)
  }
}
