# Search sources

Chomusuke searches through **providers** (`src/main/providers/`). Each one turns a query into albums/songs
and turns a chosen album into something playable. Today every provider hands back a torrent.

| Provider | Kind | Status |
|---|---|---|
| Internet Archive | HTTP API → `.torrent` (with web seeds) | Built in |
| Torznab indexers (Jackett, Prowlarr, BitMagnet, …) | Torznab XML API → magnet / `.torrent` | Built in, configured under **Sources** |

## Adding a provider

1. Implement `MusicProvider` (`providers/types.ts`): `search(query, signal)` returns albums (and songs if
   the source knows individual tracks); `open(album, signal)` returns a `Playable`.
   Put anything you need to open an album later (an id, a magnet, a download link) in `album.ref`. It stays
   in the main process; the renderer only ever sees an opaque result id.
2. If it needs settings, add a stored type and validation to `providers/settings.ts` (encrypt secrets with the
   `SecretBox`), plus a form in `renderer/src/components/SourcesView.tsx`.
3. Map the settings to your implementation in `providers/index.ts` (`buildProviders`).
4. Do network access through `http.ts`: https only (http only for hosts you explicitly allow), capped
   response sizes, timeouts, and an `allowHost` list when the host is fixed.

**Torrent websites and APIs** fit as they are: return `{ kind: 'torrent', torrent: magnetOrBytes }`.

**Direct HTTP streams** (Audius, Jamendo, Funkwhale…) need one more piece: a new `Playable` kind such as
`{ kind: 'http', tracks: [{ title, url, … }] }`, and a playback backend next to `TorrentEngine` that implements
`resolveFile()` by proxying range requests to the upstream URL. The loopback stream server and the player
don't need to change, and the renderer's CSP can stay locked to `127.0.0.1`.

## Candidates

These come from the [FMHY](https://fmhy.net) audio and torrenting pages (source: `github.com/fmhy/edit`,
`docs/audio.md` and `docs/torrenting.md`, October 2026), filtered to sources that have an API or a
machine-readable feed.

**Torrent (works with the current design):**
- **BitMagnet**: self-hosted DHT crawler and search engine with a Torznab endpoint. Add it as a Torznab
  indexer; no code needed.
- **Jackett / Prowlarr**: indexer managers that expose most public and private trackers as Torznab. These are
  the supported route to individual trackers.
- **bt.etree.org**: torrents of trade-friendly live concert recordings (only artists that allow taping). It has RSS
  feeds; search would mean parsing its HTML (a "website" provider).
- **Torrentinim / Magnetissimo**: self-hosted torrent search apps with simple HTTP APIs.

**HTTP streaming (needs the `http` playable kind above):**
- **Audius**: open, keyless REST API (`/v1/tracks/search`, `/v1/tracks/{id}/stream`); artist-uploaded music.
- **Jamendo**: Creative Commons catalogue; REST API needs a free client id (store it like an API key).
- **Funkwhale**: federated, self-hostable; each instance has a REST API.
- **Relisten**: live recordings (Live Music Archive, Phish.in) with a public API.
- **Free Music Archive**, **Mirlo**, **Newgrounds Audio**: free catalogues; check their API terms first.

**Not suitable:** YouTube Music/Spotify/Deezer/SoundCloud clients and rippers (no torrent or open API, and
their terms forbid it), and Telegram bots or Soulseek (different protocols).

Only add sources whose content you have the right to download and share.
