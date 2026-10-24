# Chomusuke

A desktop music player that streams audio straight from torrents, with a YouTube Music–style UI.
Paste a magnet link, a 40-character info hash or an https `.torrent` URL (or open a `.torrent` file),
pick a song, and it starts playing while only the pieces you need are downloaded.

## Run it

Requires Node.js 22.12+.

```sh
npm install      # lifecycle scripts are disabled in .npmrc on purpose
npm run setup    # fetches the Electron binary and node-datachannel's prebuilt WebRTC addon
npm run dev      # dev mode with hot reload
```

Other scripts: `npm run build` (production bundle in `out/`), `npm start` (run the built app),
`npm test` (unit tests via Node's built-in runner), `npm run typecheck`.

## How it works

- **Main process** (`src/main`) runs [WebTorrent](https://webtorrent.io). Torrents are added with every
  piece deselected; streaming a track creates a prioritised piece selection for just that byte range.
- **Stream server** (`src/main/stream-server.ts`) listens on `127.0.0.1` on a random port and serves only the
  audio and cover files of loaded torrents, with HTTP Range support so the `<audio>` element can seek.
  Each launch generates a random token that every URL must carry, and requests with a foreign `Host` are refused.
- **Library** (`src/main/library.ts`) turns a torrent's file list into an album: one track per song (preferring
  MP3 when the same song exists in several formats), track numbers and titles from file names, a common
  `Artist - ` prefix lifted into the artist, and a cover image.
- **Renderer** (`src/renderer`) is React in a sandboxed, context-isolated window. It only reaches the main
  process through the narrow functions in `src/preload/index.ts`.
- **Search** (`src/main/providers/`) fans a query out to every enabled provider:
  - the **Internet Archive** (built in): albums from its search API, songs from the top items' file tags;
  - **Torznab indexers** you add under *Sources*: Jackett, Prowlarr, BitMagnet or anything else that speaks
    Torznab, so you can search whichever trackers you've configured there. API keys are encrypted with the OS
    credential store (Electron `safeStorage`) and never reach the renderer.

  - **Extensions** (Hayase-style): import a repository manifest URL under *Sources*; each extension runs in an
    isolated sandbox that can only reach the https hosts it declares. Six bundled ones (written in TypeScript) live in [`extensions/src/`](extensions/src/).

  Results come back as opaque ids; opening one turns it into a magnet or `.torrent` in the main process.
- **Explore** browses every source by category (trending this week, live concerts, MP3/Lossless from your
  indexers, whatever an extension offers).

See [docs/sources.md](docs/sources.md) for how this compares to Hayase, well-known audio trackers and how to reach
them, and how to add providers or write extensions.

Downloaded pieces live in a session cache under the OS temp folder, wiped on launch and on quit.

## Notes

- The featured albums on the home screen are freely licensed (Creative Commons) releases hosted by the
  Internet Archive. Their torrents include HTTP web seeds, so they play even when no peers are online.
- Only stream content you have the right to download and share.
- UPnP/NAT-PMP port mapping and uTP are turned off; peers are reached over TCP and web seeds.
