# WriteDescription

Produce a brief, bullet-point Markdown description of what a branch changes, for the merge request a reviewer will read.

## Ideal State

- **One summary line** says what the MR does and why, in plain words, starting with the ticket ID when the branch name carries one.
- **`### Changes`** has one bullet per change a reviewer would care about, written as behaviour ("`GET orders` now returns `shippingAddress` and the carrier name"), not as a file list. Short bold group labels (API, Domain, Infrastructure) appear only when there are more than about five bullets. Endpoints, DTO fields, tables and settings are named exactly as in the code, in backticks.
- **`### Notes for reviewers`** appears only when true and then carries every one of: contract changes (response shape, renamed or removed endpoints), regenerated clients and which upstream change they follow, migrations, new config or env keys, behaviour that deliberately changed, anything risky or unfinished.
- **One line on the rest**: test, mock and generated code, with what it covers ("unit tests for the multi-address case, mock data for local runs"), never one bullet per file.
- **Brief.** Usually 4–10 bullets in total.
- Every statement rests on the real diff of the production, migration and config files; generated, mock and test files were skimmed only to learn intent, and where commit messages and the diff disagree, the diff wins.

## Anti-criteria

- No file paths unless a reviewer needs them to find something, no line counts, no code walkthrough, no restating commit messages.
- Never guesses a near-match branch: a named branch that does not exist locally or on `origin` stops the run with a question.
- Never writes a description for an empty diff; it says the diff is empty instead.
- Saves to a file only when asked.

## Inputs

If no branch is named, use the current branch and say so in one line.

## Tool contract

Gather the facts first, from the repo root:

```bash
bun ~/.claude/skills/MergeRequestDescription/Tools/BranchDiff.ts [--branch <name>] [--base origin/<target>]
```

| User says | Flag |
|-----------|------|
| "branch X", "for feature/X" | `--branch X` |
| "into main", "targeting release/1.2" | `--base origin/main`, `--base origin/release/1.2` |
| (nothing) | current branch, base auto-picked from `origin/dev`, `develop`, `main`, `master` |

Then read the real diff (`git diff <merge-base> <branch> -- <paths>`) of the production, migration and config files.

## Output format

Return the description as Markdown inside one fenced block (` ```markdown `) so it pastes cleanly into the MR. Before the block, one line stating the branch and base used. If `~/.claude/WORKOS/USER/CUSTOMIZATIONS/SKILLS/MergeRequestDescription/Example.md` exists, match its structure and density; it is a style reference, not content.
