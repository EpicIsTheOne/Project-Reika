# AgentHub Phase 1 Generated Asset Pack

This is the corrected Phase 1 asset pack: new project-local assets generated from the supplied AgentHub and Reika references.

Use this folder for the prototype:

`assets/agenthub_phase1_generated/`

## Key Files

- `manifest.json` - generated asset inventory with sizes and transparency flags.
- `contact_sheet_generated.png` - quick visual preview of the usable assets.
- `_source_refs/` - copies of the reference images used for style direction.

## Transparency

Transparent PNGs use the `_alpha.png` suffix.

Important transparent assets:

- `brand/agenthub_logo_icon_alpha.png`
- `brand/agenthub_wordmark_text_alpha.png`
- `brand/agenthub_combined_deterministic_alpha.png`
- `icons/devices/*_alpha.png`
- `icons/providers/*_alpha.png`
- `icons/status/*_alpha.png`
- `decorative/*_alpha.png`
- `loading/progress_bar_alpha.png`

## Notes

- Reika character art and room/background assets are generated image assets based on the references, not crops from the reference sheets.
- Device and provider icons were generated on chroma-key backgrounds and converted to transparent PNGs.
- Text-heavy brand assets include deterministic transparent variants because model-generated text can drift.
