from __future__ import annotations

from pathlib import Path

from PIL import Image


ROOT = Path(__file__).resolve().parents[1]
OUTPUT_DIR = ROOT / "public" / "icons"
SOURCE_PATH = OUTPUT_DIR / "bloomai-source.png"
SIZES = (16, 24, 32, 48, 64, 128, 256)


def crop_to_colored_mark(image: Image.Image) -> Image.Image:
    """Crop whitespace around the uploaded mark while preserving white leaves."""
    rgb = image.convert("RGB")
    pixels = rgb.load()
    xs: list[int] = []
    ys: list[int] = []
    for y in range(rgb.height):
        for x in range(rgb.width):
            r, g, b = pixels[x, y]
            if max(r, g, b) - min(r, g, b) >= 24 and min(r, g, b) <= 245:
                xs.append(x)
                ys.append(y)
    if not xs:
        raise ValueError("Uploaded icon has no colored mark")
    padding = 2
    left = max(0, min(xs) - padding)
    top = max(0, min(ys) - padding)
    right = min(rgb.width, max(xs) + padding + 1)
    bottom = min(rgb.height, max(ys) + padding + 1)
    return rgb.crop((left, top, right, bottom)).convert("RGBA")


def fit_mark(image: Image.Image, canvas_size: int = 1024) -> Image.Image:
    max_dimension = round(canvas_size * 0.86)
    scale = min(max_dimension / image.width, max_dimension / image.height)
    fitted = image.resize((round(image.width * scale), round(image.height * scale)), Image.Resampling.LANCZOS)
    canvas = Image.new("RGBA", (canvas_size, canvas_size), (255, 255, 255, 255))
    left = (canvas_size - fitted.width) // 2
    top = (canvas_size - fitted.height) // 2
    canvas.alpha_composite(fitted, (left, top))
    return canvas


def main() -> None:
    OUTPUT_DIR.mkdir(parents=True, exist_ok=True)
    uploaded = Image.open(SOURCE_PATH)
    cropped = crop_to_colored_mark(uploaded)
    rendered = fit_mark(cropped)
    png = rendered.resize((256, 256), Image.Resampling.LANCZOS)
    png_path = OUTPUT_DIR / "bloomai-icon.png"
    ico_path = OUTPUT_DIR / "bloomai.ico"
    png.save(png_path, format="PNG", optimize=True)
    png.save(ico_path, format="ICO", sizes=[(size, size) for size in SIZES])
    print(f"wrote {png_path} ({png.width}x{png.height}, mode={png.mode})")
    print(f"wrote {ico_path} sizes={','.join(str(size) for size in SIZES)}")


if __name__ == "__main__":
    main()
