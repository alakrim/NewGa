# Bannerfall: Frontline (Godot client)

The mobile client for **Frontline**, the one-lane 2v2 mode: each player mines gold, builds on their own
plots, trains an army and leads it with a hero. It talks to the same authoritative Node server as the web
prototype (`src/server`), so the simulation, bots and rules live in one place (`src/shared`).

- Engine: **Godot 4.7**, GL Compatibility renderer (runs on low-end Android and iOS), landscape, touch.
- Art: **Tiny Swords** by Pixel Frog, 2D pixel art drawn on a 64 px grid. One sim unit = 32 px.

## Setup

```bash
npm install
node tools/fetch-tinyswords.mjs     # downloads the Tiny Swords Free Pack into godot/assets/tinyswords_free/
npm run dev                         # server on :8787
godot --path godot                  # or open godot/project.godot in the editor
```

Point the client at another server with `godot --path godot -- --server=ws://host:8787/ws`.

## Assets and licences

| Folder | Source | Licence | In git |
|---|---|---|---|
| `assets/tinyswords/` | Tiny Swords Update 010 | CC0 | yes |
| `assets/tinyswords_free/` | Tiny Swords (Free Pack) | Free for commercial use, **no redistribution** | no, fetched by `tools/fetch-tinyswords.mjs` |
| `assets/fonts/PixelifySans.ttf` | Pixelify Sans | SIL OFL 1.1 | yes |

The Free Pack supplies knights, buildings, terrain and UI. The CC0 pack supplies goblins (assassin and
mage bodies), effects, construction sites, ruins and small decorations.

## Layout

| Script | Role |
|---|---|
| `scripts/net.gd` (autoload `Net`) | WebSocket client, JSON protocol from `src/shared/protocol.ts` |
| `scripts/sprites.gd` (autoload `Sprites`) | Texture cache, builds `SpriteFrames` from sheets |
| `scripts/visuals.gd` | Which sheet and animation rows each unit, hero role, building and effect uses |
| `scripts/fl_map.gd` | Static map features, mirrored from `src/shared/frontline/data.ts` |
| `scripts/world.gd` | Island, road, plateaus, plot foundations, decorations, clouds |
| `scripts/game.gd` | Applies snapshots and events: units, buildings, projectiles, effects, camera |
| `scripts/unit_view.gd`, `scripts/building_view.gd` | One unit or building on screen |

## Visual test

`tests/vtest.tscn` plays a scripted match against bots (builds, trains, attacks) and saves screenshots to `$VT_SHOTS` (default `user://shots`).
Run it against a fast server:

```bash
BF_SPEED=4 PORT=8788 npx tsx src/server/index.ts &
godot --path godot --rendering-driver opengl3 res://tests/vtest.tscn -- --server=ws://127.0.0.1:8788/ws
```

`BF_SPEED` (1 to 8) runs that many simulation steps per server tick. Use it for tests only.
