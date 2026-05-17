# Setting up the Microsoft Teams sync

> **Privacy reality, stated up front:** the McConnell Family Sports
> GitHub repo is **public**. Anything synced from Teams into `media/`
> becomes downloadable by anyone who knows the GitHub URL. The site's
> password gate only hides photos from the website — it does *not*
> hide them from the repository. If at any point this feels wrong for
> the family, switch the repo to **Private** in repo Settings and
> upgrade to **GitHub Pro** ($4/mo) so GitHub Pages still serves it.
> That's a 2-minute change, any time.

This document walks the family through registering an app in
Microsoft Entra ID (formerly Azure AD) so the sync workflow can read
the family Teams channel.

You only do this once. After it's set up, photos posted in the family
Teams channel get pulled into the site automatically every 30 minutes.

---

## What you'll need

- A paid Microsoft 365 tenant (Business Basic or higher).
- You are the tenant admin (i.e. you can grant "admin consent" to
  apps in Entra ID). If a spouse or IT admin owns the tenant, do this
  with them.
- About 20 minutes.

---

## Step 1 — Register the application

1. Sign in to <https://entra.microsoft.com> with your admin account.
2. In the left nav, open **Applications → App registrations**.
3. Click **+ New registration** at the top.
4. Fill out the form:
   - **Name:** `McConnell Family Sports Sync`
   - **Supported account types:** *Accounts in this organizational
     directory only (single tenant)*
   - **Redirect URI:** leave blank (this is a daemon, no sign-in flow)
5. Click **Register**.

You'll land on the app's overview page. Copy two values into a notes
file — you'll need them later:

- **Application (client) ID** — looks like `c1a2b3...`
- **Directory (tenant) ID** — looks like `d4e5f6...`

---

## Step 2 — Grant API permissions

1. From the app's overview page, click **API permissions** in the
   left nav.
2. Click **+ Add a permission** → **Microsoft Graph** →
   **Application permissions** (not Delegated).
3. Search for and check each of these:
   - `ChannelMessage.Read.All`
   - `Files.Read.All`
   - `Sites.Read.All`
4. Click **Add permissions** at the bottom.
5. Back on the API permissions list, click the **Grant admin consent
   for &lt;your tenant&gt;** button at the top. You'll be prompted to
   confirm — click **Yes**.

The "Status" column for all three permissions should now show a green
checkmark "Granted for &lt;your tenant&gt;". If you see warning
triangles, admin consent didn't apply — try the Grant admin consent
button again.

> **Why application permissions and not delegated?** The sync runs
> unattended on a schedule. There's no user signed in at run time, so
> the app authenticates as itself with a client secret. Application
> permissions are the right shape for that.

---

## Step 3 — Create a client secret

1. In the left nav of the app, click **Certificates & secrets**.
2. Click **+ New client secret**.
3. **Description:** `Sync script`. **Expires:** *24 months*
   (recommended — long enough to forget, short enough to be safe).
4. Click **Add**.
5. **Copy the "Value" immediately** — it's only shown once. If you
   close the page without copying it, you'll have to make a new one.

Save the secret value in your notes file next to the IDs from Step 1.

---

## Step 4 — Find the Team ID and Channel ID

The sync needs to know which Team and which channel inside it to
read. The easiest way to find these is **Graph Explorer**.

1. Open <https://developer.microsoft.com/graph/graph-explorer>.
2. Sign in (top-right) with your admin account.
3. In the URL box, run: `GET https://graph.microsoft.com/v1.0/me/joinedTeams`
4. Click **Run query**.
5. In the response, find the family Team by `displayName`. Copy its
   `id` field — that's the **Team ID**.
6. Now run: `GET https://graph.microsoft.com/v1.0/teams/<TEAM_ID>/channels`
   (replace `<TEAM_ID>` with the value you just copied).
7. Find the family channel by `displayName` and copy its `id` — that's
   the **Channel ID**.

Save both in your notes file.

---

## Step 5 — Store the secrets in GitHub

The sync workflow runs on GitHub Actions and reads the credentials
from repository secrets. **Never commit them to the repo.**

1. Go to <https://github.com/mcconnellentllc-cloud/McConnellFamilySports/settings/secrets/actions>.
2. Click **New repository secret** for each of these. The name on the
   left must match exactly; the value is what you copied:

   | Secret name      | Value                                          |
   |------------------|------------------------------------------------|
   | `TENANT_ID`      | Directory (tenant) ID from Step 1              |
   | `CLIENT_ID`      | Application (client) ID from Step 1            |
   | `CLIENT_SECRET`  | The secret value from Step 3                   |
   | `TEAMS_TEAM_ID` | Team ID from Step 4                            |
   | `TEAMS_CHANNEL_ID` | Channel ID from Step 4                       |

3. Each one click **Add secret**.

---

## Step 6 — Trigger the first sync

1. Go to <https://github.com/mcconnellentllc-cloud/McConnellFamilySports/actions/workflows/sync.yml>.
2. Click **Run workflow** → **Run workflow**.
3. Watch the run. The first sync may take a few minutes because it
   downloads face-recognition models. Subsequent runs are faster.

After it completes, look at `data/pending.json` in the repo — it
should have one entry per photo and message that needs human
attention. Open the site's **Review tray** (see `SETUP-GITHUB-TOKEN.md`)
to clear them.

From then on, the sync runs every 30 minutes automatically.

---

## Conventions for the family Teams channel

When you post in the channel:

- **For photos:** include `#sport` (e.g. `#gymnastics`). Optionally
  add `#tyndle`, `#oakley`, `#tayla` (one or more) to skip the review
  tray entirely.
- **For a memory (no photo, just words):** include `#sport` and at
  least one girl tag.
- **No tags?** It still gets synced — it just lands in the review
  tray where you can sort it in one tap.

EXIF date and GPS get extracted automatically when present, so your
phone's stamp on the photo becomes the date on the site.

---

## When something goes wrong

- **The workflow fails with 401/403** — the client secret expired (it
  expires every 24 months). Regenerate it (Step 3) and update the
  `CLIENT_SECRET` in GitHub Secrets.
- **Photos don't appear** — check the workflow run logs at
  <https://github.com/mcconnellentllc-cloud/McConnellFamilySports/actions>.
  The sync script prints what it found and what it skipped.
- **Wrong photos got assigned to a girl** — open `data/content.json`
  on GitHub and edit by hand, then commit. The sync won't override
  manual edits (it keys by content hash and skips already-imported
  files).

---

## Renewing the client secret (yearly chore)

Mark a calendar reminder ~22 months from when you created the secret.
When the reminder fires:

1. Repeat **Step 3** in this doc to create a new secret.
2. Update `CLIENT_SECRET` in GitHub Secrets with the new value.
3. (Optional) Delete the old secret in the Entra app's
   **Certificates & secrets** screen once you've confirmed the new
   one works.
