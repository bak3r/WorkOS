---
name: iterate
description: Iterate on a target with the principal reviewing between passes. Shortcut for the HillClimb skill's Loop intent (it replaced the Iterate skill in WorkOS 2.0). USE WHEN /iterate, iterate on this with me, multiple passes, revisit, rework.
argument-hint: [target]
---

# iterate — supervised iteration shortcut

Invoke the HillClimb skill's **Loop** intent on `$ARGUMENTS`:

```
Skill("HillClimb", "iterate on $ARGUMENTS with me")
```

If `$ARGUMENTS` is empty, the target is whatever this conversation has been working on; on a fresh session with no target, the intent asks.

Named `/iterate`, not `/loop`, because Claude Code's built-in `/loop` runs a prompt on a recurring interval.

Full procedure: `~/.claude/skills/HillClimb/Intents/Loop.md`.
