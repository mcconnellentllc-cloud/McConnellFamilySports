# Face reference set

The sync pipeline uses these folders to suggest which McConnell girl is
in each newly synced photo. **Suggestions only** — the Review tray
shows the highest-confidence guess pre-selected, but you confirm
manually before anything is filed.

## What to put here

For each girl, drop **3–5 clear photos** of just her face into her
folder:

- `media/_faces/tyndle/`
- `media/_faces/oakley/`
- `media/_faces/tayla/`

Photo guidelines:

- **Face the camera, eyes open**, neutral or smiling. Avoid harsh
  shadows or sunglasses.
- A range of angles (straight-on, slight side, recent + older) helps
  the model generalize. Mix indoor/outdoor light.
- **One face per photo.** If a group photo is unavoidable, crop the
  others out first.
- File names don't matter — `01.jpg`, `school-portrait.jpg`, anything
  works. The folder is what assigns the girl.

## When to refresh

Kids change. Re-upload a fresh set every season or so, especially
when haircuts, growth, or braces noticeably change a face. The newer
the reference photos relative to the synced photos, the better the
suggestions.

## File naming and privacy

These photos live in this public repo (see `SETUP-AZURE.md` for the
public-repo privacy note). If you'd rather keep face references
out of public view, switch the repo to Private + GitHub Pro.

## What if these folders are empty?

The sync still runs. Photos with no face suggestion just land in
the Review tray with no girl pre-selected — you sort them by hand.
The pipeline never crashes on missing references.
