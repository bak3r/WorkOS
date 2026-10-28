---
name: ic
description: Full-system integrity check — file references, version anchors, hook registration and wiring, carrier facts, replay corpus, CLAUDE.md @-imports, skills, workflows, retired tokens, gate counts, command and agent frontmatter, skill hygiene, credential registry, permission-rule shape, spinner tips. Deterministic, then a focused read of the areas that changed since the last run.
argument-hint: "[--json] [--quiet] [--deep]"
version: 1.0.0
---

# /ic — Full-System Integrity Check

Thin invoker over `WORKOS/TOOLS/IntegrityCheck.ts`, the deterministic backbone:

```bash
bun ~/.claude/WORKOS/TOOLS/IntegrityCheck.ts $ARGUMENTS
```

Exit codes: 0 clean, 1 blocking, 2 scan error. Exit 2 blocks like exit 1. Report the verdict (CLEAN or N BLOCKING) and, on any blocking finding, the specific broken items with their fix paths.

Flags: `--json` structured output · `--quiet` findings only · `--deep` prints how to run the multi-agent deep audit (the tool never spawns agents itself; run that audit only when the principal asks for it).

The report opens with the **change window** the tool prints: the last-run time and the areas touched since. After the tool pass, do a focused contextual review of the top churned areas (a subsystem rework earns a look; mechanical churn like MEMORY logs does not): do the area's docs, README and ISA still describe what is there now; do the routing surfaces that point into it (CLAUDE.md, the architecture summary, SKILL.md files) still match its shape; did the change orphan or relocate anything the deterministic pass cannot see? Report those findings beside the deterministic verdict. This is a focused read, never an agent sweep.

`/ic` reads and reports. It fixes nothing without the principal's go-ahead.
