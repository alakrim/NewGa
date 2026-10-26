#!/usr/bin/env python3
"""Detect the frame grid of Tiny Swords sprite sheets and write godot/assets/sheets.json.

Frame size: among PREFERRED_FRAMES, the sizes s that divide both width and height are candidates.
The chosen s is the one where the grid cuts the fewest sprites (opaque pixels straddling a grid line);
ties go to the larger s, so a 1152x192 sheet is 192 rather than 64, and 1920x320 is 320.
FRAME_OVERRIDES covers single images that are not a square-frame grid (the gold mines).

row_frames: for each row, how many frames contain any non-zero alpha (empty frames are not counted).

Usage (run with -I, the sheets are third-party downloads):
  python3 -I tools/analyze-sheets.py                       # writes godot/assets/sheets.json
  python3 -I tools/analyze-sheets.py --contact DIR         # also writes contact sheets to DIR
  python3 -I tools/analyze-sheets.py --contact DIR --cell 150
"""
import argparse
import glob
import json
import math
import os
import sys

from PIL import Image, ImageChops, ImageDraw, ImageFont

REPO = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
GODOT = os.path.join(REPO, "godot")
OUT_JSON = os.path.join(GODOT, "assets", "sheets.json")

PREFERRED_FRAMES = (320, 192, 128, 64)

SCAN_PATTERNS = [
    "assets/tinyswords/Factions/*/Troops/**/*.png",
    "assets/tinyswords/Resources/**/*.png",
    "assets/tinyswords_free/Units/**/*.png",
    "assets/tinyswords_free/Particle FX/**/*.png",
]

# Path prefix (relative to godot/) -> frame [w, h] for images that are one non-square frame.
FRAME_OVERRIDES = {
    "assets/tinyswords/Resources/Gold Mine/": (192, 128),
}

# Units for the contact sheets (paths relative to godot/). Glob strings expand to every PNG matched.
CONTACT_UNITS = {
    "cc0-warrior": ["assets/tinyswords/Factions/Knights/Troops/Warrior/Blue/Warrior_Blue.png"],
    "cc0-pawn": ["assets/tinyswords/Factions/Knights/Troops/Pawn/Blue/Pawn_Blue.png"],
    "cc0-archer": [
        "assets/tinyswords/Factions/Knights/Troops/Archer/Blue/Archer_Blue.png",
        "assets/tinyswords/Factions/Knights/Troops/Archer/Archer + Bow/Archer_Blue_(NoArms).png",
        "assets/tinyswords/Factions/Knights/Troops/Archer/Archer + Bow/Archer_Bow_Blue.png",
    ],
    "cc0-torch-blue": ["assets/tinyswords/Factions/Goblins/Troops/Torch/Blue/Torch_Blue.png"],
    "cc0-tnt-blue": [
        "assets/tinyswords/Factions/Goblins/Troops/TNT/Blue/TNT_Blue.png",
        "assets/tinyswords/Factions/Goblins/Troops/TNT/Dynamite/Dynamite.png",
    ],
    "cc0-barrel-blue": ["assets/tinyswords/Factions/Goblins/Troops/Barrel/Blue/Barrel_Blue.png"],
    "free-lancer": ["assets/tinyswords_free/Units/Blue Units/Lancer/*.png"],
    "free-monk": ["assets/tinyswords_free/Units/Blue Units/Monk/*.png"],
    "free-pawn": ["assets/tinyswords_free/Units/Blue Units/Pawn/*.png"],
}
CONTACT_MAX_BLOCKS = 6  # files per contact-sheet image; longer units are split into -1, -2, ...
CELL = 96  # default px per frame in contact sheets (--cell overrides)


def rel(path):
    return os.path.relpath(path, GODOT).replace(os.sep, "/")


def opaque_mask(alpha):
    return alpha.point(lambda v: 255 if v else 0)


def overlap(a, b):
    """Number of pixels that are opaque in both 0/255 masks of the same size."""
    return sum(ImageChops.multiply(a, b).histogram()[1:])


def straddles(mask, s, cols, rows):
    """Opaque pixel pairs across the internal grid lines of an s-sized square grid."""
    w, h = mask.size
    n = 0
    for c in range(1, cols):
        x = c * s
        n += overlap(mask.crop((x - 1, 0, x, h)), mask.crop((x, 0, x + 1, h)))
    for r in range(1, rows):
        y = r * s
        n += overlap(mask.crop((0, y - 1, w, y)), mask.crop((0, y, w, y + 1)))
    return n


def choose_frame(w, h, mask):
    g = math.gcd(w, h)
    options = [s for s in PREFERRED_FRAMES if g % s == 0]
    if not options:
        raise ValueError(f"no preferred frame size in {PREFERRED_FRAMES} divides {w}x{h}")
    best = min(options, key=lambda s: (straddles(mask, s, w // s, h // s), -s))
    return best, straddles(mask, best, w // best, h // best)


def override_for(path):
    key = rel(path)
    for prefix, size in FRAME_OVERRIDES.items():
        if key.startswith(prefix):
            return size
    return None


def analyze(path):
    im = Image.open(path).convert("RGBA")
    w, h = im.size
    alpha = im.getchannel("A")
    override = override_for(path)
    if override:
        fw, fh = override
        cut = 0
    else:
        fw = fh = None
        fw, cut = choose_frame(w, h, opaque_mask(alpha))
        fh = fw
    cols, rows = w // fw, h // fh
    if cols * fw != w or rows * fh != h:
        raise ValueError(f"{rel(path)}: frame {fw}x{fh} does not tile {w}x{h}")
    row_frames = []
    for r in range(rows):
        n = 0
        for c in range(cols):
            if alpha.crop((c * fw, r * fh, (c + 1) * fw, (r + 1) * fh)).getbbox() is not None:
                n += 1
        row_frames.append(n)
    return {
        "frame": [fw, fh],
        "cols": cols,
        "rows": rows,
        "row_frames": row_frames,
        "_cut": cut,
        "_image": im,
    }


def find_pngs():
    found = set()
    for pat in SCAN_PATTERNS:
        found.update(glob.glob(os.path.join(GODOT, pat), recursive=True))
    return sorted(found)


def contact_font(size):
    try:
        return ImageFont.load_default(size=size)
    except TypeError:
        return ImageFont.load_default()


def write_contact_sheets(out_dir, cell):
    os.makedirs(out_dir, exist_ok=True)
    font = contact_font(14)
    small = contact_font(12)
    for name, patterns in CONTACT_UNITS.items():
        files = []
        for pat in patterns:
            matched = sorted(glob.glob(os.path.join(GODOT, pat)))
            files.extend(matched if matched else [os.path.join(GODOT, pat)])
        blocks = [(rel(path), analyze(path)) for path in files]
        chunks = [blocks[i:i + CONTACT_MAX_BLOCKS] for i in range(0, len(blocks), CONTACT_MAX_BLOCKS)]
        for n, chunk in enumerate(chunks, 1):
            suffix = "" if len(chunks) == 1 else f"-{n}"
            out_path = os.path.join(out_dir, f"sheet-{name}{suffix}.png")
            render_contact(chunk, out_path, font, small, cell)
            print(f"contact sheet: {out_path}")


def render_contact(blocks, out_path, font, small, cell):
    label_w, count_w, pad, head_h, row_gap = 46, 40, 12, 22, 8
    grid_w = max(info["cols"] for _, info in blocks) * cell
    width = label_w + grid_w + count_w + pad * 2
    height = pad
    for _, info in blocks:
        height += head_h + info["rows"] * (cell + row_gap) + pad
    canvas = Image.new("RGB", (width, height), (40, 42, 52))
    draw = ImageDraw.Draw(canvas)
    y = pad
    for label, info in blocks:
        fw, fh = info["frame"]
        head = f"{label}  frame {fw}x{fh}  grid {info['cols']}x{info['rows']}"
        draw.text((pad, y), head, fill=(255, 230, 140), font=font)
        y += head_h
        for r in range(info["rows"]):
            draw.text((pad, y + cell // 2 - 7), f"row {r}", fill=(200, 255, 200), font=font)
            count_x = pad + label_w + info["cols"] * cell + 6
            draw.text((count_x, y + cell // 2 - 7), f"{info['row_frames'][r]}f", fill=(170, 170, 190), font=small)
            for c in range(info["cols"]):
                x0 = pad + label_w + c * cell
                box = (c * fw, r * fh, (c + 1) * fw, (r + 1) * fh)
                frame = info["_image"].crop(box).resize((cell - 2, cell - 2), Image.LANCZOS)
                canvas.paste(frame, (x0 + 1, y + 1), frame)
                draw.rectangle((x0, y, x0 + cell - 1, y + cell - 1), outline=(90, 92, 110))
                draw.text((x0 + 3, y + 2), str(c), fill=(255, 255, 255), font=small)
            y += cell + row_gap
        y += pad
    canvas.save(out_path)


def main():
    ap = argparse.ArgumentParser()
    ap.add_argument("--contact", metavar="DIR", help="also write contact sheets into DIR")
    ap.add_argument("--cell", type=int, default=CELL, help="px per frame in contact sheets")
    args = ap.parse_args()

    results = {}
    print(f"{'file':<90} {'size':>11} {'frame':>9} {'grid':>7} {'cut':>6}")
    for path in find_pngs():
        info = analyze(path)
        key = rel(path)
        w, h = info["_image"].size
        results[key] = {k: info[k] for k in ("frame", "cols", "rows", "row_frames")}
        flag = "  <-- sprites straddle grid" if info["_cut"] else ""
        size_txt = "%dx%d" % (w, h)
        frame_txt = "%dx%d" % tuple(info["frame"])
        grid_txt = "%dx%d" % (info["cols"], info["rows"])
        print(f"{key:<90} {size_txt:>11} {frame_txt:>9} {grid_txt:>7} {info['_cut']:>6}{flag}")

    with open(OUT_JSON, "w", encoding="utf-8") as f:
        json.dump(dict(sorted(results.items())), f, indent=2, ensure_ascii=False)
        f.write("\n")
    print(f"wrote {len(results)} entries to {OUT_JSON}")

    if args.contact:
        write_contact_sheets(args.contact, args.cell)
    return 0


if __name__ == "__main__":
    sys.exit(main())
