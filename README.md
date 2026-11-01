# 🐈‍⬛ Chomusuke

Desktop music player that streams audio straight from torrents 🎶

## ✨ Features

- 🧲 **Play any torrent** — magnet link, info hash, https `.torrent` URL or a local `.torrent` file, shown as an album
  with tracks, artist and cover.
- ▶️ **Streaming playback** — starts as soon as the first pieces arrive; seeking, album queue, media keys and OS media
  controls.
- 🔍 **Search** across all enabled providers at once, with **Load more** for providers that have more pages. Click an
  artist's name (album page, player, cards) to search for everything by them.
- 🏠 **Home** — more from the artists you play most, and a chart in their genre. With nothing played yet, it shows a
  popular chart. The list of songs it remembers stays on your computer and can be cleared in Settings → Sharing.
- 🧭 **Explore** — Spotify, YouTube Music, Apple Music / iTunes and ListenBrainz top albums and songs. Pick a country,
  or a language, on each chart. Choose one and Chomusuke finds it on your plugins and plays it (a chart song starts at
  that song). Entries without a cover get one from Spotify or iTunes.
- 🔌 **Charts and plugins**
  - Charts are where Explore's lists come from (Settings → Charts).
  - Plugins are where music is found and played from (Settings → Plugins): the Internet Archive, Torznab indexers (API
    keys stored in your system's credential store) and installable plugins. Install either kind from a repository URL;
    each runs in an isolated sandbox. Six Internet Archive collections and four charts come switched on; five
    public-tracker templates (The Pirate Bay, 1337x, Nyaa, Knaben, LimeTorrents) come switched off.
- 💬 **Discord status** — shows the song, artist, album and cover as *Listening to Chomusuke*, with a **Get Chomusuke**
  button that sends friends to the latest download. On by default; turn it off in Settings → Sharing.
- 📄 **Torrent details** — files, trackers, pieces, peers and transfer stats; save the `.torrent` file or copy the
  magnet link.
- 💾 **Save offline** — download a whole album to *Saved albums* so it plays instantly, even offline; recently streamed
  music is kept too, within a disk limit you choose.
- 👍 **Like & dislike** — rate songs from the track list or the player; disliked songs are skipped when an album
  plays on. Ratings follow the song across providers (same torrent file, or same artist + title in another
  release). *Liked songs* (under Playlists) plays them again; **backup export/import** (Settings) moves ratings,
  saved albums and appearance to Chomusuke on another computer.
- 🎼 **Playlists** — mix songs from any torrent and any provider; add from track rows, the player or the liked list,
  reorder, rename, shuffle. Playback moves from one torrent to the next on its own, and playlists are part of the
  backup.
- 🤝 **Sharing** — one app-wide setting (Settings → Sharing): whether Chomusuke uploads what you have to other
  listeners, with an upload limit. On by default; switching it off stops all uploading.
- 🎨 **Appearance** — preset themes (dark and light) or custom colours, backgrounds, glass panels, buttons, fonts,
  interface size and effects, including drifting particles (sakura, snow, leaves, bubbles, embers,
  music notes, fireflies or sparkles).
- ⚙️ **Settings** — appearance, charts, plugins, sharing and backup in one page, one tab each.
- ↔️ **Navigation** — collapsible sidebar, back/forward buttons, Alt+←/→ and mouse side buttons.

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

## 🏗️ Architecture

How Chomusuke is built, and how to develop and release it, is on the wiki:
**[Architecture](https://github.com/notKvS/chomusuke/wiki/Architecture)**.
