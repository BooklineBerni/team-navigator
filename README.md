# Berni Navigator

Task & roadmap manager for the Bookline team. Static single-page app deployed
to GitHub Pages, no build step. Auth via Google + Supabase. Data persisted to
`localStorage` with cloud sync to a per-user Supabase row.

- **Live:** https://booklineberni.github.io/berni-navigator/
- **Admin:** `bernat@bookline.ai`
- **Stack:** vanilla JS + classic `<script>` tags, Supabase (auth + Postgres),
  Playwright for the smoke test, GitHub Actions for CI + Supabase migrations.

## Repo layout

| Folder | What's in it |
|--------|--------------|
| `data/` | Constants (team directory, Slack users) |
| `styles/` | All CSS (`app.css`) |
| `lib/` | Shared infrastructure: auth, permissions, filter predicates, pickers, file/requests integrations, date picker |
| `views/` | One file per sidebar tab (home, files, requests, tasks, team, profile, roadmaps, roadmap-calendar, bulk-create) |
| `views/modals/` | Modal dialogs (person tags, add member, tag manager, subtasks, task tag manager) |
| `tests/` | Playwright smoke test (runs on every push via CI) |
| `supabase/migrations/` | DB schema, applied via GH Actions |
| `index.html` | App shell + the parts of the JS that have to stay inline (STORE bootstrap, render dispatcher, anchor helpers, task modal, etc.) |

## Developing

The app loads as a static page — no install or build step. To run the smoke
test locally you need Node + Chromium:

```bash
npm install
npx playwright install chromium
npx playwright test
```

## Architecture & gotchas

Before touching the code, **read [CLAUDE.md](./CLAUDE.md)**. It documents the
script load order, the `let`-isn't-on-window trap, the `</script>`-in-comments
trap, how to extract a new view, how filters work, and the deuda técnica
that's been left in place on purpose.
