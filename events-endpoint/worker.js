/*
 * The McConnell Family — events endpoint (Cloudflare Worker).
 *
 * The website is static, so anything that has to be saved or sent goes
 * through here. This Worker:
 *   1. saves event requests (RSVPs, dish requests, "I'll bring…") to Airtable,
 *   2. checks magic links: each invited guest gets a personal link that opens
 *      the site straight to the event, no password needed,
 *   3. sends invitations by email (parents only, behind their own passphrase),
 *      one per guest, each carrying that guest's magic link and a calendar file.
 *
 * Every key lives ONLY here as a Worker secret. The site's code is public and
 * never holds a key. Event details (date, schedule, menu) are read from the
 * site's own data/events.json, so there is one place to edit them.
 *
 * Routes (all POST, JSON in and out):
 *   /verify          { token }                         -> { ok, guest: { name } }
 *   /request         { event, type, name, attending, count, details,
 *                      token | password }              -> { ok }
 *   /rsvps           { event, token | password }       -> { ok, rsvps: [...] }
 *                    (the live "Who's coming" list: latest RSVP per person)
 *   /admin/guests    { adminPassword }                 -> { ok, guests: [...] }
 *   /admin/invite    { adminPassword, event, guestIds, note }
 *                                                      -> { ok, results: [...] }
 *
 * Secrets (Settings -> Variables and Secrets, type "Secret"):
 *   AIRTABLE_TOKEN          Airtable personal access token, this base only,
 *                           scopes data.records:read + data.records:write
 *   AIRTABLE_BASE_ID        the base's id, starts with "app"
 *   FAMILY_PASSWORD_SHA256  SHA-256 hex of the site password (request form
 *                           fallback for people without a magic link)
 *   ADMIN_PASSWORD_SHA256   SHA-256 hex of the parents' invitation passphrase.
 *                           Never the family password.
 *   MAIL_FROM               the address invitations come from
 *   For MAIL_PROVIDER "gmail":     GOOGLE_CLIENT_ID, GOOGLE_CLIENT_SECRET,
 *                                  GOOGLE_REFRESH_TOKEN
 *   For MAIL_PROVIDER "microsoft": TENANT_ID, CLIENT_ID, CLIENT_SECRET
 *
 * Plain variables (wrangler.toml [vars], or the dashboard as "Text"):
 *   ALLOWED_ORIGIN   https://mcconnellentllc-cloud.github.io
 *   SITE_URL         https://mcconnellentllc-cloud.github.io/McConnellFamilySports
 *   MAIL_PROVIDER    "gmail" or "microsoft"
 *   MAIL_FROM_NAME   the sender name people see, e.g. "The McConnell Family"
 *
 * Airtable tables and fields are listed in SETUP-EVENTS.md.
 */

const AIRTABLE = "https://api.airtable.com/v0";
const T_GUESTS = "Guests";
const T_REQUESTS = "Requests";
const T_INVITES = "Invites";
const TOKEN_RE = /^[a-f0-9]{48}$/;
const SLUG_RE = /^[a-z0-9-]{1,80}$/;
const REC_RE = /^rec[A-Za-z0-9]{14}$/;
const TYPES = { rsvp: "RSVP", dish: "Dish request", bring: "Bringing" };
const ATTENDING = { yes: "Yes", no: "No", maybe: "Maybe" };
const MAX_INVITES_PER_CALL = 60;

export default {
  async fetch(request, env) {
    const cors = {
      "Access-Control-Allow-Origin": env.ALLOWED_ORIGIN || "*",
      "Access-Control-Allow-Methods": "POST, OPTIONS",
      "Access-Control-Allow-Headers": "Content-Type",
      "Access-Control-Max-Age": "86400",
      Vary: "Origin",
    };
    const json = (status, obj) =>
      new Response(JSON.stringify(obj), {
        status,
        headers: { "Content-Type": "application/json", ...cors },
      });

    if (request.method === "OPTIONS") return new Response(null, { status: 204, headers: cors });
    if (request.method !== "POST") return json(405, { error: "Use POST." });

    let body;
    try {
      body = await request.json();
    } catch (e) {
      return json(400, { error: "Send JSON." });
    }
    if (!body || typeof body !== "object") return json(400, { error: "Send JSON." });

    const path = new URL(request.url).pathname.replace(/\/+$/, "");
    try {
      if (path === "/verify") return await verify(body, env, json);
      if (path === "/request") return await saveRequest(body, env, json);
      if (path === "/rsvps") return await listRsvps(body, env, json);
      if (path === "/admin/guests") return await listGuests(body, env, json);
      if (path === "/admin/invite") return await sendInvites(body, env, json);
      return json(404, { error: "Unknown route." });
    } catch (e) {
      return json(502, { error: String((e && e.message) || e) });
    }
  },
};

// ---------- Routes ----------

async function verify(body, env, json) {
  const guest = await guestByToken(env, body.token);
  if (!guest) return json(401, { ok: false, error: "That link isn't valid any more." });
  return json(200, { ok: true, guest: { name: guest.fields.Name || "" } });
}

// Who is asking: a magic-link guest, or someone who knows the site password.
// Returns { guest } (null guest for password users), or { error, status }.
async function whoIsAsking(body, env) {
  if (body.token) {
    const guest = await guestByToken(env, body.token);
    return guest ? { guest } : { status: 401, error: "That link isn't valid any more." };
  }
  if (!env.FAMILY_PASSWORD_SHA256) return { status: 500, error: "Endpoint not configured." };
  const pw = typeof body.password === "string" ? body.password : "";
  if (!pw || (await sha256Hex(pw)) !== env.FAMILY_PASSWORD_SHA256.toLowerCase()) {
    return { status: 401, error: "Wrong password." };
  }
  return { guest: null };
}

async function listRsvps(body, env, json) {
  const who = await whoIsAsking(body, env);
  if (who.error) return json(who.status, { error: who.error });
  const slug = String(body.event || "");
  if (!SLUG_RE.test(slug)) return json(400, { error: "Unknown event." });
  // slug is checked against SLUG_RE above, so it is safe in the formula.
  const recs = await allRecords(env, T_REQUESTS, `AND({Event}='${slug}', {Type}='RSVP')`);
  // Oldest first, so a later RSVP from the same person replaces an earlier one.
  recs.sort((a, b) => String(a.createdTime).localeCompare(String(b.createdTime)));
  const byPerson = new Map();
  for (const r of recs) {
    const f = r.fields || {};
    const key = (f.Guest && f.Guest[0]) || String(f.Name || "").trim().toLowerCase();
    if (!key) continue;
    byPerson.set(key, {
      name: f.Name || "",
      status: String(f.Attending || "Yes").toLowerCase(),
      count: f.Attending === "No" ? 0 : (Number(f.Count) || 1),
      note: f.Details || "",
    });
  }
  return json(200, { ok: true, rsvps: [...byPerson.values()] });
}

async function saveRequest(body, env, json) {
  const who = await whoIsAsking(body, env);
  if (who.error) return json(who.status, { error: who.error });
  const guest = who.guest;

  const slug = String(body.event || "");
  if (!SLUG_RE.test(slug)) return json(400, { error: "Unknown event." });
  const event = await findEvent(env, slug);
  if (!event || !event.requests) return json(400, { error: "Requests aren't open for that event." });
  if (event.date < todayUTC()) return json(400, { error: "That event has passed." });

  const type = TYPES[body.type];
  if (!type) return json(400, { error: "Pick what kind of request this is." });
  const name = clean(body.name, 80);
  if (!name) return json(400, { error: "Add your name." });
  const details = clean(body.details, 1000, true);

  const fields = {
    Event: slug,
    "Event Title": event.title || "",
    Type: type,
    Name: name,
  };
  if (guest) fields.Guest = [guest.id];
  if (type === "RSVP") {
    const att = ATTENDING[body.attending];
    if (!att) return json(400, { error: "Say whether you're coming." });
    fields.Attending = att;
    if (att !== "No") {
      const n = Number(body.count);
      if (!Number.isInteger(n) || n < 1 || n > 50) return json(400, { error: "How many are coming?" });
      fields.Count = n;
    }
    if (details) fields.Details = details;
  } else {
    if (!details) return json(400, { error: "Say what you'd like." });
    fields.Details = details;
  }

  await airtable(env, "POST", T_REQUESTS, null, { records: [{ fields }], typecast: true });
  return json(200, { ok: true });
}

async function listGuests(body, env, json) {
  if (!(await isAdmin(env, body.adminPassword))) return json(401, { error: "Wrong passphrase." });
  const recs = await allRecords(env, T_GUESTS, "{Active}");
  const guests = recs
    .map((r) => ({
      id: r.id,
      name: r.fields.Name || "",
      email: r.fields.Email || "",
      household: r.fields.Household || "",
      groups: r.fields.Groups || [],
    }))
    .filter((g) => g.name && g.email)
    .sort((a, b) => (a.household + a.name).localeCompare(b.household + b.name));
  return json(200, { ok: true, guests });
}

async function sendInvites(body, env, json) {
  if (!(await isAdmin(env, body.adminPassword))) return json(401, { error: "Wrong passphrase." });
  const slug = String(body.event || "");
  if (!SLUG_RE.test(slug)) return json(400, { error: "Unknown event." });
  const event = await findEvent(env, slug);
  if (!event) return json(400, { error: "Unknown event." });

  const ids = Array.isArray(body.guestIds) ? body.guestIds.filter((x) => REC_RE.test(x)) : [];
  if (!ids.length) return json(400, { error: "Pick at least one person." });
  if (ids.length > MAX_INVITES_PER_CALL) {
    return json(400, { error: "Send to " + MAX_INVITES_PER_CALL + " people or fewer at a time." });
  }
  const note = clean(body.note, 1500, true);

  const mailer = await makeMailer(env);
  const results = [];
  for (const id of ids) {
    let guest;
    try {
      guest = await airtable(env, "GET", T_GUESTS, id);
    } catch (e) {
      results.push({ id, ok: false, error: "Not found." });
      continue;
    }
    const f = guest.fields || {};
    if (!f.Active || !f.Email || !isEmail(f.Email)) {
      results.push({ id, name: f.Name || "", ok: false, error: "No active email address." });
      continue;
    }
    // Each guest keeps one link for good. Clearing Token in Airtable
    // switches the old link off; the next invitation makes a new one.
    let token = f.Token;
    if (!TOKEN_RE.test(token || "")) {
      token = randomToken();
      await airtable(env, "PATCH", T_GUESTS, id, { fields: { Token: token } });
    }
    const link = siteLink(env, token, slug);
    const msg = buildInvite(env, event, f.Name || "", link, note);
    let status = "Sent";
    try {
      await mailer.send({ to: f.Email, toName: f.Name || "", ...msg });
      results.push({ id, name: f.Name || "", ok: true });
    } catch (e) {
      status = "Failed: " + String((e && e.message) || e).slice(0, 200);
      results.push({ id, name: f.Name || "", ok: false, error: status });
    }
    // The log is a record of what went out; a hiccup writing it must not
    // stop the rest of the invitations.
    try {
      await airtable(env, "POST", T_INVITES, null, {
        records: [{ fields: { Event: slug, Guest: [id], Email: f.Email, Sent: new Date().toISOString(), Status: status } }],
        typecast: true,
      });
    } catch (e) { /* logged nowhere else; the response still reports the send */ }
  }
  return json(200, { ok: true, results });
}

// ---------- Helpers ----------

async function isAdmin(env, pw) {
  if (!env.ADMIN_PASSWORD_SHA256 || typeof pw !== "string" || !pw) return false;
  return (await sha256Hex(pw)) === env.ADMIN_PASSWORD_SHA256.toLowerCase();
}

async function guestByToken(env, token) {
  if (!TOKEN_RE.test(token || "")) return null;
  // The token is plain hex (checked above), so it is safe inside the formula.
  const recs = await allRecords(env, T_GUESTS, `AND({Active}, {Token}='${token}')`);
  return recs.length === 1 ? recs[0] : null;
}

async function findEvent(env, slug) {
  const r = await fetch(env.SITE_URL.replace(/\/+$/, "") + "/data/events.json", {
    cf: { cacheTtl: 60 },
  });
  if (!r.ok) throw new Error("Couldn't read the site's events (" + r.status + ")");
  const data = await r.json();
  return ((data && data.events) || []).find((e) => e && e.slug === slug) || null;
}

async function airtable(env, method, table, id, payload) {
  const url = `${AIRTABLE}/${env.AIRTABLE_BASE_ID}/${encodeURIComponent(table)}` + (id ? "/" + id : "");
  const r = await fetch(url, {
    method,
    headers: {
      Authorization: "Bearer " + env.AIRTABLE_TOKEN,
      "Content-Type": "application/json",
    },
    body: payload ? JSON.stringify(payload) : undefined,
  });
  if (!r.ok) {
    let detail = "";
    try { detail = (await r.json()).error; detail = detail && (detail.message || detail.type || detail); } catch (e) { /* none */ }
    throw new Error("Airtable " + method + " " + table + " failed (" + r.status + (detail ? ": " + detail : "") + ")");
  }
  return r.json();
}

async function allRecords(env, table, formula) {
  const out = [];
  let offset = "";
  do {
    const q = new URLSearchParams();
    if (formula) q.set("filterByFormula", formula);
    if (offset) q.set("offset", offset);
    const r = await fetch(`${AIRTABLE}/${env.AIRTABLE_BASE_ID}/${encodeURIComponent(table)}?${q}`, {
      headers: { Authorization: "Bearer " + env.AIRTABLE_TOKEN },
    });
    if (!r.ok) throw new Error("Airtable read " + table + " failed (" + r.status + ")");
    const data = await r.json();
    out.push(...(data.records || []));
    offset = data.offset || "";
  } while (offset);
  return out;
}

function siteLink(env, token, slug) {
  return env.SITE_URL.replace(/\/+$/, "") + "/?k=" + token + "#/family/events/" + slug;
}

function clean(v, max, multiline) {
  if (typeof v !== "string") return "";
  let s = v.replace(/\r\n?/g, "\n");
  s = multiline ? s.replace(/[^\S\n]+/g, " ").replace(/\n{3,}/g, "\n\n") : s.replace(/\s+/g, " ");
  return s.trim().slice(0, max);
}

function isEmail(s) {
  return /^[^\s@<>"]+@[^\s@<>"]+\.[^\s@<>"]+$/.test(s);
}

function randomToken() {
  const b = new Uint8Array(24);
  crypto.getRandomValues(b);
  return [...b].map((x) => x.toString(16).padStart(2, "0")).join("");
}

async function sha256Hex(str) {
  const buf = await crypto.subtle.digest("SHA-256", new TextEncoder().encode(str));
  return [...new Uint8Array(buf)].map((b) => b.toString(16).padStart(2, "0")).join("");
}

function todayUTC() {
  // A day of slack either side of UTC, so an event is still "today" in
  // Colorado until it is tomorrow everywhere.
  const d = new Date(Date.now() - 12 * 3600 * 1000);
  return d.toISOString().slice(0, 10);
}

function esc(s) {
  return String(s == null ? "" : s)
    .replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;").replace(/'/g, "&#39;");
}

function fmtTime(t) {
  const m = /^(\d{1,2}):(\d{2})$/.exec(t || "");
  if (!m) return t || "";
  let h = Number(m[1]);
  const ap = h >= 12 ? "PM" : "AM";
  h = h % 12 || 12;
  return h + (m[2] === "00" ? "" : ":" + m[2]) + " " + ap;
}

function fmtDate(iso) {
  const [y, mo, d] = iso.split("-").map(Number);
  return new Date(Date.UTC(y, mo - 1, d)).toLocaleDateString("en-US", {
    weekday: "long", month: "long", day: "numeric", year: "numeric", timeZone: "UTC",
  });
}

// ---------- The invitation ----------

function buildInvite(env, e, guestName, link, note) {
  const first = (guestName || "").split(/\s+/)[0];
  const when = fmtDate(e.date) + (e.start ? ", from " + fmtTime(e.start) : "");
  const subject = "You're invited: " + (e.title || "Family gathering") + " — " + fmtDate(e.date).replace(/, \d{4}$/, "");
  const schedule = (e.schedule || []).map((s) => [fmtTime(s.time), s.text || ""]);
  const menu = (e.menu || []).map((g) => [g.group || "", (g.items || []).map((i) => i.dish || "").filter(Boolean)]);

  const text = [
    first ? "Hi " + first + "," : "Hello,",
    "",
    "You're invited to " + (e.title || "a family gathering") + ".",
    "",
    "When: " + when,
    e.location ? "Where: " + e.location : null,
    e.summary ? "\n" + e.summary : null,
    note ? "\n" + note : null,
    schedule.length ? "\nThe day:\n" + schedule.map((s) => "  " + s[0] + " — " + s[1]).join("\n") : null,
    menu.length ? "\nOn the menu:\n" + menu.map((g) => (g[0] ? "  " + g[0] + ": " : "  ") + g[1].join(", ")).join("\n") : null,
    "",
    "RSVP, request a dish, or tell us what you're bringing here — this link is just for you, no password needed:",
    link,
    "",
    "A calendar invite is attached.",
    "",
    env.MAIL_FROM_NAME || "The McConnell Family",
  ].filter((x) => x !== null).join("\n");

  const p = (s) => `<p style="margin:0 0 14px;font-size:16px;line-height:1.5">${s}</p>`;
  const html = `<!doctype html><html><body style="margin:0;padding:0;background:#fafafa">
<div style="max-width:560px;margin:0 auto;padding:28px 22px;font-family:Georgia,'Times New Roman',serif;color:#111">
<div style="border-top:4px solid #c8102e;background:#fff;border:1px solid #e2e2e2;border-radius:6px;padding:26px 24px">
${p(esc(first ? "Hi " + first + "," : "Hello,"))}
<h1 style="font-size:28px;line-height:1.2;margin:0 0 6px;font-weight:normal">${esc(e.title || "Family gathering")}</h1>
<p style="margin:0 0 4px;font-size:16px;color:#555">${esc(when)}</p>
${e.location ? `<p style="margin:0 0 4px;font-size:16px;color:#555">${esc(e.location)}</p>` : ""}
<div style="height:14px"></div>
${e.summary ? p(esc(e.summary)) : ""}
${note ? p(esc(note).replace(/\n/g, "<br>")) : ""}
${schedule.length ? `<h2 style="font-size:19px;margin:20px 0 8px;font-weight:normal;border-top:1px solid #e2e2e2;padding-top:14px">The day</h2>
<table role="presentation" style="border-collapse:collapse;font-size:15px">${schedule.map((s) =>
  `<tr><td style="padding:4px 16px 4px 0;color:#8a0a1f;font-weight:bold;white-space:nowrap;vertical-align:top">${esc(s[0])}</td><td style="padding:4px 0">${esc(s[1])}</td></tr>`).join("")}</table>` : ""}
${menu.length ? `<h2 style="font-size:19px;margin:20px 0 8px;font-weight:normal;border-top:1px solid #e2e2e2;padding-top:14px">On the menu</h2>
${menu.map((g) => `<p style="margin:0 0 8px;font-size:15px;line-height:1.5">${g[0] ? `<span style="color:#555;font-size:12px;letter-spacing:.08em;text-transform:uppercase">${esc(g[0])}</span><br>` : ""}${g[1].map(esc).join(" · ")}</p>`).join("")}` : ""}
<div style="text-align:center;margin:26px 0 10px">
<a href="${esc(link)}" style="display:inline-block;background:#c8102e;color:#fff;text-decoration:none;font-family:Helvetica,Arial,sans-serif;font-weight:bold;font-size:16px;padding:14px 26px;border-radius:6px">RSVP &amp; requests</a>
</div>
<p style="margin:0;font-size:13px;color:#555;text-align:center;font-family:Helvetica,Arial,sans-serif">This link is just for you — no password needed. A calendar invite is attached.</p>
</div>
<p style="margin:18px 0 0;font-size:14px;color:#555;text-align:center">${esc(env.MAIL_FROM_NAME || "The McConnell Family")}</p>
</div></body></html>`;

  return { subject, text, html, ics: buildICS(e, link) };
}

function buildICS(e, link) {
  const d = e.date.replace(/-/g, "");
  const icsEsc = (t) => String(t || "").replace(/\\/g, "\\\\").replace(/;/g, "\\;").replace(/,/g, "\\,").replace(/\r?\n/g, "\\n");
  const hm = (t) => (/^\d{1,2}:\d{2}$/.test(t || "") ? t.replace(":", "").padStart(4, "0") + "00" : "");
  const desc = [e.summary || ""]
    .concat((e.schedule || []).map((s) => fmtTime(s.time) + " — " + (s.text || "")))
    .concat(["", "RSVP & requests: " + link])
    .join("\n");
  const lines = [
    "BEGIN:VCALENDAR", "VERSION:2.0", "PRODID:-//McConnell Family//Events//EN", "METHOD:PUBLISH",
    "BEGIN:VEVENT",
    "UID:" + e.slug + "@mcconnellfamilysports",
    "DTSTAMP:" + new Date().toISOString().replace(/[-:]/g, "").replace(/\.\d+/, ""),
  ];
  if (hm(e.start)) {
    lines.push("DTSTART:" + d + "T" + hm(e.start));
    if (hm(e.end)) lines.push("DTEND:" + d + "T" + hm(e.end));
  } else {
    lines.push("DTSTART;VALUE=DATE:" + d);
  }
  lines.push("SUMMARY:" + icsEsc(e.title || "Family gathering"));
  if (e.location) lines.push("LOCATION:" + icsEsc(e.location));
  lines.push("DESCRIPTION:" + icsEsc(desc), "URL:" + link, "END:VEVENT", "END:VCALENDAR");
  // Fold long lines at 75 octets, as the format requires.
  return lines.map(foldLine).join("\r\n") + "\r\n";
}

function foldLine(line) {
  const bytes = new TextEncoder().encode(line);
  if (bytes.length <= 75) return line;
  const out = [];
  let cur = "", curLen = 0;
  for (const ch of line) {
    const n = new TextEncoder().encode(ch).length;
    if (curLen + n > (out.length ? 74 : 75)) { out.push(cur); cur = ""; curLen = 0; }
    cur += ch; curLen += n;
  }
  out.push(cur);
  return out.join("\r\n ");
}

// ---------- Mail ----------

async function makeMailer(env) {
  if (!env.MAIL_FROM) throw new Error("MAIL_FROM isn't set.");
  const provider = (env.MAIL_PROVIDER || "gmail").toLowerCase();
  if (provider === "gmail") return gmailMailer(env);
  if (provider === "microsoft") return microsoftMailer(env);
  throw new Error("MAIL_PROVIDER must be gmail or microsoft.");
}

async function gmailMailer(env) {
  const r = await fetch("https://oauth2.googleapis.com/token", {
    method: "POST",
    headers: { "Content-Type": "application/x-www-form-urlencoded" },
    body: new URLSearchParams({
      client_id: env.GOOGLE_CLIENT_ID,
      client_secret: env.GOOGLE_CLIENT_SECRET,
      refresh_token: env.GOOGLE_REFRESH_TOKEN,
      grant_type: "refresh_token",
    }),
  });
  if (!r.ok) throw new Error("Google sign-in for sending failed (" + r.status + ")");
  const { access_token } = await r.json();
  if (!access_token) throw new Error("Google returned no access token.");
  return {
    async send(m) {
      const raw = b64url(utf8(mimeMessage(env, m)));
      const s = await fetch("https://gmail.googleapis.com/gmail/v1/users/me/messages/send", {
        method: "POST",
        headers: { Authorization: "Bearer " + access_token, "Content-Type": "application/json" },
        body: JSON.stringify({ raw }),
      });
      if (!s.ok) throw new Error("Gmail send failed (" + s.status + ")");
    },
  };
}

async function microsoftMailer(env) {
  const r = await fetch(`https://login.microsoftonline.com/${env.TENANT_ID}/oauth2/v2.0/token`, {
    method: "POST",
    headers: { "Content-Type": "application/x-www-form-urlencoded" },
    body: new URLSearchParams({
      client_id: env.CLIENT_ID,
      client_secret: env.CLIENT_SECRET,
      scope: "https://graph.microsoft.com/.default",
      grant_type: "client_credentials",
    }),
  });
  if (!r.ok) throw new Error("Microsoft sign-in for sending failed (" + r.status + ")");
  const { access_token } = await r.json();
  return {
    async send(m) {
      const s = await fetch(`https://graph.microsoft.com/v1.0/users/${encodeURIComponent(env.MAIL_FROM)}/sendMail`, {
        method: "POST",
        headers: { Authorization: "Bearer " + access_token, "Content-Type": "application/json" },
        body: JSON.stringify({
          message: {
            subject: m.subject,
            body: { contentType: "HTML", content: m.html },
            toRecipients: [{ emailAddress: { address: m.to, name: m.toName || undefined } }],
            attachments: [{
              "@odata.type": "#microsoft.graph.fileAttachment",
              name: "invite.ics",
              contentType: "text/calendar",
              contentBytes: b64(utf8(m.ics)),
            }],
          },
          saveToSentItems: true,
        }),
      });
      if (!s.ok) throw new Error("Outlook send failed (" + s.status + ")");
    },
  };
}

function mimeMessage(env, m) {
  const boundary = "mfs-" + randomToken().slice(0, 16);
  const alt = "alt-" + randomToken().slice(0, 16);
  const from = encodeWord(env.MAIL_FROM_NAME || "The McConnell Family") + " <" + env.MAIL_FROM + ">";
  const to = (m.toName ? encodeWord(m.toName) + " " : "") + "<" + m.to + ">";
  const wrap = (s) => b64(utf8(s)).replace(/.{1,76}/g, "$&\r\n");
  return [
    "From: " + from,
    "To: " + to,
    "Subject: " + encodeWord(m.subject),
    "MIME-Version: 1.0",
    "Content-Type: multipart/mixed; boundary=\"" + boundary + "\"",
    "",
    "--" + boundary,
    "Content-Type: multipart/alternative; boundary=\"" + alt + "\"",
    "",
    "--" + alt,
    "Content-Type: text/plain; charset=UTF-8",
    "Content-Transfer-Encoding: base64",
    "",
    wrap(m.text),
    "--" + alt,
    "Content-Type: text/html; charset=UTF-8",
    "Content-Transfer-Encoding: base64",
    "",
    wrap(m.html),
    "--" + alt + "--",
    "",
    "--" + boundary,
    "Content-Type: text/calendar; charset=UTF-8; method=PUBLISH; name=\"invite.ics\"",
    "Content-Disposition: attachment; filename=\"invite.ics\"",
    "Content-Transfer-Encoding: base64",
    "",
    wrap(m.ics),
    "--" + boundary + "--",
    "",
  ].join("\r\n");
}

function encodeWord(s) {
  // Header words with anything beyond plain ASCII (an em dash, an accent)
  // must be encoded or mail clients show garbage.
  // eslint-disable-next-line no-control-regex
  return /^[\x20-\x7e]*$/.test(s) && !/[<>",]/.test(s) ? s : "=?UTF-8?B?" + b64(utf8(s)) + "?=";
}

function utf8(s) {
  return new TextEncoder().encode(s);
}

function b64(bytes) {
  let bin = "";
  for (let i = 0; i < bytes.length; i += 0x8000) {
    bin += String.fromCharCode.apply(null, bytes.subarray(i, i + 0x8000));
  }
  return btoa(bin);
}

function b64url(bytes) {
  return b64(bytes).replace(/\+/g, "-").replace(/\//g, "_").replace(/=+$/, "");
}
