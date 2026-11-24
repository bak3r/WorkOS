# Eval

Climb an instrument: a suite, a judge or a standing check. A climb on anything else is only as good as the instrument that measures it.

## Ideal State

- The instrument's ideal state is named: the criterion it measures (from the owning ISA or skill) and the principal's labels on it.
- The baseline is the instrument's own quality, not its pass rate: whether it catches its adversarial fixture, its judged residue (`SuiteManager.ts list`, `judged_residue` in each run), and its agreement with the principal on a labelled sample of its verdicts.
- The principal's labels are collected in the conversation on a sample of stored verdicts from `run.json` transcripts, and the sample, the labels and the agreement are recorded in the climb ledger's notes.
- The misses are the cases where the instrument and the principal disagreed, and the cases it cannot tell apart.
- A kept change sharpened the instrument (for example anchored rubric levels, a mixed rubric split into single-claim asserts, a case from a real miss, a judged check moved down to code) and raised agreement or lowered residue without losing the adversarial catch.
- Each disagreement the climb resolved is now a case in the instrument, so the check that missed it before catches it now.
- A grader climb holds out labels the way a target climb holds out cases: tune on half the principal's labels and report agreement on the other half.
- A grader fix re-grades every stored output from the earlier rounds, and the climb reports whether the ranking of variants changed. If it flipped, the earlier rounds were tuned to the wrong signal, and the principal decides whether to restart from baseline.
- A failing regression suite was either fixed at the thing it guards or shown to be wrong by the principal's labels.

## Anti-criteria

- Agreement between models is not a label. Only the principal's labels count.
- The instrument improves only by fixing it, never by deleting, weakening or skipping a check, and a retired check is never reported as a score gain.
- A failing regression suite never passes because its threshold moved.

## Safety gates

- A judge, rubric or anchor edit breaks score comparability. Report the before and after as two series.

## Tool contract

```bash
bun skills/Assay/Tools/SuiteManager.ts show <suite> --json
bun skills/Assay/Tools/SuiteManager.ts validate <suite>
bun skills/Assay/Tools/SuiteManager.ts list                 # judged residue per suite
bun skills/Assay/Tools/EvalRunner.ts -s <suite> -t 5 --json  # adversarial catch and per-assert verdicts in run.json
bun ~/.claude/skills/HillClimb/Tools/HillClimb.ts start --type eval --target <suite-or-check> --metric "agreement" --direction higher --why "<why>"
bun ~/.claude/skills/HillClimb/Tools/HillClimb.ts baseline <id> --value <agreement> --train <n> --source "principal labels on <n> verdicts" --instrument <suite.yaml>
```

## Gotchas

- WorkOS has no label store or calibration tool (upstream keeps both in Assay). The labels live only in the climb ledger, so a later climb on the same instrument re-collects them.

## References

- Writing a new suite from scratch belongs to `Skill("Assay")` CreateSuite. This workflow climbs ones that exist.
