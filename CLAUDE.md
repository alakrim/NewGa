# Bannerfall (NewGa)

A 2.5D online co-op/PvP game: Frontline mode, one lane, 2v2, Stick-War economy plus 20 heroes. One-page
overview: `docs/SUMMARY.md`.

## Read first
- `docs/HANDOFF.md`: what the last session did and what is open.
- `docs/DECISIONS.md`: decisions already made (don't re-open them) and the open ones (ask the owner).
- `docs/STYLE.md` **before making or importing any art**: the look, the sprite spec, AI prompt templates, and how
  new art gets in.

## Layout
- `src/shared`: the deterministic 20 Hz rules engine, run by the server and offline practice. Content is data:
  heroes in `data/heroes/`, Frontline units, buildings and numbers in `frontline/data.ts`.
- `src/server`: the authoritative Node `ws` server. `rooms.ts` is the lobby and match loop with no transport, used
  by the server (`index.ts`, WebSockets) and by offline play (`src/offline/host.ts`, bundled with
  `npm run build:offline` into `godot/offline/bf-offline.js`, which the APK runs in a WebView). `src/client`: the
  older Three.js web client.
- `godot/`: the main client (Godot 4.7, Mobile renderer, touch). `godot/scripts/fl_data.gd` and
  `heroes_data.gd` are generated: run `npx tsx tools/gen-godot-data.ts` after changing the TypeScript data.

## Checks before pushing
```bash
npm run typecheck && npm run validate && npm test
npx tsx tools/gen-godot-data.ts && git diff --exit-code godot/scripts/fl_data.gd godot/scripts/heroes_data.gd
python3 -I tools/assets.py lint            # every asset has a source and an allowed licence
npx tsx tools/frontline-balance.ts 30 25   # after any Frontline balance change: record before/after in docs/FRONTLINE-BALANCE.md
```
Godot is installed by the NewGa cloud environment's setup script. It renders headless under xvfb:
```bash
godot --headless --path godot --import
VT_SHOTS=/tmp/shots xvfb-run -a -s "-screen 0 1280x720x24" godot --path godot --resolution 1280x720 res://tests/hd2d.tscn
# UI test: start `npx tsx src/server/index.ts` first; screenshots land in /tmp/claude-0/shots/
xvfb-run -a -s "-screen 0 1280x720x24" godot --path godot --resolution 1280x720 -- --uitest
```
Look at the screenshots after any visual change; compare with `docs/screenshots/godot/`.

Android test APK: `bash tools/android-setup.sh` once, then `bash tools/android-build.sh` (see `docs/ANDROID.md`).

## Rules
- Art comes only from CC0, credited CC BY, OFL or project-made sources (scripts, bakes, AI output with its prompt
  file), and every file gets an entry in `assets-manifest.json`. The Tiny Swords Free Pack is fetched by
  `tools/fetch-tinyswords.mjs` and never committed.
- Characters are baked from the KayKit CC0 3D models with `tools/bake-sprites.ts`. Don't hand-place frames.
- Experiments start with a hypothesis, merge criteria and a kill date (`docs/DECISIONS.md`).
- Work lands on `main` through a pull request. End every session with a short "last session" block in
  `docs/HANDOFF.md`.
