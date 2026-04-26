# Upscaling Methods Reference

## Traditional (Pillow)
- **LANCZOS**: Best for ≤2× upscale. Sharp edges, no new detail.
- **BICUBIC**: Slightly faster, slightly softer.
- **BILINEAR**: Avoid for print. Too soft.

## AI (Local CLI)
- **realesrgan-ncnn-vulkan**: Portable binary. Best for photos/art. No Python deps.
- **SwinIR** (via `basicsr`): Best for textures. Requires PyTorch.

## Decision Matrix
| Factor | Method |
|--------|--------|
| ≤2× | Lanczos |
| 2–4×, no PyTorch | realesrgan-ncnn-vulkan |
| 2–4×, PyTorch OK | Real-ESRGAN or SwinIR |
| >4× | Flag for review |
