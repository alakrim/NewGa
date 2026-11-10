"""Keys out the flat magenta background that AI image prompts ask for (see docs/STYLE.md), removes the magenta
fringe along the outline, and saves straight RGBA cropped to the art.

    python3 -I tools/magenta_key.py <in.jpg|png> <out.png> [width]

`width` scales the crop to that many pixels wide (LANCZOS). Library use: `key(rgb_array) -> rgba_array`.
Moved from the paint-over experiment's building cutter.
"""
import sys

import numpy as np
from PIL import Image


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


def crop(rgba, width=None):
    ys, xs = np.nonzero(rgba[..., 3] > 40)
    im = Image.fromarray(rgba[ys.min():ys.max() + 1, xs.min():xs.max() + 1], "RGBA")
    if width:
        im = im.resize((width, round(im.height * width / im.width)), Image.LANCZOS)
    return im


if __name__ == "__main__":
    src, dst = sys.argv[1], sys.argv[2]
    width = int(sys.argv[3]) if len(sys.argv) > 3 else None
    out = crop(key(np.asarray(Image.open(src).convert("RGB"))), width)
    out.save(dst, optimize=True)
    print(dst, out.size)
