# Setting up the upload token

The **Review tray** (`/review.html`) sorts photos and messages the Teams
sync pulled in but couldn't fully classify on its own. When you sort or
discard an item, the tray writes the change back to the repo by calling the
GitHub API directly from your phone or browser.

For that, the tray needs a **fine-grained Personal Access Token** (PAT) with
permission to write to *this one repo only*. You generate it once, paste it
into the tray, and the browser stores it in that device's local storage.

> **Note:** this token is **only** for the Review tray. The on-site
> **Upload** button (Add photos or videos) does *not* use it — uploads go
> through a separate endpoint that posts into Teams. See
> [SETUP-UPLOAD.md](SETUP-UPLOAD.md) for that.

---

## Step 1 — Generate the token on GitHub

1. Sign in to GitHub as the account that owns the repo
   (`mcconnellentllc-cloud`).
2. Go to <https://github.com/settings/personal-access-tokens/new>
   (Settings → Developer settings → Personal access tokens →
   **Fine-grained tokens** → Generate new token).
3. Fill out the form:

   | Field                                | Value                                                       |
   |--------------------------------------|-------------------------------------------------------------|
   | **Token name**                       | `McConnell Family Sports Review`                            |
   | **Expiration**                       | *Custom — 1 year from today*                                |
   | **Resource owner**                   | `mcconnellentllc-cloud`                                     |
   | **Repository access**                | *Only select repositories* → choose `McConnellFamilySports` |
   | **Repository permissions → Contents**| *Read and write*                                            |
   | **Repository permissions → Metadata**| *Read* (auto-enabled, leave it)                             |

   Leave everything else at the default. The narrower the scope, the
   safer this token is.

4. Click **Generate token**. Copy the token immediately
   (`github_pat_...`) — GitHub only shows it once.

---

## Step 2 — Switch on uploads (once for the whole site)

1. Open the site on your phone (or any browser) and unlock with the
   family password.
2. Go to `https://mcconnellentllc-cloud.github.io/McConnellFamilySports/review.html`.
3. The tray prompts for a token the first time. Paste the `github_pat_...`
   value and tap **Save token**.

The token is stored in that browser's local storage (only this device, only
this browser). The tray uses it to call the GitHub Contents API when you
confirm or discard items.

---

## What this token actually protects against (and what it doesn't)

The site's password gate is a **convenience screen, not hard
security** — the password hash lives in the browser-side JavaScript,
so anyone determined enough can fetch the page source and compare
common passwords against the hash offline. It keeps casual visitors
out; it doesn't keep a focused attacker out.

The Review tray PAT's real safety rests on three things:

1. **Scope.** The token is fine-grained, single-repo, Contents-only.
   Even if it leaks, it can't read or modify any other repo on the
   account, can't change Settings, can't see private profile data.
2. **Where you paste it.** Don't enter the token on a shared or
   public computer — other profiles, the next user, and most
   browser-syncing setups can read it back out of localStorage.
3. **Cleanup when a device changes hands.** If a phone or laptop is
   retired, sold, or lost, open the tray on that device and tap
   "Replace token" (wipes localStorage on that device), or — from
   any other device — **revoke the token** at
   <https://github.com/settings/personal-access-tokens>.

**The only hard guarantee of photo privacy** remains switching the
repository to **Private** in repo Settings (and upgrading the account
to **GitHub Pro** so GitHub Pages will still serve a private repo).
This token, the password gate, and any future hardening are layers
above that baseline — useful, but not a substitute for it.

---

## Security notes

- **The token is single-repo, Contents only.** It cannot read or
  modify any other repo on the account. It cannot change Settings, it
  cannot pull personal info, and it cannot push to forks.
- **It's stored locally, never logged.** The tray never sends it
  anywhere except to `api.github.com`, and it's never written to
  console or to the repo.
- **Clearing browser data removes it.** If a phone is lost, sign in
  to GitHub from another device and **revoke the token** at
  <https://github.com/settings/personal-access-tokens> before
  worrying about anything else. Then generate a new one when
  convenient.
- **It expires in 1 year.** When that happens, the tray will tell you
  ("the access token needs renewing — see SETUP-GITHUB-TOKEN.md") and
  you repeat Step 1 with the same settings.

---

## Renewing the token (yearly chore)

Mark a calendar reminder ~11 months from when you created the token.
When the reminder fires:

1. Repeat **Step 1** in this doc to generate a fresh token.
2. Open the Review tray on each device that uses it and paste the new
   token (there's a "replace token" link in the tray header).
3. On <https://github.com/settings/personal-access-tokens>, delete
   the old token once the new one works on every device.

---

## When something goes wrong

- **"The access token needs renewing"** — the token expired. Repeat
  Step 1.
- **"Permission denied"** — the token's repository access is wrong.
  Open it on GitHub and confirm Contents = Read and write,
  Repository access = `McConnellFamilySports`.
- **Tray shows pending items but Confirm does nothing** — open the
  browser's developer console and look for a clear error message
  (e.g. "Network error" or "401"). The tray surfaces the same error
  in plain language; if you see it loading forever, refresh the page.
