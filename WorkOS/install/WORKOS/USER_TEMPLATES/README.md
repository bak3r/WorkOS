---
category: ops
kind: reference
publish: false
provenance: template
last_updated: 2026-05-03
---

# USER/ Templates

This directory ships with every WorkOS release. Each `*.md` file is a starter scaffold for one file under `WORKOS/USER/`.

## How to use

1. Copy a template into `USER/` (without `_TEMPLATES/`):
   ```bash
   cp WORKOS/USER_TEMPLATES/Goals.md WORKOS/USER/Goals.md
   ```
2. Edit the file. Add your own content, then flip `provenance: template` → `provenance: customized` in the frontmatter.
3. Or delete the template and write your own from scratch.

## What the frontmatter does

- `provenance: template` — public release pipeline INCLUDES this file in the next release. Anyone running WorkOS gets the same starter content.
- `provenance: customized` — pipeline EXCLUDES this file. Your edits stay private.

Programmatic writers (the memory reviewer, ProposalGC) flip `template` → `customized` for you via `TelosFreshness.stampContextWrite`. A hand edit should flip it by hand.

## Adding a new template

1. Create the template here under a clear name.
2. Give it the same frontmatter shape (`category`, `kind`, `publish`, `review_cadence`, `provenance: template`, `last_updated`).
