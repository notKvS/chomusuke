import type { Socket } from 'node:net'
import { Client, type SetActivity, StatusDisplayType } from '@xhayper/discord-rpc'
import type { DiscordStatus, NowPlaying } from '../shared/types.ts'
import { logger } from './log.ts'
import type { CoverWanted } from './providers/covers.ts'
import { isRecord, text } from './song-ref.ts'

const log = logger('discord')

/** Chomusuke's application in the Discord developer portal; its name is the "Listening to …" heading. */
const CLIENT_ID = '1566140226764537896'
const RELEASES_URL = 'https://github.com/notKvS/chomusuke/releases/latest'
/** For albums without a cover Discord can load (covers from inside a torrent are served from localhost). */
const LOGO_URL = 'https://raw.githubusercontent.com/notKvS/chomusuke/master/build/icon.png'
/** Gathers quick changes (skipping through tracks) into one update; Discord allows 5 per 20 seconds. */
const SEND_DELAY_MS = 1500
/** How long to wait before looking for Discord again when it isn't running. */
const RETRY_MS = 30_000
const MAX_IMAGE_URL = 256

const errorMessage = (err: unknown): string => (err instanceof Error ? err.message : String(err))
/** Longest the cover lookup may hold up a status update. */
const COVER_TIMEOUT_MS = 5000

/** Finds a public cover for a song whose own cover only exists on this computer (see CoverFinder.find). */
export type FindCover = (wanted: CoverWanted, signal?: AbortSignal) => Promise<string | undefined>

function coverUrl(value: unknown): string | undefined {
  if (typeof value !== 'string' || value.length > MAX_IMAGE_URL) return undefined
  try {
    const url = new URL(value)
    return url.protocol === 'https:' && !url.username && !url.password ? url.toString() : undefined
  } catch {
    return undefined
  }
}

const seconds = (value: unknown) => (typeof value === 'number' && Number.isFinite(value) && value > 0 ? value : 0)

/** The song the renderer says is playing; null when nothing is (or it sent something unusable). */
export function sanitizeNowPlaying(raw: unknown): NowPlaying | null {
  if (!isRecord(raw)) return null
  const title = text(raw.title, 300)
  if (!title) return null
  return {
    title,
    artist: text(raw.artist, 200),
    album: text(raw.album, 300),
    coverUrl: coverUrl(raw.coverUrl),
    playing: raw.playing === true,
    position: seconds(raw.position),
    duration: seconds(raw.duration)
  }
}

/**
 * Discord loads covers from the web, so a cover that lives inside the torrent (served from localhost) can't be used.
 * Such a song gets its cover from a music catalogue instead, by title and then by album; none found keeps the logo.
 */
export async function resolveCover(song: NowPlaying, find: FindCover | undefined): Promise<NowPlaying> {
  const { artist, album } = song
  if (song.coverUrl || !artist || !find) return song
  const signal = AbortSignal.timeout(COVER_TIMEOUT_MS)
  const attempts: CoverWanted[] = [{ kind: 'song', title: song.title, artist }]
  if (album) attempts.push({ kind: 'album', title: album, artist })
  for (const wanted of attempts) {
    const found = coverUrl(await find(wanted, signal).catch(() => undefined))
    if (found) return { ...song, coverUrl: found }
  }
  return song
}

/** Discord's text fields take 2–128 characters. */
function field(value: string): string {
  return (value.length > 128 ? `${value.slice(0, 127)}…` : value).padEnd(2, '​')
}

/** The Discord status for a playing song that was at `position` at time `at` (ms). */
export function toActivity(song: NowPlaying, at: number): SetActivity {
  const byline = song.artist ? `by ${song.artist}` : song.album
  const activity: SetActivity = {
    type: 2, // Listening
    // The member list shows the song instead of "Chomusuke".
    statusDisplayType: StatusDisplayType.DETAILS,
    details: field(song.title),
    state: byline && field(byline),
    largeImageKey: song.coverUrl ?? LOGO_URL,
    largeImageText: field(song.album ?? 'Chomusuke'),
    buttons: [{ label: 'Get Chomusuke', url: RELEASES_URL }]
  }
  // Discord counts the progress bar on from the start time by itself.
  if (song.duration > 0) {
    activity.startTimestamp = Math.round(at - song.position * 1000)
    activity.endTimestamp = activity.startTimestamp + Math.round(song.duration * 1000)
  }
  return activity
}

/** Keeps the Discord status in step with the player; quietly does nothing while Discord isn't running. */
export class DiscordPresence {
  private enabled = false
  private song: { song: NowPlaying; at: number } | null = null
  private client: Client | null = null
  private timer: NodeJS.Timeout | undefined
  private sending = false
  private resend = false
  private readonly findCover: FindCover | undefined
  private status: DiscordStatus = { kind: 'off' }

  constructor(findCover?: FindCover) {
    this.findCover = findCover
  }

  setEnabled(enabled: boolean): void {
    if (enabled === this.enabled) return
    this.enabled = enabled
    this.status = enabled ? { kind: 'idle' } : { kind: 'off' }
    if (enabled) this.schedule(0)
    else void this.disconnect()
  }

  update(song: NowPlaying | null): void {
    this.song = song && { song, at: Date.now() }
    this.schedule(SEND_DELAY_MS)
  }

  dispose(): Promise<void> {
    this.enabled = false
    return this.disconnect()
  }

  private schedule(delay: number): void {
    clearTimeout(this.timer)
    if (this.enabled) this.timer = setTimeout(() => void this.flush(), delay)
  }

  /** Sends the latest song; a change that arrives mid-send goes out right after. */
  private async flush(): Promise<void> {
    if (this.sending) {
      this.resend = true
      return
    }
    this.sending = true
    try {
      await this.send()
    } finally {
      this.sending = false
    }
    if (this.resend) {
      this.resend = false
      void this.flush()
    }
  }

  private async send(): Promise<void> {
    const wanted = this.song
    // A paused song shows nothing: Discord can't freeze its progress bar, and without one it runs a timer instead.
    const showing = wanted?.song.playing ? wanted : null
    // Nothing to show and nothing shown: no reason to connect.
    if (!this.enabled || (!showing && !this.client)) return
    let client: Client
    try {
      client = this.client ?? (await this.connect())
    } catch (err) {
      // Discord isn't running (or only its web version is): look again later.
      this.setStatus({ kind: 'not-running' }, err)
      void this.disconnect()
      if (this.song) this.schedule(RETRY_MS)
      return
    }
    if (!this.enabled) {
      // Turned off while connecting.
      await this.disconnect()
      return
    }
    try {
      if (!client.user) throw new Error('Discord connected but did not say which account this is.')
      if (showing) {
        const song = await resolveCover(showing.song, this.findCover)
        // Another song came along while the cover was looked up: its own update is already on the way.
        if (this.song !== wanted) return
        await client.user.setActivity(toActivity(song, showing.at))
      } else await client.user.clearActivity()
      this.setStatus({ kind: 'connected' })
    } catch (err) {
      // Discord answered with an error, or quit mid-update. Reconnect on the next song (or in a while).
      this.setStatus({ kind: 'refused', message: errorMessage(err) }, err)
      void this.disconnect()
      if (this.song) this.schedule(RETRY_MS)
    }
  }

  /** What the Settings page shows about the connection. */
  current(): DiscordStatus {
    return this.status
  }

  /** Logs a problem once, not on every retry. */
  private setStatus(status: DiscordStatus, cause?: unknown): void {
    const same =
      status.kind === this.status.kind &&
      (status as { message?: string }).message === (this.status as { message?: string }).message
    this.status = status
    if (same) return
    if (cause !== undefined) log.warn(`${status.kind}: ${errorMessage(cause)}`)
    else log.info(`status: ${status.kind}`)
  }

  private async connect(): Promise<Client> {
    const client = new Client({ clientId: CLIENT_ID, transport: { type: 'ipc' } })
    client.on('disconnected', () => {
      if (this.client !== client) return
      this.client = null
      // Discord quit: show the song again once it's back.
      if (this.enabled) this.status = { kind: 'not-running' }
      if (this.song) this.schedule(RETRY_MS)
    })
    try {
      await client.login()
    } catch (err) {
      void client.destroy().catch(() => {})
      throw err
    }
    // The library only listens for socket errors while connecting; an unheard one (Discord crashing) would crash
    // the app. The socket closes right after, which the library already handles.
    ;(client.transport as unknown as { socket?: Socket }).socket?.on('error', () => {})
    this.client = client
    return client
  }

  private async disconnect(): Promise<void> {
    clearTimeout(this.timer)
    const client = this.client
    this.client = null
    if (!client) return
    await client.user?.clearActivity().catch(() => {})
    await client.destroy().catch(() => {})
  }
}
