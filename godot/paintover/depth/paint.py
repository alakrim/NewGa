"""Depth paint-over, step 2: one free, concept-quality painting of the west end of the battlefield from the
zone sketch (Muse Image on OpenRouter). The model composes everything; the sketch only fixes the big zones.

    OPENROUTER_API_KEY=... python3 paint.py [tag] [--swatches]
"""
import base64, io, json, os, sys, time, urllib.request
from PIL import Image

HERE = os.path.dirname(os.path.abspath(__file__))
SWATCHES = os.path.join(HERE, "..", "concepts", "b-swatches.jpg")

PROMPT = """A breathtaking showpiece video game battlefield, "The Autumn Siege": the western end of a long war \
road through a blazing autumn forest, seen from a high three-quarter view looking down at 52 degrees with an \
orthographic camera (no perspective, horizon not visible).

IMAGE 1 is a rough zone map: it fixes only WHERE the big areas are, so keep every zone exactly where and as big \
as it is in IMAGE 1, but invent all the detail inside each zone freely and richly. Do not copy its flat colours \
or hard edges: it is only a map.
- rust red background: dense, deep, layered autumn forest of red, orange and gold maples and dark pines, with \
volume, depth and shadowed gaps between the crowns
- big tan area top left: a raised plateau holding the western army's war camp, with a short rocky cliff face \
(the grey-brown band) toward the road
- pale yellow rectangle on the plateau: flat, cleared, trampled building ground of the camp, kept EMPTY and \
open (the game places buildings on it later): only bare earth, a few tracks and small scattered crates at the edges
- white band behind it: rows of striped canvas army tents, timber watchtowers, supply carts and campfires inside \
a log palisade that runs around the camp
- dark brown band above the road: earthen trenches with sharpened stake barricades, dug earth, scattered debris
- tan area top right: an open autumn meadow scarred by battle (craters, scorch marks, broken weapons)
- grey band: a very wide ancient paved military road of large worn flagstones
- light grey square at the left end of the road: the empty stone courtyard of the western fortress gate, low \
walls and two braziers (keep the courtyard floor empty: the castle is added by the game)
- blue ring on the road: an inlaid stone circle where a war standard is planted (empty)
- dark grey band below the road with four yellow spots: a rocky strip with four outcrops of rock veined with \
glittering gold ore, mining tools and small mine carts beside them

The road must stay calm and readable, because many small, brightly coloured soldiers fight on it: even, \
medium-dark, slightly desaturated warm grey stone with fine, low-contrast texture, no props, no leaf piles, \
only faint cracks. Put the vivid colour, contrast and storytelling detail around it.

Highly detailed, lush, painterly fantasy game environment art, rich golden-hour light from the upper left, \
soft cool shadows, ambient occlusion, real volume and cast shadows, in the spirit of HD-2D games and premium \
strategy key art. Even lighting across the frame (no vignette, no fog, no light rays). No characters, people, \
animals, castles, flags, text, user interface or minimap."""

SWATCH_NOTE = """

IMAGE 2 is a sheet of separate sample crops from the art direction, on a dark background. It has no layout: never \
copy its arrangement or background. Match how each kind of thing looks in it: the maples and pines, the tents and \
watchtowers, the trench with stakes, the paving, the gold rock outcrops."""

if __name__ == "__main__":
    tag = sys.argv[1] if len(sys.argv) > 1 else "a"
    refs = [f"{HERE}/sketch.png"] + ([SWATCHES] if "--swatches" in sys.argv else [])
    urls = []
    for r in refs:
        buf = io.BytesIO()
        Image.open(r).convert("RGB").save(buf, "JPEG", quality=92)
        urls.append("data:image/jpeg;base64," + base64.b64encode(buf.getvalue()).decode())
    body = {"model": "meta/muse-image", "prompt": PROMPT + (SWATCH_NOTE if len(refs) > 1 else ""),
            "aspect_ratio": "3:2", "input_references": [{"type": "image_url", "image_url": {"url": u}} for u in urls]}
    t = time.time()
    req = urllib.request.Request("https://openrouter.ai/api/v1/images", data=json.dumps(body).encode(),
                                 headers={"Authorization": "Bearer " + os.environ["OPENROUTER_API_KEY"],
                                          "Content-Type": "application/json"})
    d = json.load(urllib.request.urlopen(req, timeout=600))
    im = Image.open(io.BytesIO(base64.b64decode(d["data"][0]["b64_json"]))).convert("RGB")
    im.resize((1920, 1280), Image.LANCZOS).save(f"{HERE}/paint_{tag}.jpg", quality=94)
    print(tag, im.size, f"{time.time() - t:.0f}s")
