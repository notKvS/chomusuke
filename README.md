# 🐈‍⬛ Chomusuke

Desktop music player that streams audio straight from torrents 🎶

## ✨ Features

- 🧲 **Play any torrent** — magnet link, info hash, https `.torrent` URL or a local `.torrent` file, shown as an album
  with tracks, artist and cover.
- ▶️ **Streaming playback** — starts as soon as the first pieces arrive; seeking, album queue, media keys and OS media
  controls.
- 🔍 **Search** across all enabled sources at once.
- 🧭 **Explore** each source by category (trending, top charts, lossless, genres…).
- 🔌 **Sources**
  - Internet Archive (built in).
  - Torznab indexers, with API keys stored in the OS credential store.
  - Extensions: TypeScript sources running in a sandbox. Six Internet Archive collections are bundled and on; five
    public-tracker templates (The Pirate Bay, 1337x, Nyaa, Knaben, LimeTorrents) are bundled and off.
- 📄 **Torrent details** — files, trackers, pieces, peers and transfer stats; save the `.torrent` file or copy the
  magnet link.
- 💾 **Library & seeding** — keep albums (downloaded in full, playable offline) and keep what you stream within a disk
  limit; both are seeded to other listeners. Sharing is on by default and can be switched off, with an upload speed
  limit.
- 👍 **Like & dislike** — rate songs from the track list or the player; disliked songs are skipped when an album
  plays on. Ratings follow the song across sources (same torrent file, or same artist + title in another
  release). *Liked songs* page plays them again; **backup export/import** moves ratings, kept albums and
  appearance to Chomusuke on another computer.
- 🎨 **Appearance** — preset themes (dark and light) or custom colours, backgrounds, glass panels, buttons, fonts,
  interface size and effects.
- ↔️ **Navigation** — back/forward buttons, Alt+←/→ and mouse side buttons.

## 🏗️ Architecture

| Part | Location | Role |
|---|---|---|
| Main process | `src/main/index.ts` | App lifecycle, window, IPC handlers |
| Torrent engine | `src/main/engine.ts` | WebTorrent client; adds torrents with nothing selected, streams byte ranges on demand, sharing on/off |
| Stream server | `src/main/stream-server.ts` | Loopback HTTP server (random port, per-launch token) serving audio with Range support to the player |
| Album builder | `src/main/library.ts` | Turns a torrent's file list into an album (tracks, titles, cover) |
| Providers | `src/main/providers/` | Internet Archive, Torznab and extension sources: search, browse, open a result as a torrent |
| Extension host | `src/main/extension-host/` | Validates extension manifests and runs each extension in a sandboxed window limited to its declared hosts |
| Ratings & backup | `src/main/ratings.ts`, `src/main/backup.ts`, `src/shared/fingerprint.ts` | Liked/disliked songs (`<userData>/ratings.json`), song matching across torrents, backup file |
| Seeding library | `src/main/seeding.ts` | Kept and streamed albums on disk (`<userData>/library/`), sharing settings, space limit |
| Preload | `src/preload/` | The only bridge between the UI (and extension sandbox) and the main process |
| UI | `src/renderer/` | React app: pages, player, theme engine (`src/theme/`), styles |
| Shared types | `src/shared/types.ts` | Types used by main, preload and UI |
| Extensions | `extensions/` | Bundled extension sources (`src/`), manifests (`index.json`), build script and tests |

Streamed pieces go to a session cache in the OS temp folder, cleared on launch and quit; kept and streamed albums
are moved into the library on quit. More on sources and writing extensions: [docs/sources.md](docs/sources.md).

## 🚀 Getting started

Requires Node.js 22.12+.

```sh
npm install      # install dependencies (lifecycle scripts are disabled in .npmrc)
npm run setup    # download the Electron binary and the native WebRTC addon
npm run dev      # start the app with hot reload
```

| Script | What it does |
|---|---|
| `npm run setup` | Downloads Electron and the prebuilt `node-datachannel` addon (run once after install) |
| `npm run dev` | Builds extensions and starts the app in development mode with hot reload |
| `npm run build` | Builds extensions and the production bundle into `out/` |
| `npm start` | Builds extensions and runs the production bundle |
| `npm run build:extensions` | Bundles `extensions/src/*.ts` into `extensions/dist/` |
| `npm test` | Runs the unit tests |
| `npm run typecheck` | Type-checks main process, UI and extensions |
| `npm run lint` | Checks formatting, lint rules and import order (Biome) |
| `npm run fix` | Formats all files and applies safe lint fixes (Biome) |
| `npm run format` | Formats all files (Biome) |
| `npm run dist` | Builds installers for the current OS into `release/` |
| `npm run dist:dir` | Builds an unpacked app into `release/` |

With the recommended Biome extension, VS Code formats and fixes files on save.

## ⬇️ Download

Get the latest build from **[Releases → Latest](https://github.com/notKvS/chomusuke/releases/latest)** (under
*Assets*):

| System | File |
|---|---|
| 🪟 Windows | `Chomusuke-<version>-win-x64.exe` (installer) or `-win-x64.zip` (portable) |
| 🍎 macOS (Apple silicon) | `Chomusuke-<version>-mac-arm64.dmg` |
| 🐧 Linux | `Chomusuke-<version>-linux-x86_64.AppImage` or `-linux-amd64.deb` |

Builds are unsigned: on Windows choose *More info → Run anyway*; on macOS right-click the app → *Open* the first
time.

## 📦 Releases

Each push to `master` runs `.github/workflows/release.yml`: lint, typecheck and tests, then builds for Windows,
macOS and Linux and publishes them as the latest GitHub release. Pushing a `v*` tag (e.g. `v0.2.0`) publishes a
release with that version. Packaging is configured in `electron-builder.yml`.
