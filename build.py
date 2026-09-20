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
CONTENT = ROOT / "data" / "content.json"
ATHLETES = ROOT / "data" / "athletes.json"
CAL_DIR = ROOT / "calendar"

# Photos come straight off a phone at full resolution — several megabytes and
# thousands of pixels wide. Nothing on the site displays them that large, so
# the build shrinks the long edge to this and re-encodes. Comfortably sharp on
# a retina screen in the lightbox, and roughly a quarter of the file size.
LONG_EDGE = 1800
JPEG_QUALITY = 85

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


def optimize_image(path: Path) -> Path:
    """Shrink an oversized photo in place, and drop its EXIF.

    Two things happen here worth knowing about:

    * Orientation is baked into the pixels before the EXIF is discarded.
      iPhone photos are often stored sideways with a rotation flag; dropping
      that flag without applying it first would leave them on their side.
    * EXIF goes away, which also removes the GPS coordinates a phone writes
      into every shot. These files are served from a public site, so losing
      the exact location a photo of the girls was taken is a feature.

    Best effort: if Pillow is missing or a file will not open, the original is
    left exactly as it is and the build carries on.
    """
    ext = path.suffix.lower()
    # The file keeps its own name and format. Renaming someone's upload is a
    # surprise nobody asked for, and .jpeg is as valid as .jpg.
    if ext not in {".jpg", ".jpeg", ".png", ".webp"}:
        return path
    try:
        from PIL import Image, ImageOps
    except Exception:
        return path
    try:
        with Image.open(path) as im:
            if max(im.size) <= LONG_EDGE:
                return path  # already small enough; never re-encode needlessly
            before = path.stat().st_size
            im = ImageOps.exif_transpose(im)          # honour rotation...
            im.thumbnail((LONG_EDGE, LONG_EDGE), Image.LANCZOS)
            if ext == ".png":
                # Keep PNG as PNG: it may carry transparency, and a flattened
                # screenshot or logo looks worse as JPEG, not better.
                im.save(path, "PNG", optimize=True)
            elif ext == ".webp":
                im.save(path, "WEBP", quality=JPEG_QUALITY, method=6)
            else:
                im.convert("RGB").save(path, "JPEG", quality=JPEG_QUALITY,
                                       optimize=True, progressive=True)
    except Exception as exc:
        print(f"  ! {path.name}: could not resize ({exc}), leaving as-is.")
        return path
    after = path.stat().st_size
    print(f"  ~ {path.name}: {before / 1048576:.2f} MB -> {after / 1048576:.2f} MB")
    return path


def optimize_media() -> None:
    """Convert and shrink every photo under media/, including _ folders.

    The underscore folders (_family, _memories, _history, _schedules) never
    reach a gallery, but they are served to browsers just the same, so they
    get the same treatment.
    """
    if not MEDIA.exists():
        return
    for f in sorted(MEDIA.rglob("*")):
        if not f.is_file() or f.name.startswith("."):
            continue
        ext = f.suffix.lower()
        if ext not in IMAGE_EXTS:
            continue
        if ext in {".heic", ".heif"}:
            f = convert_heic(f)
        if f.suffix.lower() in IMAGE_EXTS and f.suffix.lower() not in {".gif"}:
            optimize_image(f)


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


# ---------- Calendar feeds ----------
# Each girl gets a subscribable .ics of her events, plus one per sport, so a
# phone can follow the season and pick up new games as they are added.


def ics_escape(text: str) -> str:
    """Escape a value for an iCalendar TEXT field (RFC 5545 §3.3.11)."""
    return (
        str(text)
        .replace("\\", "\\\\")
        .replace(";", "\\;")
        .replace(",", "\\,")
        .replace("\n", "\\n")
    )


def ics_fold(line: str) -> str:
    """Fold a content line to 75 octets, continuation lines starting with a space."""
    raw = line.encode("utf-8")
    if len(raw) <= 75:
        return line
    out, chunk = [], b""
    for ch in line:
        enc = ch.encode("utf-8")
        # 74 leaves room for the leading space on continuation lines.
        if len(chunk) + len(enc) > (75 if not out else 74):
            out.append(chunk.decode("utf-8"))
            chunk = b""
        chunk += enc
    out.append(chunk.decode("utf-8"))
    return "\r\n ".join(out)


def next_day(iso: str) -> str:
    """The day after an ISO date, as an all-day DTEND is exclusive."""
    y, m, d = (int(x) for x in iso.split("-"))
    days = [31, 29 if (y % 4 == 0 and (y % 100 != 0 or y % 400 == 0)) else 28,
            31, 30, 31, 30, 31, 31, 30, 31, 30, 31]
    d += 1
    if d > days[m - 1]:
        d, m = 1, m + 1
        if m > 12:
            m, y = 1, y + 1
    return f"{y:04d}{m:02d}{d:02d}"


def build_calendar(name: str, events: list[dict], sports: dict) -> str:
    lines = [
        "BEGIN:VCALENDAR",
        "VERSION:2.0",
        "PRODID:-//The McConnell Family//EN",
        "CALSCALE:GREGORIAN",
        "METHOD:PUBLISH",
        f"X-WR-CALNAME:{ics_escape(name)}",
    ]
    for ev in events:
        date = (ev.get("date") or "").strip()
        if not re.match(r"^\d{4}-\d{2}-\d{2}$", date):
            continue
        stamp = date.replace("-", "")
        sport = sports.get(ev.get("sport"), {}).get("name") or ev.get("sport") or ""
        title = ev.get("name") or "Event"
        summary = f"{sport}: {title}" if sport else title

        where = " — ".join(x for x in (ev.get("venue"), ev.get("address")) if x)
        desc_bits = []
        if ev.get("notes"):
            desc_bits.append(ev["notes"])
        if ev.get("result"):
            desc_bits.append("Result: " + str(ev["result"]).title())
        if ev.get("sets"):
            desc_bits.append("Sets: " + ", ".join(
                f"{g.get('us')}-{g.get('them')}" for g in ev["sets"]))

        # Stable per-event id so re-subscribing updates rather than duplicates.
        slug = re.sub(r"[^a-z0-9]+", "-", title.lower()).strip("-")
        lines += [
            "BEGIN:VEVENT",
            f"UID:{stamp}-{ev.get('sport','event')}-{slug}@mcconnellfamilysports",
            f"DTSTAMP:{stamp}T000000Z",
            f"DTSTART;VALUE=DATE:{stamp}",
            f"DTEND;VALUE=DATE:{next_day(date)}",
            f"SUMMARY:{ics_escape(summary)}",
        ]
        if where:
            lines.append(f"LOCATION:{ics_escape(where)}")
        if desc_bits:
            lines.append(f"DESCRIPTION:{ics_escape(' '.join(desc_bits))}")
        lines.append("END:VEVENT")
    lines.append("END:VCALENDAR")
    # RFC 5545 requires CRLF line endings.
    return "\r\n".join(ics_fold(x) for x in lines) + "\r\n"


def write_calendars() -> int:
    if not CONTENT.exists() or not ATHLETES.exists():
        return 0
    content = json.loads(CONTENT.read_text(encoding="utf-8"))
    roster = json.loads(ATHLETES.read_text(encoding="utf-8"))
    events = content.get("events") or []
    sports = {s["slug"]: s for s in roster.get("sports", [])}

    CAL_DIR.mkdir(parents=True, exist_ok=True)
    written = 0
    for girl in roster.get("athletes", []):
        slug, name = girl["slug"], girl["name"]
        mine = [e for e in events if slug in (e.get("athletes") or [])]
        if not mine:
            continue
        mine.sort(key=lambda e: e.get("date") or "")
        targets = [(f"{slug}.ics", f"{name} — Sports", mine)]
        for sp in sorted({e.get("sport") for e in mine if e.get("sport")}):
            label = sports.get(sp, {}).get("name") or sp
            targets.append((
                f"{slug}-{sp}.ics",
                f"{name} — {label}",
                [e for e in mine if e.get("sport") == sp],
            ))
        for filename, cal_name, rows in targets:
            (CAL_DIR / filename).write_text(
                build_calendar(cal_name, rows, sports), encoding="utf-8", newline="")
            written += 1
    return written


def main() -> int:
    optimize_media()
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
    n_cal = write_calendars()
    print(f"Wrote {n_cal} calendar feed(s) to {CAL_DIR.relative_to(ROOT)}/.")
    return 0


if __name__ == "__main__":
    sys.exit(main())
