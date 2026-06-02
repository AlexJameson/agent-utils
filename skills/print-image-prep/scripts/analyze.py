#!/usr/bin/env python3
"""Analyze images and classify by print-readiness tier."""
import os
import sys
import json
from PIL import Image


def classify(w, h, target_w, target_h):
    scale = min(target_w / w, target_h / h)
    if scale <= 1.0:
        return "A"  # source is equal or larger than target
    elif scale <= 2.0:
        return "C"  # needs <=2x upscale to reach target
    elif scale <= 4.0:
        return "D"  # needs 2-4x upscale to reach target
    else:
        return "E"  # needs >4x upscale to reach target


def main(input_dir, target_w=2480, target_h=3508):
    results = []
    for f in sorted(os.listdir(input_dir)):
        if not f.lower().endswith((".jpg", ".jpeg", ".png")) or f.startswith("."):
            continue
        path = os.path.join(input_dir, f)
        try:
            img = Image.open(path)
            w, h = img.size
            raw_dpi = img.info.get("dpi")
            dpi = [float(v) for v in raw_dpi] if raw_dpi else None
            tier = classify(w, h, target_w, target_h)
            scale = min(target_w / w, target_h / h)
            results.append({
                "file": f,
                "size": [w, h],
                "dpi": dpi,
                "tier": tier,
                "scale": round(scale, 2),
            })
        except Exception as e:
            results.append({"file": f, "error": str(e)})
    print(json.dumps(results, indent=2, ensure_ascii=False))


if __name__ == "__main__":
    main(sys.argv[1] if len(sys.argv) > 1 else ".")
