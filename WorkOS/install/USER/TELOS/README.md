---
provenance: template
---

# TELOS — Your Work Goals

> 🎯 SAMPLE TEMPLATES — This directory ships as a SAMPLE with placeholder entries marked `(sample)`. It shows the SHAPE of populated TELOS data. Run `/interview` (or talk to your DA) to replace the samples with your real work context.

TELOS is your professional "why." It describes where you stand at work, where
you want to get, what is in the way, and how you plan to handle it. WorkOS
reads it at every session start so the DA understands the context behind any
task you ask for.

## The one file that matters

**`TELOS.md` is the single source of truth.** Everything lives in that one
file, organized as `##` sections: Current State, Ideal State, Mission,
Problems, Goals, Challenges, Strategies, Projects, Narratives, Models, Wrong,
Wisdom, Context Filter (plus optional Beliefs, Frames, Predictions).
`GenerateTelosSummary.ts` parses those sections, and `TelosFreshness.ts` tracks
the `<!-- updated: YYYY-MM-DD by:who -->` markers you can leave on each section.

| File | What it is |
|------|------------|
| `TELOS.md` | **The canonical work TELOS.** All sections in one file. Edit this one. |
| `PRINCIPAL_TELOS.md` | **Auto-generated summary** of `TELOS.md`. Loaded into every session via CLAUDE.md. Never edit by hand. |
| `Backups/` | Versioned snapshots. Tools that bulk-edit TELOS write a backup here first. Empty until something is backed up. |

## How to fill it in

**Easiest:** run `/interview` after install. Its work-goals step asks about
your role, team, goals and challenges and writes the answers to `TELOS.md`.

**By hand:** open `TELOS.md`, delete the `(sample)` entries and write your own
under each `##` heading. Keep the headings — the generator reads them. Keep
entries short and high-signal; the DA reads this at session start.

## Regenerate the summary

Whenever you edit `TELOS.md`, regenerate the summary:

```bash
bun <configRoot>/WORKOS/TOOLS/GenerateTelosSummary.ts
```

## Privacy

This directory ships only as a bootstrap scaffold of samples. What you write
here stays inside your config tree and never leaves the machine.
