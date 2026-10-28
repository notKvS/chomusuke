# Character stickers

Stickers shown on empty and error screens (`src/renderer/src/components/mascot/Sticker.tsx`).

Add your own artwork here as PNG, WebP or GIF (transparent background works best, ~400 px tall):

| File | Used for |
|---|---|
| `aqua.png` | Search with no results, empty library |
| `megumin.png` | Album that won't load, empty playlist |
| `kazuma.png` | Search errors, sources switched off, nothing disliked |
| `darkness.png` | No liked songs |

A scene-specific pose overrides the general one: `<character>-<scene>.png`, where scene is one of `search-empty`,
`search-error`, `no-sources`, `album-error`, `liked-empty`, `disliked-empty`, `playlist-empty`, `library-empty`
(e.g. `megumin-album-error.png`). Any sticker that's missing falls back to Chomusuke.

Only add artwork you have the right to use and ship.
