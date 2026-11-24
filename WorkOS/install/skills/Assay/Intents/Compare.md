# Compare

Paired A/B comparison of two configurations (prompts, model tiers, or a with/without ablation) on one suite.

## Ideal State

- The verdict is backed by a paired-difference 95% CI over the same cases, never two independent scores eyeballed side by side.
- Both arms ran the full suite, and the paired delta with its CI is reported.
- A falsifiable hypothesis and the meaningful-difference threshold were stated before the run: "B beats A" is refuted when the CI includes 0 or favors A.
- A TIE names the case count needed to detect the observed delta (the power hint).
- The comparison JSON is persisted next to the suite's runs.

## Anti-criteria

- Calling a winner from two independent runs, or from means without the paired CI.
- A model-vs-model comparison pinned to a model id instead of a tier.
- A conclusion shipped from an underpowered case set without the power hint.
- A hypothesis written after seeing the result.

## Tool contract

```bash
# Arm A = suite as-is; arm B overrides. Keys: system_prompt | system_prompt_file | agent_level
bun ~/.claude/skills/Assay/Tools/Compare.ts -s <suite> --b '{"agent_level":"low"}'
bun ~/.claude/skills/Assay/Tools/Compare.ts -s <suite> --a '{"system_prompt_file":"v1.md"}' --b '{"system_prompt_file":"v2.md"}' --label-a v1 --label-b v2
# Ablation: arm B's prompt file has the component removed; the delta is the component's measured contribution.
bun ~/.claude/skills/Assay/Tools/Compare.ts -s <suite> --b '{"system_prompt_file":"without.md"}' --label-a with --label-b without [-t trials] [--json]
```

Exit 2 when either arm gave no verdict; no comparison is reported then.

## Gotchas

- Model-vs-model rides `agent_level` (low, medium, high, max), which `WORKOS/TOOLS/models.ts` maps to Haiku, Sonnet, Opus and Fable; on Bedrock without Fable, `max` is Opus, so `high` against `max` compares nothing.
- A significant result on 4 cases is fragile; heed the power hint.
