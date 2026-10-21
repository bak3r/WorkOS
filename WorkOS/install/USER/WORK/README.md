---
provenance: template
---

# WORK/

> 💼 SAMPLE TEMPLATE — Replace with your own work context via /interview or by editing these files.

This directory holds the day-to-day context of your job: your employer, your
team, how work flows, and the systems you work in. The DA reads it so it can
answer "who reviews this?", "what does the pipeline need?" or "what's the
ticket format?" with real names and real rules, not generic advice.

## What goes here

One subdirectory per employer, named the way you say it (e.g. `AcmeBank/`),
with a `README.md` covering:

- **Team:** (interview — team name, members and roles; people go in `../CONTACTS.md`)
- **Services / repos:** (interview — what the team owns; detail per repo goes in `../PROJECTS.md`)
- **Process:** (interview — sprint length and cadence, ceremonies, definition of done, on-call)
- **Tickets:** (interview — e.g. Jira project keys, ticket ID format, workflow states)
- **Version control & review:** (interview — e.g. GitLab group, branch naming, MR approvals, merge rules)
- **CI/CD & environments:** (interview — pipelines, stages, dev/test/prod, who may deploy)
- **Coding standards:** (interview — or point at the team's own docs)

## Work System files

- `config.yaml` — optional settings (capture switches, TASKLIST section order,
  read-only Jira/GitLab integration). Every key has a default.
- `ledger.jsonl` — the work ledger, the system of record. Append-only; written
  by the Work System tools (`bun WORKOS/TOOLS/WorkLedger.ts ...`), never by hand.
- `TASKLIST.md` — rendered from the ledger. Regenerated, never edited.

Jira and GitLab are read-only context. WorkOS never creates, edits,
transitions or comments on anything there — ticket updates stay with your
team's own process.

## Privacy

This directory is part of your private USER/ tree. Team names, internal
systems and ticket details stay local and are never published.
