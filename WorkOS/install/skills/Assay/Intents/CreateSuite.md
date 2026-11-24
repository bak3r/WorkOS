# CreateSuite

Build an eval suite that measures what matters and keeps measuring it.

## Ideal State

- Cases come from real use: a real prompt the skill or system was given, or a real failure turned into a case (`FailureToCase.ts`); an invented case is marked as invented and kept to the gaps real cases leave.
- The suite is balanced: should-do cases beside at least one should-NOT case (`negative: true`), so hedging on everything cannot pass it.
- Every part a tool can check is a code assert; judged asserts carry only the residue, each one literal claim, with `derived_from` naming where its content came from.
- A suite with any judged assert carries an `adversarial_output` on at least one case: an output that passes every code assert there and only the judge can catch.
- A suite built for a skill's intent is generated from that intent (`IntentRubric.ts suite`), so the bullets the model reads are the ones it is scored on.
- `SuiteManager.validateSuite` passes, and one real run of the suite exists before it is relied on.

## Anti-criteria

- A suite whose every case is a should-do, or whose every assert is judged.
- An adversarial fixture that fails its own code asserts (it is just wrong, not adversarial).
- A brittle string check on natural language that fails honest answers.
- A suite identity-bound to the principal (names, employer, private paths) in the skill's own `Suites/`; those go in the USER directory.

## Tool contract

```bash
bun ~/.claude/skills/Assay/Tools/IntentRubric.ts rubric skills/<Skill>/Intents/<Intent>.md          # preview the asserts
bun ~/.claude/skills/Assay/Tools/IntentRubric.ts suite skills/<Skill>/Intents/<Intent>.md --name <suite> \
  --prompt "<real prompt>" [--prompt ...] --adversarial "<output only the judge can catch>" \
  [--system-prompt-file skills/<Skill>/SKILL.md] [--trials 3] [--out <path>.yaml]
bun ~/.claude/skills/Assay/Tools/FailureToCase.ts --suite <draft> --id <case_id> --prompt "..." [--banned "..."] [--expect "..."] [--negative]
```

Suite shape (v2): `name`, `type` (capability | regression), `trials`, `pass_threshold`, optional `agent_level`, `judge_level`, `system_prompt_file`, `append_to_base`, `subject_timeout_ms`, and `cases: [{id, prompt, assert: [...], threshold?, negative?, adversarial_output?}]`. Assert types: `equals`, `contains`, `icontains`, `contains-all`, `contains-any`, `regex`, `starts-with`, `ends-with`, `is-json`, `contains-json`, `max-length`, `min-length` (each with a `not-` form), and the judged `llm-assert` and `llm-rubric`. Generic suites go in `skills/Assay/Suites/<Capability|Regression>/`; anything personal goes in `WORKOS/USER/CUSTOMIZATIONS/SKILLS/Assay/Suites/`. Drafts from FailureToCase land in that USER directory's `Suites/_drafts/`.

## Gotchas

- `IntentRubric.ts` compiles word and character counts to code; other counts (bullets, headings, links) stay judged in WorkOS. Add a `regex` assert by hand when the count matters.
- `regex` values compile with no flags: no `\p{...}` classes, no case-insensitive flag (use `icontains` or `[Aa]`).
