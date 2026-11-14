"""Turns raw 3D renders from tools/bake-sprites.ts into pixel sprite sheets.

Per unit: downsample the 2x renders to the cell size, cut the alpha hard (no soft edges), map every frame to
one shared palette of at most PALETTE colours (no dithering) after a saturation and warmth grade, add a dark
outline OUTLINE_PX wide, then pack one row per
animation into <unit>.png. Also writes contact.png: every unit's rows on a ground-coloured card.

    python3 -I tools/sprite-post.py <frames dir> <out dir> <cell width> <cell height> <unit> [<unit> ...]
"""
import json
import os
import sys

import numpy as np
from PIL import Image

PALETTE = int(os.environ.get("BAKE_PALETTE", "32"))  # buildings bake with more
OUTLINE = (27, 20, 38)  # dark plum, like the Tiny Swords outlines
OUTLINE_PX = 3  # Tiny Swords outlines are about 3 px at their 192x192 frame size; thinner ones vanish in game
SATURATION = 1.3  # the renders come out cooler and greyer than the hand-painted art they stand next to
WARMTH = (1.06, 1.0, 0.92)  # golden-hour bias, like the HD-2D grade
GROUND = (126, 142, 74)  # a mid grass tone, for judging sprites in the contact sheet

raw, out, cw, ch = sys.argv[1], sys.argv[2], int(sys.argv[3]), int(sys.argv[4])
units = sys.argv[5:]


def frames_of(unit, row):
    stem = unit.replace("/", "--")  # "blue/swordsman" frames are saved flat as "blue--swordsman__..."
    files = sorted((f for f in os.listdir(raw) if f.startswith(f"{stem}__{row}__")), key=lambda f: int(f.rsplit("__", 1)[1][:-4]))
    return [Image.open(os.path.join(raw, f)).convert("RGBA") for f in files]


def downsample(im):
    # premultiplied box filter, so transparent black does not darken the edges
    a = np.asarray(im, dtype=np.float32) / 255.0
    a[..., :3] *= a[..., 3:4]
    small = np.asarray(Image.fromarray((a * 255).astype(np.uint8)).resize((cw, ch), Image.BOX), dtype=np.float32) / 255.0
    alpha = small[..., 3:4]
    rgb = np.where(alpha > 0, small[..., :3] / np.maximum(alpha, 1e-6), 0)
    mask = alpha[..., 0] >= 0.5
    return grade(rgb.clip(0, 1)), mask


def outline(mask):
    grown = mask.copy()
    for _ in range(OUTLINE_PX):
        g = grown.copy()
        g[1:, :] |= grown[:-1, :]
        g[:-1, :] |= grown[1:, :]
        g[:, 1:] |= grown[:, :-1]
        g[:, :-1] |= grown[:, 1:]
        grown = g
    return grown & ~mask


def grade(rgb):
    grey = rgb.mean(axis=-1, keepdims=True)
    return ((grey + (rgb - grey) * SATURATION) * np.array(WARMTH)).clip(0, 1)


for unit in units:
    meta_path = os.path.join(out, f"{unit}.json")
    meta = json.load(open(meta_path))
    rows = [[downsample(f) for f in frames_of(unit, r["name"])] for r in meta["rows"]]
    # one palette per unit, from every opaque pixel of every frame
    opaque = np.concatenate([rgb[mask] for row in rows for rgb, mask in row])
    strip = Image.fromarray((opaque.reshape(1, -1, 3) * 255).astype(np.uint8), "RGB")
    pal = strip.quantize(colors=PALETTE, method=Image.Quantize.MEDIANCUT, dither=Image.Dither.NONE)
    cols = max(len(r) for r in rows)
    sheet = Image.new("RGBA", (cols * cw, len(rows) * ch), (0, 0, 0, 0))
    for y, row in enumerate(rows):
        for x, (rgb, mask) in enumerate(row):
            q = Image.fromarray((rgb * 255).astype(np.uint8), "RGB").quantize(palette=pal, dither=Image.Dither.NONE).convert("RGB")
            px = np.dstack([np.asarray(q), np.where(mask, 255, 0).astype(np.uint8)])
            px[outline(mask)] = (*OUTLINE, 255)
            sheet.paste(Image.fromarray(px, "RGBA"), (x * cw, y * ch))
    sheet.save(os.path.join(out, f"{unit}.png"), optimize=True)
    meta["palette_colors"] = len(pal.getcolors() or []) or PALETTE
    meta["sheet"] = f"{os.path.basename(unit)}.png"
    json.dump(meta, open(meta_path, "w"), indent=2)
    open(meta_path, "a").write("\n")
    print(f"sheet {unit}.png {sheet.size[0]}x{sheet.size[1]}")

# contact sheet: each unit's sheet on a ground card (skipped with BAKE_NO_CONTACT=1, e.g. when baking into the
# Godot project, where a 16k px tall image would exceed the texture size limit)
if os.environ.get("BAKE_NO_CONTACT") == "1":
    sys.exit(0)
cards = [Image.open(os.path.join(out, f"{u}.png")) for u in units]
w = max(c.width for c in cards)
h = sum(c.height for c in cards)
contact = Image.new("RGB", (w, h), GROUND)
y = 0
for c in cards:
    contact.paste(c, (0, y), c)
    y += c.height
contact.save(os.path.join(out, "contact.png"), optimize=True)
print("contact.png", contact.size)
