# ContextCheckin — full constitutional-context peer conversation

**Purpose:** Open `/interview` by reading the freshness signal across every constitutional context file (the work TELOS plus the other files that load at session start), surface the most-stale items as one of the most important things to look at, and drive a contextual peer conversation grounded in what's actually written. This is the default workflow on a populated system.

For fresh installs (DA name still "WorkOS", placeholder identity, sample-row PROJECTS), route to **Phase0Setup** instead.

---

## Notification

Output: `Running the **ContextCheckin** workflow in the **Interview** skill...`

---

## Step 1 — Read freshness AND work evidence BEFORE asking anything

Three readers. All at the start. The context is on file; we ground every prompt in it — never in what we'd ask if we had no idea.

```bash
bun ~/.claude/WORKOS/TOOLS/TelosFreshness.ts --json          # per-section work TELOS
bun ~/.claude/WORKOS/TOOLS/TelosFreshness.ts --context       # constitutional files (identity, projects, system prompt, derivatives)
bun ~/.claude/WORKOS/TOOLS/InterviewScan.ts --json           # the combined, prioritized target list
```

`InterviewScan.ts --json` produces the combined list already prioritized — TELOS sections and constitutional files share the same conceptual surface from the principal's view. Prefer it over hand-merging. Sort most-stale-first by days-over-threshold.

**Work evidence.** The observed side of the review is the work itself. Pull it before reviewing Goals, Projects, or Current State:

```bash
bun ~/.claude/WORKOS/TOOLS/WorkLedger.ts list --json        # the work registry (local ledger, open items)
git -C <project-path> log --since="30 days ago" --oneline      # commit cadence per project in PROJECTS.md
```

Open items are CANDIDATES for the review: goal items (type `goal`, slug `goal:GN`) must agree with the TELOS Goals section — a goal marked achieved in the interview closes its goal item in the same motion (`WorkLedger.ts close <id>`), and an open goal item for a dead goal is a contradiction to surface. Session/project-check items are evidence of what's actually being worked on, so the "anything missing from Projects?" prompt argues from them instead of asking blind. When the ledger is empty or missing, skip the registry read and say so.

### Step 1.5 — The evidence pass

For every stale Goals, Projects, or Current State item, put the file's claims and the observed work side by side BEFORE asking anything. The lead is the sharpest **contradiction** — a written claim the work refutes or confirms-out-of-date — not merely the oldest file:

> "**PROJECTS.md** (last reviewed {N}d ago) lists *'{project}'* as active. Its repo has {k} commits in the last 30d and the registry shows {m} open issues for it. Still active, or retire the row? Here's the corrected line: *'{draft}'*. Take it, edit it, or leave it?"

Rules for the evidence pass:

- **Dates on both sides, always.** A claim without its review date and a metric without its observation window can't be honestly compared.
- **Confirmation matters as much as contradiction.** A claim the work confirms gets "still true, want the numbers in the file?"
- **Name what's checkable.** A claim with no repo or registry behind it can be asked, not checked — say so instead of implying verification.

If `readContextFreshness()` reports a file with `why: "no frontmatter"`, the migration hasn't been run on that file. Stop and prompt: *"<file> doesn't have the freshness convention yet. Want me to run `bun ~/.claude/WORKOS/TOOLS/MigrateContextFreshness.ts` first?"*

If `readContextFreshness()` reports a file with `why: "source missing"`, the file's `derived_from:` source doesn't have a freshness signal — the derivative can't inherit one. Surface this to the principal: *"<file> derives from <source> which has no freshness frontmatter. Want me to add it?"*

---

## Step 2 — Open with the most-stale item as the lead

Staleness is **one of the most important things to surface** — but it's a peer check-in, not scolding.

Pick the highest-priority stale item across both axes (constitutional files + TELOS sections). Read its actual content via `Read` before asking. For derived files (PRINCIPAL_TELOS, ARCHITECTURE_SUMMARY), Read the SOURCE file instead — that's where the review actually lands.

Opening shape:

> "I read your context. **<File or section>** hasn't been touched in **{N}d** (threshold {T}d). It says: *'{first 80–120 chars}'*. Still right? Want to update it?"

If multiple stale items, surface the top 2-3 and let the principal pick:

> "Three things to look at: PROJECTS.md (47d/30d), system prompt (112d/90d), Goals (38d/30d). PROJECTS first?"

If everything is fresh:

> "All constitutional files within thresholds. Anything you want to revisit anyway, or pick a section to deepen?"

**Forbidden when context is populated:** generic prompts like "What's your mission?" or "Tell me about your goals." The files are on disk. Reference them.

---

## Step 3 — The contextual conversation loop

For each stale (or principal-selected) item:

### 3a. Read the file or section content

Always `Read` the file's actual content (or the source for derived files) before asking. **Asking without reading first is the failure mode this workflow exists to fix.**

For TELOS sections: pass the line range — start at `section.line + 2` (skip heading + marker), continue until the next `## ` heading.

For constitutional files: read the full file (most are <300 lines).

For derived files: read the SOURCE — `PRINCIPAL_TELOS` review goes to `TELOS.md`, `ARCHITECTURE_SUMMARY` review goes to `WorkosSystemArchitecture.md`. Update the source; the derivative regenerates.

### 3b. Pick the right register based on file/section type

**TELOS sections with typed-ID entries** (Goals → G0+, Problems → P0+, Mission → M0+, Beliefs → B0+, Models → MO0+, Frames → FR0+, Narratives → N0+, Challenges → C0+) — get **per-entry contextual prompts**:

> "**G3** says: *'{first sentence}'*. Where are we on this?"
> "**M0** is the professional mission — *'{first sentence}'*. Still the right framing, or has it shifted?"

**TELOS sections without typed IDs** (Current State, Ideal State, Wisdom, Wrong) — section-level prompts:

> "Current State says: *'{first three lines}'*. What's actually true at work today — role, team, systems you own?"

**Constitutional files** — file-level review prompts targeted to the file's purpose:

- **DA_IDENTITY.md** — personality, autonomy boundaries: *"You're 47d into the DA identity threshold. Still seeing peers, not commander/executor? Anything new about the working dynamic that should land here?"*
- **PRINCIPAL_IDENTITY.md** — name, role, team, focus: *"Identity hasn't been touched in {N}d. Quick Reference says you're at {role}. Still right?"*
- **PROJECTS.md** — project registry + routing aliases: *"PROJECTS at {N}d. Any new projects to add, or finished projects to retire? Routing aliases still match how you refer to things?"*
- **WORKOS_SYSTEM_PROMPT.md** — constitutional rules: *"System prompt at {N}d. Want to review the operational rules section, or is anything constitutional pending?"* (for this file especially, default to surfacing rather than editing — this is the most load-bearing file in the system).
- **PRINCIPAL_TELOS.md / ARCHITECTURE_SUMMARY.md** (auto-generated) — never edit directly. Route to the source file: *"PRINCIPAL_TELOS derives from TELOS.md — going there. TELOS.md last touched {N}d ago."*

### 3c. Listen, then write

The principal answers in natural language. The DA formats the answer into the file's structure:

- For typed-ID entries: preserve the ID, edit the entry text, never re-number.
- For prose sections / files: edit in place, preserve heading + marker line + frontmatter.
- For new entries: append at the next sequential ID.
- For deletions: leave a tombstone (`- [ ] G3: [DROPPED — see Decisions YYYY-MM-DD]`).
- For constitutional files: surgical edits only; backup first if rewriting ≥50% of any section.

Use the `Edit` tool with precise `old_string`/`new_string`.

### 3c.5 — Ratification is the write gate (hard rule)

No claims file — TELOS.md or a constitutional file — is written without the principal approving that specific edit in this conversation. Drafts are shown in full before landing. If a draft is declined, nothing lands and nothing is queued.

### 3d. Bump the review marker on every approved edit

`last_reviewed:` is the freshness clock — explicitly distinct from `last_updated:`,
which migrations and auto-generators also bump. The statusline FRESH line and the
A-F freshness grade are computed from `last_reviewed:`. Only this
workflow (and equivalent principal-driven review flows) should call it.

```bash
# TELOS section — section-level marker
bun ~/.claude/WORKOS/TOOLS/TelosFreshness.ts --bump <slug>

# Constitutional file — review marker
# (NOT bumpContextTimestamp; that's for writes)
bun -e "import { bumpReviewedTimestamp } from '$HOME/.claude/WORKOS/TOOLS/TelosFreshness'; console.log(bumpReviewedTimestamp('<absolute-path>', 'user'))"
```

A walk of a file that ends in "still right" with no edit counts as a review — bump it anyway.

Without this, files stay at grade F forever because no other path sets `last_reviewed:`.

### 3e. Move on, respect stop signals

> "Anything else for {file/section}, or move to {next stale item}?"

The principal can say "next", "skip", "enough", "stop", "later" at any prompt. Honor it immediately. State persists in the files themselves; there's no separate session to save.

---

## Step 3.75 — The ideal-state leg (offer, never force)

After the current-state pass — or immediately if the principal asks for it — offer a review of the TELOS `## Ideal State` and `## Goals` sections against what the work evidence from Step 1 shows. Put the observed state beside each target yourself:

> "**Ideal State** says you want to own {system} end to end by {date}. Today: {k} of the open issues for it are assigned to you, and {other team} still owns the deploy. Still the target, or re-baseline?"

Re-affirming without edits still bumps the review marker. Declining the whole leg ("later") is a stop signal like any other.

---

## Step 4 — Wrap with a freshness summary

When the principal says enough:

```bash
bun ~/.claude/WORKOS/TOOLS/TelosFreshness.ts        # final TELOS state
bun ~/.claude/WORKOS/TOOLS/ContextAudit.ts          # content quality findings (read-only)
```

Summarize:

> "Reviewed {N} items, edited {M}. {K} things still stale — top one is {name} at {age}d. {audit findings count} content-quality findings in AUDIT.md. Pick that one up next time, or call it done."

Regenerate the auto-derived files so future sessions pick up source changes:

```bash
bun ~/.claude/WORKOS/TOOLS/GenerateTelosSummary.ts 2>/dev/null || true
bun ~/.claude/WORKOS/TOOLS/ArchitectureSummaryGenerator.ts generate 2>/dev/null || true
```

---

## Rules

- **Read context before asking. No exceptions.** Generic "what's your mission?" / "describe your projects" prompts are forbidden when files are populated.
- **Evidence before age.** When a stale item has work evidence behind it, the opening is claim-vs-evidence with dates on both sides — file age alone is the fallback, not the lead.
- **Ratification is the write gate.** No claims file changes without the principal approving that edit in-conversation.
- **Name what's checkable.** Claims with no repo or registry behind them are asked, never "verified".
- **Per-entry on typed-ID TELOS sections, file-level on constitutional files, source-targeted on derived files.**
- **Staleness is information, not failure.** A 95-day-old file might still be right. The prompt is "still right?", not "you're behind."
- **One question at a time.** Never dump three prompts in one turn.
- **Bump on every approved edit.** Use `bumpTelosTimestamp` for TELOS sections and `bumpReviewedTimestamp` for constitutional files — they update the per-section marker and the `last_reviewed:` field that drives the A-F grade. `bumpContextTimestamp` is for file writes (auto-generators, migrations) and does NOT count as review.
- **Stop signals are sacred.** "Enough" / "stop" / "later" exits gracefully. State is the file.
- **ID-stability rule.** G3 stays G3 even when edited or dropped. New entries get the next sequential ID.
- **Constitutional files: surgical edits only.** Never rewrite identity, system prompt, or projects unilaterally — surface findings via ContextAudit, edit only with explicit per-edit approval.
- **Auto-generated files are never edited directly.** Route every review of PRINCIPAL_TELOS to TELOS.md; route ARCHITECTURE_SUMMARY review to WorkosSystemArchitecture.md.

---

## Examples

### Opening on a system with stale system prompt

```
read freshness ⇒ workos_system_prompt 112d/90d (most stale across both surfaces)
Read WORKOS/WORKOS_SYSTEM_PROMPT.md fully
```

> "I read your context. **WORKOS_SYSTEM_PROMPT** hasn't been touched in **112d** (threshold 90d). The Hard Prohibitions section says: *'Never self-rate responses or add unsolicited ratings. Never modify working features unprompted. Analysis means read-only…'* Still want all three of those, or has anything changed in how you want me to operate?"

### Opening when everything is fresh except an audit finding

```
read freshness ⇒ all fresh
read AUDIT.md ⇒ critical: PROJECTS.md at 82 lines exceeds declared 45-line budget
```

> "Everything within freshness thresholds. One audit finding: PROJECTS.md is 82 lines, which is 82% over its declared 45-line budget. Want to trim, raise the budget, or split active state into a load-on-demand file?"

### Per-entry conversation on Goals

```
G3 stale (38d/30d)
Read TELOS.md lines 252-296
```

> "**G3** says: *'Migrate the settlement service to the new message bus this quarter.'* The registry shows 4 of 9 migration issues closed. Where are we?"

Principal: "Consumers are done, producers are blocked on the schema review."

```
Edit G3 with current-state context
bun TelosFreshness.ts --bump goals
```

> "Updated G3 with the blocker. **G7** is *'Lead the next sprint demo.'* — is that still on, or did it move?"

---

## Failure modes

- **Migration not run yet.** First call to `readContextFreshness()` returns one or more files with `why: "no frontmatter"`. Run `bun ~/.claude/WORKOS/TOOLS/MigrateContextFreshness.ts` once before continuing.
- **Empty or missing work ledger.** Skip the registry read, say so, and argue from git history and the files alone.
- **Source missing for a derived file.** `architecture_summary` may show `why: "source missing"` if `WorkosSystemArchitecture.md` has no `last_updated` frontmatter. Surface to the principal; offer to add it.
- **Slug not found by bumpTelosTimestamp.** Returns `sectionFound: false`. Re-check `sectionSlug(headingText)`.
- **Principal goes silent mid-section.** Treat the same as "stop" — wrap with the freshness summary and exit.
