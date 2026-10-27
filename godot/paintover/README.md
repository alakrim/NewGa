# Paint-over experiment

A quick test of "block out the map, have an image model paint over it, project the painting back onto the
blocks". Everything lives in this folder plus `tools/paintover.py` and the `ortho` switch in
`scripts/game.gd`, so removing it is: delete this folder and `tools/paintover.py`, and revert the `ortho` lines.

How it works: the game camera never changes pitch (52°). With an orthographic camera at that pitch, every
surface lands on the same spot of one flat "view plane" (u = x, v = y·cos52° − z·sin52°) wherever the camera
pans or zooms, so a single painting of that plane fits the 3D blocks from every camera position.

1. `capture.tscn` renders the block map (`blockout.gd`) in flat colours, lit by the game's sun, as three
   overlapping 1920×1280 tiles (`guides/`).
2. `tools/paintover.py` sends each guide to Muse Image (OpenRouter, `meta/muse-image`, ~$0.01 per tile) with
   a detailed prompt and a per-tile layout note. The middle tile goes first; the outer tiles get a strip of it
   pasted into their guide so the model continues it (`paint/`).
3. `stitch.py` evens out each tile's large-scale colour against its guide and joins the tiles along the
   lowest-difference seam (`pano.jpg`).
4. `painted.tscn` stages the battle from `tests/hd2d.tscn`, swaps the game's terrain, grass, trees and props
   for the blocks with `projection.gdshader`, and turns on the orthographic camera (`shots/`).

```bash
godot --path godot --resolution 1920x1280 res://paintover/capture.tscn
OPENROUTER_API_KEY=... python3 tools/paintover.py 1 0 2
python3 godot/paintover/stitch.py
VT_SHOTS=$PWD/godot/paintover/shots godot --path godot --resolution 1280x720 res://paintover/painted.tscn
```

Findings: a style reference image made Muse copy its layout (it drew the concept's long cliff), so the style
is described in text only. Sending a whole neighbouring tile as a reference made it copy that tile; pasting
only a strip works. It still invents things sometimes (a cliff across the open meadow, extra plots), which the
per-tile layout notes fixed. Painted cliffs come out a bit taller than the blocks. `pano.jpg` is loaded from
disk at runtime, which only works when running from the project, not in an exported build.
