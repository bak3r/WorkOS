# WriteTestNotes

Produce a bullet-style Markdown "QA: how to test" block for a branch, written for a tester who will read it in a ticket and has no access to the diff.

## Ideal State

- The notes rest on the diff of the **production**, **migration** and **config** files, each change followed to the surface a tester can actually reach: the HTTP route, the UI screen, the message consumer, the scheduled job.
- The regression list comes from a search for existing callers of the changed code, never from assumption.
- When something is testable: **`## QA: how to test`** is the heading, then a **Scope** line: what changed in the running system, and what a tester can skip because a pipeline covers it.
- **Numbered `###` sections, one per testable behaviour**, are named by feature plus the surface it lives on (e.g. "Order totals (Service API)").
- **Bullets are single actions with an expected result**: the call or click, the parameters that matter, then `→` and the expected status code or visible outcome. A case that must not change is marked `(unchanged)`. An expected side effect is a sub-bullet under the action that causes it.
- **A ready-to-run SQL query appears wherever the database is the honest check** — a new or changed column, dedup or "no second row" behaviour, a soft delete, a status transition, a migration's effect, or a value a tester cannot see in any response. The QA team has database access, so they get the query rather than a hint. Each one:
  - sits in a fenced ` ```sql ` block as a sub-bullet under the action it verifies, with one line saying what a pass looks like ("exactly one row", "`ShippingAddress` populated for every order")
  - is `SELECT` only, in the project's dialect, with real table and column names taken from the migrations, entity classes or mappings — never guessed
  - is narrowed by the parameters the tester just used and by a recency order, so it stays readable on a busy table (`WHERE Client = '<client>' AND Asset = '<asset>' ORDER BY Id DESC`), with a row limit in the dialect's own syntax
  - uses placeholders for values (`'<client>'`, `'<userId>'`) and never a real client, account or address
- Where a column was added by this branch, a query shows it filled for existing rows as well as new ones. SQL is skipped where an API or screen already shows the result; the query is for what the interface hides.
- **`### Regression`** lists the existing features that run through the changed code, each with a one-line expected result, including delayed effects — a scheduled job, a downstream consumer, the next rollover.
- **`### Pipeline`** appears only when the branch adds or changes automated tests: which job to run and what should pass. A test count appears only if it was counted.
- **Brief and flat.** Bullets, not paragraphs. Every endpoint, field, table and setting is backticked and spelled as in the code. SQL blocks are the one place length is allowed, and they stay under about eight lines each.

## Anti-criteria

- When nothing a tester can observe changed (refactoring with identical behaviour, test-only or mock-only changes, generated-client regeneration with no call-site change, comments, formatting, build or CI config), no steps are invented and no regression section is padded on: the whole output is the no-test block below, naming the pipeline that covers it if one does.
- Generated clients, mocks and tests show intent, and are never themselves listed as things QA tests.
- No ticket restatement, no code walkthrough, no "verify it works".
- Never guesses a near-match branch: a named branch that does not exist locally or on `origin` stops the run with a question.
- Saves to a file only when asked.

## Inputs

If no branch is named, use the current branch and say so in one line.

## Tool contract

Gather the facts first, from the repo root:

```bash
bun ~/.claude/skills/QaTestNotes/Tools/BranchDiff.ts [--branch <name>] [--base origin/<target>]
```

| User says | Flag |
|-----------|------|
| "branch X", "for feature/X" | `--branch X` |
| "into main", "targeting release/1.2" | `--base origin/main`, `--base origin/release/1.2` |
| (nothing) | current branch, base auto-picked from `origin/dev`, `develop`, `main`, `master` |

Then read the diff (`git diff <merge-base> <branch> -- <paths>`).

## Output format

Return the block inside one fenced ` ```markdown ` block so it pastes into a Jira ticket unchanged. Nest the SQL blocks inside it with ` ```sql `. Before the block, one line stating the branch and base used, and one line naming the SQL dialect you wrote for and where you read it from. Keep the markdown plain — headings, bullets, backticks, no tables or HTML, since Jira renders pasted markdown unevenly.

The no-test case is the whole output:

```markdown
## QA: how to test

No testing needed — <one-line reason>.
```

If `~/.claude/WORKOS/USER/CUSTOMIZATIONS/SKILLS/QaTestNotes/Example.md` exists, match its structure and density; it is a style reference, not content.
