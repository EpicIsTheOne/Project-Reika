from __future__ import annotations

import json
from pathlib import Path

from PIL import Image, ImageDraw, ImageFilter, ImageFont


ROOT = Path(__file__).resolve().parents[1]
OUT = ROOT / "assets" / "reika_phase1_generated"


def save_status_icon(name: str, color: tuple[int, int, int], label_color: tuple[int, int, int]) -> None:
    path = OUT / "icons" / "status" / f"{name}_alpha.png"
    path.parent.mkdir(parents=True, exist_ok=True)
    img = Image.new("RGBA", (256, 256), (0, 0, 0, 0))
    glow = Image.new("RGBA", img.size, (0, 0, 0, 0))
    gd = ImageDraw.Draw(glow)
    gd.ellipse((58, 58, 198, 198), fill=(*color, 86))
    glow = glow.filter(ImageFilter.GaussianBlur(22))
    img.alpha_composite(glow)
    d = ImageDraw.Draw(img)
    d.ellipse((82, 82, 174, 174), fill=(*color, 255))
    d.ellipse((103, 99, 134, 130), fill=(*label_color, 210))
    img.save(path)


def save_blue_glow() -> None:
    path = OUT / "decorative" / "blue_glow_overlay_alpha.png"
    path.parent.mkdir(parents=True, exist_ok=True)
    img = Image.new("RGBA", (1024, 1024), (0, 0, 0, 0))
    glow = Image.new("RGBA", img.size, (0, 0, 0, 0))
    d = ImageDraw.Draw(glow)
    d.ellipse((252, 220, 772, 744), fill=(77, 141, 255, 135))
    d.ellipse((382, 344, 646, 612), fill=(111, 239, 255, 170))
    glow = glow.filter(ImageFilter.GaussianBlur(90))
    img.alpha_composite(glow)
    img.save(path)


def save_glass_panel() -> None:
    path = OUT / "decorative" / "glass_panel_texture_alpha.png"
    path.parent.mkdir(parents=True, exist_ok=True)
    img = Image.new("RGBA", (1024, 1024), (0, 0, 0, 0))
    d = ImageDraw.Draw(img)
    d.rounded_rectangle((32, 32, 992, 992), radius=44, fill=(19, 27, 51, 155), outline=(122, 183, 255, 96), width=3)
    for i in range(12):
        x = 80 + i * 80
        d.line((x, 60, x - 260, 980), fill=(111, 239, 255, 10), width=2)
    img = img.filter(ImageFilter.GaussianBlur(0.2))
    img.save(path)


def save_noise_texture() -> None:
    path = OUT / "decorative" / "subtle_noise_texture_alpha.png"
    path.parent.mkdir(parents=True, exist_ok=True)
    img = Image.new("RGBA", (512, 512), (0, 0, 0, 0))
    px = img.load()
    seed = 1337
    for y in range(img.height):
        for x in range(img.width):
            seed = (1103515245 * seed + 12345) & 0x7FFFFFFF
            n = seed % 255
            if n > 235:
                px[x, y] = (122, 183, 255, 22)
            elif n < 10:
                px[x, y] = (255, 255, 255, 12)
    img.save(path)


def save_progress_bar() -> None:
    path = OUT / "loading" / "progress_bar_alpha.png"
    path.parent.mkdir(parents=True, exist_ok=True)
    img = Image.new("RGBA", (900, 120), (0, 0, 0, 0))
    d = ImageDraw.Draw(img)
    d.rounded_rectangle((40, 38, 860, 82), radius=22, fill=(11, 16, 32, 190), outline=(77, 141, 255, 130), width=2)
    d.rounded_rectangle((52, 48, 530, 72), radius=12, fill=(77, 141, 255, 230))
    d.rounded_rectangle((390, 48, 620, 72), radius=12, fill=(111, 239, 255, 115))
    img.save(path)


def resize_alpha_assets() -> None:
    for src in [
        OUT / "brand" / "reika_logo_icon_alpha.png",
        OUT / "icons" / "providers" / "hermes_alpha.png",
        OUT / "icons" / "providers" / "openclaw_alpha.png",
        OUT / "icons" / "devices" / "pc_alpha.png",
        OUT / "icons" / "devices" / "laptop_alpha.png",
        OUT / "icons" / "devices" / "vps_server_alpha.png",
    ]:
        if not src.exists():
            continue
        img = Image.open(src).convert("RGBA")
        for size in (128, 256, 512):
            resized = img.copy()
            resized.thumbnail((size, size), Image.Resampling.LANCZOS)
            canvas = Image.new("RGBA", (size, size), (0, 0, 0, 0))
            canvas.alpha_composite(resized, ((size - resized.width) // 2, (size - resized.height) // 2))
            canvas.save(src.with_name(f"{src.stem}_{size}.png"))


def build_manifest() -> None:
    assets = []
    for path in sorted(OUT.rglob("*.png")):
        if "_source_refs" in path.parts:
            continue
        with Image.open(path) as img:
            assets.append(
                {
                    "path": path.relative_to(ROOT).as_posix(),
                    "size": list(img.size),
                    "mode": img.mode,
                    "transparent": "A" in img.mode,
                }
            )
    manifest = {
        "name": "Reika Phase 1 Generated Reika Asset Pack",
        "description": "Project-local generated assets for Reika.",
        "source_references": [
            "assets/reika_phase1_generated/_source_refs/reika_character_sheet.png",
        ],
        "palette": {
            "deep_space": "#0B1020",
            "midnight_blue": "#131B33",
            "electric_blue": "#4D8DFF",
            "sky_blue": "#7AB7FF",
            "cyan_glow": "#6FEFFF",
            "text_primary": "#FFFFFF",
            "text_secondary": "#B7C0D8",
        },
        "assets": assets,
    }
    (OUT / "manifest.json").write_text(json.dumps(manifest, indent=2), encoding="utf-8")


def build_contact_sheet() -> None:
    pngs = [
        p
        for p in sorted(OUT.rglob("*.png"))
        if "_source_refs" not in p.parts
        and not p.name.endswith("_128.png")
        and not p.name.endswith("_256.png")
        and not p.name.endswith("_512.png")
        and not p.name.endswith("_chromakey.png")
    ]
    cols = 4
    cell_w, cell_h = 280, 220
    rows = max(1, (len(pngs) + cols - 1) // cols)
    sheet = Image.new("RGB", (cols * cell_w, rows * cell_h), (8, 14, 28))
    d = ImageDraw.Draw(sheet)
    try:
        font = ImageFont.truetype("arial.ttf", 12)
    except OSError:
        font = ImageFont.load_default()
    checker = Image.new("RGB", (cell_w - 32, 150), (14, 22, 42))
    cd = ImageDraw.Draw(checker)
    for y in range(0, checker.height, 16):
        for x in range(0, checker.width, 16):
            fill = (22, 32, 58) if (x // 16 + y // 16) % 2 else (12, 18, 34)
            cd.rectangle((x, y, x + 15, y + 15), fill=fill)
    for idx, path in enumerate(pngs):
        x = (idx % cols) * cell_w
        y = (idx // cols) * cell_h
        sheet.paste(checker, (x + 16, y + 14))
        img = Image.open(path).convert("RGBA")
        img.thumbnail((cell_w - 48, 138), Image.Resampling.LANCZOS)
        preview = Image.new("RGBA", (cell_w - 32, 150), (0, 0, 0, 0))
        preview.alpha_composite(img, ((preview.width - img.width) // 2, (preview.height - img.height) // 2))
        sheet.paste(preview.convert("RGB"), (x + 16, y + 14), preview)
        label = path.relative_to(OUT).as_posix()
        d.text((x + 16, y + 174), label[:38], fill=(183, 192, 216), font=font)
    sheet.save(OUT / "contact_sheet_generated.png")


def main() -> None:
    save_status_icon("online", (45, 224, 145), (206, 255, 232))
    save_status_icon("offline", (140, 150, 178), (238, 242, 255))
    save_blue_glow()
    save_glass_panel()
    save_noise_texture()
    save_progress_bar()
    resize_alpha_assets()
    build_manifest()
    build_contact_sheet()
    print("generated utility assets, manifest, and contact sheet")


if __name__ == "__main__":
    main()
