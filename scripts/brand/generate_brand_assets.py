#!/usr/bin/env python3
"""Generate the Cryozen brand assets from code (no third-party artwork or fonts).

Outputs (under assets/brand/ unless noted):
  cryozen-mark.png        1024x1024 app icon: ice crystal on a dark rounded square
  cryozen-mark-mono.svg   single-colour vector mark for favicons and docs
  assets/banner.png       README banner, "CRYOZEN AGENT" in a procedural block font

Run: venv/bin/python scripts/brand/generate_brand_assets.py
"""

from __future__ import annotations

import math
from pathlib import Path

from PIL import Image, ImageDraw, ImageFilter

ROOT = Path(__file__).resolve().parents[2]
OUT = ROOT / "assets" / "brand"

BG = (11, 18, 32)  # deep navy
ICE_LIGHT = (224, 247, 255)
ICE = (125, 211, 252)
ICE_DEEP = (56, 139, 253)


def _crystal(
    draw: ImageDraw.ImageDraw, cx: float, cy: float, r: float, width: float, color
) -> None:
    """Six-armed crystal: arms with two pairs of angled barbs each, plus a hexagonal core."""
    for k in range(6):
        a = math.radians(90 + 60 * k)
        ex, ey = cx + r * math.cos(a), cy - r * math.sin(a)
        draw.line([(cx, cy), (ex, ey)], fill=color, width=int(width))
        for frac, blen in ((0.45, 0.30), (0.72, 0.22)):
            bx, by = cx + r * frac * math.cos(a), cy - r * frac * math.sin(a)
            for side in (-1, 1):
                b = a + side * math.radians(42)
                draw.line(
                    [
                        (bx, by),
                        (bx + r * blen * math.cos(b), by - r * blen * math.sin(b)),
                    ],
                    fill=color,
                    width=int(width * 0.8),
                )
        draw.ellipse([ex - width, ey - width, ex + width, ey + width], fill=color)
    hexr = r * 0.16
    pts = [
        (
            cx + hexr * math.cos(math.radians(30 + 60 * i)),
            cy - hexr * math.sin(math.radians(30 + 60 * i)),
        )
        for i in range(6)
    ]
    draw.polygon(pts, fill=BG, outline=color, width=int(width * 0.8))


def make_mark(size: int = 1024) -> Image.Image:
    s = size * 4  # supersample for anti-aliasing
    img = Image.new("RGBA", (s, s), (0, 0, 0, 0))
    d = ImageDraw.Draw(img)
    pad = int(s * 0.06)
    d.rounded_rectangle([pad, pad, s - pad, s - pad], radius=int(s * 0.22), fill=BG)
    # soft glow behind the crystal
    glow = Image.new("RGBA", (s, s), (0, 0, 0, 0))
    gd = ImageDraw.Draw(glow)
    gr = s * 0.30
    gd.ellipse([s / 2 - gr, s / 2 - gr, s / 2 + gr, s / 2 + gr], fill=ICE_DEEP + (110,))
    glow = glow.filter(ImageFilter.GaussianBlur(s * 0.06))
    img = Image.alpha_composite(img, glow)
    d = ImageDraw.Draw(img)
    _crystal(d, s / 2, s / 2, s * 0.33, s * 0.028, ICE_LIGHT)
    return img.resize((size, size), Image.LANCZOS)


def make_mono_svg() -> str:
    cx = cy = 50.0
    r = 38.0
    parts = []
    for k in range(6):
        a = math.radians(90 + 60 * k)
        ex, ey = cx + r * math.cos(a), cy - r * math.sin(a)
        parts.append(f'<line x1="{cx:.2f}" y1="{cy:.2f}" x2="{ex:.2f}" y2="{ey:.2f}"/>')
        for frac, blen in ((0.45, 0.30), (0.72, 0.22)):
            bx, by = cx + r * frac * math.cos(a), cy - r * frac * math.sin(a)
            for side in (-1, 1):
                b = a + side * math.radians(42)
                parts.append(
                    f'<line x1="{bx:.2f}" y1="{by:.2f}" x2="{bx + r * blen * math.cos(b):.2f}" '
                    f'y2="{by - r * blen * math.sin(b):.2f}"/>'
                )
    return (
        '<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 100 100">'
        '<rect x="3" y="3" width="94" height="94" rx="22" fill="#0B1220"/>'
        '<g stroke="#E0F7FF" stroke-width="3.2" stroke-linecap="round">'
        + "".join(parts)
        + "</g></svg>\n"
    )


# 5x7 block glyphs, drawn from scratch for the banner.
GLYPHS = {
    "C": ["01111", "10000", "10000", "10000", "10000", "10000", "01111"],
    "R": ["11110", "10001", "10001", "11110", "10100", "10010", "10001"],
    "Y": ["10001", "10001", "01010", "00100", "00100", "00100", "00100"],
    "O": ["01110", "10001", "10001", "10001", "10001", "10001", "01110"],
    "Z": ["11111", "00001", "00010", "00100", "01000", "10000", "11111"],
    "E": ["11111", "10000", "10000", "11110", "10000", "10000", "11111"],
    "N": ["10001", "11001", "10101", "10011", "10001", "10001", "10001"],
    "A": ["01110", "10001", "10001", "11111", "10001", "10001", "10001"],
    "G": ["01111", "10000", "10000", "10111", "10001", "10001", "01111"],
    "T": ["11111", "00100", "00100", "00100", "00100", "00100", "00100"],
    " ": ["000", "000", "000", "000", "000", "000", "000"],
}


def make_banner(
    width: int = 1145, height: int = 196, text: str = "CRYOZEN AGENT"
) -> Image.Image:
    img = Image.new("RGB", (width, height), (15, 17, 21))
    d = ImageDraw.Draw(img)
    cols = sum(len(GLYPHS[c][0]) + 1 for c in text) - 1
    cell = min((width - 60) // cols, (height - 40) // 7)
    x0 = (width - cols * cell) // 2
    y0 = (height - 7 * cell) // 2

    def shade(row: int) -> tuple[int, int, int]:
        t = row / 6
        return tuple(int(ICE_LIGHT[i] * (1 - t) + ICE_DEEP[i] * t) for i in range(3))

    for offset, colour in ((6, (30, 64, 110)), (3, (40, 90, 150))):
        x = x0
        for ch in text:
            g = GLYPHS[ch]
            for ry, row in enumerate(g):
                for rx, bit in enumerate(row):
                    if bit == "1":
                        px, py = x + rx * cell + offset, y0 + ry * cell + offset
                        d.rectangle(
                            [px, py, px + cell - 1, py + cell - 1], outline=colour
                        )
            x += (len(g[0]) + 1) * cell
    x = x0
    for ch in text:
        g = GLYPHS[ch]
        for ry, row in enumerate(g):
            for rx, bit in enumerate(row):
                if bit == "1":
                    px, py = x + rx * cell, y0 + ry * cell
                    d.rectangle([px, py, px + cell - 1, py + cell - 1], fill=shade(ry))
        x += (len(g[0]) + 1) * cell
    return img


def main() -> None:
    OUT.mkdir(parents=True, exist_ok=True)
    make_mark().save(OUT / "cryozen-mark.png")
    (OUT / "cryozen-mark-mono.svg").write_text(make_mono_svg(), encoding="utf-8")
    make_banner().save(ROOT / "assets" / "banner.png")
    print(
        "wrote",
        OUT / "cryozen-mark.png",
        OUT / "cryozen-mark-mono.svg",
        ROOT / "assets" / "banner.png",
    )


if __name__ == "__main__":
    main()
