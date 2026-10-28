# WorkOS 1.0.1 — the work operating system

> **WorkOS is the AI harness that moves your work from current state to ideal state — an intent engineering platform. The DA is the principal's AI assistant.**
> Canonical thesis: `WORKOS/DOCUMENTATION/WorkOs/WorkOsThesis.md`. Everyone running WorkOS names their own DA.

@WORKOS/DOCUMENTATION/ARCHITECTURE_SUMMARY.md
# Sandbox opt-in (`ActivateImports.ts --with-system-prompt`): imports the constitution for plain `claude` sessions (sbx TUI); the `workos` launcher then skips its own copy.
# @WORKOS/WORKOS_SYSTEM_PROMPT.md
# Identity @-imports below are activated by the agentic `/WorkOS setup` (via `skills/WorkOS/Tools/ActivateImports.ts`) once the principal scaffolds USER files.
# Claude Code does not follow transitive @-imports, so each must be listed here directly.
# @WORKOS/USER/TELOS/PRINCIPAL_TELOS.md
# @WORKOS/USER/PRINCIPAL/PRINCIPAL_IDENTITY.md
# @WORKOS/USER/DIGITAL_ASSISTANT/DA_IDENTITY.md
# @WORKOS/USER/PROJECTS.md
# @WORKOS/USER/CONFIG/OPERATIONAL_RULES.md

## Constitutional layer

Constitutional rules, the unified response format, verification doctrine, hard prohibitions, security protocol, and operational rules all live in the system prompt: `WORKOS/WORKOS_SYSTEM_PROMPT.md`. The `workos` launcher appends it to Claude Code's system prompt; a sandbox install can instead @-import it above, so plain `claude` sessions get it too (never both). When this file and the system prompt disagree, the system prompt wins.

This file is the **routing table** — it tells you where everything lives. The only mandatory startup `@`-import shipped with public WorkOS is `ARCHITECTURE_SUMMARY`. The five identity files (`PRINCIPAL_TELOS`, `PRINCIPAL_IDENTITY`, `DA_IDENTITY`, `PROJECTS`, `OPERATIONAL_RULES`) are commented out above — the agentic `/WorkOS setup` (via `skills/WorkOS/Tools/ActivateImports.ts`) uncomments them once the principal's USER scaffold is populated. Claude Code does not follow transitive `@`-imports from inside imported files, so each identity file must be listed here at top level. Everything below is **on-demand** lookup. Paths are relative to `~/.claude/` unless noted.

## WorkOS System (paths under `WORKOS/DOCUMENTATION/` unless noted)

- **Thesis** — `WorkOs/WorkOsThesis.md` (canonical source of truth)
- **System prompt** — `WORKOS/WORKOS_SYSTEM_PROMPT.md` (appended via `--append-system-prompt-file` by the `workos` launcher, or @-imported above in a sandbox install; home of the constitutional rules and response format)
- **System architecture** — `WorkosSystemArchitecture.md` (master doc)
- **Architecture summary** — `ARCHITECTURE_SUMMARY.md` (loaded via @-import)
- **Core components** (canonical two-tier component map) — `CoreComponents.md`
- Algorithm (the unified thinking system) — `Algorithm/AlgorithmSystem.md`
- Cortex (the memory system) — `Memory/MemorySystem.md`
- Skills — `Skills/SkillSystem.md`
- Hooks — `Hooks/HookSystem.md`
- Agents — `Agents/AgentSystem.md`
- Security — `Security/README.md`
- Notifications — `Notifications/NotificationSystem.md`
- Observability — `Observability/ObservabilitySystem.md`
- Ledger (change tracking: versioning, update registry, integrity gate, deploy events) — `Ledger/LedgerSystem.md`
- Upgrades (the system-improvement queue) — `Upgrades/UpgradesSystem.md`
- Atlas (current state of everything you own; `atlas` CLI) — `Atlas/AtlasSystem.md`
- Work system (capture surfaces → local work ledger as system of record; Jira + GitLab read-only context) — `Work/WorkSystem.md`
- Background services (every recurring job + the one-shot installer) — `Services/BackgroundServices.md`
- Custom spinner verbs + tips — `Spinner/SpinnerSystem.md`
- CLI-first architecture — `Tools/CliFirstArchitecture.md`
- Configuration — `Config/ConfigSystem.md`
- Containment policy — `Tools/Containment.md`
- Fabric — `Fabric/FabricSystem.md`
- Freshness convention (`pai-freshness-v1`) — `Freshness/FreshnessSystem.md`
- Terminal tabs — `Terminal/TerminalTabs.md`
- Tools reference — `Tools/Tools.md`
- ISA — `ISA/ISASystem.md`
- ISA format spec — `ISA/ISAFormat.md`
- Testing doctrine — `Testing/TestingDoctrine.md`
- System/user boundary — `SystemUserBoundary.md` (which files are SYSTEM, which are USER, how the boundary is enforced)
- AI writing patterns (system-level reference) — `Writing/AIWritingPatterns.md`
- Browser automation — `Skill("Interceptor")` (real Chrome; mandatory for web verification when a browser is available — in a headless sandbox use labeled HTTP-level/test evidence instead)
- Claude Code knowledge — `Agent(subagent_type="claude-code-guide")`

## Principal — Identity (paths under `WORKOS/USER/`)

Populated during `/WorkOS setup`. Typical layout:

- Principal identity — `PRINCIPAL/PRINCIPAL_IDENTITY.md` (canonical, @-imported)
- Career & resume — `PRINCIPAL/RESUME.md`
- Writing style — `PRINCIPAL/WRITINGSTYLE.md`
- Contacts (colleagues, stakeholders) — `CONTACTS.md`
- Definitions — `DEFINITIONS.md`

## Principal — Work Goals

- TELOS (work goals — single source of truth, unified H2 sections) — `WORKOS/USER/TELOS/TELOS.md`
- Auto-generated derivative — `WORKOS/USER/TELOS/PRINCIPAL_TELOS.md`
- Freshness convention — see `WORKOS/DOCUMENTATION/Freshness/FreshnessSystem.md`

## Principal — Work (paths under `WORKOS/USER/`)

> These are the conventional locations for your own content. A fresh install ships the scaffold, not the folders — create each one when you first put something in it.

- Integration configs — `INTEGRATIONS/*.yaml`
- Work system — `WORK/config.yaml`
- Secrets — `~/.claude/.env` (canonical; see OPERATIONAL_RULES.md)

## Project-Specific Rules

Drop project-scoped CLAUDE.md files alongside each project (e.g. `~/code/your-project/CLAUDE.md`) for rules that only apply inside that codebase. Claude Code merges them with this global file when sessions start in that directory. Use them for invariants that bite repeatedly — "always use the X helper, never bare Y" — so the rule lives next to the code it governs.
