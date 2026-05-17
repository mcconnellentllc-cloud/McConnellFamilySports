# Setting up the Review tray token

The Review tray (`/review.html` on the site) shows photos and
messages the sync pulled in but couldn't fully classify on its own.
When you sort or discard an item, the tray writes the change back to
the repo by calling the GitHub API directly from your phone or
browser.

For that to work, the tray needs a **fine-grained Personal Access
Token** (PAT) with permission to write to *this one repo only*. You
generate it once, paste it into the tray, and the browser stores it
locally on your device.

You only do this once per device. The token lives in that browser's
local storage — clearing site data wipes it, and you'd just paste it
again.

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

## Step 2 — Paste it into the Review tray

1. Open the site on your phone in Safari (or any browser) and unlock
   with the family password.
2. Go to `https://mcconnellentllc-cloud.github.io/McConnellFamilySports/review.html`.
3. The tray will prompt for a token the first time. Paste the
   `github_pat_...` value and tap **Save token**.

That's it. The token is stored in your browser's local storage (only
this device, only this browser, scoped to the site's origin). The
tray uses it to call the GitHub Contents API directly when you
confirm items.

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
