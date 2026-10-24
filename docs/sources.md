# Search & explore sources

Chomusuke searches and browses through **providers** (`src/main/providers/`). Each turns a query (or an
Explore category) into albums/songs and turns a chosen album into a torrent to play.

| Provider | How it works | Explore categories |
|---|---|---|
| Internet Archive (built in) | HTTP API → `.torrent` with web seeds | Trending this week, live concerts, netlabels, 78s, classical, jazz |
| Torznab indexers (Jackett, Prowlarr, BitMagnet…) | Torznab XML API → magnet / `.torrent` | Popular audio, MP3, Lossless, Other audio (newest releases ranked by seeders) |
| Extensions | Third-party JS modules in a sandbox → magnet / `.torrent` | Whatever the extension declares |

**Bundled extensions** (TypeScript in `extensions/src/`, embedded at build time by `src/main/extensions/defaults.ts`, installed on
first launch, updated when the shipped code changes, never reinstalled once you remove one):

| Extension | Catalogue | Explore categories |
|---|---|---|
| Live Music Archive | Trade-friendly concert recordings (etree) | Trending, recently added, all-time |
| Jamendo | ~300k Creative Commons albums | Trending, most played, electronic, rock, hip-hop |
| Free Music Archive | Curated free/CC independent music | Trending, most played, recently added |
| Netlabels | CC releases from online labels | Trending, most played, ambient, techno & house, experimental |
| Great 78 Project | 78 rpm records, 1898–1950s | Trending, jazz, blues, country, opera & classical |
| Public Domain Classical | Musopen and public-domain classical | Trending, most played, Musopen, piano |

All are mirrored on the Internet Archive, so their torrents carry web seeds and play without peers.

## How other apps do it: Hayase

[Hayase](https://github.com/hayase-app) (formerly Miru), a WebTorrent-based anime streaming app, ships **no
sources at all**. It is "bring your own content": users import an *extension repository* (a JSON manifest URL)
and each extension, a bundled ES module running in a sandboxed Web Worker, scrapes a site and returns
`{ hash, link, title, size, seeders, leechers }`. The manifest declares the site's URL so the app can enable CORS
for it, plus user options such as API keys. Their official example extension only lists public-domain torrents;
tracker-specific extensions come from community repositories. Hayase also supports HTTP, NZB and subtitle
extension types.

Chomusuke follows the same model:

- **Extensions** — `src/main/extensions/`. Format documented at the top of `manifest.ts`; sources in
  `extensions/src/`. Each extension runs in its own hidden, sandboxed Electron window with an
  in-memory session; its code is loaded into a module Web Worker. The session only lets it reach `https://` on
  the hosts its manifest declares (everything else, including loopback/LAN and plain http, is cancelled), and
  CORS headers are added for those hosts. Results are re-validated in the main process; `.torrent` downloads may
  only come from declared hosts (https, default port), magnets are rebuilt with only the hash, name and public
  trackers/web seeds, and LAN endpoints are stripped from `.torrent` files. Code is pinned by SHA-256; saved
  secrets only carry over to updates from the same repository with the same hosts.
  Known limits: like Hayase, an extension can still fetch more code from its own declared hosts at run time, so
  the checksum covers what you installed, not everything it may run; and in `npm run dev` the sandbox page is
  served by the Vite dev server, so only install untrusted extensions in a built app (`npm start`).
- **Torznab** — the standard indexer API (Lidarr, Sonarr…). Jackett and Prowlarr expose hundreds of public
  and private trackers through it, so this is the route to any tracker without app-specific code.

## Well-known audio torrent trackers

From FMHY (`docs/audio.md` → *Audio Torrenting*, *Concerts*; `docs/torrenting.md`) and general knowledge:

| Tracker | Type | Reachable via |
|---|---|---|
| Redacted (RED), Orpheus (OPS) | Private, invite-only; MP3/FLAC | Prowlarr / Jackett (API key). **Client whitelists apply** — WebTorrent is not an approved client, so streaming from them risks your account. |
| New-Team | Private; MP3/FLAC | Jackett (where supported) |
| RuTracker | Semi-private (free account); huge music section | Prowlarr / Jackett |
| The Pirate Bay (Music), 1337x, LimeTorrents, Knaben, ext.to | Public general trackers / aggregators | Prowlarr / Jackett |
| Nyaa (Audio) | Public; anime/J-music, lossless | Prowlarr / Jackett |
| Metal-Tracker, BlackTorrent, MixtapeTorrent, PandaCD | Genre-specific | Jackett for some; otherwise an extension |
| BitMagnet | Self-hosted DHT crawler | Its built-in Torznab endpoint |
| bt.etree.org, etreedb, TheTradersDen | Trade-friendly live recordings | Extension (site scraping / RSS) |
| Internet Archive / Live Music Archive | Legal, web-seeded | Built in / bundled example extension |

Chomusuke does not ship integrations for specific trackers; connect them through Torznab or an extension you
choose. Only download what you have the right to.

## Writing an extension

Extensions are written in TypeScript:

1. Add `extensions/src/<id>.ts` whose default export implements `Extension` from `extensions/src/sdk.ts`
   (`search`, optional `browse` and `test`). For an Internet Archive collection, `archiveCollection()` in
   `extensions/src/lib/` does it in a few lines.
2. Add its manifest entry to `extensions/index.json` (`"code": "<id>.js"`, the hosts it may reach, categories,
   options). To ship it with the app, also add it to `src/main/extensions/defaults.ts`.
3. `npm run build:extensions` bundles each source into one standalone ES module in `extensions/dist/` (git-ignored;
   `npm run dev`/`build`/`start` run it automatically). `npm run typecheck` checks extensions against the
   Web Worker environment they run in (no DOM, no Node).

To publish third-party extensions, host `index.json` plus the built `.js` files over https and import the
manifest URL under *Sources*. The sandbox runs JavaScript, so a repository serves the compiled output — the same
as Hayase's "must be bundled" rule.

## Adding a built-in provider

1. Implement `MusicProvider` (`providers/types.ts`): `search()`, `open()`, optionally `categories` + `browse()`.
   Keep anything needed to open an album in `album.ref` — it never leaves the main process.
2. Add settings (with secrets through `SecretBox`) in `providers/settings.ts` and a form in `SourcesView.tsx`.
3. Map settings → implementation in `providers/index.ts`.
4. Network access only through `http.ts` (https, size caps, timeouts, host allow-lists).

**Direct HTTP streams** (Audius, Jamendo, Funkwhale…) would need a new `Playable` kind and a playback backend
next to `TorrentEngine` that proxies range requests; the stream server and player stay as they are.

## Other candidates (from FMHY)

- **HTTP streaming APIs:** Audius (keyless), Jamendo (free client id), Funkwhale (self-hosted), Relisten (live
  recordings), Free Music Archive, Mirlo.
- **Not suitable:** YouTube Music / Spotify / Deezer / SoundCloud clients and rippers (no torrent or open API; terms
  forbid it), Telegram bots, Soulseek (different protocol).
