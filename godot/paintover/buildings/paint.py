"""Painted buildings: asks Muse Image for the keep and a sheet of plot buildings in the battlefield painting's
style and camera angle, on flat magenta, then cuts each building out (cut.py).

    OPENROUTER_API_KEY=... python3 paint.py castle|sheet
"""
import base64, io, json, os, sys, time, urllib.request
from PIL import Image

HERE = os.path.dirname(os.path.abspath(__file__))

COMMON = """Seen from a high three-quarter view looking down at exactly 52 degrees with an orthographic camera (no \
perspective), the front of each building facing the viewer, exactly like the camp in IMAGE 1. Painted in the same \
style as IMAGE 1: highly detailed, painterly fantasy game art, warm golden-hour sunlight from the left, the right \
sides in soft cool shadow, ambient occlusion, real volume. Use IMAGE 1 only for style and lighting; never copy \
its layout or contents.

Team colour: deep royal blue roof tiles, blue banners and blue trims, with weathered grey stone and dark timber.

The background must be ONE flat, uniform, pure magenta colour (#FF00FF) everywhere around the buildings: no \
ground, no grass, no base, no cast shadow on the background, no gradient, no texture, no frame. Each building \
stands on nothing, with a clean crisp outline against the magenta. No characters, people, animals, text or \
labels."""

PROMPTS = {
    "castle": """A single large medieval fortress keep for a strategy game, centred in the image and filling about \
80% of the frame: a massive square stone keep with four round corner towers, crenellated walls, a big arched \
gate with an iron portcullis facing the viewer, conical blue slate roofs, blue war banners hanging from the \
walls, arrow slits, moss and battle damage. """ + COMMON,
    "sheet": """A sprite sheet of eight separate medieval army-camp buildings for a strategy game, laid out in a \
grid of four columns and two rows, each building centred in its own cell with plenty of empty magenta space \
between them, all drawn at the same scale (each about as wide as its cell's middle two thirds):
row 1: a barracks (long timber-and-stone hall with a weapon rack), an archery range (open timber shed with \
straw targets), a sanctum (small stone chapel with a bell tower and stained glass), a cottage (small house with \
a chimney);
row 2: a blacksmith forge (stone workshop with a glowing furnace and anvil), a mine shaft entrance (timber \
headframe over a dark shaft, with a cart), a wooden watchtower (tall timber tower with a roofed platform), a \
stone defence tower (round stone tower with a conical roof). """ + COMMON,
}

if __name__ == "__main__":
    name = sys.argv[1]
    buf = io.BytesIO()
    Image.open(f"{HERE}/style_ref.jpg").convert("RGB").save(buf, "JPEG", quality=90)
    ref = "data:image/jpeg;base64," + base64.b64encode(buf.getvalue()).decode()
    body = {"model": "meta/muse-image", "prompt": PROMPTS[name], "aspect_ratio": "1:1" if name == "castle" else "2:1",
            "input_references": [{"type": "image_url", "image_url": {"url": ref}}]}
    t = time.time()
    req = urllib.request.Request("https://openrouter.ai/api/v1/images", data=json.dumps(body).encode(),
                                 headers={"Authorization": "Bearer " + os.environ["OPENROUTER_API_KEY"],
                                          "Content-Type": "application/json"})
    d = json.load(urllib.request.urlopen(req, timeout=600))
    im = Image.open(io.BytesIO(base64.b64decode(d["data"][0]["b64_json"]))).convert("RGB")
    im.save(f"{HERE}/raw_{name}.jpg", quality=95)
    print(name, im.size, f"{time.time() - t:.0f}s")
