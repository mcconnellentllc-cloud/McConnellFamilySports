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


def caption_from_filename(stem: str) -> str:
    cleaned = stem.replace("-", " ").replace("_", " ").strip()
    if not cleaned:
        return ""
    return cleaned[:1].upper() + cleaned[1:]


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
