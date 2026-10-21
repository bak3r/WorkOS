---
version: 2.0.0
---

# The Observability System

> You can't steer work you can't see (`WORKOS/DOCUMENTATION/WorkOs/WorkOsThesis.md`). Observability is the raw record behind the system — every tool call, agent, and failure as inspectable events, so both the principal and the DA can verify the hill-climb is actually climbing.

Single-source local event log for WorkOS tool activity, subagent lifecycle, memory, and tool failures. Events are appended to JSONL on local disk; there is no dashboard, HTTP server, or network sink. Readers are local tools and plain `rg`/`jq`.

## Architecture

```
Hooks / tools (emitters)
  └─ fs.appendFileSync → MEMORY/OBSERVABILITY/*.jsonl  (local disk only)
          │
          ▼
   Local readers (on demand)
   ├─ MemoryHealthCheck.ts / CortexHealth.ts / MemoryStatus.ts
   └─ rg / jq / tail, by the DA or the principal
```

## Data Flow

1. **Emitters** — hooks and tools append structured JSONL to `MEMORY/OBSERVABILITY/`
2. **Read-on-demand** — a reader tails or filters the file it needs when it needs it
3. **No push** — nothing is sent off the machine

## Event Sources

| Source | JSONL Path | Per-Source Count | Hook |
|--------|-----------|-----------------|------|
| Tool activity | `MEMORY/OBSERVABILITY/tool-activity.jsonl` | 100 | `EventLogger.hook.ts` (PostToolUse, catch-all) |
| Tool failures | `MEMORY/OBSERVABILITY/tool-failures.jsonl` | 50 | `EventLogger.hook.ts` (PostToolUseFailure) |
| Subagent events | `MEMORY/OBSERVABILITY/subagent-events.jsonl` | 50 | `AgentInvocation.hook.ts` (PreToolUse:Agent / PostToolUse:Agent) |
| Agent watchdog | stdout (Monitor notifications) | — | `Tools/AgentWatchdog.ts` via Monitor tool. Reads tool-activity.jsonl + subagent-starts.json; alerts on 90s silence with active agents. |
| Effort routing _(retired 2026-07-11)_ | `MEMORY/OBSERVABILITY/effort-router.jsonl` | — | `TheRouter.hook.ts` (retired/merged 2026-07-11) — mode/tier classification abolished, no successor writes this stream. The `MemoryReviewTrigger` MINIMAL-skip gate that read its tail is also gone. |
| ISA rework | `MEMORY/OBSERVABILITY/isa-rework.jsonl` | — | `ISASync.hook.ts` Resume-After-Complete path (Algorithm v6.9.0, 2026-05-22). One row per auto-rewind: ts, session_id, slug, prev_phase, new_phase, prev_iteration, new_iteration, body_delta_bytes. |
| Frame drift | `MEMORY/OBSERVABILITY/frame-drift.jsonl` | — | Algorithm VERIFY-phase emitter (v6.8.0). T1/T2/T3 boolean tests per ISA at VERIFY entry. |
| Reviewer runs | `MEMORY/OBSERVABILITY/reviewer-runs.jsonl` | — | `MemoryReviewer.ts` (autonomic memory). One row per reviewer execution: runId, transcript path, exchanges read, inference_duration_ms, parse_ok, dispatch_summary { total, by_type, succeeded, failed, failures }. |
| Reviewer fires | `MEMORY/OBSERVABILITY/reviewer-fires.jsonl` | — | `MemoryReviewFire.hook.ts` (Stop). Audit of when reviewer would fire if subprocess were unavailable. |
| Memory writes (Tier A) | `MEMORY/OBSERVABILITY/memory-writes.jsonl` | — | `MemoryWriter.ts`. One row per set-overwrite to `_MEMORY.md` hot-layer files. Tracks evictions. |
| Tier-B writes | `MEMORY/OBSERVABILITY/tier-b-writes.jsonl` | — | `MemorySystem.add()` routing. Audit row per logged-append to PROJECTS / CONTACTS / KNOWLEDGE / IDEAS (timestamp, type, bytes, path). |
| Pending proposals (Tier C queue) | `MEMORY/OBSERVABILITY/pending-proposals.jsonl` | — | `MemorySystem.add()` for `type:proposal`. Status lifecycle: pending → sent → accepted/rejected/edited/applied-elsewhere (or auto-applied without surfacing); `TERMINAL_STATUSES` in `WORKOS/TOOLS/lib/memory-proposals.ts` is the one authority on which of those count as resolved. Surfaced by that same lib on the inline 🧠 MEMORY line; decided via `bun WORKOS/TOOLS/ProposalDecide.ts`. |
| Identity proposals (archive) | `MEMORY/OBSERVABILITY/identity-proposals.jsonl` | — | `WORKOS/TOOLS/lib/memory-proposals.ts` surfacer. Archive of sent/accepted/rejected/edited proposals. |
| Memory retrievals | `MEMORY/OBSERVABILITY/memory-retrievals.jsonl` | — | `MemoryRetriever.getRelevantContext()` (ISC-107..112; not yet populated as of 2026-05-23; infrastructure ready). Per-turn BM25 audit. |

## Cortex evidence-driven health

The Cortex health extension is part of `WORKOS/TOOLS/MemoryHealthCheck.ts`; `WORKOS/TOOLS/CortexHealth.ts` collects and assesses its evidence. This is deliberately separate from `Cortex.ts status`: contract status reports local corpus shape, while health answers whether current reviewer, retrieval, proposal, observability, and optional-index evidence supports an operationally truthful result.

```bash
bun WORKOS/TOOLS/MemoryHealthCheck.ts --json
```

The JSON report includes the effective `thresholds`, measured `evidence`, and non-OK `findings`. Existing health exit semantics remain 0/1/2 for ok/warn/critical. Missing evidence is WARN or CRITICAL, never green.

| Evidence | Source and rule | Default threshold | Severity |
|---|---|---:|---|
| Latest reviewer run | Latest terminal `reviewer-runs.jsonl` row, plus newer run directories | success within 7 days | stale/missing WARN; latest failed, parse-failed, malformed, invalid, or timed-out CRITICAL |
| Reviewer timeout | Newer run directory without terminal row | 10-minute grace | CRITICAL |
| Retrieval | Latest `memory-retrievals.jsonl` row | 24 hours | missing, malformed, future, or stale WARN |
| Proposals | Count rows with `status:"pending"` in `pending-proposals.jsonl` | greater than 10 | WARN; malformed evidence also WARN |
| Observability retention | Recursive `.jsonl`/`.log` bytes and oldest mtime under `MEMORY/OBSERVABILITY/` | 256 MiB or 30 days | WARN |
| Optional derived index | `workos-cortex-index/v1` manifest and measured hashes | 7-day freshness | stale WARN; invalid manifest or hash mismatch CRITICAL |

The latest reviewer evidence wins over any number of earlier successes. Any malformed reviewer JSONL line is surfaced as parse failure rather than skipped. A nominal success must include `ok:true`, `parse_ok:true`, a run ID, and a valid timestamp; future timestamps cannot prove freshness.

Index health distinguishes states that must not be conflated. The shipped `WORKOS/CORTEX_INDEX_POLICY.json` is the affirmative `workos-cortex-index-policy/v1` marker for the healthy `no-index-v1` lexical baseline when no manifest exists. If both policy and manifest are missing, state is ambiguous and health warns `index-evidence-missing`; a malformed policy is CRITICAL. If a manifest exists, it supersedes the marker and health verifies its canonical SHA-256, derived-index SHA-256, contained relative index path, and `indexed_at`; canonical drift or index tampering is CRITICAL. No vector index currently exists.

Threshold overrides must be finite and positive or health emits critical `cortex-threshold-invalid`; `NaN` cannot disable a check. Operational overrides are `CORTEX_RETRIEVAL_STALE_MS`, `CORTEX_PROPOSAL_BACKLOG`, `CORTEX_OBSERVABILITY_MAX_BYTES`, and `CORTEX_OBSERVABILITY_MAX_AGE_MS`. The report preserves the actual threshold and source-path evidence used for each finding.

A read-only live check reports an overall verdict with per-check counts (critical/warn/ok) across reviewer freshness, index state, retrieval evidence, pending-proposal backlog against its threshold, and observability log age and size against their caps. Each run's report is point-in-time operational evidence, not a standing green claim.

This health path is local and file-backed. It adds no cloud telemetry, MCP endpoint, daemon, Chroma/CMEM process, or network service. Full contract and privacy boundaries: [`../Memory/CortexContract.md`](../Memory/CortexContract.md).

## Event Format

All events conform to the `WorkosEvent` interface:

```typescript
interface WorkosEvent {
  timestamp: string;     // ISO-8601 with timezone
  session_id: string;    // Claude Code session ID
  source: string;        // "tool-activity" | "tool-failure" | "subagent" | ...
  type: string;          // Event type (e.g. "tool_use", "subagent_start")
  [key: string]: unknown; // Additional fields per source
}
```

## Read Timing

Readers read on demand: each read takes the JSONL tail it needs from disk (no persistent in-memory cache; Bun fs is fast enough at these sizes).

## Key Files

| File | Role |
|------|------|
| `~/.claude/hooks/EventLogger.hook.ts` | Consolidated event writer (absorbed ToolActivityTracker + ToolFailureTracker + SkillExecutionLog + ConfigAudit + StopFailureHandler 2026-07-11). PostToolUse catch-all → tool-activity.jsonl (+ SKILLS/execution.jsonl on Skill); PostToolUseFailure → tool-failures.jsonl; ConfigChange → config-changes.jsonl; StopFailure → SECURITY stop-failures (log-only) |
| `~/.claude/WORKOS/TOOLS/MemoryHealthCheck.ts` | Reads observability evidence for the memory health verdict |

## Session State Tracking

Distinct from the event pipeline above, session state (active sessions, phase, progress, criteria, ratings) flows through a single canonical file, so every reader sees the same state.

**Canonical source:** `$WORKOS_DIR/MEMORY/STATE/work.json`

```
Writers (atomic read-modify-write via isa-utils.ts:writeRegistry)
├─ SessionAnalysis.hook.ts      RETIRED — file no longer exists; upsertSession is unowned
├─ EventLogger.hook.ts          PostToolUse → bumpLastToolActivity (30s debounced)
├─ ISASync.hook.ts              syncToWorkJson() → promote native entry to full ISA session
└─ ISAAutoName.hook.ts          RETIRED — file no longer exists

Readers
└─ status line, ISA HTML mirror, tools reading work.json directly
```

**Run states:** derived from the one table in `WORKOS/TOOLS/ascent.ts`; mode `native` sessions carry no phase strip.

**Classifier (historical — `SessionAnalysis.hook.ts` is retired and no longer ships):** its action regex (the `ALGO_ACTION_RE` symbol was deleted 2026-07-11 with the mode/tier system) — narrow 8-verb regex (`implement|build|create|architect|design|migrate|deploy|refactor`). Everything else that passes the trivia filter (`POSITIVE_PRAISE_WORDS`, `SYSTEM_TEXT_PATTERNS`, `MIN_PROMPT_LENGTH=3`) is native. Do not broaden — see `feedback_state_monitoring_requires_starting_gate.md`.

**Staleness thresholds:** 5 min native, 10 min algorithm.

**Loud-fail:** `EventLogger.hook.ts` logs exceptions via `console.error` so a silently-broken tracker shows up in session logs.

**Self-healing:** Readers use `Math.max(updatedAt, lastToolActivity)` for the activity signal, so a fresh user prompt revives a stale session even if the tool-activity tracker is down.

## Examples

### One tool call, from disk to reader

1. The DA runs a command. The moment it returns, the PostToolUse `EventLogger` hook appends one JSON line to `tool-activity.jsonl` — synchronous, fire-and-forget, no network.
2. Nothing is pushed anywhere. The line just sits on disk.
3. Later, a question like "which tools failed most this week?" is answered by reading the file: `jq` over `tool-failures.jsonl`, or a health tool that tails it.

The whole design is **read-on-demand**: emitters only append to local files and readers pull tails when they need them. There is no event bus, no in-memory queue, no push — a crashed reader loses nothing, because the events were never in flight.

### A failure takes a parallel path

A tool errors, so the `PostToolUseFailure` branch of the same hook appends to `tool-failures.jsonl` instead — tool name, error, truncated input, timestamp — without touching the activity stream. One writer, several typed sinks.

---

## See Also

- `~/.claude/WORKOS/DOCUMENTATION/Memory/CortexContract.md` — Cortex CLI contract, privacy limit, benchmark, and health evidence
- `~/.claude/WORKOS/DOCUMENTATION/WorkosSystemArchitecture.md` — Master WorkOS architecture reference
