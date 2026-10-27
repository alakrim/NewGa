"""Depth paint-over, step 1: a rough zone sketch of the west end of the battlefield on the view plane (same
framing as tiles.gd tile 0: u -115.5..-28.5, v -25..33 in 1920x1280), giving the image model only where the
big zones must be. Everything inside the zones is left to the model. Writes sketch.png."""
import math, os
from PIL import Image, ImageDraw, ImageFilter

HERE = os.path.dirname(os.path.abspath(__file__))
U0, U1, V0, V1, W, H = -115.5, -28.5, -25.0, 33.0, 1920, 1280
R = math.radians(52.0)


def px(x, y, z):
    v = y * math.cos(R) - z * math.sin(R)
    return ((x - U0) / (U1 - U0) * W, (V1 - v) / (V1 - V0) * H)


def quad(d, x0, x1, z0, z1, y, col):
    a, b = px(x0, y, z0), px(x1, y, z1)
    d.rectangle((min(a[0], b[0]), min(a[1], b[1]), max(a[0], b[0]), max(a[1], b[1])), fill=col)


im = Image.new("RGB", (W, H), (150, 60, 30))  # forest
d = ImageDraw.Draw(im)
quad(d, -100, -40, -36, -12, 3.0, (200, 170, 110))  # plateau top: war camp
# plateau front cliff face (vertical, from y 3 down to 0 at z -12)
a, b = px(-100, 3.0, -12), px(-40, 0.0, -12)
d.rectangle((a[0], a[1], b[0], b[1]), fill=(120, 110, 100))
quad(d, -83, -41, -23.5, -12.5, 3.0, (225, 205, 150))  # building ground (the plots)
quad(d, -97, -40, -35, -26, 3.0, (240, 240, 240))  # tents
quad(d, -100, -20, -12, -8, 0.0, (110, 80, 50))  # verge and trench line above the road
quad(d, -40, -20, -36, -12, 0.0, (175, 140, 80))  # open meadow east of the plateau
quad(d, -80, -20, -8, 9, 0.0, (140, 140, 140))  # the road
quad(d, -93.5, -78.5, -9.5, 3.5, 0.0, (205, 205, 215))  # keep courtyard
quad(d, -100, -20, 9, 14.5, 0.0, (95, 90, 90))  # rocky verge with gold
for x in (-68, -60, -52, -44):
    c = px(x, 0.0, 11)
    d.ellipse((c[0] - 70, c[1] - 30, c[0] + 70, c[1] + 30), fill=(240, 200, 40))
c = px(-34, 0.0, -5)
d.ellipse((c[0] - 50, c[1] - 30, c[0] + 50, c[1] + 30), outline=(70, 90, 150), width=8)  # banner circle
im.filter(ImageFilter.GaussianBlur(2)).save(f"{HERE}/sketch.png")
