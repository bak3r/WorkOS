# Build — intent in, ISA criteria, then code that passes them

Turns what the principal wants into criteria in an ISA, then builds until they pass. Covers a new project, a new feature, and an existing repo that has no ISA yet.

## Ideal State

- Anything the principal will see or use has a reference they approved before code was written (SKILL.md § Acceptance), and the ISA links it.
- The ISA points at the right thing: for a new project or a changed direction, the ladder records the date the principal confirmed L3 and L2 (`Skill("ISA", "restate <isa>")`), and that date precedes the code; an existing ISA whose direction is unchanged needs no restate.
- Criteria exist in the ISA before the code that satisfies them. A new project's ISA comes from `Skill("ISA", "scaffold from prompt: <intent> — project ISA at <repo>/ISA.md")`; an existing ISA is extended in place.
- An existing repo with no ISA ends with every surface the inventory lists as a criterion, fog, out of scope, or killed with a reason, drafted through `Skill("ISA", "seed <repo>")`. Criteria read off the code are tagged `observed` until the principal ratifies them, and that first ISA's inferred L3 and L2 go through Restate as a new project's would.
- The ISA lives at `<repo>/ISA.md`; one Scaffold wrote under `WORKOS/MEMORY/WORK/` is moved there or registered in the projects table, since the guard refuses builders aimed at a repo with neither.
- Every criterion is atomic and carries its eval at the cheapest honest Assay tier (SKILL.md purpose paragraph). `IsaCheck.ts bar` exits 0, and checking the ISA takes seconds for asserts and judgment-layer questions.
- Heard and inferred intent stay apart: anything filled in rather than heard is tagged `inferred` and listed for ratification.
- The code passes: every criterion in scope passes under Test (`Intents/Test.md`), and every new test was seen failing before the change made it pass.
- Where a second look was warranted (the ISA names one for a Feature, or the change touches auth, payments, migrations, secrets or deploy), a model that did not build it checked it.
- The run ended with the independent review on each repo it touched (SKILL.md § Safety gates): a fresh, non-forked Opus agent that did not write the change read its committed diff, and its blockers were fixed inside the run.
- A run whose work ships leaves the repo ready for the project's own release path: the change is on a branch whose commits carry its ISA edit, and any version bump or changelog entry follows the project's convention. WorkOS deploys nothing and ships no release tool.
- On large or high-blast work, a model that did not write the ISA read its criteria for compound criteria, Features with no end-to-end criterion, and judged rows that would pass the wrong thing.
- Acceptance (SKILL.md § Acceptance) passed before the change was handed over, and again on the deployed thing once the project's pipeline ships it, when the principal can reach it.
- The ISA records the run: criteria ticked with one-line evidence, judgment calls in Decisions, `phase:` and `progress:` current.

## Anti-criteria

- No application code before its criteria exist, except a trivial change (a typo, a value, an obvious one-liner), which needs no ISA.
- Never asks the principal for a fact the repo, its pipeline state (read-only GitLab), its issues (read-only Jira) or prior ISAs could answer.
- Behavior that looks wrong in an existing repo never becomes a criterion; it goes on a suspected-defects list.
- Never starts a second ISA, or deletes a thin existing one, when one already exists for the project.
- Parallel builders never write the same files: each gets disjoint files or `isolation: worktree`, and each shared registry (package manifest, lockfile, route index, migrations) has exactly one writer.
- Build never pushes, merges or deploys (SKILL.md § Safety gates), and no row that writes data targets production.
- Build never clears its own review: only the principal waives a blocker (SKILL.md § Safety gates).

## Tool contract

```bash
ROOT="${CLAUDE_CONFIG_DIR:-$HOME/.claude}"
bun "$ROOT/skills/Development/Tools/Inventory.ts" <repo> --json          # existing repo: surface list
bun "$ROOT/skills/Development/Tools/IsaCheck.ts" bar <repo>/ISA.md       # atomic criteria, one row each
bun "$ROOT/WORKOS/TOOLS/IsaLadder.ts" drift <repo>/ISA.md                # criteria still match L3
bun "$ROOT/skills/Development/Tools/IsaCheck.ts" acceptance <repo>/ISA.md --since <run start date>   # before the report, for work the principal will see or use
```

Then `Intents/Test.md` proves the result.

## Gotchas

- **`Skill("ISA", "seed …")` refuses when `ISA.md` already exists.** A repo with a thin ISA gets that ISA extended in place; never delete it to make Seed run.
