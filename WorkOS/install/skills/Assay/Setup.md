# Assay

Status: bun test ~/.claude/skills/Assay >/dev/null 2>&1 && echo ok · optional

## What it does

Assay checks AI output. It runs eval suites (a prompt, the model's answer, and code or Claude-judge assertions on that answer, over several trials) and reports pass^k with a confidence interval. Proof checks one finished file against what was asked and the skill intent that made it, and writes a receipt tied to that file's exact bytes. Code checks are free and instant; judges are Claude calls through `WORKOS/TOOLS/Inference.ts`, on the same Claude access the session uses.

## Fill in

Nothing is required. Optional, in `~/.claude/WORKOS/USER/CUSTOMIZATIONS/SKILLS/Assay/` (WorkOS before 2.0 used `Evals/` there, which still works while it is the only one):

- `Suites/` for your own suites, which resolve before the skill's.
- `config.json` with `{"config_change_suite": "<suite>"}` to pick the suite that runs when a system prompt, identity or hook file changes (default `core-dispositions`).

## Accounts and secrets

None. No key goes in `~/.claude/.env` for this skill.

## Prove it works

```bash
cd ~/.claude && bun test ./skills/Assay
bun ~/.claude/skills/Assay/Tools/SuiteManager.ts list
```

The first runs the offline tests (no model calls) and ends with `0 fail`. The second lists the suites, including `core-dispositions`. Then run one judge call for real with `bun ~/.claude/skills/Assay/Tools/Judge.ts`, which should end with `✅ judge discriminates good vs bad`.
