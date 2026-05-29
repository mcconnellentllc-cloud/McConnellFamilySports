# Meet-Day Guide — entering scores & posting photos/videos

A no-jargon walkthrough for entering scores live and posting photos and
videos from your phone or laptop, all through the GitHub website. No apps to
install, nothing to "build."

Today's card is already set up: **Paul Derda Gymnastics Meet — May 29,
2026, Paul Derda Recreation Center, Broomfield, CO**, with a blank score
block waiting for **Tyndle (Optional 1)**, **Oakley (Level 3)**, and
**Tayla (Level 3)**. You only fill in numbers.

> The site updates itself a couple of minutes after you hit **Commit
> changes** each time. You can commit after every event — no need to wait
> until the end.

---

## Part 1 — Entering scores live

### Open the file for editing
1. Go to the repo on GitHub and open the folder **`data`**.
2. Click the file **`content.json`**.
3. Click the **pencil icon** (top-right of the file) to edit it.

### Find today's blocks
Use your browser's Find (on a laptop: `Ctrl`/`Cmd` + `F`) and search for
**`Paul Derda`**. You'll land on the three score blocks — one for each girl.
Each looks like this:

```json
{
  "athlete": "tyndle",
  "date": "2026-05-29",
  "meet": "Paul Derda Gymnastics Meet",
  "location": "Paul Derda Recreation Center, Broomfield, CO",
  "level": "Optional 1",
  "results": [
    { "event": "Vault", "score": "", "placement": "", "note": "" },
    { "event": "Bars",  "score": "", "placement": "", "note": "" },
    { "event": "Beam",  "score": "", "placement": "", "note": "" },
    { "event": "Floor", "score": "", "placement": "", "note": "" }
  ],
  "allAround": "",
  "allAroundPlacement": "",
  "notes": ""
}
```

### Fill in the numbers
Type **between the quote marks** `" "`. Don't remove any quotes, commas, or
brackets — just type inside the empty `""`.

- **`score`** — the judge's number, e.g. `"9.2"`.
- **`placement`** — the award for that one event, e.g. `"1st"`, `"3rd"`, or
  a ribbon color. Leave `""` if there's no award.
- **`note`** — anything about that routine, e.g. `"Stuck the dismount!"`.
  Optional.

Filled-in example for one event:

```json
{ "event": "Beam", "score": "9.0", "placement": "3rd", "note": "Stuck the dismount!" },
```

### All-Around
- **Easiest: leave `"allAround": ""` blank.** The site adds the four event
  scores automatically once all four are filled in (it'll label it
  "auto-summed").
- To use the meet's official number instead, type it in:
  `"allAround": "36.4"`.
- **`allAroundPlacement`** — the AA award, e.g. `"1st AA"`. Optional.

### Whole-meet notes
- **`notes`** — free text about the meet for that girl: standout moments,
  how she felt, anything you want to remember. Optional.

### Save
Scroll to the bottom, type a short message like **"Tyndle vault score"**,
and click **Commit changes**. Repeat as the meet runs — commit after each
event or all at once, your call.

> **If the site shows an error after saving:** you most likely deleted a
> quote or a comma by accident. Open `content.json` again — GitHub usually
> highlights the line. Easiest fix is to re-add the missing `"` or `,`. The
> safe rule: only type *inside* the `""`.

---

## Part 2 — Posting photos and videos

Photos **and** videos go in the same place, the same way.

1. In GitHub, open the **`media`** folder, then the girl's folder, then
   **`gymnastics`**:
   - `media/tyndle/gymnastics/`
   - `media/oakley/gymnastics/`
   - `media/tayla/gymnastics/`
2. Click **Add file → Upload files**.
3. Drag your photos/videos in (or tap to pick from your phone).
4. Type a short message like "Paul Derda meet" and click **Commit changes**.
5. A couple of minutes later they appear on that girl's **Pictures** page.
   Videos show a ▶ play button — tap to watch full-screen.

**Captions** come from the file name. `vault-stuck-landing.jpg` becomes
"Vault stuck landing." Rename files before uploading for nicer captions
(dashes or underscores become spaces).

**File types that work**
- Photos: `.jpg`, `.png`, `.heic` (and `.gif`, `.webp`, `.avif`).
- Videos: `.mp4` (best — what most phones record), `.mov` (iPhone),
  `.m4v`, `.webm`.

### Big videos — read this
GitHub won't accept any single file **over 100 MB**, and we want to keep the
whole archive from getting bloated. So:

- **Short clip of one routine?** Upload it straight to the repo as above.
  Trim long recordings down to just the routine first (your phone's built-in
  trim tool is plenty).
- **A long or large video (a whole session, or anything near/over 100 MB)?**
  Don't put it in the repo. Upload it to **YouTube or Vimeo and set it to
  *Unlisted*** (only people with the link can see it), or to **Google Drive**
  with link-sharing on. Then paste that link into the girl's **memory**
  `text` for the meet, or just drop it in the family Teams channel.

If a video upload gets rejected for size, that's the 100 MB limit — trim it,
or use the Unlisted-link route above.

---

## Quick reference

| I want to… | Do this |
|---|---|
| Enter a score | `data/content.json` → pencil → type inside `""` → Commit |
| Add an event award | fill `placement` on that event |
| Add the AA award | fill `allAroundPlacement` |
| Auto-total the AA | leave `allAround` as `""` |
| Write a meet note | fill `notes` |
| Post photos/videos | `media/<girl>/gymnastics/` → Add file → Upload → Commit |
| Post a big video | upload to YouTube/Vimeo *Unlisted*, paste link in a memory |
