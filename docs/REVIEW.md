# External review (2026-11-10)

A read-only review of the project from a second model acting as game director and tech-art lead, based on
`docs/SUMMARY.md`, the code and the screenshots. Economy rates are arithmetic from `data.ts`/`sim.ts`.
Items marked ✅ were done in the same session (see `docs/FRONTLINE-BALANCE.md` for measured before/after).

## 1. Assets and art direction

**Verdict: ship HD-2D now; treat paint-over as a future second map skin, not a replacement.**
- HD-2D is coherent: sprites, grass and road share one outlined palette. Weak spots: a flat, empty map
  (`wide.jpg`, `base.jpg`) and KayKit low-poly buildings that already clash mildly with the pixel units.
- Paint-over B on blocks reads better than expected: the grey road makes all four team colours pop more than
  the yellow road. It still looks like stickers on a photo, with projection artefacts in `compare-2`.
- Depth variant + painted buildings is the worst clash: a near-photoreal keep beside 2-head-tall chibis at a
  different pixel density. Don't go further down that road with these units.

**Resolving the clash, in order of preference:**
1. **Units win.** Pull the environment toward the sprites: posterise the painting to 24-32 colours, a 1 px dark
   edge pass, nearest-neighbour downscale to the sprite texel density. Doable in `stitch.py` (PIL), no new art.
   Repaint buildings later with a flat-colour, thick-outline prompt.
2. **Glue only.** In painted mode, contact blob shadows and a 10-15% tint of sprites toward the ground colour.
3. **Painting wins.** Painterly units: ~8 units × 4 colours × animations of new art. Rejected for now.

**Readability in big fights:** purple reads as desaturated blue and yellow as pale red; teams differ by colour
only. Add a team-shaped ground marker (round for Dawn, diamond for Dusk), a 1 px team rim, and face the enemy
when idle. Units overlap ~40% in melee: raise separation or shrink pop-1 sprites 0.85 → 0.75. Heroes are
indistinguishable from soldiers: 1.25× scale, a pennant, a name plate and a thicker ring until hero bodies exist.

**Missing:** hero bodies (new art); ability VFX (Kenney Particle Pack, CC0, tintable); audio in the Godot client
(Kenney UI/Impact/RPG CC0 packs; CC0-only music); ability/item icons (game-icons.net is CC BY 3.0: credit it);
the unit bar in `hud-aim.jpg` is small and dark. `visuals.gd` maps core units to the non-redistributable Free
Pack, so a clean clone has no core units: add a CC0 fallback (Update 010 Warrior, Archer, Pawn).

## 2. Gameplay and design

- ✅ **Rich veins are a trap.** Safe trip ≈ 0.75-1.6 g/s; rich trip ≈ 34 s for 24 g (0.7 g/s), and miners
  flee. Fix: owned outposts act as drop-offs.
- ✅ **Bots want 9 miners each** → 18 per team for 16 safe slots; two always trek to the middle and feed bounties.
- ✅ **Market is dominated** (500 g for 2 g/s = 250 s payback vs ~95-200 s for a miner).
- ✅ **Houses tax plots** (4 of 7 plots to reach 40 pop). Suggest base 16, +10 per House, max 3.
- ✅ **Archer overpriced** (300 g for 19 dps / 230 hp vs Swordsman 125 g for 18 dps / 340 hp).
- ✅ **Healing scales with weapons research** (undocumented).
- ✅ **Snowball:** banners pay the side winning the lane, plus capture gold, bounties, flat 200 per hero kill.
  No comeback rule in Frontline.
- ✅ **No stalemate breaker:** garrison multiplies keep fire by 1 + 0.12 per unit (30 units = 4.6×) and heals
  5%/s. Add Sudden Death after 12 min and cap the garrison bonus.
- ✅ **Stances are coarse / hero role is thin.** Add **Follow** (army anchors on the hero).
- **Co-op feel:** teammates share only the keep. Add `giveGold`, pings, one shared team research.
- ✅ **Counters:** nothing counters the Giant except mass. Archers +50% damage against heavies.

## 3. Tech and code

- **Export blockers:** ✅ `Image.load_from_file(globalize_path(...))` in the paint-over scripts → `load("res://…")`;
  ✅ `pano.jpg` is 5098 px wide (> 4096 mobile texture limit); `height.bin` needs an export filter; no
  `export_presets.cfg`; Free Pack absent on a clean clone.
- ✅ **`formationSpot` is O(n²)**: `owned()` per idle unit per tick. Cache per-player role lists per step.
- ✅ **Banner event** always sends `key: 'keep'`.
- **Garrisoned units leave `g.units`**: timers freeze and anything iterating units misses them. A flag would be safer.
- ✅ **Queued units are lost** with no refund when their trainer building is destroyed.
- ✅ **Thin tests**: nothing asserts that a match ends or how long it takes.
- **Data drift**: add a test that `gen-godot-data.ts` output matches the committed `fl_data.gd`.

## 4. To-do (ranked)

| # | Item | Effort | Without Godot / new art |
|---|---|---|---|
| 1 | ✅ Frontline balance harness | M | Yes |
| 2 | ✅ Sudden Death (+ keep crumble) and garrison cap | S | Yes |
| 3 | ✅ Outposts as drop-offs, bot miner cap | S | Yes |
| 4 | ✅ Follow stance (sim, both HUDs; bots keep Hold, see below) | S-M | Sim yes; HUD unverified |
| 5 | ✅ Comeback rules | S | Yes |
| 6 | ✅ Number pass: pop, Archer, Market | S | Yes |
| 7 | ✅ `load()` instead of disk loads; split pano | S | Yes, unverified in-engine |
| 8 | CC0 fallback sprites in `visuals.gd` | S | By reading |
| 9 | Team-shape ground markers, hero emphasis | S | By reading; needs a visual check |
| 10 | `giveGold` and pings | S | Yes |
| 11 | ✅ Perf: cache role lists | S | Yes |
| 12 | Posterise + outline pass in `stitch.py` | M | Python yes; look check needs Godot |
| 13 | Audio: Kenney CC0 SFX, music bus | M | Wiring needs runtime |
| 14 | Export presets, phone test | M | No |
| 15 | Hero bodies, VFX sheets, flat-style building repaint | L | No (new art) |

## What the session changed beyond the review

- **The real stalemate cause was a bug.** Frontline clamps walkers to the lane band (z ≥ −11) but build plots
  sit at z = −15 and −21. Melee units and bot heroes that picked a plot building as a target pushed against
  the edge forever. `Game.inReach` now skips structures a unit can't hit from the lane.
- **Sudden Death also crumbles the keeps** (15 true damage per second). Armour decay alone did not end sieges.
- **Bots don't use Follow.** The bot hero positions itself relative to its army's front line, so an army that
  anchors on the hero would drift backwards. Bots keep Hold at the Heart; Follow is a player tool.

## 5. Big ideas

1. **The Standard-Bearer.** Your hero carries the banner; Follow-stance units in its aura fight harder; if the
   hero dies the banner drops and can be captured for gold. Makes the title literal.
2. **Combined-arms pacts.** Bonuses only across teammates (my Shieldbearers near your Archers = shield wall).
3. **Scarred battlefield.** Craters, corpses, burnt ground persist as slow zones and cover.
4. **Replay postcards.** The end screen auto-picks the biggest army-value swing and replays 10 s of it.
5. **War council vote.** Every 3 min both teammates pick 1 of 3 team edicts (Conscription, Gold Rush, Siege Season).
6. **Possess a soldier for 10 s on hero death.** Death becomes play.
7. **Dusk and Dawn tide.** Day/night alternately buffs each side's keep and vision: natural push rhythm.
8. **Asymmetric 2-v-Horde** weekly challenge with seeded, verifiable leaderboards.
