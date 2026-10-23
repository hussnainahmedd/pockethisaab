#!/usr/bin/env python3
"""PocketHisaab 'Pocket Coin' logo — original geometry, drawn with PIL.

A white pocket outline with a gold coin (stamped with the rupee sign)
dropping into it, on a deep-emerald field. No third-party assets.
Outputs:
  assets/icon.png          1024x1024 full-bleed app icon
  assets/adaptive-icon.png 1024x1024 transparent foreground (safe zone)
"""
from PIL import Image, ImageDraw, ImageFont

S = 4  # supersample factor
W = 1024 * S
FONT = "/usr/share/fonts/truetype/dejavu/DejaVuSans-Bold.ttf"

DEEP = (5, 46, 33)        # #052E21
EMERALD = (14, 159, 110)   # #0E9F6E
GOLD = (242, 179, 61)      # #F2B33D
GOLD_DARK = (217, 154, 31)
WHITE = (255, 255, 255)


def gradient(size, top, bottom):
    img = Image.new("RGB", (size, size))
    d = ImageDraw.Draw(img)
    for y in range(size):
        t = y / size
        # diagonal feel: blend with slight x influence via two passes is overkill; vertical is clean
        r = int(top[0] + (bottom[0] - top[0]) * t)
        g = int(top[1] + (bottom[1] - top[1]) * t)
        b = int(top[2] + (bottom[2] - top[2]) * t)
        d.line([(0, y), (size, y)], fill=(r, g, b))
    return img


def draw_mark(d: ImageDraw.ImageDraw, cx: float, cy: float, scale: float, on_dark=True):
    """Draw pocket + coin centered at (cx, cy); scale 1.0 = full icon width."""
    u = W * scale  # unit box width for the mark
    # Pocket body: rounded rectangle outline
    pw, ph = 0.56 * u, 0.46 * u
    x0, y0 = cx - pw / 2, cy - ph / 2 + 0.10 * u
    x1, y1 = cx + pw / 2, y0 + ph
    stroke = int(0.055 * u)
    d.rounded_rectangle([x0, y0, x1, y1], radius=0.10 * u, outline=WHITE, width=stroke)
    # Pocket mouth: curved line across the upper third (the opening)
    import math
    pts = []
    for i in range(41):
        t = i / 40
        x = x0 + 0.13 * u + t * (pw - 0.26 * u)
        y = y0 + 0.14 * u + math.sin(t * math.pi) * 0.05 * u
        pts.append((x, y))
    d.line(pts, fill=WHITE, width=int(stroke * 0.8), joint="curve")
    # Coin: gold circle overlapping the pocket's top-right rim
    cr = 0.165 * u
    ccx, ccy = cx + 0.17 * u, cy - 0.16 * u
    d.ellipse([ccx - cr, ccy - cr, ccx + cr, ccy + cr], fill=GOLD)
    ring = int(0.018 * u)
    d.ellipse([ccx - cr * 0.78, ccy - cr * 0.78, ccx + cr * 0.78, ccy + cr * 0.78], outline=GOLD_DARK, width=ring)
    # Rupee glyph on the coin
    fs = int(cr * 1.15)
    font = ImageFont.truetype(FONT, fs)
    d.text((ccx, ccy), "₨", font=font, fill=DEEP, anchor="mm")


def make_icon():
    img = gradient(W, DEEP, EMERALD).convert("RGBA")
    d = ImageDraw.Draw(img)
    draw_mark(d, W / 2, W / 2, 1.0)
    img = img.resize((1024, 1024), Image.LANCZOS)
    img.save("assets/icon.png")
    print("assets/icon.png written")


def make_adaptive():
    img = Image.new("RGBA", (W, W), (0, 0, 0, 0))
    d = ImageDraw.Draw(img)
    # Mark inside the Android adaptive safe zone (~62% of the canvas)
    draw_mark(d, W / 2, W / 2, 0.66)
    img = img.resize((1024, 1024), Image.LANCZOS)
    img.save("assets/adaptive-icon.png")
    print("assets/adaptive-icon.png written")


if __name__ == "__main__":
    make_icon()
    make_adaptive()
