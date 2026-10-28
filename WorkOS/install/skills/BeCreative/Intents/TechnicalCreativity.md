# TechnicalCreativity

Diverse, non-obvious engineering solutions from two model tiers, each with trade-offs and difficulty, and one justified recommendation.

## Ideal State

- The solution set merges 5 solutions from each of two Claude tiers (`--level max` and `--level high`), with duplicates dropped and each solution labelled with the tier that produced it.
- Solutions are mutually distinct approaches, not variations on one design.
- Every solution carries the five fields: core approach, the key non-obvious insight or cross-domain connection, trade-offs (performance, complexity, cost, maintainability), implementation difficulty 1-10 with the reason, and why it is not the default answer.
- The recommendation names one approach and justifies it against the stated constraints.
- The response follows the Output format.
- The recommended approach is one the principal would not have written on the first pass and still fully answers the brief.

## Anti-criteria

- Generation never runs as one call alone: a single call's "diverse" set shares that call's defaults.
- Never presents agreement between the two tiers as independent confirmation; they share one lineage, so it is weaker evidence than agreement across vendors.
- Not used for writing, naming, or marketing angles; those go to the other intents.

## Tool contract

WorkOS runs Anthropic models only, so the split is across tiers, not vendors (upstream LifeOS pairs OpenAI with Anthropic here). Because two tiers share more defaults than two vendors, the second call is told to avoid the conventional approaches. Run both calls in parallel, each asking for 5 solutions with the five fields from the Ideal State:

```bash
bun ~/.claude/WORKOS/TOOLS/Inference.ts --level max --timeout 300000 \
  "You generate diverse, non-obvious technical solutions and state their trade-offs honestly." \
  "<problem + hard/soft constraints + measurable success criteria + the five fields from the Ideal State>"
bun ~/.claude/WORKOS/TOOLS/Inference.ts --level high --timeout 300000 \
  "<same system prompt> Leave out the approaches an experienced engineer would reach for first; every solution must come from a different field or mechanism." \
  "<same user prompt>"
```

`--level max` resolves to Opus where the Bedrock account offers no Fable (`WORKOS/TOOLS/models.ts`); the two calls then differ by prompt, and the report says so.

## Output format

```markdown
## Creative Technical Solutions for: [Problem Name]

### Solution 1: [Descriptive Name] ([tier])
**Core Approach:** [algorithm/architecture]
**Key Innovation:** [the insight or cross-domain connection]
**Trade-offs:** Performance / Complexity / Cost / Maintainability
**Implementation Difficulty:** [1-10 with explanation]
**Why Creative:** [non-obvious thinking or novel combination]

### Solution 2 … [repeat per solution]

## Recommendation
**Selected Approach:** [Name]
**Justification:** [why it best balances constraints and goals]
**Next Steps:** [1-3 action items]
```
