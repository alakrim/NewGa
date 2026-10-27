# Generates small pixel-art grass blades and flowers (own work, CC0) for the HD-2D ground cover.
import os
import random
from PIL import Image
OUT = os.path.join(os.path.dirname(os.path.abspath(__file__)), '..', 'godot', 'assets', 'hd2d') + os.sep
G = [(108, 152, 82), (128, 172, 94), (155, 185, 78), (184, 196, 92), (214, 218, 122)]
def blades(seed, w=16, h=16, n=7):
    r = random.Random(seed)
    im = Image.new('RGBA', (w, h), (0, 0, 0, 0))
    px = im.load()
    for _ in range(n):
        x = r.randint(2, w - 3); hh = r.randint(h // 2, h - 2); lean = r.choice([-1, 0, 0, 1])
        for i in range(hh):
            y = h - 1 - i
            xx = x + (lean * i) // 5
            t = i / hh
            c = G[min(4, int(t * 4.6))]
            if 0 <= xx < w: px[xx, y] = c + (255,)
            if i < hh // 3 and 0 <= xx + 1 < w: px[xx + 1, y] = G[max(0, int(t * 4.6) - 1)] + (255,)
    return im
for i in range(4):
    blades(i).save(OUT + f'grass{i}.png')
FL = [((245, 245, 235), (250, 220, 90)), ((240, 130, 160), (250, 220, 120)), ((250, 205, 70), (230, 140, 40)), ((130, 160, 240), (240, 240, 250)), ((230, 80, 70), (250, 210, 100))]
for i, (petal, core) in enumerate(FL):
    r = random.Random(100 + i)
    im = blades(50 + i, n=4)
    px = im.load()
    for _ in range(r.randint(2, 3)):
        x = r.randint(3, 12); y = r.randint(3, 8)
        for dx, dy in [(-1, 0), (1, 0), (0, -1), (0, 1)]:
            px[x + dx, y + dy] = petal + (255,)
        px[x, y] = core + (255,)
        for yy in range(y + 2, 15):
            if px[x, yy][3] == 0: px[x, yy] = G[1] + (255,)
    im.save(OUT + f'flower{i}.png')
# soft round glow for fireflies, dust and fake light shafts
im = Image.new('RGBA', (32, 32))
px = im.load()
for y in range(32):
    for x in range(32):
        d = ((x - 15.5) ** 2 + (y - 15.5) ** 2) ** 0.5 / 16
        a = max(0.0, 1 - d) ** 2
        px[x, y] = (255, 255, 255, int(a * 255))
im.save(OUT + 'glow.png')
print('ok')
