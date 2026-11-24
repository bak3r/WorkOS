# Miss

Turn one caught miss into a standing check that would have caught it, so it cannot happen again. This is the fast path of the loop, usually minutes.

## Ideal State

- The miss is pinned down: the output it was in (an Errata entry and its output ids, or the artifact path), what was asked, and what was wrong, in the principal's words where they exist.
- A check exists at the lowest tier that can honestly catch it: code when the defect is literal or countable, a judged suite case only when it needs reading.
- The check is attached where the miss came from: a Proof `--asserts` file for the skill, the owning ISA criterion's Test Strategy row, or the skill's suite.
- The check is shown to fail on the missed output and pass on a corrected one.
- When the miss came from a false pass, the receipt that passed it is named, so Errata's false-pass rate for that check can move.
> The Bunker CLI is maintainer-private and not in the public release; run code rows with `bun test ./<path>` and suite rows with `bun skills/Assay/Tools/EvalRunner.ts`.

## Anti-criteria

- The principal's words are quoted, never paraphrased. Errata holds them verbatim for a reason.
- A check that would not have caught the miss is never reported as done.

## Safety gates

- A new judged check flags and never blocks: WorkOS judges are uncalibrated, so only a code check may block.

## Tool contract

```bash
bun WORKOS/ERRATA/Errata.ts show <erratum-id>
bun WORKOS/ERRATA/Errata.ts misses --json
bun skills/Assay/Tools/Proof.ts show --artifact <file>
bun skills/Assay/Tools/Proof.ts run --artifact <file> --intent skills/<Skill>/Intents/<Intent>.md --asserts <asserts.yaml> --json   # must now fail on the missed output
bun WORKOS/PULSE/Bunker/bin/bunker.ts miss <isa> <isc> --kind noul|choice|score --id <id> --question "<text>"  # maintainer-side: the Bunker harness does not ship
bun skills/Assay/Tools/FailureToCase.ts --suite <suite> --id <case> --prompt "<ask>" --banned "<the bad phrase>" --expect "<what good does>"
```

The climb ledger is optional for a single miss. When the same kind of miss repeats, open a Skill or Eval climb instead, because a pattern is a hill.
