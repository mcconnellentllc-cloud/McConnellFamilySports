#!/usr/bin/env python3
"""
Scan the media/ tree and regenerate data/gallery.json.

Folder convention: media/<athlete-slug>/<sport-slug>/<filename>
Caption is derived from the filename (without extension), with dashes and
underscores converted to spaces and the first letter capitalized.

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
        for sport_dir in sorted(p for p in athlete_dir.iterdir() if p.is_dir()):
            sport = sport_dir.name
            for f in sorted(sport_dir.iterdir()):
                if not f.is_file():
                    continue
                if f.name.startswith("."):
                    continue
                if f.suffix.lower() not in IMAGE_EXTS:
                    continue
                rel = f"media/{athlete}/{sport}/{f.name}"
                photos.append(
                    {
                        "athlete": athlete,
                        "sport": sport,
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
    print(f"Wrote {OUT.relative_to(ROOT)} with {len(photos)} photo(s).")
    return 0


if __name__ == "__main__":
    sys.exit(main())
