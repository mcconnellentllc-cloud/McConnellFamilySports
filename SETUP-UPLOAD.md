# Setting up on-site uploads (the Upload button)

This switches on the **Add photos or videos** button on each girl's
Pictures tab, so **anyone with the family password can upload from the
site — no GitHub account, no token, nothing to install on their end.**

## How it works (and why there's one small backend)

The website is a static page on GitHub Pages, which can't accept file
uploads by itself. So uploads go to a tiny **Cloudflare Worker** (the only
backend in the whole project). The Worker:

1. checks the family password, then
2. drops the file into the **family Teams channel's Files folder**, named
   `mfs.<girl>.<sport>.<original>`.

Your existing **Teams sync** (see `SETUP-AZURE.md`) then files it into
`media/<girl>/<sport>/`, and the next deploy shows it on the site. So a
photo uploaded on the site appears within ~30 minutes (the sync's cadence).

The Microsoft credential lives **only** in the Worker as a secret — it never
reaches anyone's browser. Family members only ever send the password.

> This is the one place the project uses a backend; the website itself stays
> plain HTML/CSS/JS. Uploads need *some* server to hold the credential, and
> this is the smallest possible one.

**Prerequisites:** the Teams sync from `SETUP-AZURE.md` must be set up first
(the Worker reuses the same app registration and Team/Channel IDs). A free
Cloudflare account. About 15 minutes.

> **On a phone? Yes — every step here works in a phone web browser.** No
> computer and no command line: Cloudflare and Microsoft both have full
> websites, and you edit `app.js` on github.com. It's a one-time job and a
> bit of careful copy-pasting on a small screen, but nothing needs a PC.

---

## Step 1 — Let the app write to the channel's files

The Teams app you made in `SETUP-AZURE.md` is read-only. Uploading needs one
write permission.

1. Go to <https://entra.microsoft.com> → **Applications → App registrations**
   → open **McConnell Family Sports Sync**.
2. **API permissions** → **+ Add a permission** → **Microsoft Graph** →
   **Application permissions**.
3. Add **`Sites.ReadWrite.All`**, then click **Add permissions**.
4. Click **Grant admin consent for &lt;your tenant&gt;** and confirm. The new
   permission should show a green "Granted" check.

---

## Step 2 — Get the family password's fingerprint

The Worker checks the password by its SHA-256 hash, and **that hash already
exists in your site** — there's nothing to compute or install.

1. On github.com, open **`assets/app.js`**.
2. Near the top, find the line that begins `const PASSWORD_HASH =` — it's a
   long hex string in quotes.
3. Copy that hex string. That's your `UPLOAD_PASSWORD_SHA256`.

It's the fingerprint of the same family password the site's gate uses, so the
Upload button and the gate stay in step automatically. (Never paste the
password itself anywhere — only this hash.)

---

## Step 3 — Create the Worker (all in the Cloudflare website)

Do this in your phone (or any) browser at <https://dash.cloudflare.com> — no
command line.

1. Sign up / log in (the free plan is plenty). In the menu tap
   **Workers &amp; Pages → Create → Create Worker**. Name it something like
   `mcconnell-family-sports-upload`, tap **Deploy** to create the starter,
   then tap **Edit code**.
2. Select all the starter code and delete it. In another tab, open
   `upload-endpoint/worker.js` from this repo on github.com, copy **all** of
   it, paste it into the Cloudflare editor, and tap **Deploy**.
3. Open the Worker's **Settings → Variables and Secrets** and add the values
   below. Add `ALLOWED_ORIGIN` as a plain **Text** variable; add the rest as
   **Secret** (encrypted) so they stay hidden:

   | Name | Type | Value |
   |------|------|-------|
   | `ALLOWED_ORIGIN` | Text | `https://mcconnellentllc-cloud.github.io` |
   | `TENANT_ID` | Secret | from `SETUP-AZURE.md` |
   | `CLIENT_ID` | Secret | from `SETUP-AZURE.md` |
   | `CLIENT_SECRET` | Secret | from `SETUP-AZURE.md` |
   | `TEAMS_TEAM_ID` | Secret | from `SETUP-AZURE.md` |
   | `TEAMS_CHANNEL_ID` | Secret | from `SETUP-AZURE.md` |
   | `UPLOAD_PASSWORD_SHA256` | Secret | the hash from Step 2 |

   Save, then tap **Deploy** once more so the new values take effect.
4. The Worker's address is shown at the top of its page, like
   `https://mcconnell-family-sports-upload.<your-subdomain>.workers.dev`.
   That's your upload endpoint.

> **Prefer a command line?** The repo also includes
> `upload-endpoint/wrangler.toml`. From a computer you can
> `npm i -g wrangler`, `wrangler login`, run `wrangler secret put <NAME>` for
> each secret above, then `wrangler deploy`.

---

## Step 4 — Point the site at the Worker

1. On github.com, open **`assets/app.js`** and tap the pencil (**Edit this
   file**) — this works fine in a phone browser.
2. Find `const UPLOAD_ENDPOINT = "";` and paste your Worker address between
   the quotes:
   ```js
   const UPLOAD_ENDPOINT = "https://mcconnell-family-sports-upload.<your-subdomain>.workers.dev";
   ```
3. **Commit changes**. After the site redeploys, the **Add photos or videos**
   button is live on every Pictures tab.

That's it. Family members unlock with the password, pick photos/videos, tap
**Upload to Teams**, and they appear after the next sync.

---

## Good to know

- **File types:** photos (`.jpg`, `.png`, `.heic`, `.webp`, …) and videos
  (`.mp4`, `.mov`, `.m4v`, `.webm`). Up to **25 MB** each. For bigger videos,
  post to YouTube/Vimeo (Unlisted) or Drive and link it in a memory — see
  `MEET-DAY-GUIDE.md`.
- **It appears within ~30 minutes**, not instantly — that's the Teams sync
  cadence. To see it sooner, run the sync workflow manually (Actions →
  *Build and Deploy* / the sync workflow → Run workflow).
- **Security = password strength.** Anyone who knows the family password can
  upload. The short default password is weak; a longer one is meaningfully
  safer (see README → "Changing the password"). If you change it, copy the
  new `PASSWORD_HASH` from `app.js` into the Worker's `UPLOAD_PASSWORD_SHA256`
  secret (Settings → Variables and Secrets) and redeploy.
- **Privacy reality is unchanged:** synced files land in the public repo, same
  as photos posted in Teams today. (See the note at the top of
  `SETUP-AZURE.md` about going Private if that ever feels wrong.)

---

## Prefer Azure instead of Cloudflare?

If you'd rather keep everything in Microsoft, the same logic can run as an
**Azure Function** (HTTP trigger) reusing this app registration — Azure has no
small request-body limit either. The Worker code in `worker.js` is a close
template; the Graph calls are identical. (Vercel is a poor fit here: its
serverless functions cap request bodies at ~4.5 MB, smaller than many meet
photos.)

---

## When something goes wrong

- **"Wrong password"** — the hash in `UPLOAD_PASSWORD_SHA256` doesn't match
  the site password. Redo Step 2 (copy `PASSWORD_HASH` from `app.js`) and
  re-set the secret in the Worker's Settings.
- **Upload fails with 401/403 from Microsoft** — the `Sites.ReadWrite.All`
  consent (Step 1) didn't apply, or the client secret expired (it lasts 24
  months — see `SETUP-AZURE.md`).
- **Upload works but the photo never appears** — check that the Teams sync is
  running (`data/.sync_state.json` should show a recent `lastSyncCompletedAt`).
  The Worker puts the file in Teams; the sync is what brings it to the site.
- **Browser console shows a CORS error** — the Worker's `ALLOWED_ORIGIN`
  variable (Settings → Variables and Secrets) must exactly match the site's
  address (no trailing slash); fix it and redeploy.
