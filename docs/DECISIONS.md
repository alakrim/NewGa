# Decisions

One dated line per decision, newest first. **Open** items wait for the project owner.

## Rules

- **Experiments** (a new look, a new mode) open with a README that states the hypothesis, what would make it
  merge, and a kill date. After two sessions they merge behind a setting or are deleted. Nothing stays on a side
  branch.
- **One line of history:** `main` holds the game. Each session works on its own branch, ends with a short
  note in `docs/HANDOFF.md`, and lands on `main` through a pull request. Still to do in GitHub's settings
  (owner): make `main` the default branch and protect it.

## Log

- 2026-11-10 `main` created at the head of `ccr-3e18521d-fh6r1c`, which already contained every other branch
  (`claude/2.5d-hero-tower-defense-odusfc`, `ccr-b746cdda-o5bvbc`); those are kept but fully merged.
- 2026-11-10 A personal NewGa cloud environment installs Godot 4.7, xvfb and lavapipe and fetches the Tiny
  Swords pack at session start, so every session can run the Godot tests headless.

- 2026-11-10 Characters are KayKit CC0 3D models baked to pixel sprites, free assets only for now. This is the
  default, with Classic (Tiny Swords) kept in Settings. All 20 heroes have their own sprites from the 9 free
  bodies, recoloured and kitted out per hero; Hallen and Kraghul are still close. Team colour is baked per
  colour rather than swapped in a shader, because the client already loads one sheet per colour. Evidence:
  `docs/art-tests/ingame-*.jpg`. Paid KayKit Extra tiers (5 more bodies, about $16): not yet.
- 2026-11-10 Paint-over: the projected ground stays as an optional map skin (kill date 2026-12-01, see
  `godot/paintover/README.md`). The photoreal painted buildings and the depth variant were deleted. Their
  magenta key-out moved to `tools/magenta_key.py`.
- 2026-11-10 All art, audio and fonts are listed in `assets-manifest.json`; CI fails on unlisted files or the
  Tiny Swords Free Pack being committed.
- 2026-11-10 Frontline matches always end: units ignore unreachable plot buildings, and Sudden Death from 12:00
  crumbles both keeps (`docs/FRONTLINE-BALANCE.md`).
- 2026-11-10 Follow stance added (key T); bots keep Hold.
- 2026-10-27 Paint-over experiment started (`godot/paintover/README.md`).
- 2026-10-26 Godot 4.7 (Mobile renderer) is the main client; the Three.js client stays as a prototype.
- 2026-10-26 Art direction HD-2D chosen from ten concepts (`docs/concepts/`, concept 01).
- 2026-10-26 Frontline (one lane, 2v2, economies plus heroes) becomes the main mode.
