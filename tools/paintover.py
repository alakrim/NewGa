"""Paint-over experiment: sends block-map guide tiles to Muse Image (OpenRouter) and saves the paintings.

    OPENROUTER_API_KEY=... python3 tools/paintover.py 1 0 2

Tiles are numbered left to right as godot/paintover/capture.gd writes them. Every tile gets the chosen concept
(godot/paintover/concepts/, CONCEPT below) as the art-direction reference. When a neighbour is already
painted, part of its overlapping strip is pasted into this tile's guide so the model continues it.
"""
import base64, io, json, os, sys, time, urllib.request
from PIL import Image

ROOT = os.path.join(os.path.dirname(__file__), "..", "godot", "paintover")
CONCEPT = f"{ROOT}/concepts/b-autumn-siege.jpg"
COLS = 3
TILE_W, STEP = 87.0, 72.0  # tiles.gd: tile width and column spacing in units
OVERLAP_PX = round((TILE_W - STEP) / TILE_W * 1920)
# Only part of the overlap is pasted: the model leaves a faint edge where the pasted strip ends, and
# stitch.py cuts on the far side of it, inside the overlap.
SEED_PX = 180
# meta/muse-image, black-forest-labs/flux-3-image-klein or bytedance-seed/seedream-5-0-flash
MODEL = os.environ.get("PO_MODEL", "meta/muse-image")
OUT_TAG = os.environ.get("PO_TAG", "")  # writes paint/tile_<i><tag>.jpg, to compare models side by side

PROMPT = """Paint one section of a video game battlefield as finished, beautiful game art.

IMAGE 1 is only a crude placeholder render made of flat-coloured primitive shapes (balls, cones, boxes). It \
shows WHERE things are, not what they look like. Replace every placeholder completely with fully detailed, \
final, painterly art in the style of IMAGE 2: each coloured ball or cone becomes a real, detailed, leafy \
autumn tree with a volumetric canopy; each flat colour area becomes richly textured ground; each box becomes \
a detailed prop. Nothing of the flat placeholder look may remain: no smooth flat colours, no primitive shapes, \
no plastic or CG look. The result must look exactly as polished and detailed as IMAGE 2.

IMAGE 1 is the layout: a plain-coloured 3D blockout render seen from above at a fixed 52 degree camera angle \
with an orthographic camera. Your painting is projected back onto these exact 3D blocks pixel by pixel, so the \
layout must match IMAGE 1 exactly: every road edge, plot, wall, trench, crater, rock, tree, tent and cliff stays at \
the same position and size. Do not move, add, remove, resize or merge layout elements. Do not zoom, crop, pan, \
rotate or change the perspective. Fill the whole frame edge to edge with no border.

IMAGE 2 is the art direction, "The Autumn Siege": match its look exactly: its blazing autumn forest of red, \
orange and gold maples with dark pines, its cracked ancient paving, its trenches with sharpened stakes, its \
striped canvas tents and timber watchtowers, its rocky gold veins, its warm golden-hour palette, rich detail, \
painterly rendering, real volume, form shading and cast shadows. Take ONLY the look and the kind of props from \
IMAGE 2. Take the layout ONLY from IMAGE 1: IMAGE 2 has a different number of plots and a different road; ignore \
its layout completely.

What each blockout colour in IMAGE 1 is:
- grey wide horizontal band: the war road, an ancient paved military road of large worn flagstones
- brown strips along both edges of the grey band: dirt verges of the road
- very dark brown thin strips beyond the verges: trenches dug along the road; the small orange sticks next to \
them are rows of sharpened wooden stakes
- olive-brown flat ground: trampled autumn meadow and forest floor covered in fallen leaves, mud and dry grass
- lighter olive flat ground (raised area) with a pale vertical band below it: a raised plateau; the pale band \
is its short rocky cliff face
- pale yellow rectangles on the plateau: empty, flat, levelled dirt building plots with a simple timber border
- orange posts and rails around the plateau: a log palisade; orange squares on legs: timber watchtowers
- white boxes and pyramids behind the palisade: striped canvas army tents
- light grey square with white walls at the end of the road: the stone courtyard of a fortress, low stone walls \
and gate pillars (keep the courtyard floor empty)
- blue-grey thin rings on the road: inlaid stone circles in the paving where war standards are planted (empty)
- near-black round spots: shell craters and scorch marks
- white blocks on the verges: broken stone pillars and toppled milestones; orange boxes: burnt-out carts
- grey clumps with yellow dots below the road: rock outcrops with glittering veins of gold ore
- red-orange balls: autumn maples; yellow balls: golden birches; dark green cones: pines (all on brown trunks)

Readability is the top priority, because many small, brightly coloured soldiers fight on the road: the paved \
road must be calm and readable: even, medium-dark, slightly desaturated warm grey stone with fine, low-contrast \
texture, no bright highlights, no busy patterns, no big props and no fallen leaves piles on it, only a few faint \
cracks and the inlaid circles. Keep the strongest colours, contrast and detail OFF the road: on the verges, \
trenches, camp and forest. The road should read as one clear, calm stage between two vivid forest walls.

Lighting: warm golden-hour sun from the upper left with soft cool shadows, keeping every shadow where IMAGE 1 \
has it. The lighting must be even across the whole image: no light gradient, no bright corner, no vignette, no \
depth-of-field blur, no light rays, no fog, no smoke columns, because this is a texture that gets joined to \
other tiles.

No characters, soldiers, people, animals, bodies, castles, houses, flags, banners, user interface, text, \
numbers, icons or minimap. Plots, courtyard floor and stone circles stay empty: the game adds those."""

NEIGHBOUR = """

The {edge} edge strip of IMAGE 1 (about 9% of the width) is already painted: it comes from the finished \
neighbouring tile. Keep that strip exactly as it is, continue it seamlessly, and paint the rest in exactly the \
same style, palette and lighting, so the tiles join without a seam. Outside that strip, follow IMAGE 1's layout."""


# What each tile holds, so the model does not invent or move things. Rows are pixel rows of the 1280 px tall
# guide (row = (33 - v) / 58 * 1280 on the view plane, tiles.gd): paved road z -7..8, cliff face at the plateau
# front, gold veins at z 11.
ROWS = ("The paved road covers pixel rows 607 to 867 (of 1280) across the whole width; the trenches run along "
        "rows 561 and 906; the gold rock outcrops sit around row 920.")
PLATEAU = ("A raised plateau fills the upper part from {a}% to {b}% of the width; its front is a short rocky cliff "
           "covering pixel rows 479 to 520 only. On it, two rows of seven empty plots inside a log palisade, "
           "with tents and two watchtowers behind it. Outside that range the ground is flat, with no cliff.")
NOTES = {
    0: "Layout of this tile: the WEST end of the battlefield, autumn forest beyond the far left. "
       + PLATEAU.format(a=18, b=87) + " The fortress courtyard sits on the left end of the road, from 26% "
       "to 43% of the width. One stone circle on the road at 94% of the width. " + ROWS,
    1: "Layout of this tile: the middle of the battlefield. No plateau here except thin slivers at the far left "
       "(up to 4%) and far right (from 94%) edges; everything else is flat level ground: a trampled meadow with "
       "craters and scattered trees above the road, the forest beyond. A broken stone arch stands above the road "
       "left of centre. Three stone circles on the road at 11%, 50% and 89% of the width. " + ROWS,
    2: "Layout of this tile: the EAST end of the battlefield, autumn forest beyond the far right. "
       + PLATEAU.format(a=11, b=80) + " The fortress courtyard sits on the right end of the road, from 57% "
       "to 75% of the width. One stone circle on the road at 6% of the width. " + ROWS,
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
    refs = [data_url(guide), data_url(CONCEPT)]
    prompt = PROMPT + "\n\n" + NOTES[i]
    if n is not None:
        prompt += NEIGHBOUR.format(edge="right" if n > i else "left")
    body = {
        "model": MODEL,
        "prompt": prompt,
        "aspect_ratio": "3:2",
        "input_references": [{"type": "image_url", "image_url": {"url": u}} for u in refs],
    }
    if MODEL != "meta/muse-image":
        body["resolution"] = "2K"
    t = time.time()
    req = urllib.request.Request("https://openrouter.ai/api/v1/images", data=json.dumps(body).encode(),
                                 headers={"Authorization": "Bearer " + key, "Content-Type": "application/json"})
    d = json.load(urllib.request.urlopen(req, timeout=600))
    im = Image.open(io.BytesIO(base64.b64decode(d["data"][0]["b64_json"]))).convert("RGB")
    os.makedirs(f"{ROOT}/paint", exist_ok=True)
    im.resize((1920, 1280), Image.LANCZOS).save(f"{ROOT}/paint/tile_{i}{OUT_TAG}.jpg", quality=93)
    print(f"tile {i} {MODEL}: {im.size} in {time.time() - t:.0f}s, neighbour {n}, cost {d.get('usage', {}).get('cost')}")


if __name__ == "__main__":
    key = os.environ["OPENROUTER_API_KEY"]
    for a in sys.argv[1:]:
        paint(int(a), key)
