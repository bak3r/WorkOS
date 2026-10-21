---
version: 2.0.0
---

# The Notification System

> Notifications close the loop's feedback edge: when the system advances the hill-climb (`WORKOS/DOCUMENTATION/WorkOs/WorkOsThesis.md`), the principal learns about it. In this fork that happens **in the terminal only**.

**Terminal-only notifications for WorkOS workflows and task execution.**

This fork ships **no voice (TTS) and no push channel** — no local `/notify` endpoint, no ElevenLabs, Pushover, ntfy, Discord, SMS, or chat bots. The target environment (a headless sandbox with deny-all egress and no audio) could not reach them anyway, and they would send work context to third parties.

---

## What replaces notifications

| Need | How it is met |
|------|---------------|
| "Task started / what is happening" | The response itself — the banner, the phase strip (`<workos-ascent-delta>`), and status notes in the session |
| "Task finished / failed" | The final response in the unified format (answer, CHANGE, VERIFY, closer) |
| "Background job finished" | Background tasks report back to the session when they exit (harness task notifications); scheduled jobs write their outcome to a log under `MEMORY/OBSERVABILITY/` |
| "Which session needs me" | Terminal tab state (Kitty) when running on a host with Kitty — see `WORKOS/DOCUMENTATION/Terminal/TerminalTabs.md` |

Skills and workflows must **not** call `curl localhost:31337/notify` or any other notification endpoint. A workflow that used to announce itself simply proceeds.

---

## Event Log Channel (events.jsonl)

Events are emitted directly from each hook via `fs.appendFileSync` to `~/.claude/WORKOS/MEMORY/OBSERVABILITY/*.jsonl` — synchronous, fire-and-forget, no shared transport library. This is a record, not a notification: nothing pushes it anywhere. Full detail: `WORKOS/DOCUMENTATION/Observability/ObservabilitySystem.md`.

### Design Principles

1. **Fire and forget** — logging never blocks hook execution
2. **Fail gracefully** — a failed append never breaks the hook
3. **No egress** — nothing in this system sends status to an external service

---

## Examples

### A long build finishing

A test suite runs in the background for twelve minutes. When it exits, the harness tells the session; the DA reads the output and answers in the normal format — what passed, what failed, the evidence. No sound, no phone ping: the next time the principal looks at the terminal, the result is there.

### A scheduled job failing

A nightly memory-consolidation job fails. Its error is appended to its log under `MEMORY/OBSERVABILITY/`; the next session's health checks surface it (for memory, the `🩺 MEMORY HEALTH:` line). Nothing is sent outside the machine.
