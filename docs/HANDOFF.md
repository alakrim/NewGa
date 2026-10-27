# Handoff: state of the project (2026-10-27)

Branch `claude/2.5d-hero-tower-defense-odusfc` (both `alakrim/NewGa` and `alakrim/Brainstorm`).

## What exists
- **Server + sim** (`src/server`, `src/shared`): authoritative Node `ws` server, deterministic TS simulation.
  Frontline mode (one lane, 2v2, gold/miners/plots/army/stances/banners/bots) is the default room mode.
  `BF_SPEED=1..8` runs extra sim steps per tick (tests only).
- **Godot client** (`godot/`, Godot 4.7, Mobile renderer): the main client. HD-2D look, touch HUD, menus,
  lobby, hero gallery, build panel, end screen. See `godot/README.md` for layout and assets.
- **Web client** (`src/client`, Three.js + KayKit): older prototype, still works with the same server.
- Art direction concepts: `docs/concepts/` (01 HD-2D was chosen). Asset research: `docs/ASSETS.md`.

## Run
```bash
npm install && node tools/fetch-tinyswords.mjs   # Free Pack is not in git (no redistribution)
npm run dev                                       # server :8787
godot --path godot                                # client
```

## Tests
- `npm test` for the sim/server.
- `godot --path godot -- --uitest` drives every menu and HUD screen against a server on :8787 (`ui-*.png`).
- `godot --path godot res://tests/hd2d.tscn` stages a battle without a server (`hd-*.png`, fast look check).
- `tests/vtest.tscn` plays a scripted bot match against a `BF_SPEED=4` server (see `godot/README.md`).

## Gotchas
- MSAA must stay off: it breaks depth of field on the Mobile renderer.
- Headless rendering in a container needs `mesa-vulkan-drivers` (lavapipe) and `xvfb-run`; it is slow,
  so give scripted matches several minutes.
- `--server=` is a per-run override and is never saved; the menu's Settings saves the address.
- The HUD works in 2D "px" space (32 px per sim unit, y = sim z). `game.gd` maps it to the 3D camera
  (`camera.position`/`zoom` rig, `screen_to_world`, and Node2D children are drawn on the ground plane).

## Known gaps / ideas
- Not yet run on a real phone; no Android/iOS export presets.
- Ability VFX are Tiny Swords sprites + ground rings + light flashes; heroes reuse unit bodies.
- Miners crowd the lower screen; damage numbers can clutter big fights.
