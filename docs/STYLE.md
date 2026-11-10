# Bannerfall style guide

The one place that says what the game looks like and how new art gets in. Read it before making or importing any
art. Decisions behind it are in `docs/DECISIONS.md`; the free sources and AI pipeline are in `docs/REVIEW-ART.md`.

## The look

**HD-2D.** Chibi pixel-art characters stand as camera-facing sprites in a lit 3D world. The world has:
- pixel-textured ground and KayKit low-poly buildings;
- a low golden-hour sun from the upper left with real shadows;
- bloom, tilt-shift depth of field, a warm split-tone grade, light shafts and fireflies.

The camera looks down at 52°, one world unit is one sim unit, and sprites use 32 texels per unit.

**Characters (proposed, see DECISIONS):** KayKit CC0 3D characters baked to pixel sprite sheets by
`tools/bake-sprites.ts`, replacing the Tiny Swords units over time. The CC0 Tiny Swords decoration, effects and
UI stay.

## Sprite spec

| | Value | Why |
|---|---|---|
| Frame | 192 × 128 px (3:2) | Room for forward swings and death falls; the Tiny Swords frame shape |
| View | Orthographic, 18° above the horizon, facing right, turned 0.55 rad toward the viewer | Billboards are seen face-on. The 52° game pitch would show only the tops of the heads |
| Character height | About 78 px of the 128 px frame | Matches the Tiny Swords units on screen |
| Outline | 3 px, `#1b1426` (dark plum) | Thinner outlines vanish at game scale |
| Palette | At most 32 colours per character, no dithering | Pixel-art read; one palette across all of a character's frames |
| Grade | Saturation ×1.3, warmth (1.06, 1.0, 0.92) | Renders come out cooler and greyer than painted pixel art |
| Light | Warm key from the upper left (`#ffe6c0`), cool rim from behind, ACES tone mapping | Same sun as the world |
| Rows | idle 8 frames at 8 fps, run 8 at 12, attack 6 at 12, death 6 at 10 | One row per animation, left to right |
| Facing left | Flip the sprite | Never bake twice |

## Colour

| Team | Players | Hex | Shape (to add, for colour-blind players) |
|---|---|---|---|
| Dawnguard (team 0, left) | blue, purple | `#3d8bfd`, `#9b5de5` | Round ground marker |
| Duskborn (team 1, right) | red, yellow | `#e5484d`, `#e8b923` | Diamond ground marker |

Team colour is applied by a hue swap in the shader, never by baking four copies. Identity colours (a hero's
`visual.tint`) are for cloth only and must stay readable next to every team colour.

## AI prompts

Use AI only where a render or a free pack can't do the job: splash art, icons, menu art, ground paintings.
Character images always start as image-to-image from that character's render, so the model restyles and never
invents. Every prompt starts with the style block, unchanged.

**Style block:**
> Stylised low-poly fantasy game art, chunky toy-like proportions, large heads, simple gradient shading, flat
> saturated colours, thick dark outline, warm golden-hour key light from the upper left, no photorealism, no
> text, no watermark.

**Splash or portrait** (image-to-image from the hero render):
> [STYLE]. IMAGE 1 is the character; keep the exact outfit, colours, weapon and proportions. Repaint as a dynamic
> three-quarter hero portrait, {pose}, {one-line personality}, simple {biome} background blurred, waist-up,
> centred.

**Ability icon sheet** (text-to-image, 16 per image):
> [STYLE]. A 4×4 grid of square game ability icons on flat magenta, even gutters, each a single bold symbol
> readable at 48 px: {16 subjects}. Consistent rim light, {hero colour} accent.

**Ground tile** (image-to-image; Seedream 5.0 Flash keeps layout, then a Muse Image refine):
> [STYLE]. IMAGE 1 is a flat-colour layout guide; keep every shape's position. Repaint as hand-painted low-poly
> terrain seen from 52° above, autumn palette from IMAGE 2, large clean shapes, no small noisy detail.

Post-process every AI image the same way as bakes: key out magenta (`tools/magenta_key.py`),
quantise, outline and nearest-neighbour downscale.

## How art gets in

1. It comes from an allowed source:
   - CC0;
   - CC BY with a credit line;
   - OFL for fonts;
   - made by the project (scripts, bakes, AI output).

   Never NC, share-alike or GPL art. Never the Tiny Swords Free Pack in git.
2. It enters through a script that can be re-run:
   - `tools/bake-sprites.ts` for characters;
   - `tools/fetch-*.mjs` for packs;
   - a prompt file for AI images.
3. It gets an entry in `assets-manifest.json`: source URL, licence, author, plus model and prompt file for AI
   output. CI runs `python3 tools/assets.py lint` and fails on any file without one. Run
   `python3 tools/assets.py credits` to refresh `CREDITS.md`.
4. It is judged in context: a contact sheet plus a mock or screenshot beside the current art (`docs/art-tests/`),
   never on a blank background alone.

## Do and don't

- Do compare new art against `docs/screenshots/godot/battle.jpg` at game scale.
- Do keep silhouettes distinct at 46 px tall: weapon, headgear and colour, in that order.
- Don't mix photoreal or painterly detail with chibi sprites. The deleted paint-over buildings are the example (git history, 2026-10-27).
- Don't add a style experiment without a hypothesis, merge criteria and a kill date (`docs/DECISIONS.md`).
