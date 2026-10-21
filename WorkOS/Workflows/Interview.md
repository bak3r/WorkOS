# Interview — work onboarding (phase 2)

The "meaning" half. Runs AFTER Setup. Captures who the user is at work, how their team works, what they build and what they are aiming for, then regenerates the TELOS summary so the DA boots with real context. This is the moment WorkOS becomes theirs.

## Stance

Peer conversation, not a form. Ask one thing at a time, reflect it back, go deeper where there's signal. Every write is `existsSync`-guarded — never clobber answers the user already gave. The user can say `skip` to any item and `done` to stop early; partial onboarding is valid.

Scope is work only. Do not ask about hometown, family, health, money, hobbies, or a life current/ideal state.

## Sequence

1. **DA naming** — what do they want to call their assistant? Capture `da.name`, optional `da.full_name`/`display_name`/`color`. Write to `CONFIG/WORKOS_CONFIG.toml` `[da]` and `DIGITAL_ASSISTANT/DA_IDENTITY.md`. *(This is the step the old install wizard handled; it lives here now.)*
2. **Work identity** — name, pronunciation, timezone, working language (and how simple the DA's English should be), title and seniority, employer, team, working pattern (office/home days, hours, sprint cadence), how the DA should talk to them → `[principal]` in `WORKOS_CONFIG.toml` and `PRINCIPAL/PRINCIPAL_IDENTITY.md`.
3. **Team & process** — who they work with (manager, product owner, QA, peers, stakeholders) → `CONTACTS.md`; how work flows: ticket system (Jira project keys, ticket ID format), version control and review (GitLab, MR rules, approvals), CI/CD, environments, ceremonies, on-call → `WORK/<Employer>/README.md`.
4. **Stack & conventions** — languages and versions (e.g. C#/.NET), frameworks, databases and SQL dialect, messaging, test frameworks, analyzers/formatters, branch/commit/MR conventions, what "ship it" means, private package feeds → `TECHSTACKPREFERENCES.md` and `CONFIG/OPERATIONAL_RULES.md`. WorkOS's own tooling stays TypeScript on bun; these preferences describe the user's codebases.
5. **Dev environment** — where the code runs (sandbox/container vs host), mounts, toolchain, egress allowlist and blocked domains, cloud accounts, what is unavailable here (browser, GUI, audio) → `ARCHITECTURE.md`.
6. **Work projects** — each repo/service: path, purpose, build/test/run commands, deploy target, routing aliases → `PROJECTS.md`.
7. **Work goals (TELOS)** — current state at work (role, team, where things stand), ideal state at work, professional mission, the problems the team/product solves, goals (sprint / quarter / career, with a measurable criterion and date where they have one), challenges, strategies, projects, narratives (talking points for reviews, demos, 1:1s), engineering lessons → `TELOS/TELOS.md`. Keep the section headings the template ships; the summary generator reads them.
8. **Domain vocabulary** — domain terms, acronyms, internal system names, ticket prefixes → `DEFINITIONS.md`.
9. **Import sources (optional)** — the user can point at existing material: repo `CLAUDE.md`/README files, ADRs, onboarding docs, an old config. Read each, extract identity / team / project / TELOS signal, and merge into the USER tree — `existsSync`-guarded, confirm before each write. **Stays-local rule:** work code and documents are read in place and summarized into the USER tree; nothing is uploaded, pasted into an external service, or fetched from outside the sandbox.
10. **Regenerate the TELOS summary** — once `TELOS/TELOS.md` is written, regenerate the `@`-imported summary:

    ```bash
    WORKOS_CONFIG_PATH=<configRoot>/WORKOS/USER/CONFIG/WORKOS_CONFIG.toml \
      bun <configRoot>/WORKOS/TOOLS/GenerateTelosSummary.ts
    ```

    It rewrites `TELOS/PRINCIPAL_TELOS.md`. Exit 1 means real content failed to parse: fix the heading or item format it names, then re-run. On a tree that is still all `(sample)` entries it writes an empty summary, which is correct.

## Close

Confirm what landed (DA name, identity, team, N projects, N goals) and tell them the interview is re-runnable any time to go deeper.

## Notes
- This workflow only WRITES the user's config tree — it never touches system files.
- If `setup` ran immediately before, continue the same conversation; if invoked standalone (`workos interview`), confirm Setup already ran (config tree exists) before writing.
