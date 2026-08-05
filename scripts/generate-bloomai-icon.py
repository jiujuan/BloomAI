from __future__ import annotations

from pathlib import Path

from PIL import Image, ImageDraw, ImageFilter


ROOT = Path(__file__).resolve().parents[1]
OUTPUT_DIR = ROOT / "public" / "icons"
CANVAS = 1024
SIZES = (16, 24, 32, 48, 64, 128, 256)


def lerp(start: tuple[int, int, int], end: tuple[int, int, int], amount: float) -> tuple[int, int, int]:
    return tuple(round(a + (b - a) * amount) for a, b in zip(start, end))


def gradient_circle(size: int) -> Image.Image:
    image = Image.new("RGBA", (size, size), (0, 0, 0, 0))
    pixels = image.load()
    start = (100, 228, 195)
    middle = (88, 166, 255)
    end = (110, 93, 245)
    radius = size * 0.305
    center = size / 2
    for y in range(size):
        for x in range(size):
            dx = x - center
            dy = y - center
            distance = (dx * dx + dy * dy) ** 0.5
            if distance > radius:
                continue
            t = max(0.0, min(1.0, (x + y * 0.25) / (size * 1.25)))
            color = lerp(start, middle, t / 0.55) if t < 0.55 else lerp(middle, end, (t - 0.55) / 0.45)
            pixels[x, y] = (*color, 255)
    return image


def polygon_bezier(points: list[tuple[tuple[float, float], ...]], steps: int = 28) -> list[tuple[int, int]]:
    result: list[tuple[int, int]] = []
    for segment in points:
        p0, p1, p2, p3 = segment
        for index in range(steps):
            t = index / steps
            inverse = 1 - t
            x = inverse**3 * p0[0] + 3 * inverse**2 * t * p1[0] + 3 * inverse * t**2 * p2[0] + t**3 * p3[0]
            y = inverse**3 * p0[1] + 3 * inverse**2 * t * p1[1] + 3 * inverse * t**2 * p2[1] + t**3 * p3[1]
            result.append((round(x), round(y)))
    return result


def draw_icon(size: int = CANVAS) -> Image.Image:
    scale = size / 256
    image = Image.new("RGBA", (size, size), (0, 0, 0, 0))
    draw = ImageDraw.Draw(image)
    rect = tuple(round(value * scale) for value in (8, 8, 248, 248))
    radius = round(58 * scale)
    draw.rounded_rectangle(rect, radius=radius, fill="#0B1832")

    glow = Image.new("RGBA", (size, size), (0, 0, 0, 0))
    glow_draw = ImageDraw.Draw(glow)
    glow_box = tuple(round(value * scale) for value in (33, 33, 223, 223))
    glow_draw.ellipse(glow_box, fill=(135, 248, 221, 95))
    glow = glow.filter(ImageFilter.GaussianBlur(round(8 * scale)))
    image.alpha_composite(glow)

    orb = gradient_circle(size)
    image.alpha_composite(orb)

    bloom_mask = Image.new("L", (size, size), 0)
    bloom_points = polygon_bezier([
        ((128, 42), (158, 63), (177, 86), (177, 114)),
        ((177, 114), (177, 145), (155, 165), (128, 165)),
        ((128, 165), (101, 165), (79, 145), (79, 114)),
        ((79, 114), (79, 86), (98, 63), (128, 42)),
    ])
    ImageDraw.Draw(bloom_mask).polygon([(round(x * scale), round(y * scale)) for x, y in bloom_points], fill=255)
    bloom = Image.new("RGBA", (size, size), (0, 0, 0, 0))
    bloom_pixels = bloom.load()
    blue = (29, 91, 209)
    mint = (113, 241, 203)
    for y in range(size):
        color = lerp(blue, mint, max(0.0, min(1.0, 1 - y / size)))
        for x in range(size):
            bloom_pixels[x, y] = (*color, 255)
    image.paste(bloom, (0, 0), bloom_mask)

    inner_mask = Image.new("L", (size, size), 0)
    inner_points = polygon_bezier([
        ((128, 77), (142, 93), (151, 107), (151, 124)),
        ((151, 124), (151, 139), (141, 149), (128, 149)),
        ((128, 149), (115, 149), (105, 139), (105, 124)),
        ((105, 124), (105, 107), (114, 93), (128, 77)),
    ])
    ImageDraw.Draw(inner_mask).polygon([(round(x * scale), round(y * scale)) for x, y in inner_points], fill=230)
    inner = Image.new("RGBA", (size, size), (255, 255, 255, 255))
    image.paste(inner, (0, 0), inner_mask)

    sparkle = Image.new("RGBA", (size, size), (0, 0, 0, 0))
    sparkle_draw = ImageDraw.Draw(sparkle)
    sparkle_center = round(184 * scale)
    sparkle_radius = round(10 * scale)
    sparkle_draw.ellipse((sparkle_center - sparkle_radius, sparkle_center - sparkle_radius, sparkle_center + sparkle_radius, sparkle_center + sparkle_radius), fill=(255, 255, 255, 220))
    image.alpha_composite(sparkle)
    return image


def main() -> None:
    OUTPUT_DIR.mkdir(parents=True, exist_ok=True)
    rendered = draw_icon()
    png = rendered.resize((256, 256), Image.Resampling.LANCZOS)
    png_path = OUTPUT_DIR / "bloomai-icon.png"
    ico_path = OUTPUT_DIR / "bloomai.ico"
    png.save(png_path, format="PNG", optimize=True)
    png.save(ico_path, format="ICO", sizes=[(size, size) for size in SIZES])
    print(f"wrote {png_path} ({png.width}x{png.height})")
    print(f"wrote {ico_path} sizes={','.join(str(size) for size in SIZES)}")


if __name__ == "__main__":
    main()
