# Setting up the upload token

This one token powers two things that write back to the repo straight
from the browser (there's no server):

1. **Site uploads (password only).** On a girl's **Pictures** tab,
   **Add photos or videos** lets anyone with the family password upload
   from the site. You switch this on **once for the whole site**: paste
   the token into the **Turn on uploads** box. The site then encrypts
   the token with the family password and stores it at
   `data/upload-key.json`, so from then on **nobody needs a token** —
   the password alone unlocks uploading for everyone.
2. **The Review tray** (`/review.html`), which sorts photos/messages the
   Teams sync couldn't classify. The tray reuses the same token.

For either, you need a **fine-grained Personal Access Token** (PAT)
with permission to write to *this one repo only*. You generate it once.

> **Important:** because the site-upload token is encrypted with the
> family password, the password's strength *is* the lock on uploading.
> Anyone who learns or cracks the password can upload. A longer family
> password makes this genuinely strong; the short default does not. If
> you change the family password later, redo the **Turn on uploads**
> step so the token is re-encrypted under the new one.

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

1. Open the site and unlock with the family password.
2. Go to any girl's **Pictures** tab (e.g. Tyndle → Gymnastics →
   Pictures).
3. Under **Add photos or videos**, the **Turn on uploads** box appears
   the first time. Paste the `github_pat_...` value and tap **Turn on
   uploads**.

The site encrypts the token with the family password and saves it to
`data/upload-key.json`. After this, **everyone with the password can
upload from the site without ever entering a token.**

(The Review tray at `/review.html` uses the same token. If you open the
tray and it asks for one, paste the same value there — that copy is
stored only in that browser's local storage.)

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
