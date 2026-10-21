---
name: Interview
version: 1.1.13
description: "Evidence-grounded work-context refresh: reads the constitutional files and the work TELOS via TelosFreshness, pulls observed work (the issue registry, git cadence), and drives a peer conversation that opens with claim-vs-evidence contradictions, drafts corrections for ratification, and closes with an ideal-state review of work goals. Routes to ContextCheckin; Phase0Setup on fresh install. USE WHEN /interview, resume interview, context check-in, telos check-in, what's stale, stale data, freshness check, update current state, state sync, review TELOS, review work goals, update ideal state, quarterly context refresh, fresh WorkOS install, configure DA name. NOT FOR single edits (Telos), bulk intake (Migrate), identity-only."
disable-model-invocation: true
---

# Interview — constitutional-context peer conversation

## What It Does

Interview reads your constitutional files — the work TELOS, identity, projects, system prompt, architecture — checks their freshness, and confronts stale claims with observed work: the issue registry and git cadence. The conversation opens with the sharpest claim-vs-evidence contradiction, drafts corrections you ratify, and closes with an ideal-state review of your work goals. On a fresh install it falls back to first-time setup.

## The Problem

The files that define your role and what you're working toward at work drift out of date the moment you stop looking at them. A goal you set at the start of the quarter may be done, dead, or still right — but nobody re-reads the whole TELOS to find out, so the context the system runs on slowly rots. The usual fix is a blank "what's your mission?" prompt, which ignores everything already on file and makes you repeat yourself. This skill reads what's there first, flags only what's gone stale, and asks "still right?" instead of starting from zero.

## How It Works

The skill reads the constitutional files via the freshness tooling, scores each section's staleness, and routes to the right workflow — a check-in on a populated system, or first-time setup on a fresh one. Staleness is a priority signal, not a failure flag.

## Workflow Routing

| Workflow | Trigger | File |
|----------|---------|------|
| **ContextCheckin** | default `/interview` on a populated system; "context check-in", "telos check-in", "what's stale", "how are we doing on…", "still on…", "review context" | `Workflows/ContextCheckin.md` |
| **Phase0Setup** | fresh install; DA name still reads "WorkOS"; PRINCIPAL_IDENTITY still reads "User"; PROJECTS sample-row only; `.env` missing required keys | `Workflows/Phase0Setup.md` |

**Routing decision (run before either workflow):**

```bash
bun ~/.claude/WORKOS/TOOLS/InterviewScan.ts --json | jq '[.targets[] | select(.phase == 0 and .completeness_score < 80)] | length'
```

- `> 0` → run **Phase0Setup** first, then ContextCheckin.
- `0` → run **ContextCheckin** directly.

## Quick Reference

- The TELOS is on file. **Read it before asking.** Generic "what's your mission?" prompts are forbidden when TELOS is populated.
- Staleness is **information, not failure** — a 95-day-old Goals section might still be right; the prompt is "still right?", not "you're behind."
- **Per-entry on typed-ID sections** (G3, M0, P2…), **section-level on prose** (Current State, Wisdom).
- **Bump on every approved edit:** `bun ~/.claude/WORKOS/TOOLS/TelosFreshness.ts --bump <slug>`. Without this the staleness signal degrades to noise.
- **Stop signals are sacred.** "Enough" / "stop" / "later" exits gracefully. State persists in the file itself.
- **ID-stability rule:** G3 stays G3 even when edited or dropped; new entries get the next sequential ID.

## Gotchas

- **Migration must run once before freshness works.** A context file without YAML frontmatter (no `last_updated:`) returns `why: "no frontmatter"` and reads as stale. Run `bun ~/.claude/WORKOS/TOOLS/MigrateContextFreshness.ts` once; idempotent.
- **The slug is normalized:** "Current State" → `current_state`, "Wrong (Things I've been wrong about)" → `wrong`. Always run heading text through `sectionSlug()` from `TelosFreshness.ts`.
- **TelosRenderer (`GenerateTelosSummary.ts`) preserves the markers.** It splits by `^## ` headings; the per-section HTML comments live inside the section body and are not re-emitted in `PRINCIPAL_TELOS.md`. Safe to run after edits.
- **The scanner shares the freshness reader.** `InterviewScan.ts` calls `readTelosFreshness()` once at startup and adds `age_days`, `threshold_days`, `stale` to every Phase 1+ target row. Stale sections get a +200 priority bump so they naturally rise in `--next` output.
- **The work registry is the local ledger.** Read it with `bun WORKOS/TOOLS/WorkLedger.ts list --json`; an empty or missing ledger means the evidence pass falls back to git history and the files — say so rather than implying the registry was checked. Jira/GitLab context (`WorkContext.ts summary`) is read-only and may be off.

## Examples

- "/interview" on a populated system → routing probe via `InterviewScan.ts`, then ContextCheckin walking the stalest sections first ("G2 is 95 days old — still right?").
- "what's stale?" → freshness summary from TelosFreshness, prioritized list, no edits unless approved.
- Fresh install (DA name still "WorkOS", PROJECTS sample-row only) → Phase0Setup first, then ContextCheckin.

## Related

- `/Telos` — edit a single TELOS section directly (without the conversational walk).
- `/Migrate` — intake content from other sources (one-shot classification, not an interview).
- an identity-profile skill — manage PRINCIPAL_IDENTITY directly.
- `Skill("ISA")` — interview an ISA (different artifact, different workflow).
