---
name: p
description: Shortcut for "parallelize" — take the work in flight (or the named work), split off the parts that do not depend on each other, and run them at the same time so it finishes sooner. "p" splits what clearly splits, "pp" splits harder, "ppp" is maximum parallelism; "p1", "p2", "p3" are the same three levels. Bare forms mean the same thing.
argument-hint: "[optional: which work to parallelize]"
version: 1.0.0
---

# p — Parallelize

The principal typing `/p` (or a bare `p`) IS them saying **"do this faster by running the independent pieces at the same time."** It is their opt-in to agents, or a Workflow when the parts warrant one, for the work in flight. With `$ARGUMENTS`, parallelize that work instead.

## Levels

The letter count is the level, and `p1`, `p2`, `p3` name the same levels by number.

| Typed | Level | What gets split |
|---|---|---|
| `p`, `p1` | 1 | The parts that clearly split: independent pieces run at once, the critical path stays with me. |
| `pp`, `p2` | 2 | Harder: big parts are cut into smaller independent ones, and research, tests and checks run beside the build instead of after it. A Workflow when there are several separable parts. |
| `ppp`, `p3` | 3 | Maximum: every part cut to the finest grain that stays independent, fanned out as a Workflow, with verification lanes running in parallel too. |

The ceiling at every level is what I can still track and reunify. Splitting past that point makes the work slower, so I stop there and say so.

## Done looks like

- The work in flight is read from its live state (ISA criteria, git status, task output files), never from memory, and split into parts that share no files and need no answer from each other.
- The first line names the level and the split, e.g. `pp · 6 parallel parts, 1 kept inline (it needs the others' output)`. Parts that depend on another part stay sequential and the line says which.
- The independent parts run at the same time: agents dispatched in one message, or a Workflow (the workflow-authoring skill loaded before the first script of the session). Each brief names the files that agent may touch, and two parts never touch the same file.
- Every dispatched part is tracked until it returns: what it is, who runs it, which files it owns, and its status. None is forgotten or left running.
- Each part goes to the cheapest rung that can do it well (`OPERATIONAL_RULES.md` § Model selection: Haiku for mechanical, Sonnet for settled execution, Opus where judgment is still open), while I keep working the critical path myself instead of waiting.
- When the parts return, I join them into one result and check it against what the principal asked for before the report.
- When nothing can be split (one inseparable part, or everything depends on the step before), say so in one line and keep going inline. When nothing is in flight, say so in one line.
- No level bypasses a gate. It grants parallel agents for this work, not a push, a publish, a GitLab or Jira write, or any other row of the Permission Boundaries table.
