---
provenance: template
last_updated: 1970-01-01T00:00:00Z
last_updated_by: bootstrap-template
convention: pai-freshness-v1
---

# Projects

> Bootstrap default — functional before interview. Run `/interview` (projects phase) to personalize.
>
> ⚠ INTERVIEW REQUIRED — run `/interview` to populate this file with your real identity content. The DA loads it at every session start; without your content, the model operates on placeholders.

A compact table of every repo and service you work on. The DA reads this at startup to route aliases ("the ledger service" → specific repo) and pick the right context for any project reference.

## Projects Table

| Project | Path | Repo | Build / Test | Deploy | Stack |
|---------|------|------|--------------|--------|-------|
| (interview — first service) | `~/work/example-service` | gitlab.example.com/team/example-service | `dotnet build` / `dotnet test` | GitLab CI pipeline | C#, .NET 8, PostgreSQL |

## Routing Aliases

When you say... | The DA routes to...
---|---
"the ledger service", "the API" | (interview — main service)
"the shared lib", "common" | (interview — shared library repo)

---
*Interview asks about your active projects one at a time and appends rows to the table. Aliases help the DA route natural language ("check the API pipeline") to the right codebase. Keep this current — it's cheap to maintain incrementally, expensive to reconstruct.*
