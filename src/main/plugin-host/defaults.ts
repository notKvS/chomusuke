// Plugins shipped with the app: written in TypeScript (plugins/src), bundled by `npm run build:plugins`
// into plugins/dist, and embedded into the main bundle at build time.
// Installed on first launch and refreshed when the bundled version changes; users can still disable or remove them.
// The tracker templates (The Pirate Bay … LimeTorrents) install switched off: see docs/sources.md.
// The charts (Spotify, YouTube Music, Apple Music, ListenBrainz) list top albums/songs for Explore and play them
// through the providers.

import x1337x from '../../../plugins/dist/1337x.js?raw'
import appleMusicCharts from '../../../plugins/dist/apple-music-charts.js?raw'
import audius from '../../../plugins/dist/audius.js?raw'

import freeMusicArchive from '../../../plugins/dist/free-music-archive.js?raw'
import great78 from '../../../plugins/dist/great-78.js?raw'
import jamendo from '../../../plugins/dist/jamendo.js?raw'
import jiosaavn from '../../../plugins/dist/jiosaavn.js?raw'
import knaben from '../../../plugins/dist/knaben.js?raw'
import limetorrents from '../../../plugins/dist/limetorrents.js?raw'
import listenbrainzCharts from '../../../plugins/dist/listenbrainz-charts.js?raw'
import liveMusicArchive from '../../../plugins/dist/live-music-archive.js?raw'
import netlabels from '../../../plugins/dist/netlabels.js?raw'
import nyaa from '../../../plugins/dist/nyaa.js?raw'
import publicDomainClassical from '../../../plugins/dist/public-domain-classical.js?raw'
import rutor from '../../../plugins/dist/rutor.js?raw'
import rutracker from '../../../plugins/dist/rutracker.js?raw'
import soundcloud from '../../../plugins/dist/soundcloud.js?raw'
import spotifyCharts from '../../../plugins/dist/spotify-charts.js?raw'
import thePirateBay from '../../../plugins/dist/the-pirate-bay.js?raw'
import youtubeMusic from '../../../plugins/dist/youtube-music.js?raw'
import youtubeMusicCharts from '../../../plugins/dist/youtube-music-charts.js?raw'
import repository from '../../../plugins/index.json?raw'
import { type PluginManifest, parseRepository } from './manifest.ts'

/** Pseudo repository URL for bundled plugins (`.invalid` never resolves, so it can't be fetched). */
export const BUNDLED_REPOSITORY = 'https://bundled.chomusuke.invalid/plugins/index.json'

const CODE: Record<string, string> = {
  '1337x.js': x1337x,
  'apple-music-charts.js': appleMusicCharts,
  'audius.js': audius,
  'free-music-archive.js': freeMusicArchive,
  'great-78.js': great78,
  'jamendo.js': jamendo,
  'jiosaavn.js': jiosaavn,
  'knaben.js': knaben,
  'limetorrents.js': limetorrents,
  'listenbrainz-charts.js': listenbrainzCharts,
  'live-music-archive.js': liveMusicArchive,
  'netlabels.js': netlabels,
  'nyaa.js': nyaa,
  'public-domain-classical.js': publicDomainClassical,
  'rutor.js': rutor,
  'rutracker.js': rutracker,
  'soundcloud.js': soundcloud,
  'spotify-charts.js': spotifyCharts,
  'the-pirate-bay.js': thePirateBay,
  'youtube-music-charts.js': youtubeMusicCharts,
  'youtube-music.js': youtubeMusic
}

/** The plugins shipped in the app bundle, validated like any repository; entries without bundled code are skipped. */
export function bundledPlugins(): Array<{ manifest: PluginManifest; code: string }> {
  return parseRepository(JSON.parse(repository), BUNDLED_REPOSITORY).flatMap(manifest => {
    const code = CODE[new URL(manifest.codeUrl).pathname.split('/').pop() ?? '']
    return code ? [{ manifest, code }] : []
  })
}
