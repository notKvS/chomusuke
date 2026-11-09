# Seek bar pictures

The pictures that can ride the player's seek bar (Settings → Appearance → Effects → Seek bar). Code:
`src/renderer/src/components/seekThumbs.ts`.

Each file is named after its id in `SEEK_THUMBS` (`src/renderer/src/theme/appearance.ts`): `blindfold.gif`,
`redhead.webp`, `darkhair.webp`, `pinkhair.webp`, `duck.webp`, `runner.webp`, `hero.webp`. PNG, WebP or GIF with a
transparent background works; ~64–128 px is plenty (they show at 30 px).

To add one: drop the file here, add its id to `SEEK_THUMBS`, and a label in `SEEK_LABELS`. A missing file falls back
to Chomusuke's face. `chomusuke` and `dot` are built in.

Only add artwork you have the right to use and ship.
