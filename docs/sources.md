# Sources & extensions

Chomusuke searches and browses through **providers** (`src/main/providers/`). Each one turns a query (or an
Explore category) into albums/songs, and turns a chosen album into a torrent to play.

| Provider | How it works | Explore categories |
|---|---|---|
| Internet Archive (built in) | HTTP API → `.torrent` with web seeds | Trending this week, live concerts, netlabels, 78s, classical, jazz |
| Torznab indexers | Torznab XML API → magnet / `.torrent` | Popular audio, MP3, Lossless, Other audio (newest releases ranked by seeders) |
| Extensions | TypeScript modules in a sandbox → magnet / `.torrent` | Whatever the extension declares |

## Bundled extensions

Written in TypeScript in `extensions/src/`, embedded at build time by `src/main/extension-host/defaults.ts`, installed
on first launch, updated when the shipped code changes, and never reinstalled once you remove one.

### On by default

| Extension | Catalogue | Explore categories |
|---|---|---|
| Live Music Archive | Trade-friendly concert recordings | Trending, recently added, all-time |
| Jamendo | ~300k Creative Commons albums | Trending, most played, electronic, rock, hip-hop |
| Free Music Archive | Curated free/CC independent music | Trending, most played, recently added |
| Netlabels | CC releases from online labels | Trending, most played, ambient, techno & house, experimental |
| Great 78 Project | 78 rpm records, 1898–1950s | Trending, jazz, blues, country, opera & classical |
| Public Domain Classical | Public-domain classical recordings | Trending, most played, Musopen, piano |

All are hosted on the Internet Archive, so their torrents carry web seeds and play without peers.

### Tracker templates (installed off)

Five extensions for well-known public trackers ship as **templates**. They install switched **off**
(`"enabledByDefault": false` in `extensions/index.json`), so the app never contacts these sites until a user
turns one on. Each is covered by offline fixture tests (`extensions/test/templates.test.ts`) but has not been
run against the live site, so treat them as starting points that may need a tweak when a site changes.

| Template | Source file | How it gets results | Explore categories | Options |
|---|---|---|---|---|
| The Pirate Bay | `the-pirate-bay.ts` | `apibay.org` JSON API (`q.php`, `precompiled/data_top100_*.json`) → magnet from the info hash | Top 100 music, top music 48h, top 100 FLAC, top 100 audio | FLAC only, include audiobooks |
| 1337x | `1337x.ts` | Reads the Music category, then each result's page for its magnet (top 15) | Popular this week / today, top 100, latest | Mirror |
| Nyaa (audio) | `nyaa.ts` | `nyaa.si/?page=rss` feed (seeders, size, info hash) → `.torrent` download | Most seeded lossless / lossy, latest | Lossless only, trusted only |
| Knaben | `knaben.ts` | `POST api.knaben.org/v1` JSON meta-search across many public trackers | Most seeded lossless / MP3, latest | Lossless only, include audiobooks |
| LimeTorrents | `limetorrents.ts` | Reads the Music category; hash from each row's .torrent link, the result page otherwise | Most seeded, latest | Mirror |

**Using one:** *Sources* → *Extensions* → flip the switch → press **Test**. The test makes one small request and
says what went wrong in plain words (site unreachable, a bot check, layout changed). Results then show up in
search, and the template's categories appear in *Explore*. You are responsible for what you stream.

**When a template stops working**

- *"Couldn't reach …"* — the site is down or blocked on your network. For 1337x and LimeTorrents, set the
  **Mirror** option to another of the listed domains.
- *"… is showing a bot check"* — the site sits behind a browser challenge the sandbox can't pass. Try another
  mirror, or reach the site through a Torznab indexer that can.
- *The site moved to a new domain* — add it to the extension's `"hosts"` in `extensions/index.json` **and** to
  `MIRRORS` in its source file (a test checks they match), then `npm run build:extensions`.
- *The page layout or API changed* — parsing lives in small exported functions (`parseListing`, `parseFeed`,
  `toResults`) with fixture tests in `extensions/test/templates.test.ts`. Save a current page as a fixture,
  adjust the patterns until the test passes, rebuild.
- *Login-only trackers* can't be templates: the sandbox doesn't keep login cookies. Connect them through a
  Torznab indexer.

**Removing them for a release:** delete the five entries from `extensions/index.json`, their files in
`extensions/src/` (plus `lib/torrent-kit.ts` if nothing else uses it), their imports in
`src/main/extension-host/defaults.ts`, and their tests in `extensions/test/`. Users who already installed them keep
them until they remove them.

## The extension sandbox

`src/main/extension-host/` — format documented at the top of `manifest.ts`.

- Each extension runs in its own hidden, sandboxed Electron window with an in-memory session; its code is
  loaded into a module Web Worker (no DOM, no Node, no access to the app).
- The session only lets it reach `https://` on the hosts its manifest declares. Everything else — other hosts,
  plain http, loopback and LAN addresses — is cancelled. CORS headers are added for the declared hosts.
- Results are re-validated in the main process. `.torrent` downloads may only come from declared hosts (https,
  default port); magnets are rebuilt with only the hash, name and public trackers/web seeds; LAN endpoints are
  stripped from `.torrent` files.
- Code is pinned by SHA-256 and checked on every launch. Saved secrets only carry over to updates from the same
  repository with the same hosts.
- Known limits: an extension can still fetch more code from its own declared hosts at run time, so the checksum
  covers what you installed, not everything it may run. In `npm run dev` the sandbox page is served by the dev
  server, so only install untrusted extensions in a built app (`npm start`).

## Writing an extension

1. Add `extensions/src/<id>.ts` whose default export implements `Extension` from `extensions/src/sdk.ts`:
   `search`, and optionally `browse` and `test`.
   - For an Internet Archive collection, `archiveCollection()` in `extensions/src/lib/` does it in a few lines.
   - For a tracker site, copy the closest template and use the helpers in `extensions/src/lib/torrent-kit.ts`:
     HTML/RSS parsing without a DOM, release-name parsing, mirrors, magnets and friendly error messages.
2. Add its manifest entry to `extensions/index.json`: `"code": "<id>.js"`, the hosts it may reach, categories,
   options, and `"enabledByDefault": false` if it should install switched off. To ship it with the app, also
   add it to `src/main/extension-host/defaults.ts`.
3. `npm run build:extensions` bundles each source into one standalone ES module in `extensions/dist/`
   (git-ignored; `npm run dev`/`build`/`start` run it automatically). `npm run typecheck` checks extensions
   against the Web Worker environment they run in. Put offline tests in `extensions/test/`.

To publish extensions separately, host `index.json` plus the built `.js` files over https and import the
manifest URL under *Sources*.

## Adding a built-in provider

1. Implement `MusicProvider` (`providers/types.ts`): `search()`, `open()`, optionally `categories` + `browse()`.
   Keep anything needed to open an album in `album.ref` — it never leaves the main process.
2. Add settings (with secrets through `SecretBox`) in `providers/settings.ts` and a form in `SourcesView.tsx`.
3. Map settings → implementation in `providers/index.ts`.
4. Network access only through `http.ts` (https, size caps, timeouts, host allow-lists).

Direct HTTP streams would need a new `Playable` kind and a playback backend next to `TorrentEngine` that proxies
range requests; the stream server and player stay as they are.
