---
name: Trim
evals:
  manual:
    reason: "a context reduction must be reviewed for preserving every distinct directive while improving the supplied file"
    falsifier: "the reviewer finds a distinct directive, safety requirement, or required reference lost in the trimmed result"
metadata:
  short-description: "Reduce oversized always-on context through approved merges and relocations while preserving directives. Excludes code refactoring and media trimming."
version: 1.1.3
description: Shrinks an always-on WorkOS context file through a human-gated pass: deterministic GC of stale entries, then semantic merges and relocations, never dropping a directive. USE WHEN /trim, trim the context, trim OPERATIONAL_RULES, this file is too big, reduce a doctrine file, prune an always-loaded file, fold the proposal inbox, shrink CLAUDE.md or DA_IDENTITY. NOT FOR code refactoring, trimming audio or video media (AudioEditor for audio), removing AI patterns from prose.
---

# Trim

Shrink an always-on context file that has gotten too big. `/trim <file>` walks the reduction, safest cuts first, never dropping a rule.

## Ideal State

- The trimmed file is measurably smaller by a re-run `wc -c`, and every distinct directive from the original still compels the same behavior.
- Every removal `WORKOS/TOOLS/ProposalGC.ts` can make deterministically is made by it rather than by judgment, and every semantic MERGE, TIGHTEN or RELOCATE is one the human picked.
- The trim lands as its own commit in the repo that actually holds the file.

## Intent Routing

| Intent | Trigger | File |
|--------|---------|------|
| **Trim** | `/trim <file>`, "trim OPERATIONAL_RULES", "this file is too big", "reduce a doctrine file", "fold the proposal inbox" | `Intents/Trim.md` |

## Data & Config

Trim needs no Config.md. Everything it reads and writes is named here, with paths relative to the install root (`CLAUDE_CONFIG_DIR`, default `~/.claude`).

- The always-on set it measures and edits: the system prompt `WORKOS/WORKOS_SYSTEM_PROMPT.md`, `CLAUDE.md`, every `@`-import listed at the top of `CLAUDE.md` (the identity and operational-rules files under `WORKOS/USER/`), and the hook-injected memory files `WORKOS/USER/PRINCIPAL/PRINCIPAL_MEMORY.md` and `WORKOS/USER/DIGITAL_ASSISTANT/DA_MEMORY.md`. The set is read from `CLAUDE.md` each run, never hardcoded.
- The two commit repos: files under `WORKOS/USER/**` commit to the private USER_DATA repo at `~/.config/WORKOS/USER` (the target of the `WORKOS/USER` symlink); every other file commits to the install-root repo `~/.claude` on `main`.

## Gotchas

- USER files commit to the USER_DATA repo, not `~/.claude`. Commit them with `git -C ~/.config/WORKOS/USER`, as the intent.s Tool contract shows; a `~/.claude` commit captures nothing under `WORKOS/USER/` and is a false safety net.
- The file can change mid-edit. The autonomic memory loop appends proposals to these files while you work. When a Write or Edit reports "modified since read", re-read before writing, because a concurrent correction may have landed; this is how a real deploy-command fix was nearly reverted. Never write from a stale read.
- Orchestrate ProposalGC, never reimplement it. Its free, zero-risk removals often clear enough that no judgment-call edit is needed.

## Examples

```
User: "/trim OPERATIONAL_RULES"
→ Trim intent
→ OPERATIONAL_RULES 40,456 → 28,043 B (−31%). ProposalGC found 0 removable; the human picked
  folding the 40-entry proposal tail and relocating skill-scoped directives to a reference;
  committed alone to USER_DATA.

User: "/trim"
→ Trim intent
→ No arg, so the largest file in the always-on set by `wc -c` is trimmed the same way.
```
