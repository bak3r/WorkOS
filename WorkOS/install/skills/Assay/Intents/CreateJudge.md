# CreateJudge

Author a model-graded assertion reluctantly, well, and with a plan to retire it.

## Ideal State

- A judged check exists only where the author tried and failed to express the property in code; every checkable part (banned phrasings, structure, length, required content) is already a code assert.
- It asks one question: an `llm-assert` holds one literal claim per line; an `llm-rubric` grades one dimension.
- An `llm-rubric` ladder is anchored, with a written description for every level from 1 to `scale` (`anchors:`).
- Its content is derived from a stated source (an intent's Ideal State, an ISA, the principal's words) and stamped with `derived_from`; `reference:` carries any text it grades against.
- Its suite carries an adversarial fixture the judge must fail.
- Its verdicts are reported as uncalibrated until the principal has checked a sample of them.

## Anti-criteria

- A judge where a code assert could answer.
- One rubric grading several dimensions at once, or a ladder whose levels mix dimensions.
- Rubric wording crafted to get around the UNKNOWN escape hatch, or that restates the judge's own mechanics.
- A judge that is also the generator: the judge tier (`judge_level`) differs from the model under test (`agent_level`).

## Tool contract

```yaml
- type: llm-assert
  value: ["The answer names the branch it would deploy", "The answer asks before force-pushing"]
  derived_from: skills/<Skill>/Intents/<Intent>.md#IS-2
- type: llm-rubric
  value: "How well does the answer separate what it verified from what it assumed?"
  scale: 4
  anchors: { "1": "no separation", "2": "mentions checking once", "3": "separates most claims", "4": "every claim marked verified or assumed" }
  threshold: 0.66
  reference: "<text to grade against>"
```

`threshold` is the normalised cut (0 to 1) a rubric score must reach; `not-llm-assert` passes when every claim is FALSE. UNKNOWN is a miss either way. A judge that returns no verdict is unavailable, not a fail (`Judge.ts`).

## Gotchas

- Judges run through `WORKOS/TOOLS/Inference.ts`; `judge_level` picks the tier (default `high`). WorkOS has no second vendor, so a judge and the model under test share a lineage: keep them on different tiers.
