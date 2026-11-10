# Art tests

Evidence for art decisions (see `docs/DECISIONS.md`). Regenerate the sheets with `tools/bake-sprites.ts`; these
images are crops of its output.

| File | What it shows |
|---|---|
| `baked-units.png` | The 8 Frontline units baked from the KayKit CC0 characters: idle, run, attack and death frames. Team tint blue (still too weak) |
| `baked-heroes.png` | All 20 heroes in their identity tints, attack frame. The 9 free bodies give about 12 distinct looks |
| `mock-baked-units-in-battle.jpg` | A paste-in mock-up, not an in-engine render: baked units at game scale beside the Tiny Swords units in `docs/screenshots/godot/battle.jpg`. In the game they would also get the HD-2D lighting, shadows and grade |

```bash
npx tsx tools/bake-sprites.ts                       # 8 units  -> build/sprites/
npx tsx tools/bake-sprites.ts --heroes --out=build/heroes
npx tsx tools/bake-sprites.ts swordsman --tint=red  # one unit, red team
```
