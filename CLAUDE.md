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

## Two layers — who each is for
The site has two distinct audiences; keep them separate.
- **Layer 1 — the main site** (tiles from the home page: the girls, Family
  archive, scores/pictures/places/memories). This is the *shared* family
  layer, built for the extended circle — parents, siblings, grandparents —
  to follow the girls' memories and successes. Warm, editorial, meant to be
  shown off.
- **Layer 2 — the Family Portal** (the red **M** badge in the header →
  `#/portal`; data in `data/meals.json`, `data/supplies.json`, etc.). This is
  the "underground," *private household* side — just for the parents (the
  user and Brandi): meals, school supplies, budgets, and day-to-day family
  logistics. Not for the extended family.
- The portal doubles as a gentle on-ramp for getting **Brandi comfortable
  with Claude/AI**, so keep it genuinely simple and inviting to use — low
  friction, plain language, nothing intimidating. Favor approachability over
  cleverness when building portal features.

## House style
- Editorial / family-keepsake tone, not childish or sports-bro.
- Don't introduce frameworks, build systems, or backends. Pages must stay
  plain HTML/CSS/JS so the family can edit JSON by hand on GitHub.
- All content edits happen in `data/content.json` and `data/athletes.json`.
  `data/gallery.json` is rebuilt by `build.py` from `media/` — never hand-edit.
- Photos that aren't tied to one girl (venues, group shots) go in
  `media/_venues/` or another `_`-prefixed folder; `build.py` skips those
  so they don't pollute per-girl galleries.
