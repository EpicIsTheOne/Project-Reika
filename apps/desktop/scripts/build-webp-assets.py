from pathlib import Path
from PIL import Image

ROOT = Path(__file__).resolve().parents[1]
SOURCE = ROOT / "assets" / "reika_phase1_generated"
OUTPUT = ROOT / "assets" / "reika_phase1_webp"

ASSETS = [
    "brand/reika_logo_icon_alpha.png", "brand/reika_logo_icon_alpha_256.png",
    "character/reika/chibi.png", "character/reika/circular_avatar_source.png",
    "character/reika/full_splash_illustration.png", "character/reika/half_body_portrait.png",
    "character/reika/expressions/neutral.png", "character/reika/expressions/happy.png",
    "character/reika/expressions/thinking.png", "character/reika/expressions/playful.png",
    "room/full_room_night.png", "room/blurred_ui_background.png", "room/hero_banner.png",
    "loading/loading_splash_background.png", "loading/reika_boot_backdrop.png", "loading/progress_bar_alpha.png",
    "empty_states/no_agents_connected.png", "empty_states/no_chat_history.png",
    "icons/devices/pc_alpha_256.png", "icons/devices/laptop_alpha_256.png", "icons/devices/vps_server_alpha_256.png",
    "icons/providers/hermes_alpha_256.png", "icons/providers/openclaw_alpha_256.png",
    "icons/status/online_alpha.png", "icons/status/offline_alpha.png",
    "decorative/blue_glow_overlay_alpha.png", "decorative/glass_panel_texture_alpha.png",
    "decorative/subtle_noise_texture_alpha.png",
]


def profile(relative: str):
    if relative.startswith("icons/") or relative.endswith("_256.png") or "wordmark" in relative or "progress_bar" in relative:
        return 512, 80, 100_000
    if relative.startswith(("room/", "loading/", "empty_states/")) or "splash" in relative:
        return 1920, 85, 500_000
    return 1200, 82, 300_000


def convert(relative: str):
    source = SOURCE / relative
    target = (OUTPUT / relative).with_suffix(".webp")
    target.parent.mkdir(parents=True, exist_ok=True)
    max_edge, initial_quality, budget = profile(relative)
    with Image.open(source) as opened:
        image = opened.convert("RGBA" if "A" in opened.getbands() else "RGB")
        if max(image.size) > max_edge:
            scale = max_edge / max(image.size)
            image = image.resize((max(1, round(image.width * scale)), max(1, round(image.height * scale))), Image.Resampling.LANCZOS)
        quality = initial_quality
        while True:
            image.save(target, "WEBP", quality=quality, method=6, exact="A" in image.getbands())
            if target.stat().st_size <= budget or quality <= 68:
                break
            quality -= 3
    print(f"{relative}: {target.stat().st_size} bytes, {image.width}x{image.height}, q{quality}")


for asset in ASSETS:
    convert(asset)
