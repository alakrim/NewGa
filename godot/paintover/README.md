# Paint-over experiment

Block out the map, have image models paint over it in a chosen art direction, project the painting back
onto the blocks. Everything lives in this folder plus `tools/paintover*.py` and the `ortho` switch in
`scripts/game.gd`, so removing it is: delete this folder and `tools/paintover*.py`, and revert the `ortho`
lines.

How it works: the game camera never changes pitch (52°). With an orthographic camera at that pitch, every
surface lands on the same spot of one flat "view plane" (u = x, v = y·cos52° − z·sin52°) wherever the camera
pans or zooms, so a single painting of that plane fits the 3D blocks from every camera position.

1. **Art direction.** `tools/paintover_concepts.py` asks Muse Image for three scenario concepts with the
   game's layout (`concepts/`). Concept B, "The Autumn Siege", was chosen. `concepts/b-swatches.jpg` is a sheet
   of crops from it: the models copy a whole concept's layout, crops carry only the look.
2. **Blocks.** `blockout.gd` lays the map out after concept B: a 15-unit paved road across the whole lane,
   trenches with stakes and earth mounds, ruins, craters, walled keep courtyards, palisaded camps with tents
   and watchtowers, gold outcrops, continuous autumn canopy. `capture.tscn` renders it in flat colours as three
   overlapping 1920×1280 tiles (`guides/`).
3. **Paint, two passes** (`tools/paintover.py`, models on OpenRouter, about $0.03 per tile):
   - Seedream 5.0 Flash paints each guide with the swatches as reference (`paint/tile_*_seed.jpg`). It is the
     only model tried that keeps the layout; Muse and Flux 3 Klein copied the concept instead.
   - Muse Image refines that pass (`paint/tile_*.jpg`): richer texture, same layout.
   The middle tile goes first; the outer tiles get a strip of it pasted into their guide.
4. **Stitch.** `stitch.py` evens out each tile's large-scale colour against its guide and joins the tiles
   along the lowest-difference seam (`pano.jpg`).
5. **Play.** `painted.tscn` stages the battle from `tests/hd2d.tscn`, swaps the game's terrain, water, grass,
   trees and props for the blocks with `projection.gdshader`, turns on the orthographic camera and turns the
   game's haze down, since the painting has its own light (`shots/`).

```bash
godot --path godot --resolution 1920x1280 res://paintover/capture.tscn
export OPENROUTER_API_KEY=...
PO_MODEL=bytedance-seed/seedream-5-0-flash PO_TAG=_seed python3 tools/paintover.py 1   # then 0 and 2
PO_REFINE=1 python3 tools/paintover.py 1 0 2
python3 godot/paintover/stitch.py
VT_SHOTS=$PWD/godot/paintover/shots godot --path godot --resolution 1280x720 res://paintover/painted.tscn
```

Known gaps: the painting is about 22 px per unit, so it softens at the closest zoom; the trenches came out
flatter than in the concept; `pano.jpg` is loaded from disk at runtime, which only works when running from
the project, not in an exported build.
