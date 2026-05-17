# McConnell Family Sports

A private, password-protected family archive for the McConnell girls' sports —
scores, pictures, places, and memories. It's a single-page website that lives
on GitHub for free, with no servers and no monthly cost.

The password is **McConnell** (the site asks for it once per browser session).

---

## Privacy notice (read this once)

This repository is **public**. The password gate hides photos and scores from
people visiting the *website*, but it does **not** hide anything from the
GitHub repository — anyone with the GitHub URL can browse `media/` and
download every photo file directly. That is a deliberate choice we made to
keep the site free.

If at any point that feels wrong — especially as the auto-sync from the
family Teams channel fills the archive with years of photos of minors — the
fix is small:

1. Repo Settings → Danger Zone → **Change visibility** → Private.
2. Upgrade the account to **GitHub Pro** (~$4/month) so GitHub Pages will
   still serve a private repo.

That's a 2-minute change, any time.

---

## How it works (auto-sync from the family Teams channel)

A scheduled GitHub Action runs every 30 minutes and pulls anything new
from the family Microsoft Teams channel into the site:

- **Post a photo with `#gymnastics`** (the sport hashtag) **and a girl
  hashtag** (`#tyndle`, `#oakley`, or `#tayla`, one or more) — the photo is
  auto-filed straight into `media/<girl>/gymnastics/` and the next deploy
  publishes it. Done.
- **Post a photo with only `#gymnastics`** — the sport is set automatically,
  but the photo waits in the **Review tray** for you to pick the girl. EXIF
  date and GPS (if your phone embeds it) come over automatically, and a face
  suggestion is pre-selected when there's a confident match.
- **Post a photo with no tags** — same flow, the tray collects it as
  "unsorted." Date and GPS still come over via EXIF.
- **Post a journal/text message with `#sport #girlname`** — it becomes a
  Memory entry on that girl's page.

Photos uploaded via Teams' "Files" tab (SharePoint-backed) are also picked
up — they always start in the tray since they don't carry message hashtags.

The **Review tray** lives at `/review.html` on the site (same password). The
only routine chore is clearing it; that shrinks over time as the venue map
and face references fill in.

**Expected early-volume curve:** most items will queue in the tray at first
because the venue map starts empty. After you sort the first handful from a
new venue, it gets remembered and subsequent photos from the same place
auto-resolve.

See **`SETUP-AZURE.md`** for the one-time Microsoft Entra setup that powers
the sync, and **`SETUP-GITHUB-TOKEN.md`** for the Review tray's token.

---

## One-time setup (about 10 minutes)

1. **Create a new private repository on GitHub.**
   - Go to <https://github.com/new>.
   - Repository name: anything you like (e.g. `mcconnell-family-sports`).
   - Choose **Private**.
   - Do not add a README, .gitignore, or license — leave it empty.
   - Click *Create repository*.

2. **Upload these files into the new repo.**
   - On the new empty repo page, click **uploading an existing file**.
   - Drag the entire contents of this folder into the upload area (open
     this folder first and select everything inside — not the folder itself).
   - Scroll down and click **Commit changes**.

3. **Turn on GitHub Pages.** (One-time, requires a repo admin signed in.)
   - In the repo, click **Settings** → **Pages** (left sidebar).
   - Under *Build and deployment*, set **Source** to **GitHub Actions**.
   - No save button — selecting it applies immediately.

4. **Allow Actions to write back to the repo.** (One-time. Lets the deploy
   workflow commit the auto-generated `data/gallery.json` whenever new
   photos are uploaded.)
   - In the repo, click **Settings** → **Actions** → **General** (left sidebar).
   - Scroll down to **Workflow permissions**.
   - Choose **Read and write permissions**, then click **Save**.

5. **Wait a couple of minutes for the first build.**
   - Click the **Actions** tab. You'll see a workflow running called
     "Build and Deploy". When it finishes (green check), the site is live.
   - The site URL is shown on the Settings → Pages screen. It looks like:
     `https://YOUR-USERNAME.github.io/REPO-NAME/`
   - Open it, type the password **McConnell**, and you're in.

> The site is unlisted (search engines are told not to index it) and locked
> behind the password, but the URL itself is technically reachable by anyone
> who knows it. Treat the link the way you'd treat a family photo album:
> share it with people you trust.

---

## Adding photos (no typing required)

1. In GitHub, open the `media/` folder.
2. Navigate into the right girl's folder, then the right sport:
   `media/tyndle/gymnastics/`, `media/oakley/gymnastics/`, or
   `media/tayla/gymnastics/`.
3. Click **Add file** → **Upload files**, then drag your photos in.
4. Scroll down, type a short note like "August meet photos," and click
   **Commit changes**.
5. Within a couple of minutes, the new photos show up on the site
   automatically — no JSON editing.

**Caption tip.** The caption under each photo comes from its filename.
A file named `first-stuck-landing.jpg` becomes the caption
"First stuck landing." Rename files before uploading if you'd like prettier
captions. Underscores work too: `vault_warmup.jpg` → "Vault warmup."

**Supported types.** `.jpg`, `.jpeg`, `.png`, `.gif`, `.webp`, `.avif`, `.heic`.

**Venue photos (shared, not tied to one girl).** Drop them into
`media/_venues/`. Folders that start with `_` are skipped by the gallery
builder, so the photo won't clutter any girl's pictures page — instead,
reference its path (e.g. `media/_venues/carbon-valley-rec-center.jpg`) in
an event's `photo` field or a memory's `photo` field in `data/content.json`.

---

## Adding scores, memories, and places

These live in **`data/content.json`**. Edit it directly on GitHub:

1. Open `data/content.json` in the repo.
2. Click the pencil icon (top right) to edit.
3. Copy one of the existing entries as a template, paste it below, and fill
   in the new details. Keep the commas and brackets exactly as you see them.
4. Scroll down, click **Commit changes**. The site updates in a couple of
   minutes.

### Score entry shape

```json
{
  "athlete": "tyndle",
  "sport": "gymnastics",
  "date": "2026-03-15",
  "meet": "Spring Classic",
  "location": "Denver, CO",
  "level": "4",
  "results": [
    { "event": "Vault", "score": 9.2 },
    { "event": "Bars",  "score": 8.9 },
    { "event": "Beam",  "score": 9.0 },
    { "event": "Floor", "score": 9.3 }
  ],
  "allAround": 36.4,
  "placement": "1st AA"
}
```

- `athlete` is `tyndle`, `oakley`, or `tayla` (lowercase).
- `sport` is `gymnastics` for now.
- `date` is `YYYY-MM-DD`.
- `placement` is free text — `"1st AA"`, `"3rd Beam"`, etc. Leave it as
  `""` if none.

### Memory entry shape

```json
{
  "athlete": "oakley",
  "sport": "gymnastics",
  "date": "2026-02-20",
  "title": "First time on high bar",
  "text": "She was shaking on the way to the gym and grinning on the way home..."
}
```

### Place entry shape

```json
{
  "athlete": "tayla",
  "sport": "gymnastics",
  "name": "Mountain View Gymnastics",
  "city": "Boulder, CO",
  "note": "Her home gym — the one with the squeaky front door."
}
```

The file already has one of each as a labeled example. Replace those when
you add your own real entries.

---

## Adding another girl or another sport later

Open **`data/athletes.json`** and add to the lists. Example — adding a new
sport:

```json
"sports": [
  { "slug": "gymnastics", "name": "Gymnastics",
    "events": ["Vault", "Bars", "Beam", "Floor", "All-Around"] },
  { "slug": "soccer", "name": "Soccer",
    "events": ["Goals", "Assists"] }
]
```

Then in each girl's entry, add the slug to her `sports` list, e.g.
`"sports": ["gymnastics", "soccer"]`. Create matching folders under
`media/<girl>/<sport>/` and you're set.

---

## Changing the password

The password is stored as a SHA-256 hash (the original word is never in the
source code). To change it:

1. Pick a new password.
2. Generate its hash. On Mac/Linux Terminal:
   ```
   printf 'YourNewPassword' | shasum -a 256
   ```
3. Open `assets/app.js`, find the line that starts with `const PASSWORD_HASH`,
   and replace the long string with your new hash.
4. Commit the change.

---

## File map

```
index.html                    The page itself.
assets/styles.css             Styling.
assets/app.js                 App logic + password gate.
data/athletes.json            Who and what sports — edit to add people/sports.
data/content.json             Scores, memories, places — edit by hand.
data/gallery.json             Auto-generated. Don't hand-edit.
media/<girl>/<sport>/         Drop photo files in here.
build.py                      Scans media/ and rebuilds gallery.json.
.github/workflows/deploy.yml  Runs on every push; builds and publishes.
```

That's the whole thing.
