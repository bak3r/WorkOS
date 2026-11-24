# BeCreative

Status: bun ~/.claude/WORKOS/TOOLS/Inference.ts --help >/dev/null && echo ok · optional

## What it does

BeCreative produces ideas that are not the model's most probable answer: it generates several distinct candidates in one pass and surfaces the strongest, or expands a small seed corpus into a larger, measurably more diverse one. Six of its seven intents run on the model you are already talking to, with nothing to set up. `SyntheticDataExpansion` also scores diversity with `Tools/Diversity.ts`, which is offline.

The seventh, `TechnicalCreativity`, asks two Claude tiers for five solutions each and merges them, because one call's "diverse" set shares that call's defaults. Upstream splits this across OpenAI and Anthropic; WorkOS runs Anthropic models only, so it splits across `--level max` and `--level high` through `WORKOS/TOOLS/Inference.ts`.

## Fill in

Nothing to write in a file. `Inference.ts` uses the same Claude access as the session (Bedrock in the WorkOS sandbox).

## Accounts and secrets

None beyond the Claude access WorkOS already has. No key goes in `~/.claude/.env` for this skill.

## Prove it works

```bash
bun ~/.claude/WORKOS/TOOLS/Inference.ts --help
bun ~/.claude/skills/BeCreative/Tools/Diversity.ts index <seed.json>
```

The first prints the one-line usage (`Usage: bun Inference.ts [--level low|medium|high|max] ...`) and exits 0. The second prints `{file, n, meanPairwiseSimilarity, diversityIndex}` for a JSON array of examples, offline. Then ask for creative technical solutions to a small problem and expect ten solutions, each labelled `max` or `high`.
