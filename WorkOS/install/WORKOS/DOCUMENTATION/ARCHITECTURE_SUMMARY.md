---
last_updated: 2026-10-21T07:01:25.395Z
last_updated_by: ArchitectureSummaryGenerator
convention: pai-freshness-v1
derived_from: WORKOS/DOCUMENTATION/WorkosSystemArchitecture.md
generator: WORKOS/TOOLS/ArchitectureSummaryGenerator.ts
---

# WorkOS Architecture Summary

> Auto-generated — do not edit (source + generator in frontmatter).

## Overview

WorkOS — a **work operating system** — is the AI harness that moves your work from its current state to its ideal state: an intent engineering platform that captures what you are trying to achieve in your role and conveys that intent to your AI on every task, then verifies the output against it.
Everything below is the machinery of that one loop: Current State → Ideal State via verifiable iteration (ISC). Canonical thesis: `WORKOS/DOCUMENTATION/WorkOs/WorkOsThesis.md`.

**Current versions:** WorkOS 1.0.0 | Algorithm v8.20.2 | System Prompt v3.7.3 | Cortex (Memory) v8.3.0

Doc routing lives in CLAUDE.md; founding principles + full section map in the master doc.

## Pipeline Router

One line per pipeline. Full wiring, file inventories, and incident notes: master doc § Pipeline Topology.

| Pipeline | What it is | Doc |
|----------|------------|-----|
| **Security** | Constitutional security protocol, native denylist, safety-classifier hooks | `WORKOS/DOCUMENTATION/Security/README.md` |
| **Algorithm** | Outcome-driven ISA execution — articulate done, hill-climb, close claims on tool evidence | `WORKOS/DOCUMENTATION/Algorithm/AlgorithmSystem.md` |
| **Cortex (Memory)** | Cortex, the memory system — autonomic capture, tiered curation, and retrieval across hot-layer, KNOWLEDGE, LEARNING | `WORKOS/DOCUMENTATION/Memory/MemorySystem.md` |
| **Hooks** | Deterministic enforcement and context injection at Claude Code events | `WORKOS/DOCUMENTATION/Hooks/HookSystem.md` |
| **Observability** | Tool activity and failures appended to JSONL under MEMORY/OBSERVABILITY/ | `WORKOS/DOCUMENTATION/Observability/ObservabilitySystem.md` |
| **Work System** | Capture surfaces feeding a local work ledger as system of record; Jira + GitLab read-only context | `WORKOS/DOCUMENTATION/Work/WorkSystem.md` |
| **Skills** | Domain capabilities: SKILL.md + workflows + deterministic tools | `WORKOS/DOCUMENTATION/Skills/SkillSystem.md` |
| **Config** | settings.json, CLAUDE.md, system prompt — directly edited | `WORKOS/DOCUMENTATION/Config/ConfigSystem.md` |
| **Notifications** | Terminal-only — no voice or push channel; long-running work reports in the session | `WORKOS/DOCUMENTATION/Notifications/NotificationSystem.md` |
| **Doc Integrity** | SessionEnd-hook cross-reference checks; regenerates this summary from the master doc | `WORKOS/DOCUMENTATION/Hooks/HookSystem.md` |
| **Atlas** | Graph-based asset management — the current state of everything owned; `atlas` CLI (owns/blast/exposed) | `WORKOS/DOCUMENTATION/Atlas/AtlasSystem.md` |
| **Ledger** | Change-tracking authority — versioning, update registry, integrity gate, deploy events (the APPLIED half of the change pipeline) | `WORKOS/DOCUMENTATION/Ledger/LedgerSystem.md` |

## Cross-References

- Full architecture: `WORKOS/DOCUMENTATION/WorkosSystemArchitecture.md`
- Algorithm spec: `WORKOS/ALGORITHM/v8.20.2.md`
- ISA format: `WORKOS/DOCUMENTATION/ISA/ISAFormat.md`
- Config system: `WORKOS/DOCUMENTATION/Config/ConfigSystem.md`
