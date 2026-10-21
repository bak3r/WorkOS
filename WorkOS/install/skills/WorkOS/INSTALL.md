# Install WorkOS

**The primary way to install WorkOS is to give this document to your AI and say "install this."**

WorkOS is AI-native, so the install is too. You hand this file (or its link) to whatever AI assistant you already use, and it does the whole install for you — on your OS, on your harness, with your permission at every step. You can also read it yourself and follow along; it's the same document either way.

---

## For you (the human) — 10 seconds

Point your AI — Claude Code, or any coding assistant that can read files and run commands — at this file in your local release directory:

> **Read `<release dir>/INSTALL.md` and install WorkOS for me.**

That's the primary path. Your AI reads the rest of this page and installs WorkOS for you.

Prefer a terminal? The bootstrap runs fully offline from the same local release directory:

```
WORKOS_SRC=<release dir> bash <release dir>/install/install.sh
```

Everything below is written for the AI doing the install.

---

## For the AI assistant — read this fully before you touch anything

You are installing WorkOS for your human. The install is **additive**: you touch only WorkOS's own files until they explicitly say yes to an integration step. Work through the phases in order. Before any change that modifies their machine, show exactly what will change and wait for a yes.

### 0. Capability gate — stop here if you fail it

You need to be able to (1) read and write files on this machine, and (2) run shell commands. If you cannot do both — for example you're a chat-only assistant with no filesystem or command execution — **stop now** and tell your human:

> "I can't install WorkOS from here — I don't have file and command access on your machine. Run this from a coding harness like Claude Code, or use the terminal shortcut at the top of `INSTALL.md`."

Do not begin a partial install you can't finish.

### 1. Prerequisites

- **bun ≥ 1.2.21** runs the install tools (they're TypeScript), and the hooks use Bun's built-in `Bun.YAML`, which older bun lacks. Check `bun --version`. In an sbx sandbox it comes from the `bun` kit; if it's missing there, stop and ask for the kit rather than trying to download it (egress is deny-all).
- **A local release directory.** The sandbox has no route to GitHub, so install from a release directory already on disk (`WORKOS_SRC`).
- **sbx:** the config root is `$CLAUDE_CONFIG_DIR` (the sandbox sets `<workspace>/.claude`, linked into `~/.claude` by the `claude-home-link` kit).

### 2. Get the release and detect the environment

Use the local release directory you were given. Then, from the WorkOS skill directory, run:

```
bun Tools/DetectEnv.ts
```

Read its output. It reports the OS (macOS / Linux / Windows), the harness (Claude Code / Cursor / other), the config root (an explicit `CLAUDE_CONFIG_DIR` always wins), and whether WorkOS is already present. **Every path below comes from this — don't assume `~/.claude` or any single harness.**

### 3. Scan for conflicts (read-only)

```
bun Tools/ScanConflicts.ts
```

Surfaces anything already sitting in the target directories. Show your human. Nothing has changed yet.

### 4. Drop the skill and runtime (additive)

```
bun Tools/DeployCore.ts            # dry run — prints the plan, writes nothing
bun Tools/DeployCore.ts --apply    # performs the copy
```

Copies the WorkOS skill and runtime into the harness's config tree, and places `CLAUDE.md` from `install/CLAUDE.template.md` when the config root has none (the routing table; its identity imports ship commented and are switched on in step 6). Existing files are never overwritten — only missing ones are added. If a `CLAUDE.md` already exists it is left alone: show your human the template and ask before merging anything into theirs.

Then place the base settings (the system half of `settings.json`, without hooks):

```
bun Tools/InstallSettings.ts            # dry run
bun Tools/InstallSettings.ts --apply    # writes settings.json (or adds only its absent keys to an existing one, backup first)
```

Never copy `install/settings.system.json` by hand — the tool expands `$HOME` in `env` values, which the harness does not.

**These tools are dry-run by default.** Without `--apply` they print a plan and change nothing, so an install that omits the flag reports success while copying zero files. Run the dry run first, show your human, then re-run with `--apply`.

### 5. Scaffold the personal (USER) tree

```
bun Tools/ScaffoldUser.ts --apply
bun Tools/LinkUser.ts --apply
```

Both are dry-run without `--apply`, same as the previous step. Creates the USER config tree (your work identity, team, projects, goals) from templates and links it in. This is empty structure — no content yet. That comes in the interview.

### 6. Wire the integration — HARNESS-SPECIFIC, WITH PERMISSION

This is the one place harnesses genuinely differ. Show the exact change and get a yes.

- **Claude Code** — run `bun Tools/InstallHooks.ts --apply` (merges the hook set into `settings.json`, backing it up first) and `bun Tools/ActivateImports.ts --apply` (turns on the identity context imports). **Both need `--apply`** — without it they print a plan and write nothing. This is what lights up the always-on behavior: the WorkOS response format, the memory loop, and per-turn context injection.

- **Any other harness (Cursor / other)** — WorkOS's always-on behavior is enforced by Claude Code *hooks*, which are a Claude Code mechanism. They don't auto-wire on other harnesses **yet**. So instead:
  1. Write an `AGENTS.md` (or the harness's own context file — e.g. `.cursor/rules`) that points the harness at the WorkOS tree, so it loads the WorkOS context every session.
  2. Tell your human, plainly and honestly: *"On <harness>, the always-on hooks aren't wired yet. You get the skill, your USER data, and context loading every session, and you run Setup and Interview on request. Full always-on behavior is on the roadmap for this harness."*
  3. **Do not** write Claude hook files or a Claude `settings.json` `hooks` block into a non-Claude harness — it would sit there inert and do nothing.

### 7. Wire the launch command — HOW WorkOS actually turns on (WITH PERMISSION)

This is the step that makes WorkOS *load*. The constitutional layer — the response format, verification doctrine, security protocol, the whole operating contract — lives in `install/WORKOS/WORKOS_SYSTEM_PROMPT.md` and is **NOT** loaded by a plain `claude` session. It loads only when the harness is launched with that file appended to its system prompt. So installed WorkOS needs its own launch command; running vanilla `claude` gives you CLAUDE.md but **not** the constitution.

The payload ships the launcher — `install/WORKOS/TOOLS/workos.ts` — which spawns Claude with `--append-system-prompt-file <configRoot>/WORKOS/WORKOS_SYSTEM_PROMPT.md` (plus the banner and MCP-profile handling). Wire a `workos` command that calls it into your human's shell. **Show the exact line, back up the rc file first, wait for a yes.** Use the real `<configRoot>` from `DetectEnv` (e.g. `~/.claude`) — never hardcode a home path.

- **Claude Code (zsh / bash)** — append to `~/.zshrc` (or `~/.bashrc`):
  ```
  alias workos='bun <configRoot>/WORKOS/TOOLS/workos.ts -s <configRoot>/WORKOS/WORKOS_SYSTEM_PROMPT.md'
  ```
  fish: `alias workos "bun <configRoot>/WORKOS/TOOLS/workos.ts -s <configRoot>/WORKOS/WORKOS_SYSTEM_PROMPT.md"; funcsave workos`. After this, **`workos` launches Claude WITH the constitution**; plain `claude` stays vanilla (which is fine — the user opts in by launching `workos`).

- **Any other harness** — use that harness's own system-prompt flag against the same file. e.g. pi: `pi --append-system-prompt <configRoot>/WORKOS/WORKOS_SYSTEM_PROMPT.md`. If a harness has no system-prompt flag, load `WORKOS_SYSTEM_PROMPT.md` through its context file (AGENTS.md / rules) as the closest equivalent, and tell your human plainly that the constitution is loading as context, not as a true system-prompt layer.

- **Sandbox (Docker Sandboxes / sbx)** — the sbx TUI starts plain `claude`, never the launcher. When `DetectEnv` reports `sandbox: true`, offer the opt-in import: `bun Tools/ActivateImports.ts --config-root <configRoot> --with-system-prompt` (dry-run), then add `--apply`. It activates `@WORKOS/WORKOS_SYSTEM_PROMPT.md` in `CLAUDE.md`, so every session, TUI included, gets the constitution as context (not as a true system-prompt layer). `workos` then sees the import and skips its own `--append-system-prompt-file` (`-s` naming that same file is skipped too), so it never loads twice. `--without-system-prompt` reverts.

If your human declines the shell edit, give them the one-line launch command to run by hand so the constitution still loads:
```
bun <configRoot>/WORKOS/TOOLS/workos.ts -s <configRoot>/WORKOS/WORKOS_SYSTEM_PROMPT.md
```

### 8. Choose the components — install all, or pick a subset (WITH PERMISSION)

WorkOS installs in **two layers**, and you present them that way.

**Core** (steps 4–7, always together) IS WorkOS: the skill + the full **skill library** + the WORKOS runtime (Algorithm, docs, tools, statusline binary, version) + the USER tree + the system prompt and its `workos` launch command. One consent installs all of Core; declining means not installing WorkOS.

**Enhancements** are **à la carte** — offer them and let your human pick some, all, or none. Each is independently installed, idempotent, and reversible:

| Component | What it adds | Default |
|---|---|---|
| **hooks** | skill routing, the memory loop, per-turn context injection — most behavior needs these (this is step 6) | **recommended** |
| **statusline** | the WorkOS status line in your prompt | optional |
| **tooltips** | custom Claude Code spinner tips | optional |
| **spinner verbs** | custom spinner verbs | optional |
| **agents** | the named agent library | optional |
| **worksweep / derivedsync / commitmentsweep** | background jobs (work capture, derived-file sync, commitment sweep) — the work sweeps also run from the `MaintenanceJobs` hook without systemd | optional |

The background jobs install as **systemd --user** units on Linux — offer them only when `systemctl --user` works (an sbx sandbox usually has no user systemd session: skip cleanly there). Show your human this menu, take their picks, and deploy only those. The **Setup** workflow (step 9) drives the actual deployment of the chosen set and verifies each with real evidence. Everything ships in the payload; nothing activates without its matching yes.

### 8.5 Capability check — probe what doctrine assumes (Doctor)

WorkOS doctrine leans on a few **external tools** the core install does not ship: a real browser for web verification (Interceptor — the sandbox has none), `rg`, `jq`, and the optional read-only work context (`glab`, Jira env). Nothing above installed them, and the features that depend on them must degrade *loudly*, not silently. After Core lands, run the doctor:

```
bun <configRoot>/WORKOS/TOOLS/Doctor.ts
```

It prints one line per capability — live ✅, broken ❌ (each with its own copy-paste fix command), or off ⏸ — and writes an advisory manifest the runtime uses to flag degraded output. Then ask your human, per broken capability: **set it up now, later, or never?**

- **Now** → run the fix command shown, re-run Doctor. With their permission, add `--network` to verify auth end-to-end — network probes only ever touch capabilities they have already configured.
- **Later** → leave it. The runtime will surface it the moment a degraded capability is actually invoked, fix command included.
- **Never** → `bun <configRoot>/WORKOS/TOOLS/Doctor.ts decline <name>`. Declined is a clean, permanent, silent OFF — no warnings, no red marks, no nagging, ever. Declining is a legitimate way to run WorkOS, not a defect.

Deeper walkthroughs per tool (what it's for, install, auth, verify it's live): `GETTING-STARTED.md`, shipped next to this file. Your human can re-run the doctor any time something feels off: `workos doctor` territory — it's the same command.

### 9. Run Setup, then Interview

Run the **Setup** workflow (`Workflows/Setup.md`) to finish integration and verify with real evidence, then the **Interview** workflow (`Workflows/Interview.md`): name the assistant, capture work identity, team and process, stack, projects and work goals (TELOS), pull in any sources your human offers, and regenerate the TELOS summary. By the end, the config tree is populated.

---

## What you get on each setup (be honest about this)

| Harness / OS | Skill + USER data | Always-on behavior (response format, memory loop, context injection) |
|---|---|---|
| **Claude Code — macOS / Linux** | ✅ | ✅ full (native hooks) |
| **Claude Code — Windows** | ✅ (USER tree links as a directory junction — no admin needed) | ✅ full |
| **Cursor / other** | ✅ | ⚠️ context loads every session via `AGENTS.md`; workflows run on request; always-on hooks not wired yet (roadmap) |
| **Chat-only assistants (no files / no commands)** | ❌ | ❌ — install stops at the capability gate |

Full-doctrine features additionally depend on the external tools in step 8.5 (a real browser above all). Without one, the dependent feature runs degraded **and says so** — it never silently pretends. The Doctor table is the live source of truth for what's on.

## Rules you must follow

- **Additive, never clobbering.** Only add what's missing; never overwrite or delete a populated dir or a file you didn't create.
- **Permission before every mutation.** Show the exact change; back up `settings.json` before editing it; wait for a yes. One documented exception: the `install.sh` bootstrap, by invocation, appends capture rules to the config-root `.gitignore` — running the bootstrap is the consent for that one bounded setup mutation. It never edits shell rc files or other systems' aliases. AI-led setup steps after the bootstrap always ask.
- **Never write a harness's config that it won't read.** Honest degrade beats an inert install.
- **The launch command loads the constitution — don't skip it.** A plain `claude` session gets CLAUDE.md but not `WORKOS_SYSTEM_PROMPT.md`. The `workos` command (step 7), or the harness's system-prompt flag, is what turns the operating contract on. Wire it, or the install is missing its whole constitutional layer.
- **Refuse to run inside the WorkOS source repo** (detected via the `skills/_WORKOS` dev-tree marker under the config root). Never mutate a maintainer's live system.
