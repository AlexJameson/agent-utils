---
name: print-image-prep
description: Prepare image collections for high-quality printing. Analyzes dimensions, DPI, and format; classifies images by print-readiness; upscales when necessary; normalizes to 300 DPI; and assesses output quality. Use when Kimi needs to process images for print, check image print readiness, upscale images for printing, batch-convert image DPI, or evaluate image quality for physical output.
---

# Image Print Preparation

Cross-platform, CLI-only, Python-based workflow for preparing images for high-quality printing.

## Core Workflow

1. **Analyze**: Run `scripts/analyze.py` to inventory and classify images.
2. **Decide**: Review classification. Choose handling per image tier.
3. **Process**: Run `scripts/process.py` to resize, set DPI, and export.
4. **Assess**: Run `scripts/assess.py` for quality metrics and visual report.

## Image Classification Tiers

| Tier | Criteria | Handling |
|---|---|---|
| A — Print-ready | ≥ target @ 300 DPI, correct DPI metadata | Pass through, verify |
| B — Large enough | ≥ target @ 300 DPI, wrong/missing DPI | Fix metadata only |
| C — Moderate upscale | Upscaling factor ≤ 2.0× | Lanczos resize |
| D — Heavy upscale | Upscaling factor 2.0–4.0× | AI upscale if available, else Lanczos + warn |
| E — Unrecoverable | Factor > 4.0× or heavily compressed | Flag for manual review |

**Upscaling factor:** `min(target_width / w, target_height / h)`

## Quality Assessment

- Always visually inspect at 100% zoom.
- Optional: Run `scripts/assess.py` for BRISQUE/NIQE scores (requires `piq`).
- Optional: Run gradient sharpness map analysis.

## Dependencies

- **Required**: Pillow (`pip install Pillow`)
- **Optional**: piq (`pip install piq`), numpy (`pip install numpy`)
- **Optional AI**: `realesrgan-ncnn-vulkan` portable binary

## Output Standards

- DPI: 300×300
- Format: JPEG quality ≥ 95% or TIFF lossless
- Color: RGB (sRGB preferred)
- Metadata: Strip conflicting old DPI tags before writing new ones
