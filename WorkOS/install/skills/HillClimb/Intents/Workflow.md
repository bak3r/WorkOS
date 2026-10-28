# Workflow

Climb one workflow, a skill's intent file, until it does its job more reliably and faster. WorkOS ships no Workflows v2 definitions; upstream LifeOS climbs those too.

## Ideal State

- The intent's ideal state is named: its own `## Ideal State` and `## Anti-criteria`, and what its consumers need from its output.
- A baseline exists from a suite that exercises the intent (generated with `IntentRubric.ts suite` when none does), run through the Assay runner, and recorded in the climb ledger.
- The misses are the failed cases and the principal's corrections about its outputs, each with its reason.
- Each experiment changed the intent file and was re-run on the same suite, so its number compares with the baseline's. A kept change beat the baseline and the intent still lints clean.
- A step whose output was judged by a model and could be checked by code now is checked by code.
- Each failure the climb fixed is guarded by a standing check (a suite case, a code assert, or a Test Strategy row) that fails if it returns.

## Anti-criteria

- No kept change leaves `IntentLint.ts` with an error on the intent.
- No kept change that only lengthens the intent: what a climb learned lands as a check, not as more prose.

## Safety gates

- Never run an intent with live side effects (pushes, deploys, posts) as an experiment. Use a synthesized input, and say which.

## Tool contract

```bash
bun ~/.claude/skills/Assay/Tools/IntentRubric.ts suite skills/<Skill>/Intents/<Intent>.md --name <suite> --prompt "<real prompt>" --adversarial "<text>" --out <path>.yaml
bun ~/.claude/skills/Assay/Tools/EvalRunner.ts -s <suite> --json            # baseline and every experiment; run.json feeds --from-run
bun WORKOS/TOOLS/IntentLint.ts skills/<Skill>/Intents/<Intent>.md                 # must stay clean after every kept change
bun ~/.claude/skills/HillClimb/Tools/HillClimb.ts start --type workflow --target skills/<Skill>/Intents/<Intent>.md --metric pass_to_k --direction higher --why "<why>"
```

## Gotchas

- The Assay runner is single-shot with no tools, so an intent whose done-bar is a file written or a tool called is climbed on Proof receipts of real runs instead of a suite.
