# Project preferences for Claude Code sessions on this repo

## Workflow
- **Always merge.** When changes are ready and pushed to a feature branch,
  open a PR and squash-merge it into `main` without asking. The user has
  granted standing permission for this — do not pause for approval on each
  merge.
- Keep developing on the designated feature branch
  (`claude/mcconnell-sports-site-1ErWX` or whatever branch is current), then
  PR → squash-merge → main. The deploy workflow on `main` publishes to
  GitHub Pages.

## Site URL
- Production: `https://mcconnellentllc-cloud.github.io/McConnellFamilySports/`
- Password: stored as a SHA-256 hash in `assets/app.js` (`PASSWORD_HASH`).
  Never paste the plaintext password into commits, PR bodies, or other
  repo artifacts.

## House style
- Editorial / family-keepsake tone, not childish or sports-bro.
- Don't introduce frameworks, build systems, or backends. Pages must stay
  plain HTML/CSS/JS so the family can edit JSON by hand on GitHub.
- All content edits happen in `data/content.json` and `data/athletes.json`.
  `data/gallery.json` is rebuilt by `build.py` from `media/` — never hand-edit.
- Photos that aren't tied to one girl (venues, group shots) go in
  `media/_venues/` or another `_`-prefixed folder; `build.py` skips those
  so they don't pollute per-girl galleries.
