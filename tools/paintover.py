"""Paint-over experiment: sends block-map guide tiles to Muse Image (OpenRouter) and saves the paintings.

    OPENROUTER_API_KEY=... python3 tools/paintover.py 2 7 1 ...

Tiles are numbered left to right as godot/paintover/capture.gd writes them. When a neighbour is already
painted, its overlapping strip is pasted into this tile's guide (so the model continues it) and the whole
neighbour goes along as a second reference, so the style carries over. PO_STYLE=1 adds the concept art as a
style reference (it made the model copy the concept's layout, so it is off by default).
"""
import base64, io, json, os, sys, time, urllib.request
from PIL import Image

ROOT = os.path.join(os.path.dirname(__file__), "..", "godot", "paintover")
STYLE = os.path.join(os.path.dirname(__file__), "..", "docs", "concepts", "01-hd2d-golden-hour.jpg")
COLS = 3
TILE_W, STEP = 76.5, 66.0  # tiles.gd: tile width and column spacing in units
OVERLAP_PX = round((TILE_W - STEP) / TILE_W * 1920)
# Only part of the overlap is pasted: the model leaves a faint edge where the pasted strip ends, and
# stitch.py cuts on the far side of it, inside the overlap.
SEED_PX = 140

PROMPT = """Repaint a 3D blockout of a video game map into finished game art.

IMAGE 1 is the blockout: a plain-coloured 3D render, seen from above at a fixed 52 degree camera angle with an \
orthographic camera. Your painting will be projected back onto these exact 3D blocks pixel by pixel, so the \
layout must match IMAGE 1 exactly: every edge, outline, tree, rock, cliff, pad, road edge and shoreline must stay \
at the same position and the same size. Do not move, add, remove, resize or merge anything. Do not zoom, crop, \
pan, rotate or change the perspective. Fill the whole frame edge to edge with no border.

Height matters: the ONLY vertical walls in the map are the grey-brown bands (cliffs and shore). Every other \
boundary between two colours, especially both edges of the tan road, is a flat transition on level ground: no \
cliff, ledge, wall, step or embankment there. The road must cover exactly the same pixel rows as the tan strip \
in IMAGE 1, full width, with no cliff or rock wall above or below it. Cliff faces must be exactly as tall as the grey-brown band in \
IMAGE 1 (they are short); never make them taller or let them spill onto the ground below.

What each blockout colour is:
- mid green flat ground: a grass meadow with short grass, small flower patches and subtle dirt spots
- lighter green flat ground (raised area): the grass top of a raised plateau
- grey-brown vertical band below the plateau: an earthen cliff face with stone layers and roots
- thin dark grey-brown band at the island edge: a low rocky shore
- tan horizontal strip: a packed dirt road with wheel ruts, small pebbles at its edges, grass tufts along the rims
- pale yellow rectangles: empty, flat, levelled sand building plots with a neat border (keep them empty)
- light grey circles and squares: flat, empty stone paving (keep them empty)
- blue: water, with gentle ripples and a little foam where it meets the shore
- green balls on brown trunks: round leafy oak trees; dark green cones: pine trees
- small green bumps: bushes; small grey bumps: boulders
- grey rocks with yellow dots: rocks with veins of shining gold ore

Art style: HD-2D (Octopath Traveler, Sea of Stars): rich, crisp pixel-art texture detail on a lit 3D \
diorama, saturated warm greens, warm afternoon sunlight, soft cool-blue shadows. Keep every shadow where \
IMAGE 1 has it. The lighting must be perfectly even across the whole image: no light gradient, no bright or \
yellow corner, no vignette, no depth-of-field blur, no light rays, no fog, no glow, because this is a texture \
that gets tiled next to other tiles. The road is the same packed dirt with two faint wheel ruts everywhere.

The image must contain no characters, soldiers, people, animals, buildings, houses, castles, towers, banners, \
flags, fences, carts, campfires, text, numbers, icons, user interface or minimap. Only terrain, plants, rocks, \
water and the empty plots and pavings."""

NEIGHBOUR = """

The {edge} edge strip of IMAGE 1 (about 7% of the width) is already painted: it comes from the finished \
neighbouring tile. Keep that strip exactly as it is, continue it seamlessly, and paint the rest of the image in \
exactly the same style, palette, grass, road and tree style and lighting, so the tiles join without a seam. \
Everything outside that strip follows the blockout colours of IMAGE 1, not the strip."""


# What each tile holds, so the model does not invent cliffs or move things. Rows are pixel rows of the
# 1280 px tall guide: cliff face at v 9.5..11.3, road at v -3.6..2.0 on the view plane (tiles.gd).
ROWS = "The road covers pixel rows 779 to 917 (of 1280)."
NOTES = {
    0: "Layout of this tile: the WEST end of the island, open water beyond its left shore. A raised plateau with "
       "fourteen sand plots (two rows of seven) fills the upper part from about 5% to 84% of the width; its front "
       "is a short cliff covering pixel rows 545 to 592 only, and the cliff stops at 84% of the width. To the right "
       "of the plateau the ground is flat meadow with no cliff. The grey rectangle on the left end of the road is "
       "the empty stone courtyard of a castle. One stone circle above the road on the right. " + ROWS,
    1: "Layout of this tile: the middle of the island. The WHOLE tile is flat level ground: there is NO plateau, "
       "NO cliff, NO wall and NO ledge anywhere in it, only meadow, forest, the road and the shore. Three stone "
       "circles above the road. " + ROWS,
    2: "Layout of this tile: the EAST end of the island, open water beyond its right shore. A raised plateau with "
       "fourteen sand plots (two rows of seven) fills the upper part from about 13% to 92% of the width; its front "
       "is a short cliff covering pixel rows 545 to 592 only, and the cliff starts at 13% of the width. To the left "
       "of the plateau the ground is flat meadow with no cliff. The grey rectangle on the right end of the road is "
       "the empty stone courtyard of a castle. One stone circle above the road on the left. " + ROWS,
}


def data_url(path, max_side=1920):
    im = Image.open(path).convert("RGB")
    im.thumbnail((max_side, max_side))
    buf = io.BytesIO()
    im.save(buf, "JPEG", quality=92)
    return "data:image/jpeg;base64," + base64.b64encode(buf.getvalue()).decode()


def neighbour(i):
    for j in (i - 1, i + 1):
        if 0 <= j < COLS and os.path.exists(f"{ROOT}/paint/tile_{j}.jpg"):
            return j
    return None


def seeded_guide(i, n):
    """The guide with the neighbour's overlapping strip pasted in."""
    g = Image.open(f"{ROOT}/guides/tile_{i}.png").convert("RGB")
    p = Image.open(f"{ROOT}/paint/tile_{n}.jpg").convert("RGB")
    if n > i:  # neighbour on the right: its left strip goes on our right edge
        g.paste(p.crop((OVERLAP_PX - SEED_PX, 0, OVERLAP_PX, 1280)), (1920 - SEED_PX, 0))
    else:
        g.paste(p.crop((1920 - OVERLAP_PX, 0, 1920 - OVERLAP_PX + SEED_PX, 1280)), (0, 0))
    path = f"{ROOT}/guides/seeded_{i}.png"
    g.save(path)
    return path


def paint(i, key):
    guide = f"{ROOT}/guides/tile_{i}.png"
    n = neighbour(i)
    if n is not None:
        guide = seeded_guide(i, n)
    refs = [data_url(guide)]
    prompt = PROMPT + "\n\n" + NOTES[i]
    if n is not None:
        prompt += NEIGHBOUR.format(edge="right" if n > i else "left")
    if os.environ.get("PO_STYLE"):
        refs.append(data_url(STYLE))
        prompt += f"\n\nIMAGE {len(refs)} is a style reference only: copy its colours and rendering, never its layout."
    body = {
        "model": "meta/muse-image",
        "prompt": prompt,
        "aspect_ratio": "3:2",
        "input_references": [{"type": "image_url", "image_url": {"url": u}} for u in refs],
    }
    t = time.time()
    req = urllib.request.Request("https://openrouter.ai/api/v1/images", data=json.dumps(body).encode(),
                                 headers={"Authorization": "Bearer " + key, "Content-Type": "application/json"})
    d = json.load(urllib.request.urlopen(req, timeout=600))
    im = Image.open(io.BytesIO(base64.b64decode(d["data"][0]["b64_json"]))).convert("RGB")
    os.makedirs(f"{ROOT}/paint", exist_ok=True)
    im.resize((1920, 1280), Image.LANCZOS).save(f"{ROOT}/paint/tile_{i}.jpg", quality=93)
    print(f"tile {i}: {im.size} in {time.time() - t:.0f}s, neighbour {n}, cost {d.get('usage', {}).get('cost')}")


if __name__ == "__main__":
    key = os.environ["OPENROUTER_API_KEY"]
    for a in sys.argv[1:]:
        paint(int(a), key)
