from __future__ import annotations

import json
import shutil
from pathlib import Path

from PIL import Image, ImageDraw, ImageFont, ImageOps


ROOT = Path(__file__).resolve().parents[1]
OUT = ROOT / "assets" / "agenthub_phase1"
SOURCE_DIR = OUT / "_source"

REFERENCE_SHEET = Path(r"C:\Users\Epic\Downloads\RefrenceSheet.png")
CHARACTER_SHEET = Path(r"C:\Users\Epic\Downloads\ReikaCharactersheet.png")


def crop_asset(
    source: Image.Image,
    rel_path: str,
    box: tuple[int, int, int, int],
    *,
    square: bool = False,
    sizes: tuple[int, ...] = (),
    transparent_dark: bool = False,
) -> list[dict[str, object]]:
    target = OUT / rel_path
    target.parent.mkdir(parents=True, exist_ok=True)

    img = source.crop(box)
    if square:
        side = max(img.width, img.height)
        canvas = Image.new("RGB", (side, side), (5, 12, 26))
        canvas.paste(img, ((side - img.width) // 2, (side - img.height) // 2))
        img = canvas

    img.save(target)
    records = [record_for(target, box, source.size)]

    if transparent_dark:
        alpha = dark_to_alpha(img)
        alpha_target = target.with_name(target.stem + "_alpha.png")
        alpha.save(alpha_target)
        records.append(record_for(alpha_target, box, source.size, variant="dark-bg-to-alpha"))

    for size in sizes:
        resized = ImageOps.contain(img, (size, size), Image.Resampling.LANCZOS)
        if square:
            canvas = Image.new("RGB", (size, size), (5, 12, 26))
            canvas.paste(resized, ((size - resized.width) // 2, (size - resized.height) // 2))
            resized = canvas
        sized_target = target.with_name(f"{target.stem}_{size}.png")
        resized.save(sized_target)
        records.append(record_for(sized_target, box, source.size, variant=f"{size}px"))

        if transparent_dark:
            alpha = dark_to_alpha(resized)
            alpha_target = target.with_name(f"{target.stem}_{size}_alpha.png")
            alpha.save(alpha_target)
            records.append(record_for(alpha_target, box, source.size, variant=f"{size}px dark-bg-to-alpha"))

    return records


def dark_to_alpha(img: Image.Image) -> Image.Image:
    rgba = img.convert("RGBA")
    pixels = rgba.load()
    for y in range(rgba.height):
        for x in range(rgba.width):
            r, g, b, a = pixels[x, y]
            brightness = max(r, g, b)
            blue_bias = b - max(r, g)
            if brightness < 24:
                pixels[x, y] = (r, g, b, 0)
            elif brightness < 58 and blue_bias < 26:
                pixels[x, y] = (r, g, b, int((brightness - 24) / 34 * 160))
    return rgba


def record_for(
    path: Path,
    box: tuple[int, int, int, int],
    source_size: tuple[int, int],
    *,
    variant: str = "source-crop",
) -> dict[str, object]:
    return {
        "path": path.relative_to(ROOT).as_posix(),
        "variant": variant,
        "source_box": list(box),
        "source_size": list(source_size),
    }


def build_contact_sheet(records: list[dict[str, object]]) -> None:
    thumbs = []
    for rec in records:
        path = ROOT / str(rec["path"])
        if path.name.endswith("_alpha.png") or any(path.name.endswith(f"_{s}.png") for s in (128, 256, 512)):
            continue
        img = Image.open(path).convert("RGB")
        img.thumbnail((180, 110), Image.Resampling.LANCZOS)
        thumbs.append((path, img.copy()))

    cols = 5
    cell_w, cell_h = 220, 160
    rows = (len(thumbs) + cols - 1) // cols
    sheet = Image.new("RGB", (cols * cell_w, max(1, rows) * cell_h), (8, 14, 28))
    draw = ImageDraw.Draw(sheet)
    try:
        font = ImageFont.truetype("arial.ttf", 12)
    except OSError:
        font = ImageFont.load_default()

    for idx, (path, img) in enumerate(thumbs):
        x = (idx % cols) * cell_w
        y = (idx // cols) * cell_h
        sheet.paste(img, (x + (cell_w - img.width) // 2, y + 12))
        label = path.relative_to(OUT).as_posix()
        draw.text((x + 10, y + 126), label[:34], fill=(183, 192, 216), font=font)

    contact = OUT / "contact_sheet.png"
    contact.parent.mkdir(parents=True, exist_ok=True)
    sheet.save(contact)


def main() -> None:
    OUT.mkdir(parents=True, exist_ok=True)
    SOURCE_DIR.mkdir(parents=True, exist_ok=True)
    shutil.copy2(REFERENCE_SHEET, SOURCE_DIR / "reference_sheet.png")
    shutil.copy2(CHARACTER_SHEET, SOURCE_DIR / "reika_character_sheet.png")

    ref = Image.open(REFERENCE_SHEET).convert("RGB")
    char = Image.open(CHARACTER_SHEET).convert("RGB")

    records: list[dict[str, object]] = []
    assets = [
        ("brand/agenthub_icon.png", ref, (31, 166, 96, 228), True, (512, 256), True),
        ("brand/agenthub_wordmark.png", ref, (113, 169, 281, 229), False, (), True),
        ("brand/agenthub_combined.png", ref, (296, 171, 453, 228), False, (), True),
        ("brand/agenthub_app_icon.png", ref, (480, 160, 549, 229), True, (512, 256), False),
        ("brand/agenthub_tray_icon.png", ref, (581, 178, 633, 226), True, (256, 128), True),
        ("brand/agenthub_loading_emblem.png", ref, (666, 151, 757, 239), True, (512, 256), True),
        ("brand/agenthub_glowing_emblem.png", ref, (689, 158, 739, 216), True, (512, 256), True),
        ("character/reika/full_splash.png", ref, (25, 333, 394, 489), False, (), False),
        ("character/reika/half_body_portrait.png", ref, (404, 333, 544, 492), False, (), False),
        ("character/reika/circular_avatar.png", ref, (558, 333, 666, 449), True, (512, 256), False),
        ("character/reika/chibi.png", ref, (690, 333, 780, 457), True, (512, 256), False),
        ("character/reika/expressions/neutral.png", ref, (27, 524, 111, 602), True, (256, 128), False),
        ("character/reika/expressions/happy.png", ref, (114, 524, 197, 602), True, (256, 128), False),
        ("character/reika/expressions/thinking.png", ref, (200, 524, 284, 602), True, (256, 128), False),
        ("character/reika/expressions/excited.png", ref, (288, 524, 371, 602), True, (256, 128), False),
        ("character/reika/expressions/concerned.png", ref, (375, 524, 458, 602), True, (256, 128), False),
        ("character/reika/expressions/sleepy.png", ref, (462, 524, 545, 602), True, (256, 128), False),
        ("character/reika/expressions/playful.png", ref, (548, 524, 632, 602), True, (256, 128), False),
        ("character/reika/expressions/glitched_error.png", ref, (637, 524, 723, 602), True, (256, 128), False),
        ("character/reika/status/online.png", ref, (29, 653, 113, 729), True, (256, 128), False),
        ("character/reika/status/idle.png", ref, (128, 653, 220, 729), True, (256, 128), False),
        ("character/reika/status/busy.png", ref, (240, 653, 333, 729), True, (256, 128), False),
        ("character/reika/status/offline.png", ref, (353, 653, 445, 729), True, (256, 128), False),
        ("character/reika/status/error.png", ref, (467, 653, 557, 729), True, (256, 128), False),
        ("room/full_room_night.png", ref, (823, 186, 1038, 319), False, (), False),
        ("room/blurred_ui_background.png", ref, (1048, 186, 1226, 319), False, (), False),
        ("room/hero_banner_crop.png", ref, (1242, 187, 1515, 319), False, (), False),
        ("room/loading_splash_background.png", ref, (829, 798, 944, 855), False, (), False),
        ("empty_states/no_agents_connected.png", ref, (824, 377, 944, 535), False, (), False),
        ("empty_states/no_devices_found.png", ref, (953, 377, 1078, 535), False, (), False),
        ("empty_states/no_chat_history.png", ref, (1087, 377, 1217, 535), False, (), False),
        ("empty_states/provider_offline.png", ref, (1224, 377, 1356, 535), False, (), False),
        ("empty_states/error_illustration.png", ref, (1366, 377, 1509, 535), False, (), False),
        ("icons/devices/pc.png", ref, (835, 590, 885, 638), True, (256, 128), True),
        ("icons/devices/laptop.png", ref, (918, 590, 971, 637), True, (256, 128), True),
        ("icons/devices/vps_server.png", ref, (1002, 589, 1060, 638), True, (256, 128), True),
        ("icons/devices/phone_future.png", ref, (1082, 585, 1124, 641), True, (256, 128), True),
        ("icons/providers/hermes.png", ref, (1163, 582, 1219, 642), True, (256, 128), True),
        ("icons/providers/openclaw.png", ref, (1244, 582, 1303, 642), True, (256, 128), True),
        ("icons/providers/mock.png", ref, (1334, 584, 1389, 641), True, (256, 128), True),
        ("icons/providers/unknown.png", ref, (1429, 586, 1484, 641), True, (256, 128), True),
        ("icons/chat/typing_indicator.png", ref, (29, 827, 67, 842), False, (), True),
        ("icons/chat/heart_reaction.png", ref, (86, 821, 122, 850), True, (256, 128), True),
        ("icons/chat/tool_use.png", ref, (150, 818, 181, 851), True, (256, 128), True),
        ("icons/chat/attachment.png", ref, (207, 820, 234, 850), True, (256, 128), True),
        ("icons/chat/voice_mic.png", ref, (270, 817, 289, 850), True, (256, 128), True),
        ("icons/chat/send.png", ref, (317, 820, 341, 849), True, (256, 128), True),
        ("decorative/blue_glow_overlay.png", ref, (378, 809, 429, 859), True, (), False),
        ("decorative/glass_panel_texture.png", ref, (437, 809, 489, 858), True, (), False),
        ("decorative/subtle_noise_texture.png", ref, (500, 809, 552, 858), True, (), False),
        ("decorative/circuit_pattern_overlay.png", ref, (562, 809, 615, 858), True, (), False),
        ("decorative/rain_overlay.png", ref, (624, 809, 675, 858), True, (), False),
        ("decorative/hologram_grid_overlay.png", ref, (685, 809, 736, 858), True, (), False),
        ("decorative/sparkle_accent.png", ref, (745, 809, 788, 858), True, (), True),
        ("loading/emblem_frames.png", ref, (960, 809, 1056, 839), False, (), True),
        ("loading/progress_bar.png", ref, (1099, 810, 1291, 838), False, (), False),
        ("loading/startup_quote_card_bg.png", ref, (1348, 799, 1489, 876), False, (), False),
        ("character_sheet/front.png", char, (279, 82, 443, 786), False, (), False),
        ("character_sheet/back.png", char, (485, 86, 643, 787), False, (), False),
        ("character_sheet/side.png", char, (684, 92, 832, 787), False, (), False),
        ("character_sheet/three_quarter.png", char, (873, 87, 1076, 786), False, (), False),
        ("character_sheet/face_closeup.png", char, (1114, 39, 1346, 290), False, (), False),
        ("character_sheet/expressions/neutral.png", char, (234, 823, 354, 967), False, (), False),
        ("character_sheet/expressions/soft_smile.png", char, (359, 823, 482, 967), False, (), False),
        ("character_sheet/expressions/teasing_smirk.png", char, (488, 823, 610, 967), False, (), False),
        ("character_sheet/expressions/serious.png", char, (616, 823, 737, 967), False, (), False),
        ("character_sheet/expressions/slight_embarrassed.png", char, (744, 823, 865, 967), False, (), False),
        ("character_sheet/expressions/cold_intense.png", char, (872, 823, 994, 967), False, (), False),
    ]

    for rel_path, source, box, square, sizes, transparent_dark in assets:
        records.extend(
            crop_asset(
                source,
                rel_path,
                box,
                square=square,
                sizes=sizes,
                transparent_dark=transparent_dark,
            )
        )

    manifest = {
        "name": "AgentHub Phase 1 Reika Visual Slice",
        "source_prompt": "C:/Users/Epic/Documents/NEXUS-AICHAT/Refrence Docs/txt/AgentHub_Phase1_Visual_Prompt.txt",
        "sources": [
            "_source/reference_sheet.png",
            "_source/reika_character_sheet.png",
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
        "assets": records,
    }
    (OUT / "manifest.json").write_text(json.dumps(manifest, indent=2), encoding="utf-8")
    build_contact_sheet(records)
    print(f"Wrote {len(records)} asset records to {OUT}")


if __name__ == "__main__":
    main()
