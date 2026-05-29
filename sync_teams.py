#!/usr/bin/env python3
"""
sync_teams.py — one-way Microsoft Teams → McConnell Family Sports sync.

Reads new messages and attached photos from the family Teams channel
via the Microsoft Graph API, extracts EXIF metadata, optionally
suggests which McConnell girl appears in each photo (face recognition),
and either files the photo straight into media/<girl>/<sport>/ or
parks it in media/_pending/ + data/pending.json for human confirmation
in the Review tray.

DESIGN GOALS
------------
- Idempotent: re-running must never duplicate work. Photos keyed by
  SHA-256 of bytes; messages keyed by their Graph id.
- Crash-safe: a watermark is only advanced after each item is
  fully processed and its state written to disk.
- Secret-quiet: secrets are read from environment variables, never
  printed, never written to JSON files, never appended to logs.
- Graceful degradation: if face recognition can't load (model
  download failed, library not installed), the sync still runs and
  every photo just lands in the Review tray with no girl
  pre-selection. Same for reverse geocoding — Nominatim rate-limit
  or outage doesn't kill the run.
- Optional dependencies: `insightface` and `onnxruntime` are nice to
  have. Their absence is a soft fail.

USAGE
-----
    sync_teams.py

Environment variables (typically GitHub Secrets in CI):
    TENANT_ID, CLIENT_ID, CLIENT_SECRET, TEAMS_TEAM_ID,
    TEAMS_CHANNEL_ID

Optional:
    SYNC_DRY_RUN=1            don't write any files; print what would happen
    SYNC_FACE_ENABLED=0       skip face recognition entirely
    SYNC_NOMINATIM_USER_AGENT custom UA for Nominatim (defaults to repo URL)
"""
from __future__ import annotations

import contextlib
import datetime as _dt
import hashlib
import io
import json
import logging
import os
import re
import sys
import time
from dataclasses import dataclass, field
from pathlib import Path
from typing import Any, Iterable

import requests

# ---------------------------------------------------------------------------
# Paths and constants
# ---------------------------------------------------------------------------

ROOT = Path(__file__).resolve().parent
DATA = ROOT / "data"
MEDIA = ROOT / "media"
PENDING_DIR = MEDIA / "_pending"
FACES_DIR = MEDIA / "_faces"

SYNC_STATE_PATH = DATA / ".sync_state.json"
PENDING_PATH = DATA / "pending.json"
CONTENT_PATH = DATA / "content.json"
ATHLETES_PATH = DATA / "athletes.json"
VENUE_MAP_PATH = DATA / "venue_map.json"
GEO_CACHE_PATH = DATA / "geo_cache.json"

GRAPH = "https://graph.microsoft.com/v1.0"
HASHTAG_RE = re.compile(r"#([A-Za-z][A-Za-z0-9_-]*)")
SUPPORTED_IMAGE_EXT = {".jpg", ".jpeg", ".png", ".heic", ".webp"}
SUPPORTED_VIDEO_EXT = {".mp4", ".mov", ".m4v", ".webm"}
SUPPORTED_MEDIA_EXT = SUPPORTED_IMAGE_EXT | SUPPORTED_VIDEO_EXT
# Files uploaded from the website's "Add photos or videos" button are named
# "mfs.<girl>.<sport>.<original-name>" by the upload endpoint so this sync can
# file them straight into the right folder instead of the Review tray.
UPLOAD_PREFIX_RE = re.compile(r"^mfs\.([a-z0-9-]+)\.([a-z0-9-]+)\.(.+)$", re.IGNORECASE)
NOMINATIM = "https://nominatim.openstreetmap.org/reverse"
NOMINATIM_MIN_INTERVAL = 1.1  # seconds; respect their 1 req/sec policy

log = logging.getLogger("sync")


# ---------------------------------------------------------------------------
# Small helpers
# ---------------------------------------------------------------------------

def utcnow_iso() -> str:
    return _dt.datetime.now(_dt.timezone.utc).strftime("%Y-%m-%dT%H:%M:%SZ")


def load_json(path: Path, default: Any) -> Any:
    if not path.exists():
        return default
    try:
        return json.loads(path.read_text())
    except json.JSONDecodeError as e:
        log.error("Corrupt JSON at %s (%s); refusing to overwrite", path, e)
        raise


def write_json(path: Path, value: Any) -> None:
    tmp = path.with_suffix(path.suffix + ".tmp")
    tmp.write_text(json.dumps(value, indent=2, sort_keys=False) + "\n")
    tmp.replace(path)


def sha256_bytes(b: bytes) -> str:
    return hashlib.sha256(b).hexdigest()


def slugify(s: str) -> str:
    s = re.sub(r"[^a-zA-Z0-9]+", "-", s.strip().lower())
    return s.strip("-")


def safe_filename(name: str) -> str:
    name = re.sub(r"[^A-Za-z0-9._-]", "_", name)
    return name[:120] or "file"


# ---------------------------------------------------------------------------
# Graph auth and HTTP
# ---------------------------------------------------------------------------

@dataclass
class GraphSession:
    tenant_id: str
    client_id: str
    client_secret: str
    _token: str | None = None
    _expires_at: float = 0.0

    def token(self) -> str:
        if self._token and time.time() < self._expires_at - 60:
            return self._token
        url = f"https://login.microsoftonline.com/{self.tenant_id}/oauth2/v2.0/token"
        r = requests.post(
            url,
            data={
                "client_id": self.client_id,
                "client_secret": self.client_secret,
                "scope": "https://graph.microsoft.com/.default",
                "grant_type": "client_credentials",
            },
            timeout=30,
        )
        if r.status_code != 200:
            # Never log the secret. Log the status + a redacted snippet.
            raise RuntimeError(
                f"Token acquisition failed: HTTP {r.status_code} "
                f"(see Entra app registration; secret may have expired)"
            )
        payload = r.json()
        self._token = payload["access_token"]
        self._expires_at = time.time() + int(payload.get("expires_in", 3599))
        return self._token

    def get(self, path_or_url: str, **kw) -> requests.Response:
        url = path_or_url if path_or_url.startswith("http") else f"{GRAPH}{path_or_url}"
        headers = kw.pop("headers", {})
        headers["Authorization"] = f"Bearer {self.token()}"
        return requests.get(url, headers=headers, timeout=60, **kw)

    def paged(self, path: str) -> Iterable[dict]:
        url: str | None = path if path.startswith("http") else f"{GRAPH}{path}"
        while url:
            r = self.get(url)
            if r.status_code == 429:
                # Honor Retry-After.
                wait = int(r.headers.get("Retry-After", "5"))
                log.warning("Graph 429; sleeping %ss", wait)
                time.sleep(wait)
                continue
            r.raise_for_status()
            body = r.json()
            for v in body.get("value", []):
                yield v
            url = body.get("@odata.nextLink")


# ---------------------------------------------------------------------------
# EXIF + reverse geocoding
# ---------------------------------------------------------------------------

def _rational_to_float(r) -> float:
    try:
        return float(r[0]) / float(r[1]) if isinstance(r, tuple) else float(r)
    except Exception:
        return 0.0


def _dms_to_decimal(dms, ref) -> float:
    deg = _rational_to_float(dms[0])
    minutes = _rational_to_float(dms[1])
    seconds = _rational_to_float(dms[2])
    val = deg + minutes / 60.0 + seconds / 3600.0
    if ref in ("S", "W"):
        val = -val
    return val


@dataclass
class ExifInfo:
    capture_date: str | None = None  # YYYY-MM-DD
    latitude: float | None = None
    longitude: float | None = None


def read_exif(buf: bytes) -> ExifInfo:
    """Best-effort EXIF parse. Never raises."""
    try:
        from PIL import ExifTags, Image  # type: ignore
    except ImportError:
        log.info("Pillow not installed; skipping EXIF for this run")
        return ExifInfo()
    try:
        img = Image.open(io.BytesIO(buf))
        raw = img.getexif()
        if not raw:
            return ExifInfo()
        info = ExifInfo()
        tags = {ExifTags.TAGS.get(k, k): v for k, v in raw.items()}
        # Capture date
        dt = tags.get("DateTimeOriginal") or tags.get("DateTime")
        if isinstance(dt, str) and len(dt) >= 10:
            # EXIF format is "YYYY:MM:DD HH:MM:SS"
            d = dt[:10].replace(":", "-")
            if re.fullmatch(r"\d{4}-\d{2}-\d{2}", d):
                info.capture_date = d
        # GPS
        gps_ifd = raw.get_ifd(ExifTags.IFD.GPSInfo) if hasattr(raw, "get_ifd") else {}
        if gps_ifd:
            gps = {ExifTags.GPSTAGS.get(k, k): v for k, v in gps_ifd.items()}
            if "GPSLatitude" in gps and "GPSLongitude" in gps:
                info.latitude = _dms_to_decimal(gps["GPSLatitude"], gps.get("GPSLatitudeRef", "N"))
                info.longitude = _dms_to_decimal(gps["GPSLongitude"], gps.get("GPSLongitudeRef", "E"))
        return info
    except Exception as e:
        log.debug("EXIF parse failed: %s", e)
        return ExifInfo()


class Nominatim:
    def __init__(self, cache_path: Path, user_agent: str):
        self.cache_path = cache_path
        self.user_agent = user_agent
        self.cache = load_json(cache_path, {"schemaVersion": 1, "entries": {}})
        self.cache.setdefault("entries", {})
        self._last_call = 0.0

    def _key(self, lat: float, lng: float) -> str:
        return f"{lat:.4f},{lng:.4f}"

    def reverse(self, lat: float, lng: float) -> str | None:
        key = self._key(lat, lng)
        if key in self.cache["entries"]:
            return self.cache["entries"][key]
        # Rate limit
        wait = NOMINATIM_MIN_INTERVAL - (time.time() - self._last_call)
        if wait > 0:
            time.sleep(wait)
        try:
            r = requests.get(
                NOMINATIM,
                params={"lat": lat, "lon": lng, "format": "json", "zoom": 16},
                headers={"User-Agent": self.user_agent},
                timeout=20,
            )
            self._last_call = time.time()
            if r.status_code != 200:
                log.warning("Nominatim %s for %s", r.status_code, key)
                return None
            display = r.json().get("display_name")
            if display:
                self.cache["entries"][key] = display
            return display
        except Exception as e:
            log.warning("Nominatim lookup failed for %s: %s", key, e)
            return None

    def save(self) -> None:
        write_json(self.cache_path, self.cache)


# ---------------------------------------------------------------------------
# Face recognition (optional)
# ---------------------------------------------------------------------------

class FaceMatcher:
    """Wraps InsightFace if available. No-ops otherwise."""

    def __init__(self, faces_dir: Path, girl_slugs: list[str]):
        self.faces_dir = faces_dir
        self.girl_slugs = girl_slugs
        self._refs: dict[str, list] = {}
        self._app = None
        self._enabled = False
        self._tried = False

    def _ensure_loaded(self) -> bool:
        if self._tried:
            return self._enabled
        self._tried = True
        if os.environ.get("SYNC_FACE_ENABLED", "1") == "0":
            log.info("Face recognition disabled by env")
            return False
        try:
            import numpy as np  # noqa: F401
            from insightface.app import FaceAnalysis  # type: ignore
        except ImportError as e:
            log.info("Face recognition libs not installed (%s); skipping", e)
            return False
        try:
            self._app = FaceAnalysis(name="buffalo_sc", allowed_modules=["detection", "recognition"])
            self._app.prepare(ctx_id=-1, det_size=(640, 640))
        except Exception as e:
            log.warning("Face model load failed (%s); skipping", e)
            return False
        # Build reference embeddings
        for slug in self.girl_slugs:
            folder = self.faces_dir / slug
            if not folder.is_dir():
                continue
            embeddings = []
            for f in sorted(folder.iterdir()):
                if f.suffix.lower() not in SUPPORTED_IMAGE_EXT:
                    continue
                try:
                    import numpy as np
                    from PIL import Image
                    img = np.array(Image.open(f).convert("RGB"))
                    faces = self._app.get(img)
                    if faces:
                        embeddings.append(faces[0].normed_embedding)
                except Exception as e:
                    log.debug("Skipping reference %s: %s", f, e)
            if embeddings:
                self._refs[slug] = embeddings
        self._enabled = bool(self._refs)
        if not self._enabled:
            log.info("No usable face references found; suggestions disabled")
        return self._enabled

    def suggest(self, buf: bytes) -> dict[str, float]:
        """Return {girl_slug: confidence in 0..1} for the dominant face in the photo."""
        if not self._ensure_loaded():
            return {}
        try:
            import numpy as np
            from PIL import Image
            img = np.array(Image.open(io.BytesIO(buf)).convert("RGB"))
            faces = self._app.get(img)
            if not faces:
                return {}
            emb = faces[0].normed_embedding
            scores: dict[str, float] = {}
            for slug, refs in self._refs.items():
                # cosine similarity, take max across references
                best = max(float(emb @ r) for r in refs)
                scores[slug] = round(max(0.0, min(1.0, (best + 1) / 2)), 3)
            return scores
        except Exception as e:
            log.debug("Face suggest failed: %s", e)
            return {}


# ---------------------------------------------------------------------------
# Routing logic
# ---------------------------------------------------------------------------

@dataclass
class SyncContext:
    athletes: dict
    content: dict
    venue_map: dict
    state: dict
    pending: dict
    nominatim: Nominatim
    faces: FaceMatcher
    dry_run: bool

    @property
    def girl_slugs(self) -> list[str]:
        return [a["slug"] for a in self.athletes.get("athletes", [])]

    @property
    def sport_slugs(self) -> list[str]:
        return [s["slug"] for s in self.athletes.get("sports", [])]

    def venue_for(self, latlng: tuple[float, float] | None) -> str | None:
        if not latlng:
            return None
        lat, lng = latlng
        return self.nominatim.reverse(lat, lng)

    def sport_from_venue(self, venue: str | None) -> str | None:
        if not venue:
            return None
        key = venue.strip().lower()
        return self.venue_map.get("venues", {}).get(key)

    def already_imported(self, content_hash: str) -> bool:
        return content_hash in self.state.get("importedHashes", [])

    def mark_imported(self, content_hash: str) -> None:
        hashes = self.state.setdefault("importedHashes", [])
        if content_hash not in hashes:
            hashes.append(content_hash)

    def already_processed_message(self, msg_id: str) -> bool:
        return msg_id in self.state.get("processedMessageIds", [])

    def mark_message_processed(self, msg_id: str) -> None:
        ids = self.state.setdefault("processedMessageIds", [])
        if msg_id not in ids:
            ids.append(msg_id)

    def pending_already_has(self, content_hash: str) -> bool:
        return any(it.get("contentHash") == content_hash for it in self.pending.get("items", []))

    def persist(self) -> None:
        """Durable checkpoint. Safe to call after every unit of work."""
        if self.dry_run:
            return
        write_json(SYNC_STATE_PATH, self.state)
        write_json(PENDING_PATH, self.pending)
        write_json(CONTENT_PATH, self.content)
        self.nominatim.save()


def extract_hashtags(text: str) -> set[str]:
    return {m.lower() for m in HASHTAG_RE.findall(text or "")}


def html_to_text(html: str) -> str:
    if not html:
        return ""
    # Drop tags, preserve hashtags
    return re.sub(r"<[^>]+>", " ", html)


def resolve_tags(text: str, girls: list[str], sports: list[str]) -> tuple[list[str], str | None]:
    tags = extract_hashtags(text)
    girl_hits = [g for g in girls if g in tags]
    sport_hit = next((s for s in sports if s in tags), None)
    return girl_hits, sport_hit


# ---------------------------------------------------------------------------
# Processing a single hosted-content photo
# ---------------------------------------------------------------------------

@dataclass
class PhotoInput:
    filename: str
    bytes_: bytes
    message_id: str
    message_text: str
    message_date: str  # ISO 8601 from Graph
    is_video: bool = False  # videos skip EXIF/face extraction


def process_photo(ctx: SyncContext, p: PhotoInput) -> None:
    content_hash = sha256_bytes(p.bytes_)
    if ctx.already_imported(content_hash) or ctx.pending_already_has(content_hash):
        log.info("Skipping already-seen photo %s", p.filename)
        return

    if p.is_video:
        # Videos carry no readable EXIF and aren't face-matched; date comes
        # from the Teams message/drive item, and there's no GPS venue lookup.
        date = p.message_date[:10]
        venue = None
        sport_from_venue = None
        face_scores = {}
    else:
        exif = read_exif(p.bytes_)
        date = exif.capture_date or p.message_date[:10]
        latlng = (exif.latitude, exif.longitude) if exif.latitude and exif.longitude else None
        venue = ctx.venue_for(latlng)
        sport_from_venue = ctx.sport_from_venue(venue)
        face_scores = ctx.faces.suggest(p.bytes_) if ctx.faces else {}

    girl_hits, sport_from_tag = resolve_tags(p.message_text, ctx.girl_slugs, ctx.sport_slugs)
    sport = sport_from_tag or sport_from_venue

    resolved = bool(girl_hits and sport)
    if resolved:
        for girl in girl_hits:
            file_for_girl(ctx, girl, sport, p, date, venue, content_hash)
        ctx.mark_imported(content_hash)
    else:
        park_pending_photo(
            ctx,
            p=p,
            content_hash=content_hash,
            date=date,
            venue=venue,
            sport_guess=sport,
            girl_hits=girl_hits,
            face_scores=face_scores,
        )


def file_for_girl(
    ctx: SyncContext, girl: str, sport: str, p: PhotoInput, date: str,
    venue: str | None, content_hash: str,
) -> None:
    dest_dir = MEDIA / girl / sport
    dest_dir.mkdir(parents=True, exist_ok=True)
    dest = dest_dir / safe_filename(p.filename)
    if dest.exists():
        # Append hash prefix to avoid clobber.
        dest = dest_dir / f"{content_hash[:8]}-{safe_filename(p.filename)}"
    if ctx.dry_run:
        log.info("[dry-run] file %s -> %s", p.filename, dest)
        return
    dest.write_bytes(p.bytes_)
    log.info("Filed %s -> %s", p.filename, dest.relative_to(ROOT))
    # No content.json append for a photo — gallery.json is rebuilt by build.py
    # from the media tree on every deploy. Only memories/scores are content.json.


def park_pending_photo(
    ctx: SyncContext,
    *,
    p: PhotoInput,
    content_hash: str,
    date: str,
    venue: str | None,
    sport_guess: str | None,
    girl_hits: list[str],
    face_scores: dict[str, float],
) -> None:
    PENDING_DIR.mkdir(parents=True, exist_ok=True)
    parked_name = f"{content_hash[:8]}-{safe_filename(p.filename)}"
    parked = PENDING_DIR / parked_name
    if ctx.dry_run:
        log.info("[dry-run] park %s -> %s", p.filename, parked)
    else:
        parked.write_bytes(p.bytes_)
    entry = {
        "kind": "photo",
        "filename": parked_name,
        "originalName": p.filename,
        "contentHash": content_hash,
        "date": date,
        "venue": venue,
        "sportGuess": sport_guess,
        "girlGuesses": girl_hits,
        "faceScores": face_scores,
        "messageId": p.message_id,
        "messageText": p.message_text[:500],
        "addedAt": utcnow_iso(),
    }
    ctx.pending.setdefault("items", []).append(entry)
    log.info("Parked %s (sport=%s, girls=%s)", p.filename, sport_guess, girl_hits)


# ---------------------------------------------------------------------------
# Processing a text-only message (potential Memory)
# ---------------------------------------------------------------------------

def process_text_only(
    ctx: SyncContext, msg_id: str, text: str, date_iso: str
) -> None:
    if ctx.already_processed_message(msg_id):
        return
    girl_hits, sport = resolve_tags(text, ctx.girl_slugs, ctx.sport_slugs)
    clean = re.sub(HASHTAG_RE, "", text).strip()
    if not clean:
        ctx.mark_message_processed(msg_id)
        return
    if girl_hits and sport:
        # File straight into content.json as a Memory.
        if ctx.dry_run:
            log.info("[dry-run] memory: %s/%s %s", girl_hits, sport, clean[:60])
        else:
            for girl in girl_hits:
                ctx.content.setdefault("memories", []).append({
                    "athlete": girl,
                    "sport": sport,
                    "date": date_iso[:10],
                    "title": "From the family channel",
                    "text": clean,
                })
        ctx.mark_message_processed(msg_id)
    else:
        # Ambiguous — park as pending memory.
        ctx.pending.setdefault("items", []).append({
            "kind": "memory",
            "messageId": msg_id,
            "messageText": clean[:1000],
            "date": date_iso[:10],
            "girlGuesses": girl_hits,
            "sportGuess": sport,
            "addedAt": utcnow_iso(),
        })
        log.info("Parked memory from msg %s", msg_id)
        ctx.mark_message_processed(msg_id)


# ---------------------------------------------------------------------------
# Pulling from Graph
# ---------------------------------------------------------------------------

def fetch_hosted_image(gs: GraphSession, message_id: str, hosted_content_id: str,
                       team_id: str, channel_id: str) -> bytes | None:
    """Hosted contents on messages are images pasted inline (most common case
    for Teams photos from the iOS/desktop app)."""
    url = (f"/teams/{team_id}/channels/{channel_id}/messages/{message_id}"
           f"/hostedContents/{hosted_content_id}/$value")
    r = gs.get(url)
    if r.status_code == 200:
        return r.content
    log.warning("hostedContents %s -> HTTP %s", hosted_content_id, r.status_code)
    return None


def channel_files_drive_root(gs: GraphSession, team_id: str, channel_id: str) -> str | None:
    """Channel files are SharePoint-backed; the drive item for the channel
    folder can be fetched via filesFolder."""
    r = gs.get(f"/teams/{team_id}/channels/{channel_id}/filesFolder")
    if r.status_code != 200:
        log.warning("filesFolder -> HTTP %s", r.status_code)
        return None
    data = r.json()
    drive_id = data.get("parentReference", {}).get("driveId")
    item_id = data.get("id")
    if drive_id and item_id:
        return f"/drives/{drive_id}/items/{item_id}"
    return None


def walk_drive(gs: GraphSession, folder_path: str, since: str | None) -> Iterable[dict]:
    """Yield drive items (files only) modified after `since` (ISO 8601)."""
    for item in gs.paged(f"{folder_path}/children"):
        if item.get("folder"):
            sub_id = item.get("id")
            if sub_id:
                drive_id = item.get("parentReference", {}).get("driveId")
                if drive_id:
                    yield from walk_drive(gs, f"/drives/{drive_id}/items/{sub_id}", since)
            continue
        if not item.get("file"):
            continue
        if since and item.get("lastModifiedDateTime", "") < since:
            continue
        yield item


def download_drive_item(gs: GraphSession, item: dict) -> bytes | None:
    url = item.get("@microsoft.graph.downloadUrl")
    if not url:
        return None
    r = requests.get(url, timeout=60)
    if r.status_code != 200:
        log.warning("Drive download %s -> %s", item.get("name"), r.status_code)
        return None
    return r.content


# ---------------------------------------------------------------------------
# Main sync loop
# ---------------------------------------------------------------------------

def sync_messages(gs: GraphSession, ctx: SyncContext, team_id: str, channel_id: str) -> None:
    since = ctx.state.get("lastMessageDateTime")
    log.info("Pulling channel messages since %s", since)
    # Fetch all messages once; Graph returns newest first. We invert to oldest-first
    # so the watermark only advances after older items are durably processed.
    messages = list(gs.paged(f"/teams/{team_id}/channels/{channel_id}/messages"))
    messages.sort(key=lambda m: m.get("createdDateTime", ""))
    for m in messages:
        created = m.get("createdDateTime", "")
        # Strict < so an item with the exact watermark timestamp can still be
        # retried; content-hash + processedMessageIds dedup handles the rest.
        if since and created < since:
            continue
        if m.get("messageType") != "message":
            continue  # skip system events
        msg_id = m["id"]
        if ctx.already_processed_message(msg_id):
            continue
        body = m.get("body") or {}
        text = html_to_text(body.get("content", ""))
        hosted = m.get("hostedContents") or []
        attachments = m.get("attachments") or []

        # Inline images: hostedContents
        if hosted:
            for hc in hosted:
                hc_id = hc.get("id")
                if not hc_id:
                    continue
                blob = fetch_hosted_image(gs, msg_id, hc_id, team_id, channel_id)
                if not blob:
                    continue
                process_photo(ctx, PhotoInput(
                    filename=f"{msg_id[:8]}-{hc_id[:8]}.jpg",
                    bytes_=blob, message_id=msg_id,
                    message_text=text, message_date=created,
                ))
                ctx.persist()
        elif not attachments:
            # Pure text message → memory candidate
            process_text_only(ctx, msg_id, text, created)

        ctx.mark_message_processed(msg_id)
        # Advance the watermark incrementally so a crash can resume here.
        ctx.state["lastMessageDateTime"] = created
        ctx.persist()


def sync_channel_files(gs: GraphSession, ctx: SyncContext, team_id: str, channel_id: str) -> None:
    """Photos uploaded via Teams' file UI go to SharePoint and don't appear as
    inline hostedContents on messages — we walk the channel's drive folder too."""
    root = channel_files_drive_root(gs, team_id, channel_id)
    if not root:
        return
    since = ctx.state.get("lastDriveItemDateTime")
    log.info("Walking channel drive since %s", since)
    for item in walk_drive(gs, root, since):
        name = item.get("name", "")
        ext = Path(name).suffix.lower()
        if ext not in SUPPORTED_MEDIA_EXT:
            continue
        blob = download_drive_item(gs, item)
        if not blob:
            continue
        # Files from the site's upload button are named
        # "mfs.<girl>.<sport>.<original>" — turn that prefix into tags so the
        # photo/video files straight into the right folder. Everything else is
        # an untagged drive file and lands in the Review tray as before.
        filename = name
        message_text = ""
        m = UPLOAD_PREFIX_RE.match(name)
        if m:
            girl, sport, original = m.group(1).lower(), m.group(2).lower(), m.group(3)
            if girl in ctx.girl_slugs and sport in ctx.sport_slugs:
                message_text = f"#{girl} #{sport}"
                filename = original
        process_photo(ctx, PhotoInput(
            filename=filename,
            bytes_=blob,
            message_id=f"drive:{item.get('id', '')}",
            message_text=message_text,
            message_date=item.get("lastModifiedDateTime", utcnow_iso()),
            is_video=(ext in SUPPORTED_VIDEO_EXT),
        ))
        modified = item.get("lastModifiedDateTime")
        if modified:
            current = ctx.state.get("lastDriveItemDateTime")
            if not current or modified > current:
                ctx.state["lastDriveItemDateTime"] = modified
        ctx.persist()


def main() -> int:
    logging.basicConfig(
        level=logging.INFO,
        format="%(asctime)s %(levelname)s %(name)s: %(message)s",
    )

    required = ["TENANT_ID", "CLIENT_ID", "CLIENT_SECRET", "TEAMS_TEAM_ID", "TEAMS_CHANNEL_ID"]
    missing = [k for k in required if not os.environ.get(k)]
    if missing:
        log.error("Missing required env vars: %s", ", ".join(missing))
        log.error("See SETUP-AZURE.md for how to configure them.")
        return 2

    dry_run = os.environ.get("SYNC_DRY_RUN") == "1"
    user_agent = os.environ.get(
        "SYNC_NOMINATIM_USER_AGENT",
        "McConnellFamilySports-sync (+https://github.com/mcconnellentllc-cloud/McConnellFamilySports)",
    )

    athletes = load_json(ATHLETES_PATH, {"athletes": [], "sports": []})
    content = load_json(CONTENT_PATH, {})
    venue_map = load_json(VENUE_MAP_PATH, {"venues": {}})
    state = load_json(SYNC_STATE_PATH, {"schemaVersion": 1})
    pending = load_json(PENDING_PATH, {"schemaVersion": 1, "items": []})

    nominatim = Nominatim(GEO_CACHE_PATH, user_agent=user_agent)
    girl_slugs = [a["slug"] for a in athletes.get("athletes", [])]
    faces = FaceMatcher(FACES_DIR, girl_slugs)

    ctx = SyncContext(
        athletes=athletes, content=content, venue_map=venue_map,
        state=state, pending=pending, nominatim=nominatim,
        faces=faces, dry_run=dry_run,
    )

    gs = GraphSession(
        tenant_id=os.environ["TENANT_ID"],
        client_id=os.environ["CLIENT_ID"],
        client_secret=os.environ["CLIENT_SECRET"],
    )

    team_id = os.environ["TEAMS_TEAM_ID"]
    channel_id = os.environ["TEAMS_CHANNEL_ID"]

    try:
        sync_messages(gs, ctx, team_id, channel_id)
        sync_channel_files(gs, ctx, team_id, channel_id)
    except requests.HTTPError as e:
        log.error("Graph request failed: %s", e)
        # Persist what we have so far — partial progress is fine.
    except Exception as e:
        log.exception("Sync aborted: %s", e)
        return 1
    finally:
        if not dry_run:
            ctx.state["lastSyncCompletedAt"] = utcnow_iso()
            write_json(SYNC_STATE_PATH, ctx.state)
            write_json(PENDING_PATH, ctx.pending)
            write_json(CONTENT_PATH, ctx.content)
            nominatim.save()
            log.info("State + pending + content persisted")

    return 0


if __name__ == "__main__":
    sys.exit(main())
