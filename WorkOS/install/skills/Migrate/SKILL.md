---
name: Migrate
version: 1.0.11
description: "Intakes external content, classifies chunks against WorkOS taxonomy, commits with provenance. Sources: .md/.txt, stdin, WorkOS dirs, CLAUDE.md/Cursor/OpenAI Custom Instructions, Obsidian/Notion exports. MigrateScan classifies → routing table. MigrateApprove with --approve-all/--approve-target/--review/--dry-run. Confidence ≥70% auto, 40-70% confirm, <40% walk-through. USE WHEN /migrate, migrate content, import from other WorkOS, bring in old work notes, import Cursor rules, import CLAUDE.md, bulk import, Obsidian/Notion import. NOT FOR single-file edits, conversational interviews, identity edits."
disable-model-invocation: true
---

# Migrate — external-content intake and classification

## 🚨 MANDATORY: Notification

Output: `Starting the migration. Scanning source and classifying chunks...`

## What It Does

Migrate intakes external content, classifies each chunk against the WorkOS taxonomy, and commits it to the right destination with provenance. Sources include `.md`/`.txt` files, stdin, other WorkOS installs, agent-harness rule files (CLAUDE.md, Cursor rules, OpenAI Custom Instructions), and Obsidian/Notion exports. Classification confidence drives the flow: high-confidence chunks auto-approve, medium ones ask for confirmation, low ones get a walk-through.

## The Problem

When you adopt WorkOS you usually arrive with years of accumulated work notes — a CLAUDE.md, a vault of markdown, design notes, rules from another tool — and none of it maps cleanly onto WorkOS's structure. Sorting hundreds of chunks into TELOS sections, knowledge notes, and operational rules by hand is the kind of tedious work that never gets done, so the old material just sits there unused. Migrate does the sorting: it reads the content you already have, proposes a destination for every chunk with a confidence score, and lets you approve in bulk or review the uncertain ones, attaching provenance so nothing lands in TELOS without attribution.

## How It Works

Migrates content into the WorkOS structure from external sources. Unlike `/interview` (which asks the user questions to fill gaps), `/migrate` **already has the content** — it just needs to classify each chunk and route it to the right WorkOS destination. MigrateScan classifies into a routing table; MigrateApprove commits per the user's chosen path.

### Sources supported in V1

- **Files:** `.md`, `.markdown`, `.txt` (single file or directory recursion)
- **Stdin:** piped content or pasted directly
- **Other WorkOS installs:** point at their `USER/TELOS/` or `MEMORY/KNOWLEDGE/` directories
- **Agent-harness rule files:** `CLAUDE.md`, `.cursorrules`, OpenAI Custom Instructions export
- **Exports:** Obsidian vaults (markdown), Notion exports (markdown), plain-text note dumps

### What it classifies chunks into

| Category | Destinations |
|---|---|
| **Work TELOS** | H2 sections of the unified `USER/TELOS/TELOS.md`, labelled `TELOS.md#<Section>`: Mission, Goals, Problems, Strategies, Challenges, Wisdom, Models, Narratives, plus optional Beliefs/Frames (appended as a new section if absent) |
| **Identity** | USER/PRINCIPAL/PRINCIPAL_IDENTITY.md |
| **Knowledge** | MEMORY/KNOWLEDGE/{Ideas,People,Companies,Research} |
| **AI collaboration rules** | Walk-through to a constitutional surface — CLAUDE.md operational rules, a hook, `settings.json`, or the relevant skill's Gotchas ("always do X" / "never Y" patterns are system patches, never harness `memory/feedback_*.md` memos) |
| **Unclear** | Flagged for the user's manual routing |

## Workflow Routing

No `Workflows/` directory — the single migration procedure runs inline through Phases 1–6 below, backed by two tools in `WORKOS/TOOLS/`.

| Trigger | Workflow | File |
|---------|----------|------|
| /migrate, migrate content, bulk import, import from other WorkOS, import CLAUDE.md / Cursor rules / Obsidian / Notion export, bring in old notes | Inline Phases 1–6 (identify → scan → route → approve → UNCLEAR → summary) | `WORKOS/TOOLS/MigrateScan.ts` + `WORKOS/TOOLS/MigrateApprove.ts` |

## Workflow

### Phase 1 — Identify the source

Ask the user what they want to migrate:

- "Paste the content here and I'll work from stdin"
- "Point me at a file path"
- "Point me at a directory and I'll scan everything inside"
- "I have a Cursor rules file at ~/Projects/X/.cursorrules"
- "My old WorkOS install has its work notes at ~/old-claude/MEMORY/KNOWLEDGE/"

Collect the source path. If content is pasted, write it to a temp file first.

### Phase 2 — Scan

Run the scanner:

```bash
bun ~/.claude/WORKOS/TOOLS/MigrateScan.ts --source <path>
# or
echo "$CONTENT" | bun ~/.claude/WORKOS/TOOLS/MigrateScan.ts --stdin
```

Scanner output includes:
- Total chunks found
- Proposed routing table (how many chunks per target)
- Average classification confidence
- Count of UNCLEAR chunks
- Count of low-confidence (<40%) chunks

### Phase 3 — Present routing summary

Show the user the routing proposal in a scannable format:

```
Found 47 chunks from 3 files. Proposed routing:

  📂 TELOS.md#Goals              12 chunks  (78% avg confidence)
  📂 TELOS.md#Wisdom              8 chunks  (65% avg confidence)
  📂 TELOS.md#Beliefs             6 chunks  (71% avg confidence)
  📂 MEMORY/KNOWLEDGE/Ideas      15 chunks  (52% avg confidence)
  🧠 AI collaboration rules       4 chunks  (walk-through: CLAUDE.md / hook / skill)
  ❓ UNCLEAR                      2 chunks  (needs your call)

Options:
  - Approve everything trusted (confidence ≥60%)?
  - Walk through the low-confidence and UNCLEAR chunks one by one?
  - Review specific categories?
  - Review everything?
```

### Phase 4 — Approval loop

Based on the user's preference:

**Fast path** (they say "approve all trusted"):
```bash
bun ~/.claude/WORKOS/TOOLS/MigrateApprove.ts --approve-all
```
Commits everything non-UNCLEAR. Then walk through UNCLEAR chunks conversationally.

**Category path** (they say "approve goals and wisdom, skip knowledge"):
```bash
bun ~/.claude/WORKOS/TOOLS/MigrateApprove.ts --approve-target "TELOS.md#Goals"
bun ~/.claude/WORKOS/TOOLS/MigrateApprove.ts --approve-target "TELOS.md#Wisdom"
```

**Walk-through path** (they want careful review):
```bash
bun ~/.claude/WORKOS/TOOLS/MigrateApprove.ts --review
```
Show each pending chunk. For each:
- Show preview + proposed target + confidence + alternatives
- Ask: approve / modify target / reject
- Commit decision

### Phase 5 — Handle UNCLEAR chunks

UNCLEAR chunks are ones where no classification rule matched strongly. For each:
- Display full content (not just preview)
- Ask the user: "This one's unclear — what is it? Could be X, Y, Z, or maybe Knowledge/Ideas as a catch-all?"
- the user chooses → commit via `--modify <id> --target <chosen>`

### Phase 6 — Completion summary

After approval pass:
- Report total chunks committed, per-target count
- Flag any remaining UNCLEAR
- Recommend next step: run `/interview` to interview around anything the migration left sparse

## Rules

- **Every commit carries provenance.** The committed content includes an HTML comment noting source file + section + timestamp. Nothing gets dropped into TELOS without attribution.
- **Never bulk-approve UNCLEAR.** Those require the user's explicit routing.
- **Confidence thresholds:** ≥70% = trusted (auto-approve eligible). 40-70% = medium (show for confirmation). <40% = low (walk-through required).
- **Ask before touching identity.** PRINCIPAL_IDENTITY.md commits always prompt — that file is load-bearing.
- **Don't duplicate.** If the same content already exists in the target (substring match), flag it and ask before appending.
- **Rules never go to harness memory.** AI collaboration rule chunks are always walked through one by one and routed to a constitutional surface: an operational rule in CLAUDE.md, a hook, a `settings.json` permission, or the relevant skill's Gotchas. Writing them to the harness `memory/feedback_*.md` directory is forbidden — every feedback memo is a missed system patch (see the system prompt's "Override of harness auto-memory").
- **Knowledge gets new files too.** Each `MEMORY/KNOWLEDGE/*` chunk becomes a new typed note with source metadata.

## Examples

### User: `/migrate ~/old-claude/MEMORY/KNOWLEDGE/`

the DA scans the old knowledge directory, classifies every chunk, presents the routing summary, offers fast-path vs. walk-through approval.

### User: `/migrate` (then pastes CLAUDE.md content)

the DA reads from stdin, classifies most chunks as AI collaboration rules (walked through to CLAUDE.md / hooks / skill Gotchas) plus maybe PRINCIPAL_IDENTITY (if identity lines are mixed in), walks through approval.

### User: "migrate my Cursor rules at ~/.cursor/rules"

the DA scans the rules dir, surfaces likely rule classifications, walks each through to its constitutional destination with extra care (Cursor rules often have tool-specific stuff that doesn't translate to WorkOS).

### User: "import the design notes I dumped in /tmp/notes.md"

the DA scans the notes, expects a lot of UNCLEAR + Knowledge/Ideas + WISDOM, walks through each section.

## Related

- `/interview` — fills gaps by asking questions (not by intaking existing content)
- `/Telos` Update workflow — edit a single TELOS section directly
- `/Knowledge` — manage the Knowledge Archive
- an identity-profile skill — manage PRINCIPAL_IDENTITY

## Gotchas

- **Low average confidence (<40%):** the source is probably genre-mismatched (e.g., code comments, logs, raw data). Consider pre-filtering to remove non-prose chunks before scanning.
- **Everything goes to UNCLEAR:** the source probably has no recognizable WorkOS-taxonomy patterns. Either add the content manually via `/Telos` or write it as general Knowledge notes.
- **Duplicate content warnings:** the scanner doesn't dedupe against existing files yet. Run `--dry-run` first to preview before committing.
