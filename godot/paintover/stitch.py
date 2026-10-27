"""Paint-over experiment: stitches paint/tile_*.jpg (one row, left to right) into one panorama over the view
plane (see tiles.gd). Neighbouring tiles are joined along the lowest-difference vertical path through their
overlap (image quilting), with a short feather across it. Before that, each tile's large-scale colour is
evened out against its guide (the model drifts in brightness and tint from tile to tile and inside a tile):
the blurred ratio paint/guide should be one constant everywhere. Writes pano.jpg."""
import os
import numpy as np
from PIL import Image, ImageFilter

HERE = os.path.dirname(os.path.abspath(__file__))
TILE_W, STEP, N = 87.0, 72.0, 3  # tiles.gd
TW, TH = 1920, 1280
STEP_PX = round(STEP / TILE_W * TW)
OV = TW - STEP_PX
FEATHER = 12
SEED_PX = 180  # tools/paintover.py: how much of the overlap was pasted into the outer tiles' guides
MARGIN = 16


def seam(a, b, lo, hi):
    """Column index per row of the cheapest top-to-bottom path through |a - b|, kept within columns lo..hi."""
    cost = np.abs(a - b).sum(axis=2)
    cost[:, :lo] = 1e9
    cost[:, hi:] = 1e9
    h, w = cost.shape
    acc = cost.copy()
    for y in range(1, h):
        prev = acc[y - 1]
        left = np.r_[np.inf, prev[:-1]]
        right = np.r_[prev[1:], np.inf]
        acc[y] += np.minimum(prev, np.minimum(left, right))
    path = np.zeros(h, dtype=int)
    path[-1] = int(np.argmin(acc[-1]))
    for y in range(h - 2, -1, -1):
        x = path[y + 1]
        lo, hi = max(0, x - 1), min(w, x + 2)
        path[y] = lo + int(np.argmin(acc[y, lo:hi]))
    return path


def blur(im, r=90):
    return np.asarray(Image.fromarray(im.clip(0, 255).astype(np.uint8)).filter(ImageFilter.GaussianBlur(r)), dtype=float) + 1.0


def load(i):
    return np.asarray(Image.open(f"{HERE}/{i}").convert("RGB"), dtype=float)


paints = [load(f"paint/tile_{i}.jpg") for i in range(N)]
ratios = [blur(p) / blur(load(f"guides/tile_{i}.png")) for i, p in enumerate(paints)]
target = np.median(np.concatenate([r.reshape(-1, 3) for r in ratios]), axis=0)
tiles = [p * target / r for p, r in zip(paints, ratios)]
out = np.zeros((TH, STEP_PX * (N - 1) + TW, 3))
out[:, :TW] = tiles[0]
for i in range(1, N):
    x0 = STEP_PX * i
    a = out[:, x0:x0 + OV]
    b = tiles[i][:, :OV]
    # tiles 0 and 2 were painted around a pasted strip of tile 1; cut on their side of the strip's edge
    if i == 1:
        path = seam(a, b, 0, OV - SEED_PX - MARGIN)
    else:
        path = seam(a, b, SEED_PX + MARGIN, OV)
    cols = np.arange(OV)[None, :]
    wb = np.clip((cols - path[:, None]) / FEATHER + 0.5, 0.0, 1.0)[..., None]
    out[:, x0:x0 + OV] = a * (1 - wb) + b * wb
    out[:, x0 + OV:x0 + TW] = tiles[i][:, OV:]
Image.fromarray(out.clip(0, 255).astype(np.uint8)).save(f"{HERE}/pano.jpg", quality=90, subsampling=0)
print("pano", out.shape, "overlap", OV)
