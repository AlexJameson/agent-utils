#!/usr/bin/env python3
"""Assess image quality via no-reference metrics and gradient analysis."""
import os
import sys
from PIL import Image, ImageFilter
import numpy as np


def gradient_sharpness(path):
    img = Image.open(path).convert("L")
    grad = np.array(img.filter(ImageFilter.FIND_EDGES))
    return float(grad.mean()), float(grad.std())


def main(image_dir):
    try:
        import piq
        has_piq = True
    except ImportError:
        has_piq = False

    for f in sorted(os.listdir(image_dir)):
        if not f.lower().endswith((".jpg", ".jpeg", ".png")) or f.startswith("."):
            continue
        path = os.path.join(image_dir, f)
        mean_grad, std_grad = gradient_sharpness(path)
        print(f"{f}:")
        print(f"  Gradient mean: {mean_grad:.2f}  std: {std_grad:.2f}")
        if has_piq:
            import torch
            img = Image.open(path).convert("RGB")
            tensor = (
                torch.from_numpy(np.array(img))
                .permute(2, 0, 1)
                .unsqueeze(0)
                .float()
                / 255.0
            )
            with torch.no_grad():
                brisque = piq.brisque(tensor, data_range=1.0).item()
                niqe = piq.niqe(tensor, data_range=1.0).item()
            print(f"  BRISQUE: {brisque:.2f}  NIQE: {niqe:.2f}")
        print()


if __name__ == "__main__":
    main(sys.argv[1] if len(sys.argv) > 1 else ".")
