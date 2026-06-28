# AgentHub Phase 1 Reika Asset Pack

This folder contains the first usable visual slice for AgentHub, extracted from the supplied Reika and AgentHub reference sheets.

## Entry Points

- `manifest.json` lists every exported asset, its source crop box, and palette metadata.
- `contact_sheet.png` previews the main exported crops.
- `_source/` contains the original reference sheets used for extraction.

## Folders

- `brand/` - AgentHub logo, wordmark, app icon, tray icon, loading emblems, plus alpha variants where useful.
- `character/reika/` - Reika splash art, portrait, avatar, chibi, expressions, and status variants.
- `character_sheet/` - Character turnaround and expression reference crops from the detailed Reika sheet.
- `room/` - Full room, blurred background, hero crop, and loading splash crop.
- `empty_states/` - Chibi/UI empty-state illustrations.
- `icons/` - Device, provider, and chat UI icons.
- `decorative/` - Glow, glass, noise, rain, grid, circuit, and sparkle assets.
- `loading/` - Loading screen emblem frames, progress bar, and quote-card background.

## Notes

- `_alpha.png` files are dark-background-to-alpha extractions intended for quick UI tests, not final hand-cleaned production transparency.
- Resized icon variants are generated at common UI sizes such as `128`, `256`, and `512`.
- Re-run `python scripts/extract_phase1_assets.py` from the project root to regenerate the pack from the source sheets.
