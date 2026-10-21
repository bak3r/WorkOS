---
provenance: template
---

# Tech Stack Preferences

> Languages, tools, and conventions for the codebases you work on — the DA uses these when suggesting or writing code in your repos.
>
> Scope: this file describes YOUR work code. WorkOS's own tooling (hooks, tools, skills) stays TypeScript on bun regardless of what you put here.

## Languages

- **Primary:** (interview — e.g. C# on .NET 8)
- **Frameworks:** (interview — e.g. ASP.NET Core, EF Core, MediatR)
- **Database / SQL dialect:** (interview — e.g. PostgreSQL, SQL Server T-SQL)
- **Messaging:** (interview — e.g. RabbitMQ, Kafka, Azure Service Bus)
- **Tests:** (interview — e.g. xUnit, NUnit, FluentAssertions, Testcontainers)
- **Analyzers / formatting:** (interview — e.g. `dotnet format`, StyleCop, .editorconfig rules)
- **Build / package feeds:** (interview — e.g. `dotnet build`, private NuGet feed URL)
- **Allowed:** (interview — what other languages are welcome)
- **Avoid:** (interview — what to steer away from)

## CLI Tools

Three layers — pick the right one for the context:

- **In-tool (Claude tool calls):** Built-in `Grep` (ripgrep-backed), `Glob`, `Read`. Faster than shelling out; no subprocess.
- **In Bash (terminal / one-shot pipelines):** `rg` over `grep`, `fd` over `find`, `bat` over `cat`, `eza` over `ls`.
- **In WorkOS skill/tool code:** prefer language-native fs APIs (Bun `fs`, Node `fs/promises`); if shelling out, prefer `find` — `fd` is not guaranteed installed.
- **Preferred shell:** (interview — bash / zsh / fish)

## Conventions

- **Paths:** Use `$HOME`, `${WORKOS_DIR}`, relative paths — never hardcode user paths
- **Comments:** Minimal — code should explain itself via naming
- **Error handling:** Explicit. Never silently swallow errors.
- **Branches / commits / MRs:** (interview — e.g. `feature/PROJ-1234-short-name`, ticket ID in the commit subject, one MR per ticket)
- **Config:** (interview — appsettings.json / env vars / secrets store preference)

---
*These preferences shape every code suggestion, refactor, and tool selection. The DA consults this file before invoking any code-writing capability.*
