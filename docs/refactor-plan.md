# Refactor plan: structure, styles and docs

A handoff brief for the agent doing this cleanup. It is self-contained: read it, then the files it names.

## Goal

Make the codebase easier to change without changing what the app does or how it looks. Five tasks, in order. Each
one lands on its own and leaves the app working.

1. Shared form controls (small, unblocks task 2)
2. Per-component stylesheets with explicit cascade layers (largest)
3. Split `App.tsx` into hooks and pure, tested modules
4. Split the main process IPC handlers by area
5. Fill in missing TSDoc

**Out of scope:** new features, visual redesigns, dependency upgrades, changes to `extensions/`.

## Ground rules

- **No behaviour or visual change.** Every task is a refactor. If something looks different afterwards, that is a bug.
- **Don't commit or stage.** The owner commits, and often while you are working. Leave changes unstaged. Avoid
  `git mv` (it stages the move, and an earlier move got swept into an unrelated commit). Move files by writing the new
  file and deleting the old one.
- **The owner has work in progress.** Before starting, run `git status` and don't touch files you didn't change.
- **Prefer what's installed.** No new runtime dependencies. If a dev tool is really needed, ask first.
- **Match the house style:** Biome formatting (`npm run fix`), short doc comments that explain *why*, 120-column lines,
  BEM-ish class names (`block__element`, `is-state`).
- **Verify after every task** (see [Verification](#verification)).

## Orientation

Electron + React 19 + TypeScript, built with electron-vite. Biome for lint and format. Tests use `node:test` and run
`.ts` files directly through Node's type stripping (so test-reachable modules import siblings with explicit `.ts`
extensions and must not touch React or the DOM).

```
src/main/        Electron main process: torrents, providers, library, ratings, playlists, IPC (index.ts)
src/preload/     contextBridge API (window.chomusuke)
src/shared/      types shared by main and renderer
src/renderer/src/
  App.tsx        app shell: navigation, queue, album loading, page switch
  components/    pages and widgets; settings/ holds the Settings page tabs; mascot/ holds Chomu, stickers, particles
  theme/         appearance model (pure, tested), colour maths, DOM writer
  styles.css     base layout + every component          (~2,140 lines)
  anime.css      anime skin re-styling the same components (~1,195 lines)
  theme.css      backgrounds, surfaces, Appearance page    (~550 lines)
```

Commands:

| Command | What it does |
|---|---|
| `npm run typecheck` | All three tsconfigs |
| `npm run lint` / `npm run fix` | Biome check / auto-fix |
| `npm test` | `node:test` over `src/**/*.test.ts` and `extensions/test` |
| `npm run build` | Extensions + electron-vite build into `out/` |
| `npm run dev` | Dev app with hot reload |

**Gotcha:** if your shell sets `ELECTRON_RUN_AS_NODE=1` (VS Code terminals do), Electron runs as plain Node and the
app won't open. Unset it for the launch: `env -u ELECTRON_RUN_AS_NODE npm run dev`.

## Must keep: performance decisions

These were measured and are easy to undo by accident while moving CSS around. Keep them, and keep their comments.

| Where | What | Why |
|---|---|---|
| `src/main/index.ts` | `app.commandLine.appendSwitch('enable-prefer-compositing-to-lcd-text')` | The content scroller is see-through, so Chromium scrolled it on the main thread and repainted every card. Explore went from ~30 to 60 fps. |
| Particles CSS (`anime.css`) | Only `transform`/`opacity` animate; `will-change: transform` on `.particle`, **not** on `.particle__body` | `will-change` freezes the raster scale; bodies that grow (sparkles, fireflies) turned blurry. |
| Sidebar collapse (`morphSidebar` in `App.tsx`, `.is-morphing-sidebar` CSS) | View transition; `view-transition-name` set only during the transition | A permanent name makes `.content` a stacking context and traps popup menus under the player bar. |
| `.skeleton`/`.skeleton-row`, `.eq i`, Sakura/particles | Shimmer is a sliding `::after`; equaliser uses `scaleY`; petals fall via `transform` | Avoid layout or paint every frame. |
| `.chomu…__art`, `.loader-scene__art`, mesh `body::before` | `will-change: transform, filter` / `transform` | Keep the mascot and background animations on the compositor. |
| `prefers-reduced-motion` and `html[data-motion='off']` blocks | Turn animations off | Accessibility. |

## Task 1: shared form controls

**Why:** the same controls are written several times, each slightly differently.

| Control | Copies today |
|---|---|
| On/off switch (`role="switch"`, `.switch`) | `Toggle` in `settings/AppearanceSettings.tsx`, `Switch` in `settings/SharingSettings.tsx`, inline in `SourceRow` in `settings/SourcesSettings.tsx` |
| Status message (`.torznab-form__status is-ok/error/busy`) | `StatusLine` in `SourcesSettings.tsx`, inline `<p>` in `BackupSettings.tsx` and `AppearanceSettings.tsx` |
| Labelled setting | `Setting` (stacked, in Appearance) and `SettingRow` (title + hint + control in a row, in Sharing) |
| `Segmented`, `Range`, `Swatches` | Only in `AppearanceSettings.tsx`, but generic |

**Do:**

- Create `src/renderer/src/components/controls/` with `Switch.tsx`, `StatusLine.tsx`, `SettingField.tsx` (was
  `Setting`), `SettingRow.tsx`, `Segmented.tsx`, `Range.tsx`, `Swatches.tsx`.
- Use them everywhere the copies were. `Switch` takes `checked`, `label`, `onChange` and an optional `disabled`.
- Rename the CSS class `torznab-form__status` to `status-line` (it isn't Torznab-specific). Update every use.
- `Segmented` reads labels from a `LABELS` map in `AppearanceSettings.tsx`. Pass labels in as a prop
  (`labels?: Record<string, string>`) instead of importing that map.

**Done when:** `grep -rn 'role="switch"' src/renderer` finds only `controls/Switch.tsx`, the Settings tabs look and
behave the same, and `AppearanceSettings.tsx` is mostly page content.

## Task 2: per-component stylesheets + cascade layers

**Why:** styles are split by layer (base, anime skin, theme), not by component. 56 selectors are defined in more than
one file, so understanding `.card__art`, `.nav-item` or `.player` means reading two or three files, and which rule wins
depends on import order (`main.tsx` imports `styles.css`, then `anime.css`, then `theme.css`).

**Decision: plain co-located CSS files, not CSS Modules.** Keep today's class names. CSS Modules would hash class
names, which breaks `theme.css` selectors like `html[data-surface='glass'] .sidebar` and means rewriting every
`className`. Co-location gives you ownership without that churn.

**Target layout:**

```
src/renderer/src/styles/
  index.css        @layer order + imports of the global sheets below; imported once from main.tsx
  tokens.css       :root custom properties (the top of styles.css)
  base.css         reset, body, typography, shared primitives: buttons, icon-button, chips, switch, segmented, range
  layout.css       .app grid, .content, .page, narrow-window media queries, view-transition rules
  theme.css        backgrounds, surfaces, button styles, motion switches (today's theme.css minus the Appearance page)
  motion.css       prefers-reduced-motion block
components/Sidebar.tsx + components/Sidebar.css      (and so on, one per component that has styles)
components/settings/AppearanceSettings.css           (the "Appearance page" part of theme.css)
components/mascot/Particles.css, Chomu.css, LoaderScene.css, Sticker.css
```

Each component imports its own sheet (`import './Sidebar.css'`).

**Layers.** In `styles/index.css` declare the order once:

```css
@layer tokens, base, layout, components, theme, motion;
```

Wrap each file's rules in its layer (`@layer components { … }`). Later layers win regardless of selector specificity,
which is what we want: theme surfaces override components, and reduced motion overrides everything. Unlayered CSS
beats all layers, so leave nothing unlayered.

**Merging the anime skin.** For each component, combine its section in `styles.css` with its overrides in `anime.css`
into one rule set with the **final** computed values. Section headers make the mapping easy:

| `styles.css` section | `anime.css` overrides | New home |
|---|---|---|
| Layout | `.content`, `.app.has-player` | `styles/layout.css` |
| Top bar | Brand / animated logo, Search box | `TopBar.css`, `mascot/AnimatedLogo.css` |
| Sidebar | Sidebar | `Sidebar.css` |
| Shared bits | Buttons, chips, switches; Page headings | `styles/base.css` |
| Home | Home hero | `Home.css` |
| Album; Album actions, torrent panel | Cards & rows | `AlbumView.css`, `TorrentPanel.css`, `Card.css` |
| Search, Explore | Cards & rows | `SearchView.css`, `ExploreView.css` |
| Sources | (none) | `settings/SourcesSettings.css` |
| Player bar | Player bar | `PlayerBar.css` |
| Toast; Narrow windows | Toast & error states | `styles/layout.css` / `AlbumView.css` (error page) |
| Library & sharing; Settings | (none) | `SavedAlbumsView.css`, `LibraryAlbumRow.css`, `settings/SettingsView.css`, `settings/SharingSettings.css` |
| Ratings; Playlists | (none) | `RateButtons.css`, `LikedView.css`, `PlaylistView.css`, `AddToPlaylist.css`, `Sidebar.css` |
| (none) | Chomusuke the mascot; Loader scene; Splash; Particles; Character stickers | `mascot/*.css` |

To list the selectors defined in more than one file today, run this from the repo root:

```sh
python - <<'PY'
import re, collections
owners = collections.defaultdict(set)
for f in ['styles.css', 'anime.css', 'theme.css']:
    css = re.sub(r'/\*.*?\*/', '', open(f'src/renderer/src/{f}', encoding='utf-8').read(), flags=re.S)
    for m in re.finditer(r'(^|\})\s*([^{}@]+?)\s*\{', css):
        for sel in m.group(2).split(','):
            if sel.strip().startswith('.'): owners[sel.strip()].add(f)
for sel, files in sorted(owners.items()):
    if len(files) > 1: print(sel, sorted(files))
PY
```

**Work in slices.** Move one component (or one row of the table) at a time, then build and compare screenshots before
the next one. Delete `styles.css`, `anime.css` and the old `theme.css` only when they are empty.

**Done when:**

- `main.tsx` imports only fonts and `styles/index.css`.
- No selector is defined in two files, except deliberate `theme.css` surface overrides.
- Screenshots match the baseline (see [Verification](#verification)) for: Home, Explore, an album, Search results,
  Liked songs, Saved albums, a playlist, and every Settings tab. Check each in dark and light mode, with the
  Classic and Glass surfaces, and with the sidebar both expanded and collapsed.

## Task 3: split `App.tsx`

**Why:** `App.tsx` (~630 lines) does everything, so none of its logic is testable on its own.

Today it holds:

- **History:** `Page` union, `samePage`, `history` state, `navigate`/`goBack`/`goForward`, mouse side-button and
  Alt+arrow listeners, per-page scroll restore (`scrolls` WeakMap), `MAX_HISTORY`.
- **Album loading:** `albums` state, `Overlay`, `runLoad`, `loadSource`, `openSearchAlbum`, `openLibraryAlbum`,
  `openFile`, `openAlbum`, `showAlbum`, the `sourceToHash` cache, `requestId` cancellation.
- **Search cache:** `searches` state, `runSearch`, `MAX_CACHED_SEARCHES`, re-running an evicted search on back.
- **Queue:** `Queue`, `playQueueAt`, `startQueue` (with shuffle), `edgeRef` (the player asks it to go past the end of
  an album), `isDisliked`.
- **Shell bits:** toast and its timer, the Space-to-toggle shortcut, sidebar collapsed state and `morphSidebar`,
  splash.
- **The page switch** that renders the current view.

**Do:**

- Pure modules (no React, no DOM, `.ts` imports) with `node:test` tests next to them:
  - `navigation.ts`: `Page`, `samePage`, and a reducer for `push`/`back`/`forward` that respects `MAX_HISTORY`.
    Test: dedupe of the same page, truncating forward history on push, the cap, back/forward at the ends.
  - `queue.ts`: `shuffle` (accept a random source for testability), next/previous position, end-of-queue.
    Test: shuffle keeps every item exactly once; edge positions.
- Hooks in `src/renderer/src/hooks/` (or next to `App.tsx`, matching `usePlayer.ts`):
  `useNavigation`, `useAlbumLoader`, `useSearches`, `useQueue`, `useSidebarCollapsed` (owning `morphSidebar` and the
  `chomusuke.sidebar-collapsed` localStorage key).
- `PageContent.tsx` for the `switch (view.kind)`.

**Done when:** `App.tsx` is mostly wiring (roughly under 200 lines), the new tests pass, and back/forward, scroll
restore, playlist playback (including shuffle and skipping disliked songs), search caching and sidebar collapse all
behave as before.

## Task 4: split the main-process IPC

**Why:** `src/main/index.ts` (~860 lines) registers all 38 IPC channels in one `registerIpc` function.

**Do:** create `src/main/ipc/`. Each file exports `register(deps)` for one area:

| File | Channels |
|---|---|
| `sources.ts` | `source:load`, `source:open-file` |
| `search.ts` | `search:query`, `search:open`, `explore:sources`, `explore:browse` |
| `providers.ts` | `providers:*`, `extensions:*` |
| `torrent.ts` | `torrent:details`, `torrent:save-file`, `torrent:copy-magnet` |
| `library.ts` | `library:*`, `sharing:set` |
| `ratings.ts` | `ratings:*` |
| `playlists.ts` | `playlists:*` |
| `backup.ts` | `backup:export`, `backup:import` |
| `window.ts` | `ui:set-window-appearance` |
| `guard.ts` | `assertTrustedSender`, `toResult`, `sanitizeHints` and the other input sanitisers |

`index.ts` keeps app lifecycle, window creation, the command-line switches, and the calls to each `register`.

**Security, non-negotiable:** every handler must still call `assertTrustedSender(event)` before doing anything. Today
37 calls cover 38 channels, so find the one handler without its own call, check whether it's protected another way,
and fix it if not. Keep every input sanitiser and length limit exactly as is.

**Done when:** each file under `ipc/` is under ~200 lines, every channel in `src/preload/index.ts` is still
registered, and each handler starts with `assertTrustedSender`.

## Task 5: TSDoc

84 of 144 exported functions and classes have a doc comment. Many of the rest explain themselves (`formatTime`,
`hexToRgb`, `isHex`); leave those alone. Add a short comment (what it's for, and anything non-obvious: limits, errors,
side effects, threading) to:

- Stores: `PlaylistStore`, `RatingsStore`, `SeedLibrary`, `ProviderSettingsStore`.
- Extension host: `ExtensionHost`, `hostPage`, `createExtensionProvider`, `bundledExtensions`.
- Providers: `createArchiveProvider`, `searchArchive`, `browseArchive`, `createTorznabProvider`, `toAlbum`,
  `validateTorznabUrl`.
- HTTP: `fetchCapped`, `fetchJson`, `fetchText`, `FetchError`.
- Backup and sharing: `buildBackup`, `BackupError`, `sanitizeSharing`.
- Renderer: `Particles`, `PlayerBar`, `Sidebar`, `TopBar`, `AlbumView`, `SearchView`, and every new hook or module
  from task 3.

Explain *why* or *what's surprising*, not what the signature already says.

## Verification

After every task:

1. `npm run typecheck`, `npm run lint`, `npm test`, `npm run build`. All must pass.
2. Run the app (`env -u ELECTRON_RUN_AS_NODE npm run dev`) and click through what you touched.

**Screenshot baseline (tasks 1 and 2).** Take it **before** changing any CSS:

- Launch the built app with a throwaway profile, so the owner's ratings, saved albums and seeding aren't touched.
  Create a gitignored launcher such as `out/perf-launch.mjs` that calls `app.setPath('userData', <temp dir>)` before
  `await import('./main/index.js')`, then start it with:
  `env -u ELECTRON_RUN_AS_NODE ./node_modules/electron/dist/electron.exe out/perf-launch.mjs --remote-debugging-port=9333`.
  Delete the launcher when done.
- Drive it over the Chrome DevTools Protocol (`http://127.0.0.1:9333/json`, then the page's WebSocket; Node 22+ has a
  global `WebSocket`). Freeze motion first so frames are comparable: set `localStorage['chomusuke.appearance']` with
  `particles: 'off'`, `animatedBackground: false`, `mascotMotion: false`, `splash: false`, then reload.
- `Page.captureScreenshot` each page and state listed under task 2. After the change, capture again and compare.
  If you want a pixel diff, `npx pixelmatch` works without adding a dependency.
- If Windows hides the window and nothing renders, add `--disable-backgrounding-occluded-windows
  --disable-renderer-backgrounding --disable-features=CalculateNativeWinOcclusion`.

**Scroll check (task 2).** On Explore, scroll with `Input.synthesizeScrollGesture` while timing frames with
`requestAnimationFrame` in the page. Expect a median of ~16.7 ms and almost no frames over 20 ms, as now.

## Report back

For each task: what moved where, anything you couldn't keep identical (with screenshots), and the output of the
verification commands.
