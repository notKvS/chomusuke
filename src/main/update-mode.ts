// How this copy of the app can update itself. Pure (no Electron), so it runs in unit tests.

/** Where releases are published (electron-builder.yml `publish`). */
export const RELEASES_URL = 'https://github.com/notKvS/chomusuke/releases'

/**
 * - `auto`: download in the background, then restart to install (Windows installer, AppImage).
 * - `notify`: only say a new version is out and link its release page (macOS until builds are signed — it refuses
 *   unsigned updates — plus the Windows zip and the .deb, which can't replace themselves).
 * - `off`: never check (running from source).
 */
export type UpdateMode = 'auto' | 'notify' | 'off'

export interface InstallInfo {
  isPackaged: boolean
  platform: NodeJS.Platform
  /** Installed by the NSIS installer (its uninstaller sits next to the exe), not unpacked from the zip. */
  nsisInstalled: boolean
  /** Running as an AppImage (`APPIMAGE` is set). */
  appImage: boolean
}

export function updateMode({ isPackaged, platform, nsisInstalled, appImage }: InstallInfo): UpdateMode {
  if (!isPackaged) return 'off'
  if (platform === 'win32') return nsisInstalled ? 'auto' : 'notify'
  if (platform === 'linux') return appImage ? 'auto' : 'notify'
  if (platform === 'darwin') return 'notify'
  return 'off'
}

/** The release page for a version; the releases list when the version doesn't look like X.Y.Z. */
export function releasePageUrl(version: string): string {
  return /^\d+\.\d+\.\d+$/.test(version) ? `${RELEASES_URL}/tag/v${version}` : RELEASES_URL
}
