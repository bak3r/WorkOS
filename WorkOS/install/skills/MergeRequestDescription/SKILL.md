---
name: MergeRequestDescription
version: 1.1.0
description: "Writes a brief, bullet-point Markdown description of what a branch changes, for a merge request / pull request — one summary line, behaviour-level change bullets, reviewer notes (contract changes, regenerated clients, migrations, config), and one line on test/mock/generated code — derived from the real diff against the target branch. USE WHEN MR description, merge request description, PR description, describe this branch, what changed on this branch, summarize branch changes, write the MR text, describe changes for review. NOT FOR reviewing code for bugs or quality (use code-review), writing QA test instructions, writing tests, or commit messages and changelogs."
metadata:
  short-description: "Writes a brief bullet-point MR description of what a branch changes, from the real diff against its merge target."
evals:
  deterministic:
    - command: "bun skills/MergeRequestDescription/Tools/BranchDiff.ts --help"
      falsifier: "the branch-diff tool fails to load or print its usage"
  manual:
    reason: "whether the description tells a reviewer what changed and what to look at needs the principal's reading against the real MR"
    falsifier: "a bullet describes a change the diff does not contain, or a contract change, migration or config key in the diff is missing from the notes"
---

# MergeRequestDescription

Turns a branch diff into a short MR description: a deterministic tool classifies what changed, the model reads the production diff and writes behaviour-level bullets. The tool is read-only git; nothing is posted.

## Ideal State

- Every bullet describes the final diff against the merge-base, as behaviour a reviewer cares about, with endpoints, fields, tables and settings named exactly as in the code.
- Contract changes, regenerated clients, migrations and new config keys are always in the reviewer notes, never buried or missing.
- The description is brief and pastes cleanly into the MR.

## Intent Routing

| Intent | Trigger | File |
|--------|---------|------|
| **WriteDescription** | "MR description for branch X", "what changed on this branch", "describe this branch" | `Intents/WriteDescription.md` |

**Tool:** `Tools/BranchDiff.ts` — branch vs base: commits, files grouped as production / migration / mock / config / generated / test / docs, route attribute lines touched, test cases added/removed. Read-only git.

## Data & Config

Optional customizations at `<configRoot>/WORKOS/USER/CUSTOMIZATIONS/SKILLS/MergeRequestDescription/` (`configRoot` is `$CLAUDE_CONFIG_DIR`, else `~/.claude`): `PREFERENCES.md` (default base branch, section names) and `Example.md` (a reference output to match in structure and density). Without them the defaults here stand.

## Gotchas

- **`origin/HEAD` is not the merge target.** In real repos it often points at an old feature branch. The tool picks the candidate base with the fewest commits on the branch; pass `--base` when the MR targets something else (a release branch).
- **Diff against the merge-base, never the base tip.** `git diff origin/dev..branch` with a moved base shows other people's work as removals.
- **Commit messages drift from the code.** "chore: linting" commits can hide real renames, and an early "add X" can be undone later. Describe the final diff, not the commit history.
- **Mocks and generated clients sit in `src/` but are not the change.** They inflate the production count; the tool separates them. A regenerated API client usually means an upstream contract changed, which belongs in reviewer notes.
- **Do not invent names.** Endpoints, fields and tables come from the diff; if unsure, say what the code does rather than guessing its public name.

## Examples

**Example 1: current branch**
```
User: "write the MR description for this branch"
→ BranchDiff.ts on current branch, base auto-picked
→ reads production diff
→ returns a fenced markdown block: summary line, Changes, Notes for reviewers, one line on tests/mocks
```

**Example 2: named branch, release target**
```
User: "describe feature/ABC-123 for the MR into release/2.4"
→ BranchDiff.ts --branch feature/ABC-123 --base origin/release/2.4
→ same output contract
```
