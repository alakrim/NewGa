# Art and workflow review (2026-11-10)

A second read-only review focused on characters, free assets, AI generation and workflow. Licence lines were
fetched from the cited pages on 2026-11-10. **Verified in this session** marks what was then tested in the repo
(`docs/art-tests/`).

## 1. Art direction: bake 3D characters into pixel sprites

| Option | Can free packs + AI fill 20 heroes and 8 units × 4 colours, with animation? | Verdict |
|---|---|---|
| Stay with Tiny Swords pixel art | No: about 5 CC0 bodies; the core units come from the non-redistributable Free Pack; 20 heroes would need bespoke pixel animation, which AI does worst | Dead end for heroes |
| Hand-painted 2D sprites via AI | Stills yes, frame-consistent animation no | Reject |
| **KayKit-family low-poly 3D, pre-rendered to pixel sprite sheets** | Yes: rigged CC0 bodies share 38-150+ animations, team colour is one shader, every frame is consistent by construction | **Pick** |

- Keeps the `Sprite3D` / `sheets.json` / `visuals.gd` pipeline and phone performance, and units and the
  KayKit buildings finally share one shape language.
- Keep the CC0 Tiny Swords decoration, effects and UI ribbons, the KayKit buildings and the HD-2D lighting.
- Drop over time: the Tiny Swords Free Pack (licence problem, broken clean clone) and the goblin stand-ins.
  For paint-over, keep the projected ground as an optional skin and drop the photoreal `buildings/` and `depth/`.

**Verified in this session** (`tools/bake-sprites.ts`, `docs/art-tests/`):
- Headless Chromium + the project's three.js bake a unit's 28 frames in under a second, no Godot or GPU needed.
- **Correction:** the review said to bake at the 52° game-camera pitch. That shows the tops of the big chibi
  heads and hides faces. The sprites are camera-facing billboards like the Tiny Swords art, so they are baked
  nearly side-on (18°) and turned 0.55 rad toward the viewer.
- A hairline outline disappears at game scale. A 3 px outline plus a saturation and warmth grade makes them
  sit next to Tiny Swords art (`mock-baked-units-in-battle.jpg`).
- All 8 units are distinct (`baked-units.png`). The 20 heroes are not: the 9 free bodies give about
  12 distinct looks (Sable/Tamsin, Wren/Merrow, Kaelen/Nerissa and Valen/Seraphine are near-twins), and the
  multiply tint makes identity colours muddy (`baked-heroes.png`).
- Team colour is too weak with the current cloth tint. It needs the key-hue bake plus a hue-swap shader below.

## 2. Free assets shopping list

| Pack | URL | Licence (quoted from the page) | Covers |
|---|---|---|---|
| KayKit Adventurers 2.0 | kaylousberg.itch.io/kaykit-adventurers | "Creative Commons Zero v1.0 Universal" | Knight, Barbarian, Rogue (+Hooded), Mage, Ranger; weapons. Extra tier ($7.95, CC0): Engineer, Druid, Barbarian_Large, alt textures |
| KayKit Skeletons | kaylousberg.itch.io/kaykit-skeletons | "Free for personal and commercial use, no attribution required. (CC0 Licensed)" | Warrior, Rogue, Mage, Minion. Extra tier: Golem, Necromancer |
| KayKit Character Animations | kaylousberg.itch.io/kaykit-character-animations | "Creative Commons Zero v1.0 Universal" | "150+ Humanoid character animations" for Rig_Medium/Rig_Large |
| KayKit Medieval Hexagon | kaylousberg.itch.io/kaykit-medieval-hexagon | "Creative Commons Zero v1.0 Universal" | Buildings in 4 colours (already used) |
| KayKit Forest Nature | kaylousberg.itch.io/kaykit-forest | "(CC0 Licensed)" | "100+ models of trees, rocks, bushes, and grass" |
| Quaternius Ultimate Monsters | quaternius.com/packs/ultimatemonsters.html | CC0 | "50 fully animated monsters": Giant, non-human heroes, Horde mode |
| Quaternius Modular Character Outfits: Fantasy | quaternius.com/packs/modularcharacteroutfitsfantasy.html | CC0 | 12 outfits, 62 parts. Different proportions: fallback only |
| Quaternius Universal Animation Library | quaternius.com/packs/universalanimationlibrary.html | "(CC0 License)" | 120+ animations for Quaternius bodies |
| Kenney Particle Pack | kenney.nl/assets/particle-pack | "Creative Commons CC0" | 80 particle textures: base for all ability VFX |
| Kenney UI Pack: Adventure | kenney.nl/assets/ui-pack-adventure | "Creative Commons CC0" | 130 UI files (look not checked) |
| Kenney RPG Audio, Impact Sounds | kenney.nl/assets/rpg-audio, /impact-sounds | "Creative Commons CC0" | 50 + 130 SFX |
| game-icons.net | game-icons.net | "Creative Commons 3.0 BY" | ~4,180 SVG icons: fastest route to 80 ability icons (credit per author) |
| Music | opengameart.org "Determined Pursuit", "Heartfelt Battle" | **Unverified** (page returned 403) | Battle loops; check each track page by hand |

**20 distinct heroes:** free gives 10 bodies. Kitbashing (hats, helmets, capes, weapons, scale, atlas recolour)
reaches about 14-16 silhouettes. About $16 for the two KayKit Extra tiers adds 5 CC0 bodies, for a clean 20.

## 3. AI generation: only where a render can't do the job

- **Identity:** every AI character image starts as image-to-image from that hero's own render, so the
  model restyles and never invents. The repo's notes say Seedream 5.0 Flash keeps layout and Muse Image
  refines texture; Gemini 3 Pro Image was used with a reference image for the concepts.
- **Animation, honest odds:** AI sprite sheets 10-20% per animation (attacks worst); AI pose + Skeleton2D
  cutout 50-60% per character and 2-4 h of rigging each; 3D model + bake about 95% (verified above).
- **Team colour:** bake once with team-coloured texels in a reserved key hue, then hue-swap in the sprite
  shader keeping luminance (`paintover/buildings/building.gdshader` already does this). One sheet per body,
  and purple works.
- **VFX:** Godot particles with Kenney textures tinted by the `color` the sim already sends; AI only for a few
  ultimates, as stills animated by shader.
- **Prompt templates** live in `docs/STYLE.md`.
- **Cost at ~$0.03 per image:** 20 splash arts ×4 tries $2.40; 80 ability icons as 5 sheets ×4 $0.60;
  35 item icons $0.30; ground repaint $0.75; menu and loading art $0.50. Under $10 in all; bakes are free.

## 4. Workflow

| Item | Status |
|---|---|
| Asset manifest with source, licence, author, AI model and prompt file | ✅ `assets-manifest.json` |
| Asset lint in CI (every file listed, licence allowed, Free Pack never committed) | ✅ `tools/assets.py lint` |
| Generated credits | ✅ `tools/assets.py credits` → `CREDITS.md`, checked in CI. Menu credits screen: to do |
| Godot data drift check in CI | ✅ |
| Sprite bake tool with contact sheets | ✅ `tools/bake-sprites.ts`, `tools/sprite-post.py` |
| Style bible that every session reads | ✅ draft `docs/STYLE.md`. A root `CLAUDE.md` pointing at it is the user's call |
| `docs/DECISIONS.md`: one dated line per decision | ✅ |
| Experiments: hypothesis, merge criteria and kill date up front, two sessions max, then merge behind a flag or delete | Rule in `docs/DECISIONS.md` |
| Godot in CI: headless import plus `tests/hd2d.tscn` under xvfb with lavapipe, screenshots as artifacts | To do (no verified setup action for 4.7) |
| Godot in the cloud environment's setup script | To do: the user's environment setting |
| Create `main`, protect it, end every session with a PR into it; merge the `ccr-*` branches | To do: needs the user's go-ahead |

## 5. Plan

1. **No API key, no Godot:**
   - ✅ prove the bake;
   - ✅ STYLE, DECISIONS, manifest, lint and credits;
   - key-hue team colour plus hue-swap shader;
   - a hero recolour pass in place of the multiply tint;
   - kitbash to 20 silhouettes.
2. **Godot needed (locally or in CI):**
   - swap `visuals.gd` to baked sheets behind a setting;
   - compare against `battle.jpg`;
   - Kenney SFX and particle VFX;
   - drop the Free Pack.
3. **API key (about $10) and optionally $16 of packs:**
   - splash portraits from renders;
   - ability and item icon sheets;
   - restyle or delete the paint-over ground;
   - music after checking each licence by hand.
