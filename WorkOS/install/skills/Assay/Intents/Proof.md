# Proof

Check one produced artifact against what was asked, before the principal sees it, and bind the result to its bytes.

The rest of Assay tests a skill on fixture cases. Proof tests one run's output: the document, description, notes or code that this run made.

## Ideal State

- A skill run's output is held to that intent's own definition of done: its `## Ideal State` and `## Anti-criteria` bullets run as checks (`--intent`), and the receipt names the intent and its sha256.
- The principal's ask, when there is one, is checked too (`--ask`), and the receipt carries the ask's sha256.
- Every check code can decide is a code check: countable bullets compile to code (`IntentRubric.ts`), and an `--asserts` file carries the rest of what code can see.
- The artifact reaches the principal only with a fresh receipt (`Proof.ts verify` exits 0) whose verdict is `pass`, or `admitted-flagged` with every flag said in the hand-over.
- A file kind Proof cannot read (anything not text) is handed over with an `UNPROOFED: <kind>` line, never silently.

## Anti-criteria

- A judged "no" blocking: WorkOS judges are uncalibrated, so their "no" is a flag the presenter states.
- An unavailable judge, an `unmeasured` receipt, or a stale or hand-edited receipt read as a pass.
- The builder proofing its own work by looking at it instead of running the checks.
- A flag left out of the hand-over.

## Tool contract

```bash
bun ~/.claude/skills/Assay/Tools/Proof.ts run --artifact <file> [--intent skills/<Skill>/Intents/<Intent>.md] [--ask "<what was asked>"] [--asserts <asserts.yaml>] [--judge-level low|medium|high|max] [--no-judge] [--json]
bun ~/.claude/skills/Assay/Tools/Proof.ts verify --artifact <file> [--json]
bun ~/.claude/skills/Assay/Tools/Proof.ts show --artifact <file>
```

`run` exits 0 pass, 1 fail (a code check failed), 2 unavailable (a judge gave no verdict), 3 admitted-flagged or unmeasured, 64 usage. `verify` exits 0 only when the receipt is fresh, intact and presentable. An `--asserts` file is a YAML list of `Assertions.ts` asserts, or `{assert: [...]}`. A skill with no `Intents/` passes its `SKILL.md` as `--intent`.

## Output format

When presenting a proofed artifact, one line after it: `Proof: <verdict> · <n> checks · receipt <sha256 prefix>`, then each flag as `🚩 <check> — <why>`.

## Gotchas

- An edit after the run makes the receipt stale. Re-run `run` after the last edit, not before it.
- `--no-judge` runs the code checks only; the receipt then carries skipped judge findings and reads `unmeasured` unless a code check passed.
