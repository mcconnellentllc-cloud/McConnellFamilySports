/*
 * McConnell Family Sports — upload endpoint (Cloudflare Worker).
 *
 * Why this exists: the website is a static page on GitHub Pages, so it can't
 * accept file uploads on its own. This tiny Worker is the only "backend." It:
 *   1. checks the family password (so only password-holders can upload),
 *   2. uploads the photo/video into the family Teams channel's Files folder,
 *      named  mfs.<girl>.<sport>.<original>  so the Teams sync files it into
 *      media/<girl>/<sport>/ and the site shows it.
 *
 * The Microsoft credential lives ONLY here as a Worker secret — it never
 * reaches the browser. Users only ever send the family password.
 *
 * The browser sends the raw file as the request body, with metadata in
 * headers (no base64 bloat, password kept out of the URL):
 *   POST <worker-url>
 *   X-Upload-Password : encodeURIComponent(family password)
 *   X-Upload-Girl     : athlete slug (e.g. "tyndle")
 *   X-Upload-Sport    : sport slug (e.g. "gymnastics")
 *   X-Upload-Filename : encodeURIComponent(original filename)
 *   Content-Type      : the file's MIME type
 *   <body>            : the file bytes
 *
 * Required secrets/vars (see SETUP-UPLOAD.md):
 *   TENANT_ID, CLIENT_ID, CLIENT_SECRET   (the existing Teams app registration)
 *   TEAMS_TEAM_ID, TEAMS_CHANNEL_ID       (same values the sync uses)
 *   UPLOAD_PASSWORD_SHA256                (SHA-256 hex of the family password)
 *   ALLOWED_ORIGIN                        (e.g. https://mcconnellentllc-cloud.github.io)
 */

const GRAPH = "https://graph.microsoft.com/v1.0";
const MAX_BYTES = 25 * 1024 * 1024; // keep in step with the site's 25 MB cap
const IMAGE_EXT = new Set(["jpg", "jpeg", "png", "heic", "heif", "webp", "gif", "avif"]);
const VIDEO_EXT = new Set(["mp4", "mov", "m4v", "webm"]);
const SLUG_RE = /^[a-z0-9-]+$/;

export default {
  async fetch(request, env) {
    const origin = env.ALLOWED_ORIGIN || "*";
    const cors = {
      "Access-Control-Allow-Origin": origin,
      "Access-Control-Allow-Methods": "POST, OPTIONS",
      "Access-Control-Allow-Headers":
        "Content-Type, X-Upload-Password, X-Upload-Girl, X-Upload-Sport, X-Upload-Filename",
      "Access-Control-Max-Age": "86400",
    };
    const json = (status, obj) =>
      new Response(JSON.stringify(obj), {
        status,
        headers: { "Content-Type": "application/json", ...cors },
      });

    if (request.method === "OPTIONS") return new Response(null, { status: 204, headers: cors });
    if (request.method !== "POST") return json(405, { error: "Use POST." });

    try {
      // --- Password check ---
      const password = decodeURIComponent(request.headers.get("X-Upload-Password") || "");
      if (!password) return json(400, { error: "Missing password." });
      if (!env.UPLOAD_PASSWORD_SHA256) return json(500, { error: "Endpoint not configured." });
      const hash = await sha256Hex(password);
      if (hash.toLowerCase() !== env.UPLOAD_PASSWORD_SHA256.toLowerCase()) {
        return json(401, { error: "Wrong password." });
      }

      // --- Validate metadata ---
      const girl = (request.headers.get("X-Upload-Girl") || "").toLowerCase();
      const sport = (request.headers.get("X-Upload-Sport") || "").toLowerCase();
      const rawName = decodeURIComponent(request.headers.get("X-Upload-Filename") || "");
      if (!SLUG_RE.test(girl) || !SLUG_RE.test(sport)) {
        return json(400, { error: "Bad girl/sport." });
      }
      const safe = sanitizeFilename(rawName);
      const ext = safe.includes(".") ? safe.split(".").pop().toLowerCase() : "";
      if (!IMAGE_EXT.has(ext) && !VIDEO_EXT.has(ext)) {
        return json(400, { error: "Unsupported file type." });
      }

      // --- Read the file bytes ---
      const buf = await request.arrayBuffer();
      const size = buf.byteLength;
      if (size === 0) return json(400, { error: "Empty file." });
      if (size > MAX_BYTES) return json(413, { error: "File over 25 MB." });

      // Name so the Teams sync auto-files it: mfs.<girl>.<sport>.<original>
      const uploadName = `mfs.${girl}.${sport}.${safe}`;

      // --- Upload into the Teams channel's Files folder via Graph ---
      const token = await getGraphToken(env);
      const folder = await getChannelFilesFolder(env, token);
      await uploadToDrive(token, folder.driveId, folder.itemId, uploadName, buf);

      return json(200, { ok: true, name: uploadName });
    } catch (e) {
      return json(502, { error: String((e && e.message) || e) });
    }
  },
};

async function sha256Hex(str) {
  const data = new TextEncoder().encode(str);
  const buf = await crypto.subtle.digest("SHA-256", data);
  return [...new Uint8Array(buf)].map((b) => b.toString(16).padStart(2, "0")).join("");
}

function sanitizeFilename(name) {
  const cleaned = (name || "").replace(/[^A-Za-z0-9._-]/g, "_").replace(/^\.+/, "");
  return (cleaned.slice(0, 120) || "file");
}

async function getGraphToken(env) {
  const body = new URLSearchParams({
    client_id: env.CLIENT_ID,
    client_secret: env.CLIENT_SECRET,
    scope: "https://graph.microsoft.com/.default",
    grant_type: "client_credentials",
  });
  const r = await fetch(`https://login.microsoftonline.com/${env.TENANT_ID}/oauth2/v2.0/token`, {
    method: "POST",
    headers: { "Content-Type": "application/x-www-form-urlencoded" },
    body,
  });
  if (!r.ok) throw new Error("Microsoft token request failed (" + r.status + ")");
  const data = await r.json();
  if (!data.access_token) throw new Error("No access token returned.");
  return data.access_token;
}

async function getChannelFilesFolder(env, token) {
  const r = await fetch(
    `${GRAPH}/teams/${env.TEAMS_TEAM_ID}/channels/${env.TEAMS_CHANNEL_ID}/filesFolder`,
    { headers: { Authorization: "Bearer " + token } }
  );
  if (!r.ok) throw new Error("Couldn't find the channel Files folder (" + r.status + ")");
  const data = await r.json();
  const driveId = data.parentReference && data.parentReference.driveId;
  const itemId = data.id;
  if (!driveId || !itemId) throw new Error("Channel Files folder is missing drive info.");
  return { driveId, itemId };
}

async function uploadToDrive(token, driveId, itemId, name, buf) {
  // Upload sessions work for any size and avoid the 4 MB simple-PUT ceiling.
  const sessRes = await fetch(
    `${GRAPH}/drives/${driveId}/items/${itemId}:/${encodeURIComponent(name)}:/createUploadSession`,
    {
      method: "POST",
      headers: { Authorization: "Bearer " + token, "Content-Type": "application/json" },
      body: JSON.stringify({ item: { "@microsoft.graph.conflictBehavior": "rename", name } }),
    }
  );
  if (!sessRes.ok) throw new Error("Couldn't start the upload (" + sessRes.status + ")");
  const { uploadUrl } = await sessRes.json();
  if (!uploadUrl) throw new Error("No upload URL returned.");

  const size = buf.byteLength;
  // Files are capped at 25 MB, so a single fragment is always within the
  // 60 MiB Graph limit — one PUT covering the whole range completes it.
  const putRes = await fetch(uploadUrl, {
    method: "PUT",
    headers: {
      "Content-Length": String(size),
      "Content-Range": `bytes 0-${size - 1}/${size}`,
    },
    body: buf,
  });
  if (putRes.status !== 200 && putRes.status !== 201) {
    throw new Error("Upload didn't complete (" + putRes.status + ")");
  }
}
