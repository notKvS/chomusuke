// Extensions shipped with the app: written in TypeScript (extensions/src), bundled by `npm run build:extensions`
// into extensions/dist, and embedded into the main bundle at build time.
// Installed on first launch and refreshed when the bundled version changes; users can still disable or remove them.
// The tracker templates (The Pirate Bay … LimeTorrents) install switched off: see docs/sources.md.

import x1337x from '../../../extensions/dist/1337x.js?raw'
import freeMusicArchive from '../../../extensions/dist/free-music-archive.js?raw'
import great78 from '../../../extensions/dist/great-78.js?raw'
import jamendo from '../../../extensions/dist/jamendo.js?raw'
import knaben from '../../../extensions/dist/knaben.js?raw'
import limetorrents from '../../../extensions/dist/limetorrents.js?raw'
import liveMusicArchive from '../../../extensions/dist/live-music-archive.js?raw'
import netlabels from '../../../extensions/dist/netlabels.js?raw'
import nyaa from '../../../extensions/dist/nyaa.js?raw'
import publicDomainClassical from '../../../extensions/dist/public-domain-classical.js?raw'
import thePirateBay from '../../../extensions/dist/the-pirate-bay.js?raw'
import repository from '../../../extensions/index.json?raw'
import { type ExtensionManifest, parseRepository } from './manifest.ts'

/** Pseudo repository URL for bundled extensions (`.invalid` never resolves, so it can't be fetched). */
export const BUNDLED_REPOSITORY = 'https://bundled.chomusuke.invalid/extensions/index.json'

const CODE: Record<string, string> = {
  '1337x.js': x1337x,
  'free-music-archive.js': freeMusicArchive,
  'great-78.js': great78,
  'jamendo.js': jamendo,
  'knaben.js': knaben,
  'limetorrents.js': limetorrents,
  'live-music-archive.js': liveMusicArchive,
  'netlabels.js': netlabels,
  'nyaa.js': nyaa,
  'public-domain-classical.js': publicDomainClassical,
  'the-pirate-bay.js': thePirateBay
}

export function bundledExtensions(): Array<{ manifest: ExtensionManifest; code: string }> {
  return parseRepository(JSON.parse(repository), BUNDLED_REPOSITORY).flatMap(manifest => {
    const code = CODE[new URL(manifest.codeUrl).pathname.split('/').pop() ?? '']
    return code ? [{ manifest, code }] : []
  })
}
