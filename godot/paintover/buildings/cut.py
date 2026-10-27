"""Painted buildings: keys out the magenta background of raw_castle.png and raw_sheet.png, removes the magenta
fringe, and saves each building cropped to its outline as <name>.png (straight RGBA).
Sheet cells, row by row: barracks, archery, sanctum, house / forge, mineshaft, watchtower, tower."""
import os
import numpy as np
from PIL import Image

HERE = os.path.dirname(os.path.abspath(__file__))
SHEET = [["barracks", "archery", "sanctum", "house"], ["forge", "mineshaft", "watchtower", "tower"]]


def key(rgb):
    a = rgb.astype(float)
    r, g, b = a[..., 0], a[..., 1], a[..., 2]
    m = np.minimum(r, b) - g  # how magenta a pixel is: about 255 on the background, near 0 on the art
    alpha = 1.0 - np.clip((m - 70.0) / 110.0, 0.0, 1.0)
    # remove the magenta spill along the outline: take the excess of red and blue over green back out
    spill = np.clip(m - 15.0, 0.0, None) * np.clip(1.4 - alpha, 0.0, 1.0)
    out = np.stack([r - spill, g, b - spill], -1).clip(0, 255)
    # semi-transparent pixels (smoke, soft edges) keep a pink cast from the background: make them grey
    grey = out.mean(-1, keepdims=True)
    k = np.clip((0.9 - alpha) / 0.5, 0.0, 1.0)[..., None]
    out = out * (1 - k) + grey * k
    return np.dstack([out, alpha * 255]).astype(np.uint8)


def save(rgba, name, width):
    """Crops to the outline and scales to `width` px: about the most the closest zoom shows on screen."""
    a = rgba[..., 3]
    ys, xs = np.nonzero(a > 40)
    crop = Image.fromarray(rgba[ys.min():ys.max() + 1, xs.min():xs.max() + 1], "RGBA")
    crop = crop.resize((width, round(crop.height * width / crop.width)), Image.LANCZOS)
    crop.save(f"{HERE}/{name}.png", optimize=True)
    crop = np.asarray(crop)
    print(name, crop.shape[1], "x", crop.shape[0])


save(key(np.asarray(Image.open(f"{HERE}/raw_castle.jpg").convert("RGB"))), "castle", 768)
sheet = key(np.asarray(Image.open(f"{HERE}/raw_sheet.jpg").convert("RGB")))
h, w = sheet.shape[:2]
for r, row in enumerate(SHEET):
    for c, name in enumerate(row):
        save(sheet[r * h // 2:(r + 1) * h // 2, c * w // 4:(c + 1) * w // 4], name, 288)
