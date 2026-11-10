# Decisions

One dated line per decision, newest first. **Open** items wait for the project owner.

## Rules

- **Experiments** (a new look, a new mode) open with a README that states the hypothesis, what would make it
  merge, and a kill date. After two sessions they merge behind a setting or are deleted. Nothing stays on a side
  branch.
- **One line of history:** every session ends with its work on the designated branch and a short note in
  `docs/HANDOFF.md`. Open: create `main`, protect it, and merge each session through a pull request.

## Log

- 2026-11-10 **Open:** move characters from Tiny Swords sprites to KayKit 3D characters baked to pixel sprites
  (`docs/REVIEW-ART.md`). Evidence: `docs/art-tests/`. All 8 units read well; heroes need more bodies (about
  $16 of CC0 KayKit Extra tiers, or Quaternius) and a recolour pass. Team colour needs the hue-swap shader.
  Merge criterion: an in-engine screenshot beside `battle.jpg` that the owner prefers.
- 2026-11-10 **Open:** paint-over. The review recommends keeping the projected ground as an optional map skin,
  restyled to the style block, and deleting `godot/paintover/buildings/` and `depth/` (photoreal beside chibi
  units). Kill date proposed: 2026-12-01.
- 2026-11-10 All art, audio and fonts are listed in `assets-manifest.json`; CI fails on unlisted files or the
  Tiny Swords Free Pack being committed.
- 2026-11-10 Frontline matches always end: units ignore unreachable plot buildings, and Sudden Death from 12:00
  crumbles both keeps (`docs/FRONTLINE-BALANCE.md`).
- 2026-11-10 Follow stance added (key T); bots keep Hold.
- 2026-10-27 Paint-over experiment started (`godot/paintover/README.md`).
- 2026-10-26 Godot 4.7 (Mobile renderer) is the main client; the Three.js client stays as a prototype.
- 2026-10-26 Art direction HD-2D chosen from ten concepts (`docs/concepts/`, concept 01).
- 2026-10-26 Frontline (one lane, 2v2, economies plus heroes) becomes the main mode.
