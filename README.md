# WorkOS

A work operating system for Claude Code. It gives the assistant a durable picture of your role, your team, your stack and your work goals, then runs every task as the same loop: say what "done" means as checkable criteria, do the work, and close each claim only on evidence.

WorkOS is a work-only fork of [LifeOS](https://github.com/danielmiessler/LifeOS) by Daniel Miessler (MIT), taken from release 7.40.4 (upstream commit `5e2f2e8`). It is a clean fork: names, paths and environment variables are WorkOS throughout, and upstream changes are ported by hand, not merged.

## What it keeps

- **The Algorithm and ISAs.** Every non-trivial task gets an Ideal State Artifact with verifiable criteria. Claims close on tool evidence, never on assertion.
- **Work context.** `USER/` holds your work identity, team and colleagues, tech-stack conventions, dev environment, work projects and work goals (TELOS, now scoped to your role).
- **Memory (Cortex).** Session learnings, a typed knowledge archive, curated proposals into the always-loaded context.
- **Hooks.** Safety and containment guards, verification gates, context loading, memory capture, observability (JSONL), and throttled background maintenance.
- **Skills.** Research, red-teaming, root-cause analysis, systems thinking, ISA tooling, evals, hardening (property and mutation testing), prompting, Fabric patterns, diagrams, code-review helpers (MR comments, MR descriptions, QA notes) and more.
- **A local work ledger** with read-only GitLab and Jira context (below).

## What was removed

Everything that served only personal life (life goals and life dimensions, health, finances, family, hometown, hobbies, personal profile), the Pulse dashboard and voice server, every third-party AI or messaging vendor except Apify and BrightData, macOS-only components, content-creator tooling, and upstream release and maintainer machinery.

## Work system

- **System of record:** a local ledger at `WORKOS/USER/WORK/ledger.jsonl`, rendered to `TASKLIST.md`. Reminders ("remind me to ..."), session catch-up, stale-project checks, work-goal follow-ups and commitments land there. CLI: `bun WORKOS/TOOLS/WorkLedger.ts --help`.
- **GitLab and Jira are read-only.** `WorkContext.ts` reads your open and review-requested merge requests (`glab api --method GET`) and your tickets in open sprints (Jira REST, GET only), caches them, and a short summary is loaded at session start. WorkOS automation never creates, edits, transitions or comments anything in either system.
- **Ticket keys are generic.** Any `ABC-123` style key is recognised (in branch names such as `dev-ABC-123-...` and ISA frontmatter). Restrict it with `jira.project_keys` in `USER/WORK/config.yaml`.

## Target environment

Built for [Docker Sandboxes](https://docs.docker.com/ai/sandboxes/) (Linux microVM, deny-all egress, Claude Code on Amazon Bedrock), and it works on any Linux or macOS Claude Code setup.

Requirements in a sandbox:

- the `bun` kit (hooks and tools are `#!/usr/bin/env bun`);
- the `claude-home-link` kit, because the config root is `CLAUDE_CONFIG_DIR=<workspace>/.claude` and hooks also resolve `~/.claude`;
- optional: `gitlab-cli` (for GitLab context) and `atlassian-mcp`, which provides `JIRA_URL`, `JIRA_USERNAME` and `JIRA_API_TOKEN` (for Jira context).

## Install

The install is driven by an AI, from a local copy (no network needed):

1. Put this repository somewhere the sandbox can read, for example inside the workspace.
2. In a Claude Code session, say: **"Read `<path>/WorkOS/INSTALL.md` and install WorkOS for me."**
   The installer detects the environment, shows every change before making it, deploys into `$CLAUDE_CONFIG_DIR`, wires the hooks, and runs a short work interview to fill in `USER/`.

Shell bootstrap alternative: `WORKOS_SRC=<path> bash <path>/WorkOS/install/install.sh`.

## Launching

The constitution (`WORKOS/WORKOS_SYSTEM_PROMPT.md`: response format, verification and security rules) is loaded by launching through the `workos` command, which runs Claude Code with `--append-system-prompt-file`. A plain `claude` session still gets the hooks and `CLAUDE.md` context, but not the constitution.

In a sandbox, the sbx TUI starts plain `claude`. Two routes:

- **Sandbox route (TUI works):** opt in once with `bun <configRoot>/skills/WorkOS/Tools/ActivateImports.ts --with-system-prompt --apply`. `CLAUDE.md` then @-imports the constitution, so every plain `claude` session, the TUI included, loads it as context. `workos` notices the import and does not append it a second time. Undo with `--without-system-prompt --apply`.
- **Launcher route:** without the opt-in, press `x` for a shell and run `workos -l` from the project. The constitution is appended as a real system prompt.

## Layout

```
WorkOS/                      the installer skill (SKILL.md, INSTALL.md, Tools/, Workflows/)
WorkOS/install/              the payload deployed into the config root
  WORKOS/                    runtime: Algorithm, docs, tools, system prompt, statusline
  hooks/  skills/  agents/   Claude Code hooks, skills, agents
  commands/                  slash commands
  USER/                      templates for your own work context (scaffolded once, never overwritten)
```

## Licence

MIT. See `LICENSE`; the upstream copyright notice is retained as the licence requires.
