# WorkOS

**Your AI assistant, with a memory of your job and a habit of proving its work.**

## Why use it

- Every new session starts from zero. Your AI forgets your role, your team, your stack and what you're trying to ship.
- It says "done" when it isn't. "Should work" isn't evidence.
- WorkOS fixes both. The assistant knows your work context every time, and it only calls something done once it has proof.

## What it does

- **Knows your work.** Your role, team, stack, projects and work goals load into every session.
- **Defines "done" first.** Any real task starts with a short list of checkable criteria.
- **Proves it.** Each claim closes on evidence (a test run, a diff, a log line), never on "trust me".
- **Remembers.** It keeps what it learns from each session and builds up a knowledge archive over time.
- **Tracks your work.** It keeps a local task list for reminders, follow-ups and commitments.
- **Reads Jira and GitLab, never writes.** It sees your open MRs and sprint tickets but never changes anything there.
- **Comes with skills.** Research, code-review helpers (MR descriptions, MR comments, QA notes, bug scenarios, review prep, comment pruning), root-cause analysis, red-teaming, test hardening and more.

## How it works

- It runs on top of **Claude Code**: hooks, skills and a system prompt, all plain files you can read.
- **The Algorithm** is the core loop: say what done means → do the work → verify each claim → report.
- **Hooks** add safety guards, verification gates, context loading and memory capture.
- **Your data stays local.** Your context lives in your own config folder, and Jira and GitLab are read-only.

## Get started

1. Put this repo somewhere Claude Code can read it.
2. In a session, say: **"Read `<path>/WorkOS/INSTALL.md` and install WorkOS for me."**
3. The installer shows every change before it makes it, then asks you a few questions about your work.

Built for Docker Sandboxes, and it works on any Linux or macOS Claude Code setup. Needs `bun`, `rg` and `jq`.

> ⚠️ The default settings turn on auto mode, because they're meant for an isolated sandbox. On a normal machine, check `WorkOS/install/settings.system.json` before you install.

## Upgrading from 1.0.x

Say: **"Read `<path>/WorkOS/Workflows/Update.md` and update WorkOS."**

- Files you never changed are replaced with the 2.0.0 versions.
- A file you edited is kept, with the new version next to it as `<file>.new`.
- Files 2.0.0 no longer ships (retired skills and hooks) move to the backup.
- `USER/`, `WORKOS/MEMORY/` and `settings.json` are not overwritten, and `Tools/Rollback.ts` undoes every change.

## What's in 2.0.0

WorkOS 2.0.0 is synced with LifeOS 8.761.0 (upstream `fb9aef46`). It takes the same Algorithm (v8.45), the upstream bug fixes, an equal or stronger security floor, and the skills that are useful for work. It doesn't take parts that need macOS, an AI vendor other than Bedrock, a scheduler, or personal data:

- Pulse and Pulse Desktop, voice and ReadIt, texting (Tex, Relay), People, Rings, Vera, Socrates, Location, Dictation.
- Vigil, STATVS and CENSVS; the Workflows scheduler and the Cloudflare clock (MaintenanceJobs runs the upkeep instead).
- The multi-vendor Router and the Astra, Sol, Argon and Grok agents; the Codex, Gemini and Perplexity researchers.
- The Seatbelt subagent sandbox, `.env` age sealing and managed settings.
- The git pre-push hook, which refuses every non-GitHub remote.
- The multi-vendor Research, Council, Art and Cortex recall (WorkOS keeps Claude-only versions).
- The LifeOS installer (WorkOS keeps its own, with inventory, backup ledger, Adopt and Rollback), the `OPERATIONAL_RULES` rename, and the statusline's Rust front end, usage, weather and tide rows.

## Credits

A work-only fork of [LifeOS](https://github.com/danielmiessler/LifeOS) by Daniel Miessler. MIT licence.
