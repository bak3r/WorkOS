# Phase0Setup — first-run install bootstrap

**Purpose:** On a fresh WorkOS install (or one where the bootstrap was never finished), walk the setup targets that give the DA its work context: DA identity, Principal identity (role and team), credentials, first project, work ledger + integrations. Once Phase 0 is done on a system, this workflow auto-skips and `/interview` routes to **ContextCheckin** instead.

A fresh WorkOS install ships with placeholder identity ("WorkOS" / "User"), an empty `.env`, a sample-row PROJECTS table, and Jira/GitLab context switched to auto-detect. Until Phase 0 runs, the DA works under the wrong name, knows nothing about your role or team, and has no read-only view of your tickets and merge requests.

---

## Notification

Output: `Running the **Phase0Setup** workflow in the **Interview** skill...`

---

## Step 1 — Detect whether Phase 0 is needed

Run the scanner to see Phase 0 completeness:

```bash
bun ~/.claude/WORKOS/TOOLS/InterviewScan.ts --json | jq '.targets[] | select(.phase == 0)'
```

If every Phase 0 target reads ≥80% complete, **skip this workflow** and route to ContextCheckin.

---

## Step 2 — The setup targets, in order

Walk the setup targets one at a time. Each writes to a specific file. The whole phase is skip-able if the principal already knows what they want and types it directly.

| # | Target | Files written | Skip-when |
|---|--------|---------------|-----------|
| 0.1 | **DA Identity** — name, full name, color, role, personality summary | `USER/DIGITAL_ASSISTANT/DA_IDENTITY.md` (YAML frontmatter holds structured schema, body holds prose) | DA_IDENTITY.md no longer reads "WorkOS" / "WorkOS Assistant" |
| 0.2 | **Principal Identity** — name, timezone, role, team, systems owned, current focus | `USER/PRINCIPAL/PRINCIPAL_IDENTITY.md` Quick Reference section | PRINCIPAL_IDENTITY.md no longer reads "User" with "(interview)" markers |
| 0.3 | **Credentials** — optional keys for the skills you use (e.g. `GH_TOKEN` for the work pipeline, `APIFY_TOKEN`, `BRIGHTDATA_API_KEY`). Model access is never stored here — the `claude` CLI uses the harness's own auth (Bedrock in the sandbox) | `~/.claude/.env` (or `~/.config/WORKOS/.env` symlink target) | `.env` exists and holds the keys the principal named |
| 0.4 | **First project** — at least one row so PROJECTS routing works | `USER/PROJECTS.md` table + Routing Aliases | PROJECTS.md has ≥1 non-sample row |
| 0.5 | **Work ledger + integrations** — keep the local ledger on (default) or disable it; confirm read-only Jira (`JIRA_URL`/`JIRA_USERNAME`/`JIRA_API_TOKEN`) and GitLab (`glab` + `GITLAB_HOST`) context, and the team's Jira key prefixes if the generic pattern catches false positives | `USER/WORK/config.yaml` (`enabled`, `jira.project_keys`, `jira.enabled`, `gitlab.enabled`) | `bun WORKOS/TOOLS/Doctor.ts` shows jira/glab live or deliberately off, and `bun WORKOS/TOOLS/WorkContext.ts refresh` reports each source ok or skipped |

---

## Step 3 — Conversation flow

1. **Run scanner**, present:
   > "Looks like a fresh setup — Phase 0 hasn't run. I'll walk through a few setup steps: identity, your role and team, credentials, projects, work ledger + integrations. Roughly 5 minutes. Want to start, or skip Phase 0 and pick up at the work TELOS?"
2. For each target:
   - Read current file content. If still on the bootstrap default, **Fill mode** — walk the prompts.
   - If already populated, **Review mode** — read back the populated values, ask "still right?"
3. Credentials (0.3) — never echo keys back to the principal. Confirm only "captured GH_TOKEN". If the principal pastes a key in chat, immediately write it to `.env` and ask the principal to clear it from scrollback.
4. After Phase 0 completes, **regenerate PRINCIPAL_TELOS.md** (it interpolates the principal name):
   ```bash
   bun ~/.claude/WORKOS/TOOLS/GenerateTelosSummary.ts 2>/dev/null || true
   ```
5. State the transition:
   > "Phase 0 done — your identity and work context are on file. Moving to the context check-in, or break here?"

---

## Rules

- **One question at a time.** Never dump all setup prompts at once.
- **Never echo credentials.** Confirm capture only.
- **Skip-able at every step.** The principal can short-circuit any target.
- **Don't ask again about filled fields.** The scanner's completeness score decides what's still gap-worthy.
- **After Phase 0, route to ContextCheckin** — don't re-prompt for TELOS sections; that's the next workflow's job.
