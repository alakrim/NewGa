# Sprite sheet animations

Row indexes are 0-based, counted from the top of each sheet. Columns are frame indexes, 0-based, left to right.
Frame counts come from `sheets.json` (`row_frames`), which counts only non-empty frames. Every listed row is complete, with no empty trailing cells.
Paths are relative to `godot/assets/`. Frame size is square unless noted.

Confidence: **high** means the motion is clear in the art. **medium** means the motion is clear but the name is inferred. **low** means the motion is observed but the name is not verified.

Regenerate `sheets.json` and the contact sheets with `python3 -I tools/analyze-sheets.py --contact /tmp/claude-0/shots --cell 150`.

---

## CC0 pack (`tinyswords/`)

### Factions/Knights/Troops/Warrior/Blue/Warrior_Blue.png
Frame 192x192, grid 6 cols x 8 rows. All rows have 6 frames.
- row 0: **idle**, 6f. Stands facing right, sword held at the side. High confidence.
- row 1: **run**, 6f. Body sways and bobs, legs visible. Medium confidence.
- row 2: **attack right, variant A**, 6f. Sword raised overhead in frames 0-2, then a large arc on the right in frames 3-4. Frame 5 is the recovery. High confidence.
- row 3: **attack right, variant B**, 6f. Sword held low on the left in frames 0-2, then a sweep from lower-left to the right in frames 3-4. High confidence.
- row 4: **attack down, variant A**, 6f. Arc below the body in frames 3-4. High confidence.
- row 5: **attack down, variant B**, 6f. Arc below and to the side in frames 3-4. High confidence.
- row 6: **attack up, variant A**, 6f. Back-facing. Arc over the head in frames 3-4. High confidence.
- row 7: **attack up, variant B**, 6f. Forward-facing. Horizontal overhead arc across the top in frames 3-4. Medium confidence on the direction label.

### Factions/Knights/Troops/Pawn/Blue/Pawn_Blue.png
Frame 192x192, grid 6 cols x 6 rows. All rows have 6 frames. The figure is small in the cell, roughly 50px.
- row 0: **idle**, 6f. Small breathing bob. High confidence.
- row 1: **idle variant or run in place**, 6f. A small item sits at the bottom-left in frame 0. Low confidence.
- row 2: **interact, swing right** (axe or pickaxe), 6f. A tool arc appears on the right in frames 3-4, and a chunk flies up in frames 0-2 and 5. Medium confidence.
- row 3: **interact, impact**, 6f. Debris flies left and the arc sweeps low in frames 3-4. Medium confidence.
- row 4: **hands-up bob**, 6f. Motion is only the small hand dots moving. Low confidence.
- row 5: **hands-up bob, alternate timing**, 6f. Same as row 4 with different timing. Low confidence.

### Factions/Knights/Troops/Archer/Blue/Archer_Blue.png
Frame 192x192, grid 8 cols x 7 rows. Rows 0-1 have 6 frames. Rows 2-6 have 8 frames.
- row 0: **idle**, 6f. Bow held at the side. Medium confidence.
- row 1: **idle variant**, 6f. Same pose with different timing. Low confidence.
- row 2: **shoot up**, 8f. Draw in frames 0-1, arrow vertical in frames 2-5, arrow released up-right in frame 6, relax in frame 7. High confidence.
- row 3: **shoot up-right (diagonal)**, 8f. Draw in frames 0-1, arrow diagonal up-right in frames 3-5, relax in frames 6-7. High confidence.
- row 4: **shoot right (level)**, 8f. Draw in frames 0-1, arrow horizontal right in frames 2-5, relax in frames 6-7. High confidence.
- row 5: **shoot down-right (diagonal)**, 8f. Arrow pointing down-right in frames 3-5. High confidence.
- row 6: **shoot down**, 8f. Arrow pointing straight down in frames 3-5, with frames 0-2 showing the draw toward the lower-left. High confidence.

The left-facing aims have no separate rows. Use horizontal flips of the right-facing rows to get them, and confirm in game.

### Factions/Knights/Troops/Archer/Archer + Bow/Archer_Blue_(NoArms).png
Frame 192x192, grid 6 cols x 2 rows. Body only, with the arms and bow removed. Both rows are 6 frames of idle, which matches row 0 and row 1 of `Archer_Blue.png`. Use this as the base layer when the bow is a separate overlay.

### Factions/Knights/Troops/Archer/Archer + Bow/Archer_Bow_Blue.png
Frame 192x192, grid 8 cols x 2 rows. Bow-only overlay.
- row 0: **bow at rest**, 1f (frame 0 only).
- row 1: **bow draw and shoot**, 8f. Aim angles progress from up-left to right, matching the body rows above.

### Factions/Goblins/Troops/Torch/Blue/Torch_Blue.png
Frame 192x192, grid 7 cols x 5 rows. Row 0 has 7 frames. Rows 1-4 have 6 frames.
- row 0: **idle**, 7f. Torch flame flickers. High confidence.
- row 1: **run**, 6f. Torch sways in front, body bobs. Medium confidence.
- row 2: **attack, torch arc, variant A**, 6f. Torch swings in a large arc over the front in frames 3-4. High confidence.
- row 3: **attack, torch arc, variant B**, 6f. Arc sweeps low from the lower-left in frames 3-4. High confidence.
- row 4: **attack, overhead circle**, 6f. Goblin sits lower. Arc circles over the head in frames 3-4. Medium confidence.

### Factions/Goblins/Troops/TNT/Blue/TNT_Blue.png
Frame 192x192, grid 7 cols x 3 rows. Rows 0-1 have 6 frames. Row 2 has 7 frames.
- row 0: **idle**, 6f. Stick with a lit fuse held at the side. Medium confidence.
- row 1: **idle variant**, 6f. Same pose, stick held higher. Low confidence.
- row 2: **throw / place**, 7f. Stick raised overhead in frames 0-1, then dropped and released in frames 2-5. Medium confidence.

### Factions/Goblins/Troops/TNT/Dynamite/Dynamite.png
Frame 64x64, grid 6 cols x 1 row. **Lit-fuse loop**, 6f. The dynamite stick with flickering sparks. Use this as the projectile or item sprite.

### Factions/Goblins/Troops/Barrel/Blue/Barrel_Blue.png
Frame 128x128, grid 6 cols x 6 rows. Frame size is 128, not 192. Row counts are 1, 6, 1, 6, 3, 3.
- row 0: **idle, still pose**, 1f. Medium confidence.
- row 1: **roll / hop**, 6f. Barrel bounces in place. Low confidence.
- row 2: **idle, eyes visible**, 1f. Low confidence.
- row 3: **roll / hop, alternate**, 6f. Low confidence.
- row 4: **fuse flicker / angry**, 3f. Eyes change and the fuse flares. Low confidence.
- row 5: **damage / explode**, 3f. Frames 0-1 are red-tinted, frame 2 has a spark burst. Medium confidence.

---

## Free pack (`tinyswords_free/`, not committed)

### Units/Blue Units/Lancer/
Each file is one row. Frame 320x320.
- `Lancer_Idle.png`, 12f: **idle**.
- `Lancer_Run.png`, 6f: **run**, spear held upright.
- `Lancer_<Dir>_Attack.png`, 3f each: **thrust**, windup, strike, recover.
- `Lancer_<Dir>_Defence.png`, 6f each: **defence**, spear held and pointed in that direction.
- `<Dir>` is one of Right, UpRight, Up, DownRight, Down. There are no left-facing files, so mirror the right-facing ones for left.

### Units/Blue Units/Monk/
Frame 192x192. Each file is one row.
- `Idle.png`, 6f: **idle**.
- `Run.png`, 4f: **run**.
- `Heal.png`, 11f: **heal cast**, arms raised with sparkles.
- `Heal_Effect.png`, 11f: **heal effect overlay**, green sparkles and ground glow, drawn on top of the monk.

### Units/Blue Units/Pawn/
Frame 192x192. Each file is one row.
- `Pawn_Idle.png`, 8f: **idle**, no tool.
- `Pawn_Idle <Item>.png`, 8f each: **idle carrying item**. Items: Axe, Gold, Hammer, Knife, Meat, Pickaxe, Wood.
- `Pawn_Run.png`, 6f: **run**, no tool.
- `Pawn_Run <Item>.png`, 6f each: **run carrying item**. Items: Axe, Gold, Hammer, Knife, Meat, Pickaxe, Wood.
- `Pawn_Interact Axe.png`, 6f: **chop**, swing with a visible arc in frame 2.
- `Pawn_Interact Pickaxe.png`, 6f: **mine**, swing with a visible arc in frame 2-3.
- `Pawn_Interact Hammer.png`, 3f: **hammer hit**, impact particles in frames 1-2.
- `Pawn_Interact Knife.png`, 4f: **knife slash**.

Item variants exist for Idle and Run, but Interact exists only for Axe, Hammer, Knife, and Pickaxe.
