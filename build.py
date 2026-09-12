#!/usr/bin/env python3
"""
Scan the media/ tree and regenerate data/gallery.json.

Folder convention: media/<athlete-slug>/<sport-slug>/<filename>
Caption is derived from the filename (without extension), with dashes and
underscores converted to spaces and the first letter capitalized.

Both photos and videos are picked up from the same per-girl/per-sport
folders. Each gallery entry carries a "type" of "photo" or "video" so the
site can render an <img> or an inline <video> player accordingly.

Run locally:  python3 build.py
Run in CI:    handled by .github/workflows/deploy.yml
"""

from __future__ import annotations

import json
import re
import sys
from pathlib import Path

ROOT = Path(__file__).resolve().parent
MEDIA = ROOT / "media"
OUT = ROOT / "data" / "gallery.json"

IMAGE_EXTS = {".jpg", ".jpeg", ".png", ".gif", ".webp", ".avif", ".heic", ".heif"}
# Web-friendly video containers. .mp4 (H.264/AAC) plays in every browser;
# .mov (iPhone), .m4v, and .webm are also detected and rendered inline.
VIDEO_EXTS = {".mp4", ".mov", ".m4v", ".webm"}
MEDIA_EXTS = IMAGE_EXTS | VIDEO_EXTS


# Names a camera or phone assigns on its own — IMG_4821, PXL_20260912_183045,
# DSC00042, and friends. They say nothing about the photo, so they make worse
# captions than no caption at all.
CAMERA_NAME_RE = re.compile(
    r"^(img|image|photo|pxl|dsc|dscn|dji|gopr|mvimg|vid|video|mov|fullsizerender)"
    r"[ _-]*[0-9_\-]*$",
    re.IGNORECASE,
)


def caption_from_filename(stem: str) -> str:
    cleaned = stem.replace("-", " ").replace("_", " ").strip()
    if not cleaned:
        return ""
    if CAMERA_NAME_RE.match(stem.strip()):
        return ""
    return cleaned[:1].upper() + cleaned[1:]


def convert_heic(path: Path) -> Path:
    """Turn an iPhone .heic/.heif into a .jpg so every browser can show it.

    Chrome, Firefox, and Android render HEIC as a broken image, so a photo
    uploaded straight from an iPhone's Files app would be invisible to most
    of the family. Converting keeps that from happening silently.

    If the optional decoder isn't installed the original file is left alone
    and returned unchanged — a missing dependency must never fail the build.
    """
    try:
        from PIL import Image
        import pillow_heif

        pillow_heif.register_heif_opener()
    except Exception:
        print(f"  ! {path.name}: HEIC decoder unavailable, leaving as-is.")
        return path

    jpg = path.with_suffix(".jpg")
    if jpg.exists():
        return jpg
    try:
        with Image.open(path) as im:
            im.convert("RGB").save(jpg, "JPEG", quality=90)
    except Exception as exc:
        print(f"  ! {path.name}: could not convert ({exc}), leaving as-is.")
        return path
    path.unlink()
    print(f"  + converted {path.name} -> {jpg.name}")
    return jpg


def scan() -> list[dict]:
    photos: list[dict] = []
    if not MEDIA.exists():
        return photos
    for athlete_dir in sorted(p for p in MEDIA.iterdir() if p.is_dir()):
        athlete = athlete_dir.name
        # Skip non-athlete folders (e.g. _venues/, _shared/) — leading underscore
        # marks media that should not appear in any girl's gallery.
        if athlete.startswith("_"):
            continue
        for sport_dir in sorted(p for p in athlete_dir.iterdir() if p.is_dir()):
            sport = sport_dir.name
            for f in sorted(sport_dir.iterdir()):
                if not f.is_file():
                    continue
                if f.name.startswith("."):
                    continue
                ext = f.suffix.lower()
                if ext not in MEDIA_EXTS:
                    continue
                if ext in {".heic", ".heif"}:
                    f = convert_heic(f)
                    ext = f.suffix.lower()
                rel = f"media/{athlete}/{sport}/{f.name}"
                photos.append(
                    {
                        "athlete": athlete,
                        "sport": sport,
                        "type": "video" if ext in VIDEO_EXTS else "photo",
                        "src": rel,
                        "caption": caption_from_filename(f.stem),
                        "file": f.name,
                    }
                )
    return photos


def main() -> int:
    photos = scan()
    OUT.parent.mkdir(parents=True, exist_ok=True)
    payload = {"photos": photos}
    with OUT.open("w", encoding="utf-8") as fh:
        json.dump(payload, fh, indent=2, ensure_ascii=False)
        fh.write("\n")
    n_video = sum(1 for p in photos if p.get("type") == "video")
    n_photo = len(photos) - n_video
    print(
        f"Wrote {OUT.relative_to(ROOT)} with {len(photos)} media item(s) "
        f"({n_photo} photo(s), {n_video} video(s))."
    )
    return 0


if __name__ == "__main__":
    sys.exit(main())
