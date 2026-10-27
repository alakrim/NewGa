"""Depth paint-over, step 3: fits the free painting to the game and turns it into a height field.

1. Warps paint_<tag>.jpg so its road, cliff, courtyard and gold line up with the gameplay positions (a
   separable piecewise-linear warp through hand-picked landmarks; LANDMARKS below).
2. Runs Depth Anything V2 (small, ONNX) on the painting for relative depth and warps it the same way.
3. Calibrates depth to heights in world units: the road is ground (y = 0) and the camp ground stands
   3 units up (world3d.gd's plateau). Pixels lie on the orthographic camera's rays, so a height per pixel
   places it exactly in 3D.
4. Flattens what gameplay needs flat: the lane and courtyard at 0, the building plots at 3.

Writes painting.jpg (the warped painting) and height.bin (float32 heights, GRID_W x GRID_H, row-major,
top row first) for painted_depth.gd.

    python3 -I fit.py <tag> <path to depth-anything-v2-small model.onnx>
"""
import math, os, sys
import numpy as np
import onnxruntime as ort
from PIL import Image, ImageFilter

HERE = os.path.dirname(os.path.abspath(__file__))
W, H = 1920, 1280
U0, U1, V0, V1 = -115.5, -28.5, -25.0, 33.0  # tiles.gd tile 0
R = math.radians(52.0)
GRID_W, GRID_H = 480, 320

# Landmarks: painting position -> game position, as (rows) and (columns). Rows: palisade back, cliff top,
# road top, road bottom, gold outcrops. Columns: courtyard left wall, courtyard gate, two gold outcrops.
ROWS = ([0, 110, 600, 725, 938, 1075, 1280], [0, 100, 479, 589, 885, 960, 1280])
COLS = ([0, 190, 580, 940, 1560, 1920], [0, 485, 816, 1225, 1578, 1920])


def px(x, y, z):
    v = y * math.cos(R) - z * math.sin(R)
    return (x - U0) / (U1 - U0) * W, (V1 - v) / (V1 - V0) * H


def warp(a):
    """Resamples a (H, W[, C]) array from painting space into game space (nearest row/column)."""
    src_r = np.interp(np.arange(H), ROWS[1], ROWS[0]).round().astype(int).clip(0, H - 1)
    src_c = np.interp(np.arange(W), COLS[1], COLS[0]).round().astype(int).clip(0, W - 1)
    return a[src_r][:, src_c]


def depth(img, model):
    sess = ort.InferenceSession(model, providers=["CPUExecutionProvider"])
    side = 518
    x = np.asarray(img.resize((side * 3 // 2 // 14 * 14, side // 14 * 14), Image.BICUBIC), dtype=np.float32) / 255.0
    x = (x - [0.485, 0.456, 0.406]) / [0.229, 0.224, 0.225]
    x = x.transpose(2, 0, 1)[None].astype(np.float32)
    out = sess.run(None, {sess.get_inputs()[0].name: x})[0][0]
    return np.asarray(Image.fromarray(out.astype(np.float32)).resize((W, H), Image.BICUBIC))


def blur(a, r):
    """Box blur, applied three times (close to a Gaussian), for float arrays."""
    for _ in range(3):
        for axis in (0, 1):
            c = np.cumsum(np.pad(a, [(r + 1, r) if i == axis else (0, 0) for i in range(2)], mode="edge"), axis=axis)
            a = (np.take(c, range(2 * r + 1, c.shape[axis]), axis=axis) - np.take(c, range(0, c.shape[axis] - 2 * r - 1), axis=axis)) / (2 * r + 1)
    return a


def box_mask(x0, x1, z0, z1, y):
    a, b = px(x0, y, z0), px(x1, y, z1)
    m = np.zeros((H, W), bool)
    m[int(min(a[1], b[1])):int(max(a[1], b[1])), int(min(a[0], b[0])):int(max(a[0], b[0]))] = True
    return m


def soft(m, r=4):
    return blur(m.astype(float), r)


if __name__ == "__main__":
    tag, model = sys.argv[1], sys.argv[2]
    paint = Image.open(f"{HERE}/paint_{tag}.jpg").convert("RGB")
    disp = depth(paint, model)  # relative inverse depth: larger is nearer the camera
    disp = blur(disp, 1)
    img = warp(np.asarray(paint))
    disp = warp(disp)
    Image.fromarray(img).save(f"{HERE}/painting.jpg", quality=94)

    road = box_mask(-78.5, -28.5, -8, 9, 0.0)
    court = box_mask(-93.5, -78.5, -9.5, 3.5, 0.0)
    plots = box_mask(-83, -41, -23.5, -12.5, 3.0)
    # Depth Anything's large-scale gradient is not reliable on this view, so the big shapes come from the
    # zones (plateau 3 units up behind the cliff, ground in front) and the model only adds local relief:
    # tree crowns, rocks, tents, trench walls, relative to their surroundings.
    rows = np.arange(H)[:, None]
    cliff_top, cliff_bottom = 479, 589  # game rows of the cliff's top edge and foot
    base = np.broadcast_to(np.interp(rows, [cliff_top, cliff_bottom], [3.0, 0.0]), (H, W)).copy()
    relief = disp - blur(disp, 40)
    scale = 4.0 / np.percentile(relief, 97)  # the tallest crowns stand about 4 units above their ground
    h = (base + relief * scale).clip(-1.0, 10.0)
    print(f"relief scale {scale:.3f}, plots {np.median(h[plots]):.2f}, road spread {h[road].std():.2f}")
    # flatten the lane, the courtyard (0) and the plots (3)
    for m, y in ((road | court, 0.0), (plots, 3.0)):
        w = soft(m)
        h = h * (1 - w) + y * w
    grid = np.asarray(Image.fromarray(h.astype(np.float32)).resize((GRID_W, GRID_H), Image.BILINEAR), dtype=np.float32)
    grid.tofile(f"{HERE}/height.bin")
    vis = ((h + 1) / 13 * 255).clip(0, 255).astype(np.uint8)
    Image.fromarray(vis).save(f"{HERE}/height_preview.png")
    print("height range", float(h.min()), float(h.max()))
