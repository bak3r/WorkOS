---
last_updated: 2026-08-08
last_updated_by: da
last_reviewed: 2026-08-08
last_reviewed_by: da
convention: pai-freshness-v1
version: 1.4.3
---

# Hook System

> Hooks are why the WorkOS runs when nobody is looking. The thesis (`WorkOs/WorkOsThesis.md`) assigns them their job: automate the loop — capture current state, enforce doctrine, fire the next move — without the principal having to ask. A hill-climb that only advances when prompted is a chatbot; the hook lifecycle below is what makes it an operating system.

> **WorkOS 5.0** — Stable event-driven automation infrastructure.

**Event-Driven Automation Infrastructure**

**Location:** `~/.claude/hooks/`
**Configuration:** `~/.claude/settings.json` (GENERATED — merged from `settings.system.json` + `WORKOS/USER/CONFIG/settings.user.json` by `MergeSettings.ts`; for events the user file defines as a plain array — UserPromptSubmit, PostToolUse, PreToolUse, Stop, SessionEnd — the user array REPLACES the system array, so `settings.json` is the only registration truth. `settings.user.json` does not exist on a fresh install — `MergeSettings` no-ops cleanly until you create it to carry user-side overrides)
**Status:** Active — hook counts below are hand-maintained (the `UpdateCounts.ts` count-cache write was removed 2026-05-06; statusline/Banner read live via `GetCounts.ts`)

> **Post-consolidation state (2026-07-11 hooks-BPE pass; WorkOS census 2026-10-21).** 40 distinct hook files are registered in `hooks/hooks.json` (39 `.hook.ts` + `ContextReduction.hook.sh`) across 72 hook commands; **54 hook files exist on disk (53 `.hook.ts` + `ContextReduction.hook.sh`).** WorkOS has no HTTP hooks (the Pulse SkillGuard/AgentGuard routes were removed along with Pulse, voice/TTS and push notifications). The 14 `.hook.ts` files that are on disk but NOT registered directly are not dead — each is imported as a `run()`/`check()` module by a consolidating dispatcher and still runnable standalone via its own shim: `DestructiveGuard`, `SystemFileGuard`, `BashSystemWriteGuard`, `CommunicationSkillGuard`, `EgressClassGuard`, `PublicPushGate` → `PreToolGuard`; `FormatGate`, `VerificationGate`, `ISACloseGate`, `ISAFoldGate`, `ISAGate` → `StopGates`; `LoadMemory`, `MemoryDeltaSurface` → `MemoryTurnStart`; `SystemChangeSurface` → `PostToolObserver`. (`LoopDetector` graduated to a direct PostToolUse + PostToolUseFailure registration and is no longer dispatcher-only; `ISAStaleWriteGuard` is both registered directly on PostToolUse and called by `PreToolGuard` for whole-file Writes.) The consolidation retired `TheRouter` entirely (removed 2026-07-11) (mode/tier classification abolished; model rungs now live in `WORKOS/TOOLS/models.ts` + `AgentInvocation.hook.ts`) and folded a family of single-purpose loggers/gates/painters into `EventLogger`, `TabState`, `StopGates`, `MemoryTurnStart`, `MemoryReviewFire`, and `PostToolObserver`. Details per event below.

---

## Overview

The WorkOS hook system is an event-driven automation infrastructure built on the AI engine's native hook support (Claude Code today). Hooks are executable scripts (TypeScript/Python) that run automatically in response to specific events during sessions.

**Core Capabilities:**
- **Session Management** - Auto-load context, capture summaries, manage state
- **History Capture** - Automatic work/learning documentation to `~/.claude/WORKOS/MEMORY/`
- **Security Validation** - Active (v5+, consolidated 2026-05-14) — Single `Safety.hook.ts` dispatching by `hook_event_name`: PermissionRequest gates outgoing tool calls via the shape classifier in `lib/safety-classifier.ts` (auto-allows safe shapes, neutral on dangerous/credential/injection); PostToolUse tags WebFetch/WebSearch responses with the "treat as data" warning + injection marker. Replaces the prior split between `SmartApprover.hook.ts` and `PromptInjection.hook.ts`. The v4.0 Inspector Pipeline was deleted 2026-05-06. See `WORKOS/DOCUMENTATION/Security/README.md`.
- **Multi-Agent Support** - Agent-specific hooks for subagent start/stop capture
- **Tab Titles** - Dynamic terminal tab updates with task context
- **Unified Event Stream** - The advisory checkers emit structured events to `events.jsonl`, read back at SessionStart (see § Unified Event System for the emitters that participate)

**Key Principle:** Most hooks run asynchronously and fail gracefully. Security hooks (e.g. `hooks/Safety.hook.ts`) are synchronous — the PermissionRequest path emits `decision: allow` JSON when safe (otherwise stdout is empty and the native engine prompts). All `.ts` hooks have `#!/usr/bin/env bun` shebangs and `+x` permissions — settings.json references them directly (e.g., `$HOME/.claude/hooks/Safety.hook.ts`) without a `bun` prefix.

**Freshness Authority:** When adding or modifying hooks, consult the `claude-code-guide` agent to verify current hook event types, return value schemas, and available fields.

---

## Available Hook Types

Claude Code supports the following hook events:

### 1. **SessionStart**
**When:** Claude Code session begins (new conversation)
**Use Cases:**
- Load WorkOS context (CLAUDE.md auto-loads routing + identity + PRINCIPAL_TELOS via @-imports)
- Initialize session state
- Capture session metadata

**Current Hooks (fire order per settings.json):**
```json
{
  "SessionStart": [
    {
      "hooks": [
        { "type": "command", "command": "bun $HOME/.claude/hooks/HookHealer.hook.ts", "timeout": 10 },
        { "type": "command", "command": "$HOME/.claude/hooks/KittyEnvPersist.hook.ts" },
        { "type": "command", "command": "$HOME/.claude/hooks/LoadContext.hook.ts" },
        { "type": "command", "command": "bun $HOME/.claude/WORKOS/TOOLS/FreshnessCache.ts --quiet", "timeout": 5, "async": true },
        { "type": "command", "command": "$HOME/.claude/hooks/MaintenanceJobs.hook.ts", "timeout": 5 },
        { "type": "command", "command": "bun $HOME/.claude/WORKOS/TOOLS/SettingsBackport.ts; bun $HOME/.claude/WORKOS/TOOLS/MergeSettings.ts --system $HOME/.claude/settings.system.json --user $HOME/.claude/WORKOS/USER/CONFIG/settings.user.json --output $HOME/.claude/settings.json", "timeout": 15, "async": true }
      ]
    }
  ]
}
```
<!-- regenerated from hooks/hooks.json 2026-10-21 -->

**What They Do:**
- `HookHealer.hook.ts` - Self-heals the registered-script exec-bit class: sweeps every script a settings hook execs directly, `chmod +x` on a missing exec bit, warns on a missing file/shebang. Registered via `bun <path>` so it is immune to losing its own exec bit. Writes `MEMORY/OBSERVABILITY/hook-healer.jsonl`.
- `KittyEnvPersist.hook.ts` - Persists Kitty terminal env vars both to the shared `MEMORY/STATE/kitty-env.json` and to a per-session `MEMORY/STATE/kitty-sessions/{sessionId}.json` (required by out-of-process consumers), then resets tab title to clean state
- `LoadContext.hook.ts` - Injects dynamic context (relationship, learning, work summary) as `<system-reminder>` at session start
- `MaintenanceJobs.hook.ts` *(timeout 5)* - Throttled background maintenance that re-homes the recurring jobs, without cron or any OS scheduler (Docker Sandboxes guarantee no systemd). Each job has its own interval and its own stamp: `memory-consolidation` (20 h — `SessionHarvester.ts --recent 20 && LearningPatternSynthesis.ts --week`, 10 min timeout), `proposal-gc` (20 h — `ProposalGC.ts --auto`), `worksweep` (1 h — `WorkSweep.ts`), `commitment-sweep` (20 h — `CommitmentSweep.ts`). Default (SessionStart) mode: if any job is due and no worker holds the lock, spawn itself detached/unref'd with `--run` and exit immediately (never blocks session start; skips subagents; exits 0 on every path). `--run` worker: take the one exclusive-create lock (a lock older than 2 h is treated as a crashed worker and reclaimed), run only the due jobs with per-job timeouts, stamping each job when it starts, appending output to the log. A failing job is retried once per its interval, not on every session start. State: `MEMORY/STATE/maintenance-jobs.json` (`{ jobs: { <name>: { last_start, last_end, exit } } }`) + `.lock`; log: `MEMORY/OBSERVABILITY/maintenance-jobs.log`.
- `FreshnessCache.ts` *(a `WORKOS/TOOLS/` script, not a `hooks/` file)* - Warms the `pai-freshness-v1` staleness cache (async)
- `SettingsBackport.ts` + `MergeSettings.ts` *(TOOLS, not hooks)* - Backport source-vs-generated drift, then regenerate `settings.json` from `settings.system.json` + `settings.user.json` (async). This is why `settings.json` is a generated artifact.

---

### 2. **SessionEnd**
**When:** Claude Code session terminates (conversation ends)
**Use Cases:**
- Capture work completions and learning moments
- Generate session summaries
- Record relationship context
- Update system counts (skills, hooks, signals)
- Run integrity checks

**Current Hooks (fire order per settings.json):**
```json
{
  "SessionEnd": [
    {
      "hooks": [
        { "type": "command", "command": "$HOME/.claude/hooks/WorkCompletionLearning.hook.ts" },
        { "type": "command", "command": "$HOME/.claude/hooks/SessionCleanup.hook.ts" },
        { "type": "command", "command": "$HOME/.claude/hooks/UpdateCounts.hook.ts" },
        { "type": "command", "command": "$HOME/.claude/hooks/MemoryHealthGate.hook.ts" },
        { "type": "command", "command": "$HOME/.claude/hooks/DocIntegrity.hook.ts" },
        { "type": "command", "command": "$HOME/.claude/hooks/IntegrityCheck.hook.ts" }
      ]
    }
  ]
}
```
<!-- regenerated from hooks/hooks.json 2026-10-21 -->

**What They Do:**
- `WorkCompletionLearning.hook.ts` - Reads ISA.md frontmatter for work metadata and ISC section for criteria status, captures learning to `MEMORY/LEARNING/` for significant work sessions
- `SessionCleanup.hook.ts` - Marks ISA.md frontmatter status→COMPLETED and sets completed_at timestamp, clears session state, resets tab, cleans session names
- `UpdateCounts.hook.ts` - Refreshes the Anthropic OAuth usage cache (`MEMORY/STATE/usage-cache.json`, via `handlers/UpdateCounts.ts`) so the statusline has fresh data next session
- `MemoryHealthGate.hook.ts` - Runs `MemoryHealthCheck.ts`: asserts all autonomic-memory hooks registered in BOTH settings files, code files present on disk, last reviewer fire within 7d, state file readable. Writes `memory-health.jsonl`; WARN/CRITICAL to stderr. Non-blocking. *(Moved from Stop to SessionEnd in the 2026-07-11 consolidation, then also re-registered at Stop as an async second block — it runs on both events today; see Section 4.)*
- `DocIntegrity.hook.ts` - Cross-reference + semantic drift checks + architecture-summary regen (`handlers/DocCrossRefIntegrity.ts`, `handlers/RebuildArchSummary.ts`); self-gates to a no-op when no system files changed. *(Moved from Stop to SessionEnd during the consolidation.)*
- `IntegrityCheck.hook.ts` - Runs DocCrossRefIntegrity and SystemIntegrity checks at session end

> **Historical (retired 2026-07-11):** `RelationshipMemory.hook.ts` (captured relationship context to `MEMORY/RELATIONSHIP/`) is no longer registered and no longer on disk; relationship signal is carried by the autonomic memory reviewer instead.

---

### 3. **UserPromptSubmit**
**When:** User submits a new prompt to Claude
**Use Cases:**
- Update UI indicators
- Pre-process user input
- Capture prompts for analysis
- Detect ratings and sentiment

**Current Hooks (fire order per settings.json — 9 hooks):**
```json
{
  "UserPromptSubmit": [
    { "hooks": [ { "type": "command", "command": "$HOME/.claude/hooks/PromptProcessing.hook.ts", "timeout": 30, "async": true } ] },
    { "hooks": [ { "type": "command", "command": "$HOME/.claude/hooks/SatisfactionCapture.hook.ts", "timeout": 20, "async": true } ] },
    { "hooks": [ { "type": "command", "command": "$HOME/.claude/hooks/ReminderRouter.hook.ts", "timeout": 5, "async": true } ] },
    { "hooks": [ { "type": "command", "command": "$HOME/.claude/hooks/VersionDrift.hook.ts", "timeout": 10, "async": true } ] },
    { "hooks": [ { "type": "command", "command": "$HOME/.claude/hooks/DriftReminder.hook.ts", "timeout": 5, "async": true } ] },
    { "hooks": [ { "type": "command", "command": "$HOME/.claude/hooks/MemoryTurnStart.hook.ts", "timeout": 8 } ] },
    { "hooks": [ { "type": "command", "command": "$HOME/.claude/hooks/AlgorithmNudge.hook.ts", "timeout": 5, "async": true } ] },
    { "hooks": [ { "type": "command", "command": "$HOME/.claude/hooks/TimeContext.hook.ts", "timeout": 5, "async": true } ] },
    { "hooks": [ { "type": "command", "command": "$HOME/.claude/hooks/ModelRungGuard.hook.ts", "timeout": 5, "async": true } ] }
  ]
}
```
<!-- regenerated from hooks/hooks.json 2026-10-21 -->

**What They Do:**

**PromptProcessing.hook.ts** — Tab Title + Session Naming via Haiku
- Single responsibility: terminal tab title updates and session auto-naming
- Fast paths: deterministic tab title on first prompt, deterministic session name fallback
- Inference: one Haiku call returning `{ tab_title, session_name }`
- Writes to: `session-names.json`, `work.json`, tab state
- **Naming-context isolation (2026-04-19):** `getRecentContext()` strips Assistant turns when `isFirstPrompt` is true. Session names are permanent, so scaffolding in assistant output — phase headers, agent names, SUMMARY lines — must never reach the naming prompt.

**SatisfactionCapture.hook.ts** — User satisfaction signal capture
- Reads `MEMORY/STATE/last-response.txt` (written by `LastResponseCache.hook.ts` at Stop) to access the previous response
- Detects explicit ratings ("8 - great"), positive praise, low-rating learning signals
- Writes to: `ratings.jsonl`, low-rating learning failures, complaint clusters
- Async (timeout 20s)

**ReminderRouter.hook.ts** — "remind me to X" → item in the local work ledger (`USER/WORK/ledger.jsonl`)
- Parses reminder-shaped prompts (precision-biased); appends one slug-idempotent `reminder`/`research`/`queue` item and re-renders `TASKLIST.md`. No network. See `Work/WorkSystem.md`
- Async (timeout 5s)

**VersionDrift.hook.ts** — Deterministic version-drift tooth (timeout 10s, async)
- Diffs the core surface (`hooks/`, `skills/`, `WORKOS/ALGORITHM/`, `WORKOS/TOOLS/`, `agents/`, `commands/`, `WORKOS/ATLAS/`, `test/`, `WORKOS/DOCUMENTATION/`, `settings.json`, `CLAUDE.md`, the system prompt) against the last `vX.Y.Z` tag; injects a `/vb` nag line when drift passes threshold
- Quiet by design: silent when `WORKOS/VERSION` already moved past the tag (bump in flight), silent below thresholds (10 changed core files, or any drift once the tag is >48h old), and at most one nag per 60 min. Zero inference; state at `MEMORY/STATE/version-drift-nag.json`

**DriftReminder.hook.ts** — Deterministic format drift nudges (added 2026-06-10)
- Scans the Stop-hook last-response cache (`MEMORY/STATE/last-response.txt`) with the banned-vocab regex (`hooks/lib/banned-vocab.ts`), banner-presence check, and em-dash count
- Fires at most one `DRIFT-REMINDER:` context line; budget 1-per-5-turns (`MEMORY/STATE/drift-reminder.json`); consecutive identical findings dedupe, a clean response re-arms; 30-min staleness guard. No LLM calls.

**MemoryTurnStart.hook.ts** — the ONE UserPromptSubmit memory hook (consolidated 2026-07-11)
- Dispatcher merging two per-prompt memory modules, each still runnable standalone: `LoadMemory.run()` (`<workos-memory>` hot-layer injection) then `MemoryDeltaSurface.run()` (`<workos-memory-health>?` + `<workos-memory-delta>`)
- Hot-layer injection is gated: injects `<workos-memory>` on a session's FIRST prompt, whenever the memory files' content hash changes, or after 20 turns without an injection (compaction backstop); the 🧠 delta line stays every-turn
- Subagent skip checked once here. Failure caught per-module; never blocks the prompt
- The former cadence tick (`MemoryReviewTrigger.run()`) was removed from this path 2026-07-11 — `MemoryReviewFire` (Stop) now owns the whole memory-review cadence

**AlgorithmNudge.hook.ts** — Algorithm live nudge layer ("Events ask the rest"; unified 2026-07-11, formerly ISANudge)
- TWO SCOPES. Always-on (any session): skill-routing on UserPromptSubmit (prompt matches a skill's USE WHEN → "invoke, don't handroll"; prebuilt index at `MEMORY/STATE/skill-usewhen-index.json`, detached rebuild, noise guards + per-skill 60-min cooldown) and late-ISA on PostToolUse (25+ tool calls, no registered run → "does done need writing down?", once per session)
- Run-scoped (live Algorithm run only): principal-message (UserPromptSubmit), probe-fail (PostToolUseFailure, execute/verify phases), agent-return / claim-close / stale-ISA / spend (~75 in-run tool calls with claims open, 30-min cooldown; tier-free replacement for the retired budget-half nudge) on PostToolUse
- Always-on **capability row** (2026-07-12, #1461): on `PostToolUseFailure` for a Bash command that exercises a Doctor-tracked capability (interceptor) while `MEMORY/STATE/capabilities.json` has that capability `broken`, fires ONE line with a static fix command (per-capability 60-min cooldown). Reads only `state` from the manifest — the fix string is a compile-time `CAP_FIX` constant, never sourced from the on-disk manifest (second-look audit: keeps a poisoned manifest from injecting runnable prose into model context). `declined`/`live`/absent-manifest all stay silent.
- Deterministic, zero inference, <20ms hot path; subagent tool events silenced via primary-transcript gate
- Registered on UserPromptSubmit (user settings, async) + PostToolUseFailure (system settings); PostToolUse reaches it via `PostToolObserver`'s import. Not a successor to the retired `SkillSurface.hook.ts` every-prompt top-3 line — routing nudges fire only on USE WHEN phrase match, driven by the 2026-07-11 dynamic-range audit's under-use finding

**TimeContext.hook.ts** — Live per-turn wall clock (timeout 5s, async; ported from public PR #1511, credit @anikinsasha)
- Emits a `<time-now>` line with weekday, date, time, zone, and a coarse part-of-day label. The harness `currentDate` context is date-only and anchored at session start, so a long session drifts; this recomputes every turn
- Timezone from `settings.json` `principal.timezone`, falling back to UTC. Fails open — any error is swallowed and the turn proceeds without the line

**ModelRungGuard.hook.ts** — Off-pin session detection (timeout 5s, async)
- Compares the `model` pin in `settings.json` against the model on the last assistant message in the transcript, and reports when the session is running below the pinned rung
- Reports only. A hook cannot set the main loop's carrier, so it names the sanctioned move from OPERATIONAL_RULES § Model selection (dispatch MAX-class work up with a tier alias) rather than asking for a `/model` change. Reads a tail of the transcript; no LLM calls; any error exits 0

> **Historical — retired 2026-07-11 (hooks-BPE pass):**
> - **`TheRouter.hook.ts` retired entirely** (commit `4dd0fbe19`). It owned per-prompt Mode + Tier classification (emitting `MODE: MINIMAL|NATIVE|ALGORITHM | TIER: E1-E5`); that whole scheme was abolished. There is no successor classifier — the model discovers difficulty from the work, and model rungs now live in `WORKOS/TOOLS/models.ts` + `AgentInvocation.hook.ts`. Its deterministic router libs (`router-deterministic`, `router-classifier`, `RouterShadow`, `ai-speak-patterns`) were deleted with it.
> - **`MemoryReviewTrigger.hook.ts` retired** (commit `4dd0fbe19`) — its per-prompt cadence tick was absorbed by `MemoryReviewFire` v2 at Stop.
> - **`SkillSurface.hook.ts` deleted** (commit `ac4f703ab`) — the deterministic top-3 skill-surfacing line is no longer emitted.
> - Earlier retirements still true: the v4.0 Inspector Pipeline (PromptGuard, ContentScanner, SmartApprover, SecurityPipeline, ContainmentGuard) and `RepeatDetection.hook.ts` were removed in the 2026-05-06 security simplification (tag `pre-bpe-cuts-2026-05-06`).

---

### 4. **Stop**
**When:** Main agent ({DA_IDENTITY.NAME}) completes a response
**Use Cases:**
- Capture work summaries and learnings
- **Update terminal tab with final state** (color + suffix based on outcome)

**Current Hooks (fire order per settings.json — 7 hooks across 2 blocks):**
```json
{
  "Stop": [
    {
      "hooks": [
        { "type": "command", "command": "$HOME/.claude/hooks/LastResponseCache.hook.ts" },
        { "type": "command", "command": "$HOME/.claude/hooks/TabState.hook.ts" },
        { "type": "command", "command": "$HOME/.claude/hooks/ISARenderOnStop.hook.ts" },
        { "type": "command", "command": "$HOME/.claude/hooks/SpendAuditor.hook.ts" },
        { "type": "command", "command": "$HOME/.claude/hooks/StopGates.hook.ts" },
        { "type": "command", "command": "$HOME/.claude/hooks/MemoryReviewFire.hook.ts" }
      ]
    },
    {
      "hooks": [
        { "type": "command", "command": "$HOME/.claude/hooks/MemoryHealthGate.hook.ts", "timeout": 15, "async": true }
      ]
    }
  ]
}
```
<!-- regenerated from hooks/hooks.json 2026-10-21 -->

**What They Do:**

Each Stop hook is a self-contained `.hook.ts` file that reads stdin via shared `hooks/lib/hook-io.ts`, calls its handler, and exits.

**`LastResponseCache.hook.ts`** — Cache last response for SatisfactionCapture bridge
- Writes `last_assistant_message` (or transcript fallback) to `MEMORY/STATE/last-response.txt`
- SatisfactionCapture and DriftReminder read this on the next UserPromptSubmit

**`TabState.hook.ts`** — Reset Kitty tab title/color after response *(the Stop branch; formerly `ResponseTabReset.hook.ts`, merged into the unified `TabState` hook 2026-07-10)*
- Calls `handlers/TabState.ts` to set the completed/past-tense state
- Same file also handles the PreToolUse and PostToolUse `AskUserQuestion` tab branches (see those events)

**`ISARenderOnStop.hook.ts`** — Re-render edited ISAs at end-of-turn
- Reads the per-session state file written by `ISASync.hook.ts` on every ISA Edit/Write; for each ISA edited this turn spawns `ISARender.ts` ONLY IF the sibling `ISA.html` already exists (the ISA reached `phase: complete` at least once) — the doctrinal gate against constant remaking during authoring
- Renders spawned detached, never awaited (<100ms budget)

**`SpendAuditor.hook.ts`** — Outcome-side spend verification (added 2026-07-16)
- Catches the failure class where a HEAVY ask (design, analysis, research, assessment) is answered inline with zero capability use and no stated reason. `AlgorithmNudge` catches the depth SIGNAL at prompt time; this checks the OUTCOME at Stop
- Hot path only reads/writes a small state file and spawns a detached worker (<20ms target, always exit 0). The worker audits when any trigger fires: a `depth` nudge fired this session, a zero-Skill/zero-Agent session with a ≥200-char last prompt, or a work.json row that hit `phase=complete` in the last 10 minutes
- **Never blocks, never exits non-zero, never runs inference on the hot path** — a Stop-blocking spend gate Goodharts into token dispatches, which is why the AlgorithmNudge depth-block variant was killed 2026-07-12. Verdicts land in `MEMORY/OBSERVABILITY/spend-audit.jsonl`; an underspend verdict at confidence ≥0.6 also writes `capability-incidents.jsonl`

**`StopGates.hook.ts`** — the ONE Stop-event gate hook (consolidated 2026-07-11)
- Reads stdin ONCE and evaluates the per-turn gates in order; each gate file still owns its logic and stays runnable standalone:
  1. `FormatGate.run()` — deterministic structural checks on the one WorkOS format (banner first, 🗣️ closer last, 🧠 line when a delta arrived)
  2. `VerificationGate.run()` — blocks done-claims lacking transcript evidence (T1 web-deploy / T2 flow / T3 appearance)
  3. `ISACloseGate.run()` — blocks a major-work completion claim on an active run whose ISA is provably stale (≥10 tool calls since last ISA edit via `toolCallsSinceIsaEditAbs`, no ISA edit this turn, no subagent); fires ONCE per session+run, honest "no ISA delta needed" statements pass (principal directive 2026-07-24; kill switch `ISACLOSEGATE_OFF=1`)
  4. `ISAFoldGate.run()` — D-50 enforcement (added 2026-07-29): prod mutated this turn + active run + ISA untouched + the reply silent on ISA state → block. Phrase-independent, so it sees the gap `ISACloseGate`'s completion regex cannot ("rigged and armed" isn't "done")
  5. `ISAGate.run()` — blocks a close (`phase: complete` written this turn) on structural ISA violations (non-M/N progress, fog-at-complete, missing anchors_to); scoped to ISAs touched this turn — the structural tooth complementing ISACloseGate's staleness tooth
- The FIRST gate returning `decision:"block"` wins; the recovery turn re-runs all gates. Fails open per-gate so one gate's crash never silences the others
- `OutputFormatGate.run()` was dropped from the chain 2026-07-11 (it was telemetry-only and policed the retired mode-banner system; format drift is now `DriftReminder`'s job)

**`MemoryReviewFire.hook.ts`** (v2) — owns the WHOLE memory-review cadence (consolidated 2026-07-11)
- On every primary-session Stop: **this session's** `turn_count += 1`, `last_message_at = now`; if that per-session `turn_count >= turn_threshold` AND minutes since the **global** last review `>= min_minutes_between`, spawn `MemoryReviewer.ts` detached and reset this session's counter
- Cadence state is keyed per `session_id` (public issue #1711, @jacobo-ortiz) — a shared global counter let concurrent sessions reset and starve each other. The turn threshold is per-session; the minute floor stays global because it is the inference-volume guard
- Absorbed the former `MemoryReviewTrigger` per-prompt tick — firing at Stop already IS the quiet moment the idle/debounce machinery approximated, so `pending_review` stays false forever (kept for statusline schema compat)
- Subprocess is env-scrubbed (delete `ANTHROPIC_API_KEY` + `ANTHROPIC_AUTH_TOKEN`) to preserve subscription billing. State: `MEMORY/STATE/memory-review/<session_id>.json` (cadence, pruned after 7 days), mirrored to `MEMORY/OBSERVABILITY/review-state.json` for the statusline and health readers; params: `WORKOS/USER/CONFIG/memory-review.json`

**`MemoryHealthGate.hook.ts`** *(second Stop block; timeout 15, async)* — Autonomic-memory health check
- Runs `MemoryHealthCheck.ts`: asserts every autonomic-memory hook is registered in BOTH settings files, the code files are on disk, the last reviewer fire was within 7 days, and the state file is readable
- Writes `MEMORY/OBSERVABILITY/memory-health.jsonl`; WARN/CRITICAL to stderr. Non-blocking. Registered at **both** Stop (here) and SessionEnd (Section 2) — the Stop registration gives per-turn health, the SessionEnd one covers a session that ends without a further Stop

> **Historical (moved off Stop 2026-07-11):** `DocIntegrity.hook.ts` now runs at SessionEnd (see Section 2). `MemoryHealthGate.hook.ts` also moved to SessionEnd in that pass and was later re-added at Stop as the async second block above, so it is registered on both events today. `OutputFormatGate.hook.ts` was deleted (commit `4dd0fbe19`).

**Tab State System:** See `../Terminal/TerminalTabs.md` for complete documentation

---

### 5. **PreToolUse**
**When:** Before Claude executes any tool
**Use Cases:**
- Security validation across write/exec operations (Bash, Write, Edit, MultiEdit) — `PreToolGuard` blocks destructive and credential-exfil Bash shapes in every permission mode, USER content landing in SYSTEM files, raw email sends, and over-ceiling Tier-2 egress; the native permission denylist covers the rest
- Context reduction (RTK command rewrite on Bash)
- Tab state updates on questions
- Subagent-start capture at the `Agent` boundary (`AgentInvocation`)

**Current Hooks (per settings.json):**
```json
{
  "PreToolUse": [
    { "matcher": "Bash", "hooks": [ { "type": "command", "command": "$HOME/.claude/hooks/ContextReduction.hook.sh" } ] },
    { "matcher": "Agent", "hooks": [
        { "type": "command", "command": "$HOME/.claude/hooks/AgentInvocation.hook.ts" }
    ] },
    { "matcher": "AskUserQuestion", "hooks": [ { "type": "command", "command": "$HOME/.claude/hooks/TabState.hook.ts" } ] },
    { "matcher": "Bash|Write|Edit|MultiEdit", "hooks": [ { "type": "command", "command": "$HOME/.claude/hooks/PreToolGuard.hook.ts" } ] }
  ]
}
```
<!-- regenerated from hooks/hooks.json 2026-10-21 -->

**Security guard (active — `PreToolGuard.hook.ts`, the ONE PreToolUse blocking dispatcher, consolidated 2026-07-11):** Reads stdin ONCE and routes by tool to isolated blocker modules (each still runnable standalone via its own shim), FIRST block wins (`exit 2`, message to stderr → model):
- `Write | Edit | MultiEdit` → `SystemFileGuard.check` (blocks deny-list USER content landing in a SYSTEM file; fail-OPEN), then `ISAStaleWriteGuard.check` (Write-only: a whole-file Write that would silently discard ISA changes the session never saw; fail-OPEN)
- `Bash` → `DestructiveGuard.check` first (hard-blocks recursive deletes of `/`, system dirs, the home dir or the config root; download-piped-to-shell; raw device writes, mkfs, fork bombs, `chmod -R 777`; reverse shells; privileged or host-mounting `docker run`; force-push or hard reset on main/master/prod; history rewrites and ref deletion; process attach; private-key, cloud-credential and `/proc/*/environ` reads; `.env` or credential files sent over the network. It runs on PreToolUse because `Safety.hook.ts` only sees PermissionRequest, which never fires under bypassPermissions — the Docker Sandboxes TUI mode. Interpreter one-liners and plain `.env` reads stay with the normal permission flow. Matching uses `buildShapeTargets()` from `lib/safety-classifier.ts`, so quoting, `bash -c`, env-prefix wrappers, substitutions and escapes are seen through. Fail-OPEN on internal error; tests in `hooks/DestructiveGuard.test.ts`), then `BashSystemWriteGuard.check` (the Bash lane of `SystemFileGuard`: a write-shaped command into a SYSTEM-tree target — redirection, tee, cp/mv, sed -i, script-writes — has its whole command text, heredocs included, scanned against the same deny-list; fail-OPEN), `CommunicationSkillGuard.check` (blocks raw email send; fail-OPEN), `EgressClassGuard.check` (blocks over-ceiling Tier-2 egress; fail-CLOSED on a Tier-2-signature call whose classification throws, fail-OPEN otherwise), then `PublicPushGate.check` (blocks a Bash-driven push to a PUBLIC GitHub repo, or making a repo public, until the repo's HEAD tree and reachable history pass a deny-scan; patterns from `WORKOS/USER/SECURITY/PublicScrubPatterns.txt` plus built-in secret signatures; fail-OPEN while visibility is undetermined, fail-CLOSED once the destination is confirmed public; visibility cached 24 h in `MEMORY/STATE/public-push-gate.json`)

Each check is wrapped in its own try/catch so one guard throwing can never suppress the others. `ContextReduction.hook.sh` stays a SEPARATE Bash hook because it REWRITES the command (`updatedInput`) rather than block/allow. `AgentInvocation.hook.ts` captures subagent-start at the `Agent` boundary. See `DOCUMENTATION/Security/README.md` for full architecture.

**What They Do:**
- `ContextReduction.hook.sh` - Context reduction via [RTK](https://github.com/rtk-ai/rtk). Transparently rewrites Bash commands to `rtk` equivalents for 60-90% token reduction across git, build, test, lint, and package manager output. Runs on the Bash matcher. Meta commands (use directly, not through hook): `rtk gain` (savings analytics), `rtk gain --history` (command history), `rtk discover` (missed opportunities), `rtk proxy <cmd>` (bypass filtering). Note: if `rtk gain` fails, check for name collision with reachingforthejack/rtk (Rust Type Kit).
- `TabState.hook.ts` *(PreToolUse:AskUserQuestion branch; formerly `SetQuestionTab.hook.ts`)* - Sets the tab to teal "awaiting input" and saves the previous title so the PostToolUse branch can restore it when the question is answered.

> **Historical (retired 2026-07-11):** `SecurityPipeline.hook.ts` (the v4.0 Inspector Pipeline: PatternInspector → EgressInspector) is no longer registered — its blocking role was absorbed by `PreToolGuard` above and the native permission denylist. `SetQuestionTab.hook.ts` was merged into the unified `TabState.hook.ts`. The `Read` matcher was dropped (no PreToolUse security hook fires on Read anymore).

---

### 6. **PostToolUse**
**When:** After Claude executes any tool
**Status:** Active - Algorithm state tracking

**Current Hooks (per settings.json):**
```json
{
  "PostToolUse": [
    { "matcher": "Agent", "hooks": [ { "type": "command", "command": "$HOME/.claude/hooks/AgentInvocation.hook.ts" } ] },
    { "matcher": "WebFetch", "hooks": [ { "type": "command", "command": "$HOME/.claude/hooks/Safety.hook.ts", "timeout": 5 } ] },
    { "matcher": "WebSearch", "hooks": [ { "type": "command", "command": "$HOME/.claude/hooks/Safety.hook.ts", "timeout": 5 } ] },
    { "matcher": "mcp__.*", "hooks": [ { "type": "command", "command": "$HOME/.claude/hooks/Safety.hook.ts", "timeout": 5 } ] },
    { "matcher": "ToolSearch", "hooks": [ { "type": "command", "command": "$HOME/.claude/hooks/Safety.hook.ts", "timeout": 5 } ] },
    { "matcher": "AskUserQuestion", "hooks": [ { "type": "command", "command": "$HOME/.claude/hooks/TabState.hook.ts" } ] },
    { "matcher": "Read", "hooks": [
        { "type": "command", "command": "$HOME/.claude/hooks/ISAStaleWriteGuard.hook.ts" }
    ] },
    { "matcher": "Write", "hooks": [
        { "type": "command", "command": "$HOME/.claude/hooks/ISASync.hook.ts" },
        { "type": "command", "command": "$HOME/.claude/hooks/ISAStaleWriteGuard.hook.ts" },
        { "type": "command", "command": "$HOME/.claude/hooks/CheckpointPerISC.hook.ts", "timeout": 30 },
        { "type": "command", "command": "$HOME/.claude/hooks/ConfigEvalFire.hook.ts" },
        { "type": "command", "command": "$HOME/.claude/hooks/AtlasEventCapture.hook.ts", "timeout": 5 },
        { "type": "command", "command": "$HOME/.claude/hooks/KnowledgeWriteGuard.hook.ts", "timeout": 5 },
        { "type": "command", "command": "$HOME/.claude/hooks/ComplexityRatchet.hook.ts" }
    ] },
    { "matcher": "Edit", "hooks": [
        { "type": "command", "command": "$HOME/.claude/hooks/ISASync.hook.ts" },
        { "type": "command", "command": "$HOME/.claude/hooks/ISAStaleWriteGuard.hook.ts" },
        { "type": "command", "command": "$HOME/.claude/hooks/CheckpointPerISC.hook.ts", "timeout": 30 },
        { "type": "command", "command": "$HOME/.claude/hooks/ConfigEvalFire.hook.ts" },
        { "type": "command", "command": "$HOME/.claude/hooks/AtlasEventCapture.hook.ts", "timeout": 5 },
        { "type": "command", "command": "$HOME/.claude/hooks/KnowledgeWriteGuard.hook.ts", "timeout": 5 },
        { "type": "command", "command": "$HOME/.claude/hooks/ComplexityRatchet.hook.ts" }
    ] },
    { "matcher": "MultiEdit", "hooks": [
        { "type": "command", "command": "$HOME/.claude/hooks/ISASync.hook.ts" },
        { "type": "command", "command": "$HOME/.claude/hooks/ISAStaleWriteGuard.hook.ts" },
        { "type": "command", "command": "$HOME/.claude/hooks/CheckpointPerISC.hook.ts", "timeout": 30 },
        { "type": "command", "command": "$HOME/.claude/hooks/ConfigEvalFire.hook.ts" },
        { "type": "command", "command": "$HOME/.claude/hooks/AtlasEventCapture.hook.ts", "timeout": 5 },
        { "type": "command", "command": "$HOME/.claude/hooks/KnowledgeWriteGuard.hook.ts", "timeout": 5 },
        { "type": "command", "command": "$HOME/.claude/hooks/ComplexityRatchet.hook.ts" }
    ] },
    { "hooks": [
        { "type": "command", "command": "$HOME/.claude/hooks/PostToolObserver.hook.ts", "timeout": 5 },
        { "type": "command", "command": "$HOME/.claude/hooks/LoopDetector.hook.ts", "timeout": 5 },
        { "type": "command", "command": "$HOME/.claude/hooks/EventLogger.hook.ts", "timeout": 5, "async": true }
    ] },
    { "matcher": "Bash", "hooks": [
        { "type": "command", "command": "$HOME/.claude/hooks/AtlasEventCapture.hook.ts", "timeout": 5 }
    ] }
  ]
}
```
<!-- regenerated from hooks/hooks.json 2026-10-21 -->

**What They Do:**

**AgentInvocation.hook.ts** *(matcher `Agent`)* - Records subagent-stop with duration at the `PostToolUse:Agent` boundary (also captures subagent-start at `PreToolUse:Agent`); this is where `subagent_type`/`description` are reliably present.

**Safety.hook.ts** *(matchers `WebFetch`, `WebSearch`, `mcp__.*`, `ToolSearch`)* - PostToolUse branch of the consolidated `Safety.hook.ts`: tags external content with the "treat as data" warning + injection marker. Same file dispatches the PermissionRequest branch (see Section: PermissionRequest).

**TabState.hook.ts** *(matcher `AskUserQuestion`; formerly `QuestionAnswered.hook.ts`)* - Restores the tab to working/orange after the user answers. Same unified file handles the PreToolUse question branch and the Stop reset.

**ISASync.hook.ts** *(matchers `Write`, `Edit`, `MultiEdit`)* - ISA Frontmatter → work.json Sync
- Fires after Write/Edit/MultiEdit to ISA files in `MEMORY/WORK/`; syncs ISA frontmatter (status, title, effort) to `MEMORY/STATE/work.json`; non-blocking, fire-and-forget
- Uses `hooks/lib/isa-utils.ts::appendPhase()` for phaseHistory with `source: "prd"`, dedup via upgrade to `source: "merged"`. See `WORKOS/MEMORY/KNOWLEDGE/Ideas/dual-source-event-tracking-pattern.md`.

**CheckpointPerISC.hook.ts** *(matchers `Write`, `Edit`, `MultiEdit`; 30s timeout)* - Per-ISC auto-commit checkpoint of work-tree state.

**KnowledgeWriteGuard.hook.ts** *(matchers `Write`, `Edit`, `MultiEdit`; 5s timeout; registered 2026-07-29, ported from public PR #1687, @elhoim)* - Schema feedback at the moment a Knowledge note is written. Advisory only: for writes under `MEMORY/KNOWLEDGE/<Type>/<slug>.md`, validates the note against the canonical schema and emits `additionalContext` naming violations and the sanctioned writer (`MemorySystem.renderInitialNote`) while the author is still in the loop — one edit now instead of a migration later (the SessionEnd `KnowledgeConformance` pass reports the same drift after the fact). NEVER blocks (the note is already on disk at PostToolUse); fail-silent on every path outside KNOWLEDGE.

**ComplexityRatchet.hook.ts** *(matchers `Write`, `Edit`, `MultiEdit`; registered 2026-08-08)* - Advisory complexity-drift meter (inspired by github.com/0xwilliamortiz/ratchet). Measures the complexity a session ADDS — PostToolUse only ever sees new edits, so every pre-existing line of debt is the baseline for free — and reports drift back into the live session via `additionalContext`. v1 is advise-only: it never blocks (the tool has already run at PostToolUse), and fail-open is absolute — any parse, fs, or measurement error exits silently. `MODE` is the single extension point for a future guard/strict tier.

**PostToolObserver.hook.ts** *(catch-all; the ONE sync catch-all hook, consolidated 2026-07-11)* - Dispatcher merging the sync catch-all modules that emit `additionalContext`, joined into one `hookSpecificOutput`:
- `LoopDetector.run()` — exact-repeat / oscillation / hammering detection
- `AlgorithmNudge.run()` — the Algorithm live nudge layer (run-scoped: agent-return / claim-close / stale-ISA / spend; always-on: late-ISA when no run is registered)
- `SystemChangeSurface.run()` — the **⚙️ SYSTEM line** (added 2026-07-27, principal directive: "any time that we modify the system, I want the response format to include a cool, maintenance-looking system message"). Emits a `<workos-system-delta>` block naming this turn's writes to the four self-surfaces — ISA (anywhere on disk, with its claim delta), doctrine (CLAUDE.md, the system prompt, the Algorithm), identity (PRINCIPAL/DA identity, TELOS, OPERATIONAL_RULES, PROJECTS), machinery (hooks, skills, settings, TOOLS). Silent on ordinary work, and silent on `WORKOS/MEMORY/` by design — that belongs to 🧠. **Why PostToolUse:** the line must describe THIS turn's writes and be in context before the model composes, so UserPromptSubmit (where the 🧠 surface lives) is structurally one turn too late, and Stop is worse — it fires after the message is on screen and can only enforce by forcing a doubled response. **Turn boundary:** `clearLedger(sessionId)` from `MemoryTurnStart`, per-session. A first cut keyed the boundary to the memory system's GLOBAL heartbeat mtime; a concurrent session's prompt then wiped a live session's ledger mid-turn, which is why the boundary is per-session and owned here. Rendering compliance is flagged (never blocked) by `FormatGate`'s `missing-system-line`.

**EventLogger.hook.ts** *(catch-all; async; the unified observability writer, consolidated 2026-07-10)* - On PostToolUse writes the ground-truth audit to `MEMORY/OBSERVABILITY/tool-activity.jsonl` and bumps the ISA heartbeat; when `tool == Skill` also appends to `MEMORY/SKILLS/execution.jsonl`. Also spawns `WORKOS/TOOLS/WorkReconcile.ts` detached at most once a minute (2026-07-20): the reconciler heals work.json rows whose ISA frontmatter changed outside ISASync's Write/Edit trigger (Bash edits, git ops) — phase/progress/criteria/title re-synced from the ISA, mtime-cached so unchanged files cost one stat. The same file dispatches PostToolUseFailure, StopFailure, and ConfigChange (see those events). Merged five former loggers: `ToolActivityTracker`, `SkillExecutionLog`, `ToolFailureTracker`, `StopFailureHandler`, `ConfigAudit`. Fail-open; never blocks a turn.

> **Historical (retired 2026-07-11):** `ContentScanner.hook.ts` (v4.0 InjectionInspector on the global matcher) is gone — external-content tagging is the `Safety.hook.ts` PostToolUse branch, now scoped to the named egress/read matchers above (`WebFetch`, `WebSearch`, `ToolSearch`, and every MCP tool via `mcp__.*` — the matcher was widened from the mail/drive/calendar subset to all MCP servers). `TelosSummarySync.hook.ts` retired (commit `4dd0fbe19`) — PRINCIPAL_TELOS regeneration is handled by `DerivedSync` / `GenerateTelosSummary.ts` outside the hook layer. `ToolActivityTracker.hook.ts` and `QuestionAnswered.hook.ts` were folded into `EventLogger` and `TabState` respectively.

---

### 7. **PostToolUseFailure**
**When:** A tool execution fails
**Use Cases:**
- Track tool failure patterns for debugging
- Identify flaky tools or recurring errors
- Observability data for system health

**Current Hooks (per settings.json — 3 hooks):**
```json
{
  "PostToolUseFailure": [
    { "hooks": [ { "type": "command", "command": "$HOME/.claude/hooks/EventLogger.hook.ts" } ] },
    { "hooks": [ { "type": "command", "command": "$HOME/.claude/hooks/AlgorithmNudge.hook.ts", "timeout": 5 } ] },
    { "hooks": [ { "type": "command", "command": "$HOME/.claude/hooks/LoopDetector.hook.ts", "timeout": 5 } ] }
  ]
}
```
<!-- regenerated from hooks/hooks.json 2026-10-21 -->

**What They Do:**
- `EventLogger.hook.ts` *(PostToolUseFailure branch; formerly `ToolFailureTracker.hook.ts`)* - Appends structured failure events (tool name, error message, truncated tool input, session ID, timestamp) to `MEMORY/OBSERVABILITY/tool-failures.jsonl`. Lightweight, file append only, no inference calls.
- `AlgorithmNudge.hook.ts` - Fires the probe-failed nudge ("Claim wrong or code wrong? If the claim, update the ISA.") on an active Algorithm run, plus the always-on capability row for a Doctor-tracked capability the manifest marks `broken`.
- `LoopDetector.hook.ts` - Repeat-failure / hammering detection on the failing tool call. Direct registration here as well as the `PostToolUse` catch-all, so a tool that fails the same way repeatedly is caught on the failure path too.

---

### 8. **SubagentStart** *(not registered)*
**When:** A subagent is spawned (command-only event)
**Status:** Not present in `settings.json`. Claude Code's built-in `SubagentStart` payload omits `subagent_type` / `description` / `prompt`, so WorkOS tracks subagent lifecycle at the `PreToolUse:Agent` boundary via `AgentInvocation.hook.ts` (see Sections 5–6) where that data is reliably present.

---

### 9. **ConfigChange**
**When:** Configuration settings are modified (command-only event)
**Use Cases:**
- Security audit trail for permission changes
- Track hook modifications
- Detect unauthorized config changes

**Current Hooks:**
```json
{
  "ConfigChange": [
    {
      "hooks": [
        {
          "type": "command",
          "command": "$HOME/.claude/hooks/EventLogger.hook.ts"
        }
      ]
    }
  ]
}
```
<!-- regenerated from hooks/hooks.json 2026-10-21 -->

**What It Does:**
- `EventLogger.hook.ts` *(ConfigChange branch; formerly `ConfigAudit.hook.ts`, merged 2026-07-10)* - Appends config change events (config key, old → new summary, session ID, timestamp) to `MEMORY/OBSERVABILITY/config-changes.jsonl`; flags sensitive keys (permissions, hooks, env, mcpServers). Lightweight, file append only, no inference calls.
- **One improvement over the pre-merge behavior:** the settings-diff baseline snapshot moved from volatile `/tmp/pai-settings-snapshot.json` to `MEMORY/STATE/pai-settings-snapshot.json`, so the diff baseline now survives reboots.

---

### 10. **PreCompact** *(not registered)*
**When:** Before Claude compacts context (long conversations)
**Status:** Not present in `settings.json`; `PreCompact.hook.ts` is no longer on disk. Historically it captured active work context (task, ISA summary, files, decisions) to a stdout handover note preserved through compaction. Work-in-progress state is now carried by the ISA/`work.json` registry and the autonomic memory layer rather than a compaction hook.

---

### 11. **PostCompact** *(not registered)*
**When:** After Claude compacts context
**Status:** Not present in `settings.json`; `RestoreContext.hook.ts` was removed 2026-05-06 and no longer exists on disk. It historically restored critical context after compaction.

---

### 12. **SubagentStop** *(not registered)*
**When:** A subagent completes (command-only event)
**Status:** Not present in `settings.json`. Subagent stop + duration is tracked at `PostToolUse:Agent` via `AgentInvocation.hook.ts` (see Sections 5–6) where `subagent_type`/`description`/duration are reliably present.

---

### 12a. **TeammateIdle** *(removed 2026-05-06)*
**When:** An agent team teammate is about to go idle
**Status:** Removed in BPE Phase A.1 (commit `31a4b9ad9`). The `teammate-events.jsonl` log it produced had zero readers across WORKOS/, hooks/, skills/. Future reassignment-logic hint in the original docstring was never implemented.

To restore: `git revert 31a4b9ad9` (or `git show pre-bpe-cuts-2026-05-06:hooks/TeammateIdle.hook.ts > hooks/TeammateIdle.hook.ts` and re-add to settings.json `TeammateIdle` array).

---

### 13. **TaskCreated**
**When:** A task is created via TaskCreate tool
**Status:** Active — `TaskGovernance.hook.ts`

**Current Hooks:**
```json
{
  "TaskCreated": [
    {
      "hooks": [
        {
          "type": "command",
          "command": "$HOME/.claude/hooks/TaskGovernance.hook.ts"
        }
      ]
    }
  ]
}
```
<!-- regenerated from hooks/hooks.json 2026-10-21 -->

**What It Does:**
- `TaskGovernance.hook.ts` - Validates and governs task creation for ISC quality standards

---

### 14. **StopFailure**
**When:** The main agent fails to complete a response
**Status:** Active — `EventLogger.hook.ts` (StopFailure branch)

**Current Hooks:**
```json
{
  "StopFailure": [
    {
      "hooks": [
        {
          "type": "command",
          "command": "$HOME/.claude/hooks/EventLogger.hook.ts"
        }
      ]
    }
  ]
}
```
<!-- regenerated from hooks/hooks.json 2026-10-21 -->

**What It Does:**
- `EventLogger.hook.ts` *(StopFailure branch; formerly `StopFailureHandler.hook.ts`, merged 2026-07-10)* - Captures abnormal-stop diagnostics (log-only) to `MEMORY/SECURITY/<YYYY>/<MM>/stop-failures-<YYYY-MM-DD>.jsonl`.

---

### 14a. **PermissionRequest**
**When:** The native permission engine is about to prompt for a tool call
**Status:** Active — `Safety.hook.ts` (PermissionRequest branch), 2 matcher blocks

**Current Hooks (per settings.json — 1 hook, 2 matchers):**
```json
{
  "PermissionRequest": [
    { "matcher": "Write|Edit|MultiEdit|Bash", "hooks": [ { "type": "command", "command": "$HOME/.claude/hooks/Safety.hook.ts" } ] },
    { "matcher": "mcp__.*", "hooks": [ { "type": "command", "command": "$HOME/.claude/hooks/Safety.hook.ts" } ] }
  ]
}
```
<!-- regenerated from hooks/hooks.json 2026-10-21 -->

**What It Does:**
- `Safety.hook.ts` *(PermissionRequest branch)* - Shape-classifier auto-approve. `lib/safety-classifier.ts` allows safe shapes (read-only commands, dev binaries, trusted-workspace targets, pre-vetted MCP calls, shell control flow over data) by emitting `decision: allow` JSON; on dangerous, credential, or injection shapes it stays silent and the native engine prompts as normal. Writes a decision cache (`MEMORY/STATE/permission-cache.json`) and an observability trail (`MEMORY/OBSERVABILITY/permission-decisions.jsonl`). Same file as the PostToolUse content-tagging branch (Section 6); it dispatches on `hook_event_name`.

---

### 15. **Elicitation** *(handler removed 2026-05-06)*
**When:** An MCP server requests structured input (e.g. Stripe, Bright Data mid-task prompt)
**Status:** Handler removed in BPE Phase A.2 (commit `1de31b0a7`). The single elicitation log file across the entire history contained one event (125 bytes from 2026-04-04). MCP elicitation already shows the dialog natively when the schema is unknown. Hook claimed it could auto-respond; never did.

To restore: `git revert 1de31b0a7`.

---

### 16. **FileChanged** *(handler removed 2026-05-06)*
**When:** A watched file is modified
**Status:** Handler removed in BPE Phase B.1 (commit `c43dbc019`). The PostToolUse catch-all logger (then `ToolActivityTracker`, now `EventLogger.hook.ts`) already captures every tool call including file paths and content — FileChanged was a redundant second log of the same events under a different schema.

To restore: `git revert c43dbc019`.

---

### 17. **InstructionsLoaded** *(not registered)*
**When:** Instructions (CLAUDE.md or project instructions) are loaded
**Status:** Not present in `settings.json`; `InstructionsLoadedHandler.hook.ts` is no longer on disk. CLAUDE.md / system-prompt / identity-file integrity is now checked by `InstructionsLoaded`-independent tooling — the SHA-256 audit runs inside `IntegrityCheck` / `HookHealer` and the release gates rather than a per-load hook.

---

## Configuration

### Location
**File:** `~/.claude/settings.json`
**Section:** `"hooks": { ... }`

### Environment Variables
Hooks have access to all environment variables from `~/.claude/settings.json` `"env"` section:

```json
{
  "env": {
    "WORKOS_DIR": "$HOME/.claude",
    "CLAUDE_CODE_MAX_OUTPUT_TOKENS": "64000"
  }
}
```

**Key Variables:**
- `WORKOS_DIR` - WorkOS installation directory (typically `~/.claude`)
- Hook scripts reference `$HOME/.claude` in command paths

### Identity Configuration (Central to Install Wizard)

**The canonical identity source is `WORKOS/USER/CONFIG/WORKOS_CONFIG.toml`, read via `WORKOS/TOOLS/WorkosConfig.ts`.** The `daidentity` block in settings.json is a runtime mirror kept for transition safety — `hooks/lib/identity.ts` reads it first when present, then falls back to the config/identity files. Configure identity in the toml (or via `/interview`); the mirror below shows the settings.json shape hooks read:

```json
{
  "daidentity": {
    "name": "WorkOS",
    "fullName": "Personal AI",
    "displayName": "WorkOS",
    "color": "#3B82F6"
  },
  "principal": {
    "name": "{YourName}",
    "pronunciation": "{YourName}",
    "timezone": "America/Your_City"
  }
}
```

**Using the Identity Module:**
```typescript
import { getIdentity, getPrincipal, getDAName, getPrincipalName } from './lib/identity';

// Get full identity objects
const identity = getIdentity();    // { name, fullName, displayName, color, personality }
const principal = getPrincipal();  // { name, pronunciation, timezone }

// Convenience functions
const DA_NAME = getDAName();        // "WorkOS"
const USER_NAME = getPrincipalName(); // "{YourName}"
```

**Why settings.json?**
- Programmatic access via `JSON.parse()` - no regex parsing markdown
- Central to the WorkOS install wizard
- Tool-friendly: easy to read/write from any language

> **Note:** `settings.json` is a **generated file** -- `MergeSettings.ts` writes it (async at SessionStart) by merging `settings.system.json` (SYSTEM) with `WORKOS/USER/CONFIG/settings.user.json` (USER). For events the user file defines as a plain array (UserPromptSubmit, PostToolUse, PreToolUse, Stop, SessionEnd), the **user array REPLACES the system array** — so a system-side edit to those events silently no-ops unless the user file also carries it. Hooks read `settings.json` freely for runtime config, but manual edits are overwritten on the next merge. To make permanent changes, edit the appropriate source (`settings.system.json` or `settings.user.json`) and re-run `MergeSettings.ts`.

### Hook Configuration Structure

```json
{
  "hooks": {
    "HookEventName": [
      {
        "matcher": "pattern",  // Optional: filter which tools/events trigger hook
        "hooks": [
          {
            "type": "command",
            "command": "$HOME/.claude/hooks/my-hook.ts --arg value"
          }
        ]
      }
    ]
  }
}
```

**Fields:**
- `HookEventName` - One of: SessionStart, SessionEnd, UserPromptSubmit, Stop, StopFailure, PreToolUse, PostToolUse, PostToolUseFailure, SubagentStart, SubagentStop, ConfigChange, PreCompact, PostCompact, TaskCreated, TaskCompleted, TeammateIdle, Elicitation, ElicitationResult, FileChanged, CwdChanged, InstructionsLoaded, WorktreeCreate, WorktreeRemove, Notification, PermissionRequest
- `matcher` - Pattern to match (use `"*"` for all tools, or specific tool names)
- `type` - Always `"command"` (executes external script)
- `command` - Path to executable hook script (TypeScript/Python/Bash)

### Hook Input (stdin)
All hooks receive JSON data on stdin:

```typescript
{
  session_id: string;         // Unique session identifier
  transcript_path: string;    // Path to JSONL transcript
  hook_event_name: string;    // Event that triggered hook
  prompt?: string;            // User prompt (UserPromptSubmit only)
  tool_name?: string;         // Tool name (PreToolUse/PostToolUse)
  tool_input?: any;           // Tool parameters (PreToolUse)
  tool_output?: any;          // Tool result (PostToolUse)
  // ... event-specific fields
}
```

---

## Common Patterns

### 1. History Capture (UOCS Pattern)

**Pattern:** Parse structured response → Save to appropriate history directory

**File Naming Convention:**
```
YYYY-MM-DD-HHMMSS_TYPE_description.md
```

**Types:**
- `WORK` - General task completions
- `LEARNING` - Problem-solving learnings
- `SESSION` - Session summaries
- `RESEARCH` - Research findings (from agents)
- `FEATURE` - Feature implementations (from agents)
- `DECISION` - Architectural decisions (from agents)

**Example pattern (from WorkCompletionLearning.hook.ts):**
```typescript
import { getLearningCategory, isLearningCapture } from './lib/learning-utils';
import { getPSTTimestamp, getYearMonth } from './lib/time';

const structured = extractStructuredSections(lastMessage);
const isLearning = isLearningCapture(text, structured.summary, structured.analysis);

// If learning content detected, capture to LEARNING/
if (isLearning) {
  const category = getLearningCategory(text);  // 'SYSTEM' or 'ALGORITHM'
  const targetDir = join(baseDir, 'MEMORY', 'LEARNING', category, getYearMonth());
  const filename = generateFilename(description, 'LEARNING');
  writeFileSync(join(targetDir, filename), content);
}
```

**Structured Sections Parsed:**
- `📋 SUMMARY:` - Brief overview
- `🔍 ANALYSIS:` - Key findings
- `⚡ ACTIONS:` - Steps taken
- `✅ RESULTS:` - Outcomes
- `📊 STATUS:` - Current state
- `➡️ NEXT:` - Follow-up actions
- `🎯 COMPLETED:` - One-line completion summary

---

### 2. Agent Type Detection

**Pattern:** Identify which agent is executing → Route appropriately

```typescript
// Agent detection pattern
let agentName = getAgentForSession(sessionId);

// Detect from Task tool
if (hookData.tool_name === 'Task' && hookData.tool_input?.subagent_type) {
  agentName = hookData.tool_input.subagent_type;
  setAgentForSession(sessionId, agentName);
}

// Detect from CLAUDE_CODE_AGENT env variable
else if (process.env.CLAUDE_CODE_AGENT) {
  agentName = process.env.CLAUDE_CODE_AGENT;
}

// Detect from path (subagents run in /agents/name/)
else if (hookData.cwd && hookData.cwd.includes('/agents/')) {
  const agentMatch = hookData.cwd.match(/\/agents\/([^\/]+)/);
  if (agentMatch) agentName = agentMatch[1];
}
```

**Session Mapping:** `~/.claude/WORKOS/MEMORY/STATE/agent-sessions.json`
```json
{
  "session-id-abc123": "engineer",
  "session-id-def456": "researcher"
}
```

---

### 3. Tab Title + Color State Architecture

**Pattern:** Visual state feedback through tab colors and title suffixes

**State Flow:**

| Event | Hook | Tab Title | Inactive Color | State |
|-------|------|-----------|----------------|-------|
| UserPromptSubmit | `PromptProcessing.hook.ts` | `⚙️ Summary…` | Orange `#B35A00` | Working |
| Inference | `PromptProcessing.hook.ts` | `🧠 Analyzing…` | Orange `#B35A00` | Inference |
| Stop (success) | `handlers/TabState.ts` | `Summary` | Green `#022800` | Completed |
| Stop (question) | `handlers/TabState.ts` | `Summary?` | Teal `#0D4F4F` | Awaiting Input |
| Stop (error) | `handlers/TabState.ts` | `Summary!` | Orange `#B35A00` | Error |

**Active Tab:** Always Dark Blue `#002B80` (state colors only affect inactive tabs)

**Why This Design:**
- **Instant visual feedback** - See state at a glance without reading
- **Color-coded priority** - Teal tabs need attention, green tabs are done
- **Suffix as state indicator** - Works even in narrow tab bars
- **Haiku only on user input** - One AI call per prompt (not per tool)

**State Detection (in Stop hook):**
1. Check transcript for `AskUserQuestion` tool → `awaitingInput`
2. Check `📊 STATUS:` for error patterns → `error`
3. Default → `completed`

**Text Colors:**
- Active tab: White `#FFFFFF` (always)
- Inactive tab: Gray `#A0A0A0` (always)

**Active Tab Background:** Dark Blue `#002B80` (always - state colors only affect inactive tabs)

**Tab Icons:**
- 🧠 Brain - AI inference in progress (Haiku/Sonnet thinking)
- ⚙️ Gear - Processing/working state

**Full Documentation:** See `~/.claude/WORKOS/DOCUMENTATION/Terminal/TerminalTabs.md`

---

### 4. Async Non-Blocking Execution

**Pattern:** Hook executes quickly → Launch background processes for slow operations

```typescript
// PromptProcessing.hook.ts pattern
// Set immediate tab title (fast)
execSync(`printf '\\033]0;${titleWithEmoji}\\007' >&2`);

// Launch background process for Haiku summary (slow)
Bun.spawn(['bun', `${paiDir}/hooks/PromptProcessing.hook.ts`, prompt], {
  stdout: 'ignore',
  stderr: 'ignore',
  stdin: 'ignore'
});

process.exit(0);  // Exit immediately
```

**Key Principle:** Hooks must never block Claude Code. Always exit quickly, use background processes for slow work.

---

### 5. Graceful Failure

**Pattern:** Wrap everything in try/catch → Log errors → Exit successfully

```typescript
async function main() {
  try {
    // Hook logic here
  } catch (error) {
    // Log but don't fail
    console.error('Hook error:', error);
  }

  process.exit(0);  // Always exit 0
}
```

**Why:** If hooks crash, Claude Code may freeze. Always exit cleanly.

---

## Creating Custom Hooks

### Step 1: Choose Hook Event
Decide which event should trigger your hook (SessionStart, Stop, PostToolUse, etc.)

### Step 2: Create Hook Script

**Template:**
```typescript
#!/usr/bin/env bun

interface HookInput {
  session_id: string;
  transcript_path: string;
  hook_event_name: string;
  // ... event-specific fields
}

async function main() {
  try {
    // Read stdin
    const input = await Bun.stdin.text();
    const data: HookInput = JSON.parse(input);

    // Your hook logic here
    console.log(`Hook triggered: ${data.hook_event_name}`);

    // Example: Read transcript
    const fs = require('fs');
    const transcript = fs.readFileSync(data.transcript_path, 'utf-8');

    // Do something with the data

  } catch (error) {
    // Log but don't fail
    console.error('Hook error:', error);
  }

  process.exit(0);  // Always exit 0
}

main();
```

### Step 3: Make Executable
```bash
chmod +x ~/.claude/hooks/my-custom-hook.ts
```
> **Note:** WorkOS hooks are registered BARE (`$HOME/.claude/hooks/<Name>.hook.ts`, no `bun` prefix — 69 of the 70 hook-script commands in `hooks/hooks.json`; `HookHealer` is the one exception, and the two `WORKOS/TOOLS/` commands are `bun`-prefixed scripts, not hooks), so the shebang + execute bit ARE required. A `bun` prefix would make them optional, but that is not how settings.json is wired (contradiction flagged in public issue #1600, @cristbc).

### Step 4: Add to settings.json
```json
{
  "hooks": {
    "Stop": [
      {
        "hooks": [
          {
            "type": "command",
            "command": "$HOME/.claude/hooks/my-custom-hook.ts"
          }
        ]
      }
    ]
  }
}
```

### Step 5: Test
```bash
# Test hook directly
echo '{"session_id":"test","transcript_path":"/tmp/test.jsonl","hook_event_name":"Stop"}' | bun ~/.claude/hooks/my-custom-hook.ts
```

### Step 6: Restart Claude Code
Hooks are loaded at startup. Restart to apply changes.

---

## Hook Development Best Practices

### 1. **Fast Execution**
- Hooks should complete in < 500ms
- Use background processes for slow work (Haiku API calls, file processing)
- Exit immediately after launching background work

### 2. **Graceful Failure**
- Always wrap in try/catch
- Log errors to stderr (available in hook debug logs)
- Always `process.exit(0)` - never throw or exit(1)

### 3. **Non-Blocking**
- Never wait for external services (unless they respond quickly)
- Use `.catch(() => {})` for async operations
- Fail silently if optional services are offline

### 4. **Stdin Reading**
- Use timeout when reading stdin (Claude Code may not send data immediately)
- Handle empty/invalid input gracefully

```typescript
const decoder = new TextDecoder();
const reader = Bun.stdin.stream().getReader();

const timeoutPromise = new Promise<void>((resolve) => {
  setTimeout(() => resolve(), 500);  // 500ms timeout
});

await Promise.race([readPromise, timeoutPromise]);
```

### 5. **File I/O**
- Check `existsSync()` before reading files
- Create directories with `{ recursive: true }`
- Use local-timezone timestamps for consistency (the utility resolves from your WorkOS config)

### 6. **Environment Access**
- All `settings.json` env vars available via `process.env`
- Use `$HOME/.claude` in settings.json for portability
- Access in code via `process.env.WORKOS_DIR`

### 7. **Logging**
- Log useful debug info to stderr for troubleshooting
- Include relevant metadata (session_id, tool_name, etc.)
- Never log sensitive data (API keys, user content)

---

## Troubleshooting

### Hook Not Running

**Check:**
1. Is hook script executable? `chmod +x ~/.claude/hooks/my-hook.ts` (required: WorkOS registers hooks bare, without a `bun` prefix)
2. Is path correct in settings.json? Use `$HOME/.claude/hooks/...` (bare, matching every existing registration except `HookHealer`)
3. Is settings.json valid JSON? `jq . ~/.claude/settings.json`
4. Can the hook process find `bun`? Bare registration + `#!/usr/bin/env bun` means the harness's PATH must reach bun; a stripped environment fails every `.ts` hook with `env: bun: No such file or directory` (public issues #1368/#1600, @cristbc)
4. Did you restart Claude Code after editing settings.json?

**Debug:**
```bash
# Test hook directly
echo '{"session_id":"test","transcript_path":"/tmp/test.jsonl","hook_event_name":"Stop"}' | bun ~/.claude/hooks/my-hook.ts

# Check hook logs (stderr output)
tail -f ~/.claude/hooks/debug.log  # If you add logging
```

---

### Hook Hangs/Freezes Claude Code

**Cause:** Hook not exiting (infinite loop, waiting for input, blocking operation)

**Fix:**
1. Add timeouts to all blocking operations
2. Ensure `process.exit(0)` is always reached
3. Use background processes for long operations
4. Check stdin reading has timeout

**Prevention:**
```typescript
// Always use timeout
setTimeout(() => {
  console.error('Hook timeout - exiting');
  process.exit(0);
}, 5000);  // 5 second max
```

---

### Work Not Capturing

**Check:**
1. Does `~/.claude/WORKOS/MEMORY/` directory exist?
2. Does `work.json` contain an entry for this session? `jq '.sessions | to_entries[] | select(.value.sessionUUID == "<uuid>")' ~/.claude/WORKOS/MEMORY/STATE/work.json`
3. Is hook actually running? Check `~/.claude/WORKOS/MEMORY/RAW/` for events
4. File permissions? `ls -la ~/.claude/WORKOS/MEMORY/WORK/`

**Debug:**
```bash
# All sessions in the registry, sorted by recency:
jq '.sessions | to_entries | map({slug: .key, phase: .value.phase, mode: .value.mode, updatedAt: .value.updatedAt}) | sort_by(.updatedAt) | reverse' ~/.claude/WORKOS/MEMORY/STATE/work.json

# Check recent work directories
ls -lt ~/.claude/WORKOS/MEMORY/WORK/ | head -10
ls -lt ~/.claude/WORKOS/MEMORY/LEARNING/$(date +%Y-%m)/ | head -10

# Check UUID-collision anomalies (multiple ISAs on one harness UUID):
tail ~/.claude/WORKOS/MEMORY/OBSERVABILITY/work-anomalies.jsonl
```

**Common Issues:**
- No entry in `work.json` for this sessionUUID → ISASync didn't fire (ISA never written), or PromptProcessing's `upsertSession` was skipped (rare)
- Session aged out → cleanup thresholds in `hooks/lib/isa-utils.ts` (native 4h, complete 24h, everything else 7d) — bump if you want longer
- Duplicate native rows for one UUID → upstream of native idempotency fix; clear with `jq` or wait for the cleanup pass
- UUID collision (two ISAs sharing one harness UUID) → check `work-anomalies.jsonl`; resolve by closing one ISA or by starting a fresh Claude Code session

---

### Stop Event Not Firing (RESOLVED)

**Original Issue:** Stop events were not firing consistently in earlier Claude Code versions, causing work capture to fail silently.

**Resolution:** Fixed in Claude Code updates. The Stop hooks now fire reliably. The individual hook pattern (each `.hook.ts` delegating to `handlers/`) was implemented in part to work around this — and remains the production architecture.

**Status:** RESOLVED — Stop events now fire reliably. Individual Stop hooks handle all post-response work.

---

### Agent Detection Failing

**Check:**
1. Is `~/.claude/WORKOS/MEMORY/STATE/agent-sessions.json` writable?
2. Is `[AGENT:type]` tag in `🎯 COMPLETED:` line?
3. Is agent running from correct directory? (`/agents/name/`)

**Debug:**
```bash
# Check session mappings
cat ~/.claude/WORKOS/MEMORY/STATE/agent-sessions.json | jq .

# Check subagent-stop debug log
tail -f ~/.claude/hooks/subagent-stop-debug.log
```

**Fix:**
- Ensure agents include `[AGENT:type]` in completion line
- Verify Task tool passes `subagent_type` parameter
- Check cwd includes `/agents/` in path

---

### Transcript Type Mismatch (Fixed 2026-01-11)

**Symptom:** Context reading functions return empty results even though transcript has data

**Root Cause:** Claude Code transcripts use `type: "user"` but hooks were checking for `type: "human"`.

**Affected Hooks:**
- `PromptProcessing.hook.ts` - Couldn't read user messages for context
- `SatisfactionCapture.hook.ts` - Same issue

**Fix Applied:**
1. Changed `entry.type === 'human'` → `entry.type === 'user'`
2. Improved content extraction to skip `tool_result` blocks and only capture actual text

**Verification:**
```bash
# Check transcript type field
grep '"type":"user"' "$(ls -d ~/.claude/projects/*/ | head -1)"*.jsonl | head -1 | jq '.type'
# Should output: "user" (not "human")
```

**Prevention:** When parsing transcripts, always verify the actual JSON structure first.

---

### Context Loading Issues (SessionStart)

**Check:**
1. Does `~/.claude/CLAUDE.md` exist?
2. Is `LoadContext.hook.ts` executable?
3. Is `WORKOS_DIR` env variable set correctly?

**Debug:**
```bash
# Test context loading directly
bun ~/.claude/hooks/LoadContext.hook.ts

# Should output <system-reminder> with SKILL.md content
```

**Common Issues:**
- Subagent sessions loading main context → Fixed (subagent detection in hook)
- File not found → Check `WORKOS_DIR` environment variable
- Permission denied → `chmod +x ~/.claude/hooks/LoadContext.hook.ts` (required — WorkOS hooks are registered bare, without a `bun` prefix)

---

## Advanced Topics

### Multi-Hook Execution Order

Hooks in same event execute **sequentially** in order defined in settings.json:

```json
{
  "Stop": [
    {
      "hooks": [
        { "command": "$HOME/.claude/hooks/LastResponseCache.hook.ts" }  // Example: one of several Stop hooks
      ]
    }
  ]
}
```

**Note:** If first hook hangs, second won't run. Keep hooks fast!

---

### Matcher Patterns

`"matcher"` field filters which events trigger hook:

```json
{
  "PostToolUse": [
    {
      "matcher": "Bash",  // Only Bash tool executions
      "hooks": [...]
    },
    {
      "matcher": "*",     // All tool executions
      "hooks": [...]
    }
  ]
}
```

**Patterns:**
- `"*"` - All events
- `"Bash"` - Specific tool name
- `""` - Empty (all events, same as `*`)

---

### Hook Data Payloads by Event Type

**SessionStart:**
```typescript
{
  session_id: string;
  transcript_path: string;
  hook_event_name: "SessionStart";
  cwd: string;
}
```

**UserPromptSubmit:**
```typescript
{
  session_id: string;
  transcript_path: string;
  hook_event_name: "UserPromptSubmit";
  prompt: string;  // The user's prompt text
}
```

**PreToolUse:**
```typescript
{
  session_id: string;
  transcript_path: string;
  hook_event_name: "PreToolUse";
  tool_name: string;
  tool_input: any;  // Tool parameters
}
```

**PostToolUse:**
```typescript
{
  session_id: string;
  transcript_path: string;
  hook_event_name: "PostToolUse";
  tool_name: string;
  tool_input: any;
  tool_output: any;  // Tool result
  error?: string;    // If tool failed
}
```

**Stop:**
```typescript
{
  session_id: string;
  transcript_path: string;
  hook_event_name: "Stop";
}
```

**SessionEnd:**
```typescript
{
  conversation_id: string;  // Note: different field name
  timestamp: string;
}
```

---

## Examples

### One hook, one event

The whole hook idea at its smallest: **record a one-line summary whenever a long task finishes.** Nothing about the model changes — a deterministic script fires on an event and produces one observable effect.

- **Event:** `Stop` (the assistant finished responding).
- **Hook:** reads the turn's outcome, and if the work was non-trivial, appends a one-sentence summary to a local log.
- **Effect:** the log gains "Done — tests green, deploy verified" without anyone watching the terminal.

The value is that it is *deterministic and always-on*: the summary isn't something the model chooses to do when it remembers — it's wired to the event, so it happens every time, whether or not the model is paying attention. That is the entire point of a hook: move a behavior you want *every time* out of the model's judgment and into the harness.

### A hook firing, over time

```mermaid
sequenceDiagram
    participant U as User
    participant M as Model
    participant H as Stop hook
    participant V as Summary log
    U->>M: "ship the fix"
    M->>M: edits, runs tests, verifies deploy
    M-->>U: final response
    Note over M,H: the Stop event fires automatically
    M->>H: Stop event + turn transcript
    H->>H: outcome non-trivial? (deterministic check)
    H->>V: append one-line summary
    V-->>U: log reads "Done — tests green, deploy verified"
```

The hook sits *after* the model's turn, reads what happened, and acts — the model never had to decide to log anything. Swap the Stop hook for a `PostToolUse` hook and the same shape gives you auto-format-on-save; swap it for a `UserPromptSubmit` hook and you get context injected before the model even sees the prompt. Different event, same contract: **the harness runs the behavior so the model doesn't have to remember to.**

### When a hook should exist (and when it shouldn't)

A behavior earns a hook when all three are true — it should happen *every* time, it can be decided *deterministically* (no judgment call), and forgetting it is *costly*:

- **Good hook:** auto-commit after each verified change. Every time, purely mechanical, and a lost checkpoint hurts. → a `PostToolUse` hook.
- **Good hook:** tag fetched web content as untrusted data before the model reads it. Every time, deterministic, and missing it is a security hole. → a `PostToolUse` hook.
- **Bad hook:** "write better commit messages." Not deterministic — it's a judgment the model should make in context. Encoding it as a hook would either misfire or do nothing. This belongs in guidance, not a hook.

The test is the one the whole system uses: if a smarter model would still need this done *mechanically and every time*, it's a hook; if a smarter model would just do it well on its own, it isn't.

---

## Related Documentation

- **Agent System:** `WORKOS/DOCUMENTATION/Agents/AgentSystem.md`
- **History/Memory:** `~/.claude/WORKOS/DOCUMENTATION/Memory/MemorySystem.md`

---

## Quick Reference Card

```
HOOK LIFECYCLE:
1. Event occurs (SessionStart, Stop, etc.)
2. Claude Code writes hook data to stdin
3. Hook script executes
4. Hook reads stdin (with timeout)
5. Hook performs actions (capture, guard, etc.)
6. Hook exits 0 (always succeeds)
7. Claude Code continues

HOOKS BY EVENT (11 events wired in hooks/hooks.json; regenerated 2026-10-21.
40 distinct hook files registered [39 .hook.ts + ContextReduction.hook.sh];
53 hook files on disk [52 .hook.ts + 1 .sh] — the 13 unregistered .hook.ts are
imported as run()/check() modules by dispatchers, noted [via X] below):

SESSION START (4 hooks + 2 TOOLS):
  bun HookHealer.hook.ts         Self-heal registered-script exec bits [timeout 10]
  KittyEnvPersist.hook.ts        Persist Kitty env vars + tab reset
  LoadContext.hook.ts            Dynamic context injection (relationship, learning, work)
  bun FreshnessCache.ts          (TOOL) warm pai-freshness cache [timeout 5, async]
  MaintenanceJobs.hook.ts        Per-job throttled detached jobs: memory consolidation + ProposalGC (20 h), WorkSweep (1 h), CommitmentSweep (20 h) [timeout 5]
  bun SettingsBackport.ts; MergeSettings.ts  (TOOLS) regenerate settings.json [timeout 15, async]

USER PROMPT SUBMIT (9 hooks, in fire order):
  PromptProcessing.hook.ts       Tab title + session naming via Haiku [timeout 30, async]
  SatisfactionCapture.hook.ts    User satisfaction signal capture (reads last-response.txt) [timeout 20, async]
  ReminderRouter.hook.ts         "remind me" parser → labeled GitHub issue [timeout 5, async]
  VersionDrift.hook.ts           Core surface drifted past last tag → surface /vb, no LLM [timeout 10, async]
  DriftReminder.hook.ts          Deterministic format drift nudge, no LLM [timeout 5, async]
  MemoryTurnStart.hook.ts        ONE memory hook: LoadMemory [via X] + MemoryDeltaSurface [via X] [timeout 8]
  AlgorithmNudge.hook.ts         Algorithm live nudge (skill-routing always-on; principal-message on a live run) [timeout 5, async]
  TimeContext.hook.ts            Live per-turn wall-clock line, tz from settings.json [timeout 5, async]
  ModelRungGuard.hook.ts         Reports a session running below the settings.json model pin [timeout 5, async]

PRE TOOL USE (4 distinct hooks):
  ContextReduction.hook.sh       Context reduction via RTK — REWRITES command [Bash]
  AgentInvocation.hook.ts        subagent_start capture [Agent]
  TabState.hook.ts               Tab teal "awaiting input" [AskUserQuestion]
  PreToolGuard.hook.ts           ONE blocking dispatcher: SystemFileGuard.check [via X] +
                                 ISAStaleWriteGuard.check on Write/Edit/MultiEdit;
                                 BashSystemWriteGuard.check [via X] + CommunicationSkillGuard.check [via X] +
                                 EgressClassGuard.check [via X] + PublicPushGate.check [via X] on Bash.
                                 FIRST block wins (exit 2). [Bash|Write|Edit|MultiEdit]

POST TOOL USE (13 distinct hooks):
  AgentInvocation.hook.ts        subagent_stop with duration [Agent]
  Safety.hook.ts                 Tag external content as data [WebFetch, WebSearch, mcp__.*,
                                 ToolSearch; timeout 5] — same file as PermissionRequest hook
                                 below; dispatches by event
  TabState.hook.ts               Post-question tab restore [AskUserQuestion]
  ISAStaleWriteGuard.hook.ts     Stale-ISA write guard [Read, Write, Edit, MultiEdit]
  ISASync.hook.ts                ISA → work.json sync [Write, Edit, MultiEdit]
  CheckpointPerISC.hook.ts       Per-ISC auto-commit [Write, Edit, MultiEdit; timeout 30]
  ConfigEvalFire.hook.ts         Config-eval trigger [Write, Edit, MultiEdit]
  AtlasEventCapture.hook.ts      Atlas asset-event capture [Write, Edit, MultiEdit, Bash; timeout 5]
  KnowledgeWriteGuard.hook.ts    Knowledge-note schema advisory [Write, Edit, MultiEdit; timeout 5]
  ComplexityRatchet.hook.ts      Advisory complexity-drift meter, advise-only [Write, Edit, MultiEdit]
  PostToolObserver.hook.ts       ONE sync catch-all: LoopDetector [via X] + AlgorithmNudge [via X] + SystemChangeSurface [via X] (catch-all) [timeout 5]
  LoopDetector.hook.ts           Direct catch-all registration [timeout 5]
  EventLogger.hook.ts            Unified observability writer: tool-activity + skill-execution (catch-all) [async]

POST TOOL USE FAILURE (3 hooks, in fire order):
  EventLogger.hook.ts            tool-failures.jsonl (formerly ToolFailureTracker)
  AlgorithmNudge.hook.ts         probe-failed + broken-capability nudge [timeout 5]
  LoopDetector.hook.ts           Repeat-failure / hammering detection [timeout 5]

STOP (7 hooks across 2 blocks, in fire order):
  LastResponseCache.hook.ts      Cache response for SatisfactionCapture + DriftReminder bridge
  TabState.hook.ts               Tab title/color reset after response (formerly ResponseTabReset)
  ISARenderOnStop.hook.ts        Re-render completed ISAs (only if ISA.html already exists)
  SpendAuditor.hook.ts           Outcome-side spend verification, detached worker; never blocks
  StopGates.hook.ts              ONE gate hook: FormatGate, VerificationGate, ISACloseGate, ISAFoldGate, ISAGate .run [via X] in order; FIRST block wins
  MemoryReviewFire.hook.ts       Owns the WHOLE memory-review cadence: tick at Stop, fire MemoryReviewer.ts
                                 detached (env-scrubbed) at turn_threshold ∧ min_minutes_between. pending_review always false now.
  MemoryHealthGate.hook.ts       Autonomic-memory health assertions → memory-health.jsonl
                                 [separate block; timeout 15, async] — also registered at SessionEnd

STOP FAILURE (1 hook):
  EventLogger.hook.ts            Capture abnormal-stop diagnostics (formerly StopFailureHandler)

SUBAGENT START / SUBAGENT STOP (not registered):
  (keys absent — tracked at PreToolUse:Agent / PostToolUse:Agent → AgentInvocation.hook.ts)

PERMISSION REQUEST (1 hook, 2 matchers):
  Safety.hook.ts                 Shape-classifier auto-approve [Write|Edit|MultiEdit|Bash, mcp__.*]
                                 — same file as PostToolUse hook above; dispatches by event.
                                 PermissionRequest path uses lib/safety-classifier.ts to allow safe shapes
                                 (read-only commands, dev binaries, trusted-workspace targets, mcp pre-vetted,
                                 shell-control-flow over data) and falls through to native prompt on
                                 dangerous/credential/injection shapes. Cache + observability JSONL.

TASK CREATED (1 hook):
  TaskGovernance.hook.ts         Empty-description block + task rate limit

CONFIG CHANGE (1 hook):
  EventLogger.hook.ts            Security audit trail to OBSERVABILITY/ (formerly ConfigAudit)

SESSION END (6 hooks):
  WorkCompletionLearning.hook.ts Work/learning capture to MEMORY/
  SessionCleanup.hook.ts         Mark WORK dir complete, clear state, reset tab
  UpdateCounts.hook.ts           Refresh system counts (skills, hooks, signals)
  MemoryHealthGate.hook.ts       MemoryHealthCheck.ts: autonomic-memory registration/health assertions → memory-health.jsonl (also registered at Stop)
  DocIntegrity.hook.ts           Cross-ref + arch-summary regen (self-gates when no system files changed)
  IntegrityCheck.hook.ts         System integrity checks

NOT REGISTERED (event keys absent from settings.json; hook files also gone):
  PreCompact / PostCompact / InstructionsLoaded — see Sections 10, 11, 17.

RETIRED IN THE 2026-07-11 HOOKS-BPE PASS (deleted or folded):
  TheRouter (removed 2026-07-11), MemoryReviewTrigger, OutputFormatGate, SecurityPipeline,
  ContentScanner, TelosSummarySync [now DerivedSync.ts, a systemd --user path unit], RelationshipMemory, GrepWiringEnrich,
  IdentityToSettingsSync, SettingsBackport.hook — folded loggers/gates/painters:
  ToolActivityTracker+ToolFailureTracker+SkillExecutionLog+ConfigAudit+
  StopFailureHandler → EventLogger; SetQuestionTab+QuestionAnswered+
  ResponseTabReset → TabState; FormatGate+VerificationGate+ISACloseGate+ISAGate → StopGates;
  LoadMemory+MemoryDeltaSurface → MemoryTurnStart; SystemChangeSurface → PostToolObserver (LoopDetector now also registered directly);
  SystemFileGuard+CommunicationSkillGuard+EgressClassGuard → PreToolGuard
  (BashSystemWriteGuard and PublicPushGate were later added as PreToolGuard lanes).

REMOVED IN WORKOS (not part of this fork):
  VoiceCompletion / VoiceNotification hooks, WritingGate, DeployRegistrationGate,
  and the Pulse HTTP routes (SkillGuard, AgentGuard).

KEY FILES:
~/.claude/settings.json              Hook configuration (GENERATED by MergeSettings.ts — read, don't hand-edit)
~/.claude/settings.system.json       System-side hook/permission source (SYSTEM)
~/.claude/WORKOS/USER/CONFIG/settings.user.json  User-side source (USER); its plain-array events REPLACE the system array
~/.claude/WORKOS/TOOLS/MergeSettings.ts  Merges system + user → settings.json (runs async at SessionStart)
~/.claude/hooks/                     Hook scripts (53 files: 52 .hook.ts + ContextReduction.hook.sh; 40 distinct hook files registered)
~/.claude/hooks/handlers/            Handler modules (8 files)
~/.claude/hooks/lib/                 Shared libraries (30 files: 29 .ts + spend-auditor-prompt.md)
~/.claude/hooks/lib/learning-utils.ts Learning categorization
~/.claude/hooks/lib/time.ts          PST timestamp utilities
~/.claude/WORKOS/MEMORY/WORK/               Work tracking
~/.claude/WORKOS/MEMORY/LEARNING/           Learning captures
~/.claude/WORKOS/MEMORY/STATE/              Runtime state
~/.claude/WORKOS/MEMORY/STATE/events.jsonl  Unified event log (append-only)
~/.claude/WORKOS/MEMORY/OBSERVABILITY/      Tool failures, agent spawns, config changes

INFERENCE TOOL (for hooks needing AI):
Path: ~/.claude/WORKOS/TOOLS/Inference.ts
Import: import { inference } from '../../.claude/WORKOS/TOOLS/Inference'
Levels: fast (haiku/15s) | standard (sonnet/30s) | smart (opus/90s)

TAB STATE SYSTEM:
Inference: 🧠…  Orange #B35A00  (AI thinking)
Working:   ⚙️…  Orange #B35A00  (processing)
Completed:      Green  #022800  (task done)
Awaiting:  ?    Teal   #0D4F4F  (needs input)
Error:     !    Orange #B35A00  (problem detected)
Active Tab: Always Dark Blue #002B80 (state colors = inactive only)

```
<!-- regenerated from hooks/hooks.json 2026-10-21 -->

---

## Shared Libraries

The hook system uses shared TypeScript libraries to eliminate code duplication:

### `hooks/lib/learning-utils.ts`
Shared learning categorization logic.

```typescript
import { getLearningCategory, isLearningCapture } from './lib/learning-utils';

// Categorize learning as SYSTEM (tooling/infra) or ALGORITHM (task execution)
const category = getLearningCategory(content, comment);
// Returns: 'SYSTEM' | 'ALGORITHM'

// Check if response contains learning indicators
const isLearning = isLearningCapture(text, summary, analysis);
// Returns: boolean (true if 2+ learning indicators found)
```

**Used by:** PromptProcessing, WorkCompletionLearning

### `hooks/lib/time.ts`
Shared PST timestamp utilities.

```typescript
import {
  getPSTTimestamp,    // "2026-01-10 20:30:00 PST"
  getPSTDate,         // "2026-01-10"
  getYearMonth,       // "2026-01"
  getISOTimestamp,    // ISO8601 with offset
  getFilenameTimestamp, // "2026-01-10-203000"
  getPSTComponents    // { year, month, day, hours, minutes, seconds }
} from './lib/time';
```

**Used by:** PromptProcessing, WorkCompletionLearning, SessionSummary

### `hooks/lib/identity.ts`
Identity and principal configuration from settings.json.

```typescript
import { getIdentity, getPrincipal, getDAName, getPrincipalName } from './lib/identity';

const identity = getIdentity();    // { name, fullName, displayName, color, personality }
const principal = getPrincipal();  // { name, pronunciation, timezone }
```

**Used by:** PromptProcessing, handlers/TabState.ts

### `WORKOS/TOOLS/Inference.ts`
Unified AI inference with four run levels (low/medium/high/max, bound via `models.ts` `EFFORT_MODEL`).

```typescript
import { inference } from '../../.claude/WORKOS/TOOLS/Inference';

// Low (Haiku) - quick tasks, 15s timeout
const result = await inference({
  systemPrompt: 'Summarize in 3 words',
  userPrompt: text,
  level: 'low',
});

// Medium (Sonnet) - balanced reasoning, 30s timeout
const result = await inference({
  systemPrompt: 'Analyze sentiment',
  userPrompt: text,
  level: 'medium',
  expectJson: true,
});

// High (Opus) - deep reasoning, 90s timeout
const result = await inference({
  systemPrompt: 'Strategic analysis',
  userPrompt: text,
  level: 'high',
});

// Result shape
interface InferenceResult {
  success: boolean;
  output: string;
  parsed?: unknown;  // if expectJson: true
  error?: string;
  latencyMs: number;
  level: 'low' | 'medium' | 'high' | 'max';
}
```

**Used by:** PromptProcessing (consolidated from RatingCapture + UpdateTabTitle + SessionAutoName + SessionAnalysis + ModeClassifier + ClassifierTelemetry)

---

## Unified Event System

Alongside existing filesystem state writes (algorithm-state JSON, ISAs, session-names.json, etc.), hooks can emit structured events to a single append-only JSONL log. This provides a unified observability layer without replacing any existing state management.

### Components

| Component | Path | Role |
|-----------|------|------|
| Emitter | `hooks/lib/events.ts` | `appendEvent()` / `emitFindingSet()` — the shared writer every emitter uses |
| Log | `WORKOS/MEMORY/STATE/events.jsonl` | Append-only JSONL, never rotated |
| Model-facing reader | `hooks/lib/advisory-readback.ts` | SessionStart digest of the current finding set, injected by `LoadContext.hook.ts` |
| Shell reader | — | `tail -f` / `jq` (see § Consuming Events) |

### Usage in Hooks

Hooks call `appendEvent()` as a secondary write **alongside** their existing state writes. The emitter is synchronous, fire-and-forget, and silently swallows errors so it never blocks or crashes a hook.

```typescript
// Inside an existing hook, AFTER the normal state write:
// appendEvent() writes to ~/.claude/WORKOS/MEMORY/STATE/events.jsonl
appendEvent({ type: 'work.created', source: 'ISASync', slug: 'my-task' });
```

### Event Structure

Every event has a common base shape plus type-specific fields:
- `timestamp` (ISO 8601) -- auto-injected by `appendEvent()`
- `session_id` -- auto-injected from `CLAUDE_SESSION_ID` env
- `source` -- the hook or handler name that emitted the event
- `type` -- dot-separated topic (e.g., `algorithm.phase`, `work.created`, `rating.captured`)

Events use a dot-separated topic hierarchy for filtering. A `custom.*` escape hatch allows arbitrary extension without modifying the type system.

### Event Type Categories

Types below are the ones actually written to `events.jsonl` by shipped code. The
hierarchy is open — a new emitter picks a topic and calls `appendEvent()` — but this
table lists emitters, not intentions: if a type is not here, nothing writes it.

| Type | Emitter | Shape |
|------|---------|-------|
| `doc.integrity.memory_dir` | `handlers/MemoryDirIntegrity.ts` | finding set (see below) |
| `doc.integrity.knowledge_conformance` | `handlers/KnowledgeConformance.ts` | finding set (see below) |
| `custom.*` | — | escape hatch for local emitters |

Other observability streams write their own files and are NOT part of this log:
`OBSERVABILITY/*.jsonl` (EventLogger — tool activity, failures, config changes),
`OBSERVABILITY/subagent-events.jsonl`,
`STATE/work-events.jsonl`, `ATLAS/events.jsonl`.

### Finding-set events

A checker that reports a set of problems uses `emitFindingSet()`, which adds
`ok`, `finding_count`, and a `findings` array of `{ key, kind, detail }`.

- **One event per completed check, carrying the full current set — including the
  empty set.** An emitter that speaks only when it has findings can never say that
  a problem was fixed, so the SessionStart digest shows it forever.
- **No event on a skipped check.** No emission means "not re-checked, previous set
  stands"; an empty set means "checked, all clear". Emitting the empty set from a
  skip path silently clears findings nobody looked at.
- **`key` is stable across runs and free of counts, timestamps, and ordinals** —
  the readback compares key sets to decide whether anything changed.

### Consuming Events

```bash
# Live tail (real-time monitoring)
tail -f ~/.claude/WORKOS/MEMORY/STATE/events.jsonl | jq

# Filter by type
tail -f ~/.claude/WORKOS/MEMORY/STATE/events.jsonl | jq 'select(.type | startswith("algorithm."))'

# Programmatic (Node/Bun fs.watch)
import { watch } from 'fs';
const eventsPath = `${process.env.HOME}/.claude/WORKOS/MEMORY/STATE/events.jsonl`;
watch(eventsPath, (eventType) => { /* read new lines */ });
```

### Key Principles

- **Additive only** -- events supplement existing state files, they never replace them
- **Append-only** -- `events.jsonl` is an immutable log, never rewritten or truncated by hooks
- **Graceful failure** -- write errors are swallowed; events are observability, not critical path
- **One file** -- all event types go to a single `events.jsonl` for simple tailing and watching

---

**Last Updated:** 2026-07-11
**Status:** Production — unified `STATE/events.jsonl` log written through `hooks/lib/events.ts`, read at SessionStart by `hooks/lib/advisory-readback.ts` (gated on `dynamicContext.advisoryReadback`). Separately, `EventLogger.hook.ts` is the single writer of the `MEMORY/OBSERVABILITY/*.jsonl` streams across PostToolUse/PostToolUseFailure/StopFailure/ConfigChange (count auto-computed by UpdateCounts.ts) — a different store, not this log.
**Maintainer:** WorkOS System

### Drift & Routing hooks (added 2026-06-10, Fable-prompt upgrades R1/R4)

- **`DriftReminder.hook.ts`** (UserPromptSubmit) — deterministic format drift nudges. Scans the Stop-hook last-response cache (`MEMORY/STATE/last-response.txt`) with the banned-vocab regex (`hooks/lib/banned-vocab.ts`, derived from DA_IDENTITY's ban list — regenerate when that list changes), banner-presence check, and em-dash count. Fires at most one `DRIFT-REMINDER:` context line; budget 1-per-5-turns (`MEMORY/STATE/drift-reminder.json`); consecutive identical findings dedupe, a clean response re-arms; 30-min staleness guard prevents firing on a previous session's cached response. No LLM calls.
- **`SkillSurface.hook.ts`** *(retired 2026-07-11, commit `ac4f703ab`)* — historically a deterministic top-3 skill surfacer on UserPromptSubmit (`LIKELY SKILLS (may not apply): …`). Deleted in the hooks-BPE pass; no longer registered or on disk.
- **Chain note (updated 2026-07-11):** the UserPromptSubmit chain is 6 hooks (`PromptProcessing`, `SatisfactionCapture`, `ReminderRouter`, `DriftReminder`, `MemoryTurnStart`, `AlgorithmNudge`); the earlier per-prompt memory trio was already collapsed into `MemoryTurnStart`. The single-dispatcher-process consolidation the old note anticipated has partly landed via the per-event dispatchers (`MemoryTurnStart`, `PostToolObserver`, `StopGates`, `PreToolGuard`, `EventLogger`, `TabState`).
