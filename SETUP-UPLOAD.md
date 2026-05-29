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

The Worker checks the password by its SHA-256 hash (so the plaintext password
is never stored on the server). Generate the hash on Mac/Linux Terminal —
replace `YourFamilyPassword` with the real site password:

```
printf 'YourFamilyPassword' | shasum -a 256
```

Copy the long hex string it prints. (It must be the **same** password the
site's gate uses.) Don't paste the password itself into any file.

---

## Step 3 — Deploy the Worker

From this repo's `upload-endpoint/` folder:

1. Install the Cloudflare CLI (one time): `npm install -g wrangler`
2. Sign in: `wrangler login`
3. Set each secret (it'll prompt you to paste the value):
   ```
   wrangler secret put TENANT_ID            # from SETUP-AZURE.md
   wrangler secret put CLIENT_ID            # from SETUP-AZURE.md
   wrangler secret put CLIENT_SECRET        # from SETUP-AZURE.md
   wrangler secret put TEAMS_TEAM_ID        # from SETUP-AZURE.md
   wrangler secret put TEAMS_CHANNEL_ID     # from SETUP-AZURE.md
   wrangler secret put UPLOAD_PASSWORD_SHA256   # the hash from Step 2
   ```
4. Deploy: `wrangler deploy`

Wrangler prints the Worker's URL, e.g.
`https://mcconnell-family-sports-upload.<your-subdomain>.workers.dev`. Your
upload endpoint is that URL.

> `ALLOWED_ORIGIN` is already set to the site's address in `wrangler.toml`. If
> you serve the site from a different URL, change it there and redeploy.

---

## Step 4 — Point the site at the Worker

1. Open `assets/app.js` and find the line:
   ```js
   const UPLOAD_ENDPOINT = "";
   ```
2. Paste your Worker URL between the quotes:
   ```js
   const UPLOAD_ENDPOINT = "https://mcconnell-family-sports-upload.<your-subdomain>.workers.dev";
   ```
3. Commit. After the deploy, the **Add photos or videos** button is live on
   every Pictures tab.

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
  safer (see README → "Changing the password"). If you change it, redo
  Step 2 + `wrangler secret put UPLOAD_PASSWORD_SHA256`.
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
  the site password. Redo Step 2 and re-set the secret.
- **Upload fails with 401/403 from Microsoft** — the `Sites.ReadWrite.All`
  consent (Step 1) didn't apply, or the client secret expired (it lasts 24
  months — see `SETUP-AZURE.md`).
- **Upload works but the photo never appears** — check that the Teams sync is
  running (`data/.sync_state.json` should show a recent `lastSyncCompletedAt`).
  The Worker puts the file in Teams; the sync is what brings it to the site.
- **Browser console shows a CORS error** — `ALLOWED_ORIGIN` in `wrangler.toml`
  must exactly match the site's address (no trailing slash); redeploy.
