# Chomusuke

A desktop music player that streams audio straight from torrents. Search, browse, pick a song, and it starts
playing while only the pieces you need are downloaded. Hosted by Chomusuke, a small fire-breathing cat with a
fish, in a night-violet anime theme.

## Features

- **Play from any torrent** — paste a magnet link, a 40-character info hash or an https `.torrent` URL, or open a
  `.torrent` file. The torrent becomes an album: one track per song, track numbers and titles from file names,
  artist and cover art picked up automatically.
- **Instant streaming** — playback starts as soon as the first pieces arrive; seeking jumps straight to the
  right part of the file.
- **Search** across every enabled source at once, with albums and songs side by side.
- **Explore** each source by category: trending this week, top charts, lossless, live concerts, genres.
- **Sources you control** (*Sources* page):
  - **Internet Archive** — built in; millions of freely licensed recordings with web seeds, so they play even
    when no peers are online.
  - **Torznab indexers** — connect any indexer that speaks Torznab, the standard torrent search API, and search
    the trackers you've configured there. API keys are encrypted with the OS credential store.
  - **Extensions** — sources written in TypeScript that run in an isolated sandbox. Install more from a
    repository URL.
- **Bundled extensions**
  - On by default: Live Music Archive, Jamendo, Free Music Archive, Netlabels, Great 78 Project, Public Domain
    Classical.
  - Templates, installed **off**: The Pirate Bay, 1337x, Nyaa (audio), Knaben, LimeTorrents. Switch one on
    under *Sources* and press **Test**. You are responsible for what you stream.
- **Player** — queue through an album, media keys and the OS media controls, remembered volume and a smooth
  seek bar.
- **Anime look** — animated mascot logo (click it), splash and loading scenes, drifting sakura petals; all
  motion respects the system's reduced-motion setting.

## Run it

Requires Node.js 22.12+.

```sh
npm install      # lifecycle scripts are disabled in .npmrc on purpose
npm run setup    # fetches the Electron binary and the prebuilt WebRTC addon
npm run dev      # dev mode with hot reload
```

| Script | What it does |
|---|---|
| `npm run build` | Production bundle in `out/` |
| `npm start` | Runs the built app |
| `npm test` | Unit tests (Node's built-in runner), including offline tests for every bundled extension |
| `npm run typecheck` | Type-checks the main process, the UI and the extensions |
| `npm run build:extensions` | Bundles `extensions/src/*.ts` into `extensions/dist/` (run automatically by dev/build/start) |

## How it works

- **Main process** (`src/main`) runs the [WebTorrent](https://webtorrent.io) engine. Torrents are added with
  every piece deselected; streaming a track selects just the byte range being played.
- **Stream server** (`src/main/stream-server.ts`) listens on `127.0.0.1` on a random port and serves only the
  audio and cover files of loaded torrents, with HTTP Range support for seeking. Every URL carries a random
  per-launch token, and requests with a foreign `Host` are refused.
- **Library** (`src/main/library.ts`) turns a file list into an album: one track per song (MP3 preferred when
  the same song exists in several formats), padding files skipped, cover image chosen.
- **Providers** (`src/main/providers/`) turn a query or an Explore category into results and a chosen result
  into a torrent. Results reach the UI as opaque ids; links are only resolved in the main process.
- **Extensions** (`src/main/extensions/`) each run in a hidden, sandboxed window with an in-memory session; the
  code runs in a Web Worker and may only reach the https hosts its manifest declares. Results are re-validated,
  magnets are rebuilt with only the hash, name and public trackers, and LAN addresses are stripped from
  `.torrent` files. Code is pinned by SHA-256.
- **Renderer** (`src/renderer`) is React in a sandboxed, context-isolated window with a strict CSP. It only
  reaches the main process through the functions in `src/preload/index.ts`.

Downloaded pieces live in a session cache under the OS temp folder, wiped on launch and on quit.
UPnP/NAT-PMP port mapping and uTP are off; peers are reached over TCP and web seeds.

See [docs/sources.md](docs/sources.md) for the sources and templates in detail, and how to write an extension
or add a provider.

## Project layout

```
src/main/            Electron main process: torrent engine, stream server, providers, extension sandbox
src/preload/         The narrow bridges exposed to the UI and to the extension sandbox
src/renderer/        React UI, theme (styles.css, anime.css) and mascot artwork
src/shared/          Types shared by main and renderer
extensions/          Bundled extensions: index.json (manifests), src/ (TypeScript), test/ (offline tests)
build/               App icons
docs/                Sources and extension guide
```
