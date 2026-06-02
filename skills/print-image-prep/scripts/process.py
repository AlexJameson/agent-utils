#!/usr/bin/env python3
"""Process images: RGB convert, resize, set 300 DPI, export."""
import os
import sys
from PIL import Image

TARGET_LONG_EDGE = 1500  # minimum long edge for upscaled images
MIN_LONG_EDGE = 1200
JPEG_QUALITY = 95


def process_image(src, dst, target_w=None, target_h=None):
    img = Image.open(src)
    if img.mode in ("RGBA", "P", "LA", "L"):
        if img.mode == "P":
            img = img.convert("RGBA")
        if img.mode in ("RGBA", "LA"):
            bg = Image.new("RGB", img.size, (255, 255, 255))
            if img.mode == "RGBA":
                bg.paste(img, mask=img.split()[3])
            else:
                bg.paste(img, mask=img.split()[1])
            img = bg
        else:
            img = img.convert("RGB")
    elif img.mode != "RGB":
        img = img.convert("RGB")

    w, h = img.size
    long_edge = max(w, h)

    if long_edge < MIN_LONG_EDGE:
        scale = TARGET_LONG_EDGE / long_edge
        new_w = int(round(w * scale))
        new_h = int(round(h * scale))
        img = img.resize((new_w, new_h), Image.Resampling.LANCZOS)
    elif target_w and target_h:
        scale = min(target_w / w, target_h / h)
        if scale < 1.0:
            new_w = int(round(w * scale))
            new_h = int(round(h * scale))
            img = img.resize((new_w, new_h), Image.Resampling.LANCZOS)

    # Strip conflicting DPI metadata
    if "exif" in img.info:
        try:
            exif = img.getexif()
            if exif:
                for tag in (282, 283, 296):
                    exif.pop(tag, None)
                img.info["exif"] = exif.tobytes()
        except Exception:
            pass

    img.save(dst, "JPEG", dpi=(300, 300), quality=JPEG_QUALITY, optimize=True)
    return img.size


def main(input_dir, output_dir, target_w=None, target_h=None):
    os.makedirs(output_dir, exist_ok=True)
    for f in sorted(os.listdir(input_dir)):
        if not f.lower().endswith((".jpg", ".jpeg", ".png")) or f.startswith("."):
            continue
        src = os.path.join(input_dir, f)
        dst = os.path.join(output_dir, f)
        try:
            out_size = process_image(src, dst, target_w, target_h)
            print(f"✅ {f} → {out_size}")
        except Exception as e:
            print(f"❌ {f}: {e}")


if __name__ == "__main__":
    if len(sys.argv) < 3:
        print("Usage: process.py <input_dir> <output_dir> [target_w] [target_h]")
        sys.exit(1)
    main(
        sys.argv[1],
        sys.argv[2],
        int(sys.argv[3]) if len(sys.argv) > 3 else None,
        int(sys.argv[4]) if len(sys.argv) > 4 else None,
    )
