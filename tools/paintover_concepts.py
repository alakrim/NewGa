"""Paint-over experiment: art-direction concepts for the battlefield from Muse Image (OpenRouter).

    OPENROUTER_API_KEY=... python3 tools/paintover_concepts.py [name ...]

Each concept is one finished scene seen from the game camera, with the Frontline layout, so the block map and
the paint-over can follow it afterwards. Writes godot/paintover/concepts/<name>.jpg.
"""
import base64, io, json, os, sys, time, urllib.request
from concurrent.futures import ThreadPoolExecutor
from PIL import Image

OUT = os.path.join(os.path.dirname(__file__), "..", "godot", "paintover", "concepts")

LAYOUT = """Camera and framing: a high three-quarter view looking down at about 52 degrees, almost orthographic \
(no strong perspective, no fisheye, horizon not visible), framed like a strategy game battlefield. The scene is \
the western half of one long battlefield that runs left to right.

Layout, which must be followed exactly because the game's units walk on it:
- A VERY WIDE war road runs straight across the whole image from left to right, through the lower middle. It is \
about one third of the image height wide, flat and open, so two whole armies can clash on it.
- At the far left end of the road stands the western army's fortress gate: a stone courtyard where the road \
ends, with braziers. Leave the courtyard itself empty (the castle model is added by the game).
- Above the road, on the left two thirds, a raised plateau with a short cliff face toward the road. On the \
plateau sit two rows of seven empty, flat, rectangular building plots (cleared, levelled ground with a simple \
border), inside a fortified war camp. Keep the plots empty: buildings are added by the game.
- Above the road on the right third: open ground at road level (no plateau), leading toward the enemy.
- Three flat round standard circles stand just above the road's upper edge: one at the right edge of the \
plateau, one at the centre of the right third, one at the right image edge (empty, flags are added by the game).
- Below the road: a strip of rocky ground with veins of shining gold ore in four rock clusters spaced along it.
- Behind everything (top of the image) and in front of everything (bottom edge): forest closing in.

No characters, soldiers, people, animals, monsters, bodies, flags, user interface, text, minimap or icons: \
the battlefield is empty and waiting for the armies, which the game adds on top."""

STYLE = """Make it beautiful, a showpiece: highly detailed, lush, painterly fantasy game environment art with \
rich lighting, depth, ambient occlusion and atmosphere, in the spirit of HD-2D games (Octopath Traveler II, \
Triangle Strategy) and premium mobile strategy key art. Crisp detail everywhere, lots of small storytelling \
props. Not a flat 2D tile map: every tree, rock, cliff and prop has real volume, form shading and cast shadows."""

IDEAS = {
    "a-ashen-greenwood": """Scenario: "The Ashen Greenwood". A war fought inside an ancient forest of colossal, \
moss-draped trees with huge roots. The war road is a broad river of churned dark mud and trampled grass, \
scarred by wheel ruts, hoof prints, puddles reflecting the sky, scorch marks, broken spears and arrows stuck \
in the ground, dropped shields. Parts of the forest beside the road are burnt: charred trunks, grey ash, \
glowing embers, thin smoke rising. Wrecked catapults and a toppled siege tower lie at the roadside. The war \
camp has log palisades, canvas tents, weapon racks, supply crates, banners on poles. Warm late-afternoon sun \
breaking through the canopy, cool green shadows.""",
    "b-autumn-siege": """Scenario: "The Autumn Siege". A war road through a blazing autumn forest of red, orange \
and gold maples and dark pines. The road is a wide, ancient paved military road of cracked, sunken flagstones, \
half reclaimed by fallen leaves and mud, lined by toppled stone milestones and a broken aqueduct arch. \
Trenches and earthworks with sharpened stake barricades flank the road. Craters, burning hay carts, smoke \
drifting from campfires. The war camp on the plateau has wooden watch platforms, striped tents, a smithy \
glow. Golden-hour light, long soft shadows, falling leaves.""",
    "c-moonlit-pines": """Scenario: "Siege of the Misty Pines". A war road through a deep, misty pine forest \
at blue dusk on the edge of night. The road is wide, trampled frozen earth with patches of snow and slush, \
lined with lanterns on posts and burning torches that cast warm pools of orange light against the cold blue \
forest. Ancient rune stones and a ruined shrine overgrown with glowing mushrooms beside the road. Shattered \
wooden barricades, abandoned siege ballistae, arrows in the snow. The war camp has fur-covered tents, \
campfires, totem poles. Low ground fog between the trees, fireflies.""",
}


def make(name, key):
    prompt = IDEAS[name] + "\n\n" + LAYOUT + "\n\n" + STYLE
    body = {"model": "meta/muse-image", "prompt": prompt, "aspect_ratio": "3:2"}
    t = time.time()
    req = urllib.request.Request("https://openrouter.ai/api/v1/images", data=json.dumps(body).encode(),
                                 headers={"Authorization": "Bearer " + key, "Content-Type": "application/json"})
    d = json.load(urllib.request.urlopen(req, timeout=600))
    im = Image.open(io.BytesIO(base64.b64decode(d["data"][0]["b64_json"]))).convert("RGB")
    os.makedirs(OUT, exist_ok=True)
    im.save(f"{OUT}/{name}.jpg", quality=92)
    print(f"{name}: {im.size} in {time.time() - t:.0f}s")


if __name__ == "__main__":
    key = os.environ["OPENROUTER_API_KEY"]
    names = sys.argv[1:] or list(IDEAS)
    with ThreadPoolExecutor(len(names)) as ex:
        list(ex.map(lambda n: make(n, key), names))
