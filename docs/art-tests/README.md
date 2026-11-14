# Art tests

Evidence for art decisions (see `docs/DECISIONS.md`). Regenerate the sheets with `tools/bake-sprites.ts`; these
images are crops of its output.

| File | What it shows |
|---|---|
| `ingame-1-fight.jpg`, `ingame-2-blue-base.jpg`, `ingame-4-close.jpg` | **In-engine renders** of `tests/hd2d.tscn`: classic (top) against baked (bottom) |
| `baked-units-teams.png` | The 8 units in the 4 player colours, after the cloth and shield swatch recolour |
| `baked-heroes.png` | All 20 heroes after the per-hero recolour and gear pass, attack frame. Hallen (steel armour, cloak, shield) and Kraghul (blackened iron, rust-red helmet, no cloak, axe) are now clearly apart |
| `team-markers-before-after.jpg` | In-engine, baked mode: before (left) and after (right) the team ground markers (round ring for Dawnguard, diamond ring for Duskborn, double ring and larger body for heroes) |
| `baked-buildings.png` | The KayKit Medieval Hexagon buildings baked to sprites with `--buildings`, blue (top) and red (bottom): castle, house, barracks, archery, sanctum, giantpit, forge, mineshaft, watchtower, market |
| `baked-units.png` | The first bake (single multiply tint, before the swatch recolour): idle, run, attack and death |
| `mock-baked-units-in-battle.jpg` | A paste-in mock-up, not an in-engine render: baked units at game scale beside the Tiny Swords units in `docs/screenshots/godot/battle.jpg`. In the game they would also get the HD-2D lighting, shadows and grade |

```bash
npx tsx tools/bake-sprites.ts --tint=all --out=godot/assets/baked/units --no-contact   # the game's unit sheets
npx tsx tools/bake-sprites.ts --heroes --out=godot/assets/baked/heroes --no-contact    # the game's hero sheets
npx tsx tools/bake-sprites.ts --buildings --out=godot/assets/baked/buildings --cell=160 --no-contact   # building icon sprites
npx tsx tools/bake-sprites.ts swordsman --tint=red   # one unit into build/sprites/ with a contact sheet
npx tsx tools/bake-sprites.ts --probe=Knight:Rectangle_Shield   # which atlas swatches a body and its gear show
VT_SHOTS=/tmp/s xvfb-run -a godot --path godot --resolution 1280x720 res://tests/hd2d.tscn -- --chars=classic
```
