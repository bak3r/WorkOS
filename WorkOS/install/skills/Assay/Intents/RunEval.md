# RunEval

Run a suite and read the result honestly.

## Ideal State

- The headline is pass^k with its SEM and 95% CI; regression suites are judged on pass^k, capability suites on the mean.
- Every surprising score in the report, good or bad, cites the transcripts of the extreme cases it rests on, and those transcripts were read before the score was reported.
- An erroring or no-verdict suite (exit 2) is reported as unverified, the same operational fact as a failing one, with the reason from its summary.
- The judge level and that WorkOS judges are uncalibrated are both in the report.
- When the suite was generated from a skill's intents (`Tools/IntentRubric.ts`), each failed assert is reported against the bullet it came from (its `derived_from`: `<intent path>#IS-n` or `#AC-n`).

## Anti-criteria

- A bare mean quoted without its interval.
- A score reported before its transcripts were read.
- Two runs on either side of a judge or rubric change compared as one series.

## Tool contract

```bash
bun ~/.claude/skills/Assay/Tools/EvalRunner.ts -s <suite|path.yaml> [-t trials] [--json]
# Exit 0 = passed, 1 = regressed, 2 = evaluator unavailable (no verdict; run.json kept as history, latest.json untouched).
bun ~/.claude/skills/Assay/Tools/SuiteManager.ts list      # what exists + last results
```

Every run persists per-trial transcripts to `WORKOS/MEMORY/STATE/Evals-Results/<suite>/<run_id>/run.json`.

## Gotchas

- The model under test runs single-shot, no tools, with the live system prompt and DA identity, so a config edit that shifts dispositions shows up; a property that needs tool use is checked on the artifact with Proof.
