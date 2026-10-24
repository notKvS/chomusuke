// Extensions shipped with the app: written in TypeScript (extensions/src), bundled by `npm run build:extensions`
// into extensions/dist, and embedded into the main bundle at build time.
// Installed on first launch and refreshed when the bundled version changes; users can still disable or remove them.
import repository from '../../../extensions/index.json?raw'
import freeMusicArchive from '../../../extensions/dist/free-music-archive.js?raw'
import great78 from '../../../extensions/dist/great-78.js?raw'
import jamendo from '../../../extensions/dist/jamendo.js?raw'
import liveMusicArchive from '../../../extensions/dist/live-music-archive.js?raw'
import netlabels from '../../../extensions/dist/netlabels.js?raw'
import publicDomainClassical from '../../../extensions/dist/public-domain-classical.js?raw'
import { parseRepository, type ExtensionManifest } from './manifest.ts'

/** Pseudo repository URL for bundled extensions (`.invalid` never resolves, so it can't be fetched). */
export const BUNDLED_REPOSITORY = 'https://bundled.chomusuke.invalid/extensions/index.json'

const CODE: Record<string, string> = {
  'free-music-archive.js': freeMusicArchive,
  'great-78.js': great78,
  'jamendo.js': jamendo,
  'live-music-archive.js': liveMusicArchive,
  'netlabels.js': netlabels,
  'public-domain-classical.js': publicDomainClassical
}

export function bundledExtensions(): Array<{ manifest: ExtensionManifest; code: string }> {
  return parseRepository(JSON.parse(repository), BUNDLED_REPOSITORY).flatMap(manifest => {
    const code = CODE[new URL(manifest.codeUrl).pathname.split('/').pop() ?? '']
    return code ? [{ manifest, code }] : []
  })
}
