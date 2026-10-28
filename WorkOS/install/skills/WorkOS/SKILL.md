---
name: WorkOS
version: 1.0.0
description: Install and onboard a user into WorkOS — a work operating system for a developer's AI assistant (where your work stands → where you want it to be, via work TELOS + the Algorithm). The agentic installer detects your OS + harness, wires hooks with permission, scaffolds your USER tree, pulls in sources you provide, and runs the work onboarding interview (identity, team and process, stack, projects, work goals). USE WHEN install WorkOS, set up WorkOS, workos setup, workos-setup, workos interview, onboard me, run the interview, integrate WorkOS into my harness, update WorkOS, uninstall WorkOS, first-time setup, workos doctor, check my install, what capabilities are broken. NOT FOR building or cutting a WorkOS release (private release tooling), editing TELOS after onboarding (use Telos / Interview), or WorkOS system maintenance (use the private maintenance skill).
disable-model-invocation: true
argument-hint: "[setup|interview|doctor|update|uninstall]"
allowed-tools: Read, Write, Edit, Bash, Glob, Grep
---

# WorkOS

> **This is the INSTALLED copy of the WorkOS skill, not the distribution root.**
> Its `install/` directory holds the bootstrap script (`install.sh`) plus the templates the
> installer tools read (`CLAUDE.template.md`, `settings.system.json`,
> `settings.enhancements.json`, `package.json`) — not the whole-system payload (`skills/`,
> `hooks/`, `WORKOS/`, `USER/`, …), which lived in the release artifact you installed FROM
> and is now deployed across `~/.claude`. Statements below
> about the skill being self-contained describe that release artifact, not this directory.
> Run the setup and deploy tools from `~/.claude`, not from here — relative paths do not
> resolve in this copy.


The install + onboarding surface for **WorkOS** — a work operating system for your AI assistant. One command takes a developer from nothing to a working install that already knows their role, team, stack, projects and work goals — without making them adopt a whole new harness.

## How it ships

WorkOS is distributed as **one self-contained skill** — the `WorkOS/` directory is the *entire* distribution. Everything ships inside it: the orchestrator (`SKILL.md`, `Workflows/`, `Tools/`), the whole-system payload under `install/`, and the one-line bootstrap at `install/install.sh`. **Nothing ships outside the skill** — no release-root `install.sh`, no `.claude/` clone.

**The primary install is AI-native: give `INSTALL.md` (in the local release directory) to your AI and say "install this."** WorkOS is AI-native, so the install is too — your AI installs WorkOS on your OS and harness, with permission at each step. It's the same document a human can read and follow. `INSTALL.md` opens with a capability gate, drives the install Tools (which run under `bun` on any OS, not a shell), wires integration per-harness (honest about what each gets), then runs Setup → Interview.

A terminal shortcut runs fully offline from the same release directory (the sbx sandbox has deny-all egress):

```
WORKOS_SRC=<release dir> bash <release dir>/install/install.sh
```

Both come from the skill's own single sources of truth — `INSTALL.md` at the skill root, `install/install.sh` for the shell path (which hands off to the agentic `/WorkOS setup`). Two versions coexist and mean different things: the frontmatter `version:` is this skill's own **component** line (bumped by the maintainer-side `BumpSkillVersions`, which does not ship in the release), while the **distribution** version — what a user means by "WorkOS 7.x" — is the GitHub release tag and the `WORKOS_RELEASES/<version>/` parent dir. Never read the component line as the release number. The payload (skills, hooks, system prompt, Algorithm, docs, runtime tools) rides along under `install/` and is placed during setup, with permission.

## Workflow Routing

| Trigger | Target |
|---------|--------|
| `setup`, `/WorkOS setup`, "install WorkOS", "integrate into my harness" | `Workflows/Setup.md` |
| `interview`, "onboard me", "run the interview", work TELOS capture | `Workflows/Interview.md` |
| `doctor`, "check my install", "what's broken", "what capabilities are live" | run `bun <configRoot>/WORKOS/TOOLS/Doctor.ts` (see `INSTALL.md`) |
| `update`, "update WorkOS", after a version bump | `Workflows/Update.md` |
| `uninstall`, "remove WorkOS", "roll back the install", "undo WorkOS" | `Workflows/Uninstall.md` (backed by `Tools/Rollback.ts`) |

`doctor` is the one tool-backed route — it needs no workflow because `Doctor.ts` is self-describing: it prints the four capability states (live / broken / declined / stale) and the exact fix command for anything broken. Relay its table, offer the fix it names, and honor `decline` — a declined capability is a legitimate way to run WorkOS, never a defect to nag about.

Default flow (`/WorkOS setup`): **Setup phase** (system integration) → transitions into **Interview phase** (work onboarding). One continuous experience, two clearly-marked phases — setup is logistics, interview is meaning. Setup ALWAYS runs first; hooks must be wired before the interview seeds anything.

## The two phases

**Setup (logistics, first).** Inventory the config root (`Tools/Inventory.ts`, read-only) and, when LifeOS is there, adopt it (`Tools/Adopt.ts`: untouched LifeOS copies to the backup, work memory into WORKOS/MEMORY) → detect OS + harness → scan for conflicts and surface them → install prerequisites → overlay the system templates → scaffold the USER tree + link it → **trust-gated hook install** (show the exact change, back up `settings.json`, wait for yes) → activate the identity imports → verify with two evidence classes. Adapts to OS (macOS/Linux/Windows) and harness (Claude Code / Cursor / OpenClaw). The config root is `$CLAUDE_CONFIG_DIR` when set (the sbx sandbox sets `<workspace>/.claude`).

**Interview (meaning, second).** Name the DA → work identity → team & process (Jira, GitLab, ceremonies) → stack & conventions → dev environment → work projects → work goals into TELOS → domain vocabulary → **pull in sources the user provides** (repo CLAUDE.md/README files, ADRs, onboarding docs — read locally, never sent out) → regenerate the TELOS summary. By the end, the config tree is populated, not empty scaffolding.

## Hard rules

- **Setup before Interview, always.** Hooks/integration land before any onboarding write.
- **Additive for everything that isn't WorkOS's.** Files the developer authored or edited are kept and never written into; untouched LifeOS copies are replaced only through Adopt, after being moved to `.workos-backup/<run>/`. Every write is recorded in `WORKOS/install-manifest.jsonl`, so `Tools/Rollback.ts` restores the root byte-identical.
- **Permission before mutation.** Hook install shows the exact change (file count + settings entries) and backs up `settings.json` first. Nothing changes without an explicit yes.
- **Config root keeps its canonical name.** The user tree lives under the config dir and is linked into the harness tree; "WorkOS" is the brand, the resolved config path does not rename (renaming it breaks the identity `@`-imports).
- **Dev-tree refusal.** The install tools refuse to run inside the WorkOS source repo (detected via the dev-tree marker: the private maintenance skill `skills/_WORKOS` present under the config root). Never mutate the author's live system.

## Gotchas

- **The frontmatter `version:` is the COMPONENT line, not the release.** Claude Code ignores it; the maintainer-side `BumpSkillVersions` (not shipped) maintains it at the source repo. The DISTRIBUTION version is the tag + `WORKOS_RELEASES/<version>/` + the `install.sh` fetch.
- **`install.sh` is non-destructive by design.** It installs only the WorkOS skill and backs up only a prior WorkOS skill — never the user's other skills, hooks, or config. The whole point is "bolt on, don't take over."
- **Hooks are installed imperatively, with permission.** A bare skill cannot auto-wire hooks; the setup workflow writes them into the user's harness explicitly, after showing what changes.
- **Config is `.toml`, never `.yaml`.** `WorkosConfig.ts` reads TOML; the legacy `.yaml` template was retired 2026-06-19.
- **Cross-platform is solved at setup time, not statically.** The setup conversation detects the OS + harness and tailors hook commands and paths — don't assume macOS.

## Examples

- "install WorkOS" → `install.sh` drops the skill, then `/WorkOS setup` runs: detect env, surface conflicts, wire hooks with permission, scaffold the USER tree, then roll into the interview.
- "run the workos interview" → Interview workflow: capture work identity, team, stack, projects and work goals, pull in the user's sources, regenerate the TELOS summary.
- "workos doctor" → run `Doctor.ts`, relay the capability table, offer the fix command for anything broken.
- "update WorkOS" → Update workflow: idempotent re-overlay after a version bump, non-destructive.
