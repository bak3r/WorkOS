---
name: QaTestNotes
version: 1.1.0
description: "Writes a bullet-style Markdown 'QA: how to test' block for a branch or merge request, ready to paste into a Jira ticket — scope line, numbered sections per testable behaviour with concrete calls and expected status codes or outcomes, ready-to-run SELECT queries in the project's SQL dialect wherever the database is the honest check, regression list, pipeline job — or just 'No testing needed' with a reason when nothing observable changed. USE WHEN QA how to test, QA notes, test instructions, testing steps for the ticket, how should QA test this, what to test on this branch, test plan for the MR, attach test steps to Jira. NOT FOR describing what a branch changed (use MergeRequestDescription), reviewing code for bugs (use code-review), or writing automated unit and integration tests."
metadata:
  short-description: "Writes a paste-ready 'QA: how to test' block for a branch, with concrete calls, expected results and read-only SQL checks."
evals:
  deterministic:
    - command: "bun skills/QaTestNotes/Tools/BranchDiff.ts --help"
      falsifier: "the branch-diff tool fails to load or print its usage"
  manual:
    reason: "whether a tester can follow the notes without the diff needs a tester or the principal reading them against the branch"
    falsifier: "a step tests something the branch did not change, a changed behaviour has no step, or a SQL query names a table or column that does not exist"
---

# QaTestNotes

Turns a branch diff into the "QA: how to test" block a tester pastes into the ticket: what changed in the running system, one numbered section per testable behaviour with concrete calls and expected results, read-only SQL where the database is the honest check, and a regression list. A deterministic tool classifies what changed; the model traces each change to the surface a tester can reach. Nothing is posted.

## Ideal State

- Every step is an action a tester with no access to the diff can run, with its expected status code or visible outcome, traced from the changed code to a route, screen, consumer or job.
- Every SQL query is `SELECT` only, in the project's real dialect, against real table and column names, with placeholders for values.
- A branch with nothing observable gets "No testing needed" with its reason, never invented steps.

## Intent Routing

| Intent | Trigger | File |
|--------|---------|------|
| **WriteTestNotes** | "QA how to test", "test steps for this branch", "what should QA test" | `Intents/WriteTestNotes.md` |

**Tool:** `Tools/BranchDiff.ts` — branch vs base: commits, files grouped as production / migration / mock / config / generated / test / docs, route attribute lines touched, test cases added/removed. Read-only git.

## Data & Config

Optional customizations at `<configRoot>/WORKOS/USER/CUSTOMIZATIONS/SKILLS/QaTestNotes/` (`configRoot` is `$CLAUDE_CONFIG_DIR`, else `~/.claude`): `PREFERENCES.md` (default base branch, API naming, pipeline job names) and `Example.md` (a reference output to match in structure and density). Without them the defaults here stand.

## Gotchas

- **`origin/HEAD` is not the merge target.** In real repos it often points at an old feature branch. The tool picks the candidate base with the fewest commits on the branch; pass `--base` when the branch targets something else (a release branch).
- **Diff against the merge-base, never the base tip.** `git diff origin/dev..branch` with a moved base shows other people's work as removals.
- **A changed handler is not a changed endpoint.** Trace to the route, screen, consumer or job that reaches it; one query can back several endpoints, and each is its own test line.
- **Mocks and generated clients sit in `src/` but are not behaviour QA can test.** They inflate the production count; the tool separates them. A regenerated client usually means an upstream contract moved, so name the upstream call in Regression.
- **"No testing needed" is a real answer.** A refactor, a mock change or a regenerated client with no call-site change earns it. Inventing steps for an untestable change wastes a tester's day and trains them to ignore the section.
- **Do not invent counts, table names or status codes.** Take them from the code, migrations or a test run; otherwise use placeholders (`<N>`, `'<client>'`).
- **Read the SQL dialect from direct package references, not the lock file.** A `packages.lock.json` transitively lists every provider (SQL Server, Npgsql, MySQL, SQLite all at once), so it proves nothing. The direct `PackageReference` in the `.csproj`, the DbContext setup (`UseSqlServer`, `UseNpgsql`) or the connection string is the answer. It decides real syntax: `SELECT TOP 5 ...` on SQL Server versus `... LIMIT 5` on Postgres and MySQL.
- **An entity name is not a table name.** EF pluralizes, `[Table]` attributes and fluent `ToTable` override, and a column can be renamed in the mapping or by a migration. Read the mapping or the latest migration before writing a query the QA team will run.
- **QA runs these queries against a shared environment.** Keep them `SELECT` only, filtered to the tester's own parameters, and never paste a real client, account or address into the ticket.

## Examples

**Example 1: current branch, real behaviour change**
```
User: "write the QA how to test for this branch"
→ BranchDiff.ts on current branch, base auto-picked
→ reads production diff, traces to routes and callers
→ returns a fenced markdown block: Scope, 1..N sections, Regression, Pipeline
```

**Example 2: refactor-only branch**
```
User: "QA steps for feature/ABC-123"
→ BranchDiff.ts shows only renames and test edits
→ returns "No testing needed — internal rename, behaviour unchanged, covered by the unit test job"
```
