---
last_updated: 2026-06-13T01:30:00Z
last_updated_by: da
convention: pai-freshness-v1
version: 1.0.5
---

# RenamePlan — PAI → WorkOS

<!-- The title above quotes the RETIRED mark on purpose (public issue #1554,
     @loudoguno): a 2026-07-04 blind prose sweep rewrote this doc's own title
     to "WorkOS → WorkOS". Rename sweeps must exclude this file's title and
     retired-mark quotations — a rename doc has to be able to name the thing
     it renamed. -->


> The staged plan for renaming the system and (eventually) the public repo to **WorkOS**. The machine-readable companion is `RenameMap.json` in this directory — rename tooling AND the privacy/scrub gates consume that file, never hardcoded token lists.

## The one rule

**A half-rename is a silent privacy regression, worse than breakage.** A scrub gate that greps for a token that no longer exists passes vacuously. Every rename stage therefore updates the gates in the same change, off `RenameMap.json`.

## Status

| Wave | Scope | Status |
|------|-------|--------|
| **Casing standardization** | `WorkOS` prose standard (retire `Work OS`, keep `WorkOs` for PascalCase files only) | DONE 2026-06-13 (core files; fleet wave with rename-now) |
| **Rename-now (framing)** | Docs prose/branding (class 1), UI display strings (class 2 minus logo asset), core identity files (system prompt, CLAUDE.md, thesis, architecture master) | IN PROGRESS 2026-06-13 |
| **Rename-at-cut** | `WORKOS/` dir + ~4K path refs (compat symlink), `PAI_*` env keys (read-fallback shims), the core management skill via CreateSkill, repo URLs (the GitHub rename IS the cut), mode banners + hook regexes, logo asset | QUEUED — gated on cut preconditions |
| **Post-cut optional** | Code identifiers (194 occurrences) | QUEUED — mechanical, can lag indefinitely |

## What changed now (framing wave)

- WorkOS is the primary identity in WORKOS_SYSTEM_PROMPT.md, CLAUDE.md, WorkOsThesis.md, WorkosSystemArchitecture.md (+ regenerated ARCHITECTURE_SUMMARY.md) — zero rule/gate/template semantics changed; the three mode-banner literals stay byte-identical until the cut (pinned by OutputFormatGate + DriftReminder hooks).
- Docs subsystem intros tie each subsystem to the current→ideal-state loop.

## Cut preconditions (all must hold — see RenameMap.json `cut_preconditions`)

1. The WorkOS install is demonstrably healthy and running — the rename is then a formality, not a migration.
2. In-flight forks reconciled: `.claude-fable` v7, skill-only shadow release (release root = `WorkOS/` skill only, no full `.claude/` clone and no root `install.sh`), 5.0.0/5.1.0 shadow releases.
3. Scrub gates read RenameMap.json programmatically.
4. Rehearsal in a `CLAUDE_CONFIG_DIR` clone passes its migration ISA (per-path probes: symlink chain intact, two-repo sync green, statusline rendering).
5. GitHub rename redirect verified (stars + clone URLs survive); never create a new repo named WorkOS afterward.

## Cut-day runbook (summary)

1. Freeze: no other sessions; checkpoint commit both private repos.
2. Atomic GitHub rename of the public repo (separate decision/moment from the private-tree changes; public repo content changes remain out of scope until then).
3. Private tree: `WORKOS/` → new dir name in one operation + `WorkOS → <new>` compat symlink; env shims in; systemd units rewritten + restarted; settings.json paths swept; banners + hook regexes + tests changed in one coordinated commit.
4. Sweep classes 6/7 (repo URLs, core management skill rename via CreateSkill).
5. Probe pass: migration ISA per-path probes + `bun test` (hooks/ cwd) + a probe on every WorkOS machine in the fleet.
6. Shadow-release restage + 14 gates against the renamed tree before any future public publish.
