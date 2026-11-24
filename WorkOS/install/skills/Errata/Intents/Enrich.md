# Enrich

Fill the model-judged `enrichment` on entries that have none, so each carries a failure class, a cause hypothesis and a proposed fix.

## Ideal State

- Every pending entry the run reached has a validated enrichment appended as a patch, or stays null with the reason logged; the run reports attempted, enriched, failed and remaining.
- Each enrichment names its model, and its `class` is a stable snake_case label that groups entries of the same failure.
- When the principal asks to triage, the enriched entries are summarised by class with counts and their proposed fixes, and any class worth a change is offered as an Upgrades record or a HillClimb climb, which the principal decides.

## Anti-criteria

- Never writes a partial or malformed enrichment: a reply that fails `validateEnrichment` leaves the entry null.
- Never edits an entry's words, kind, rating or tags while enriching.
- Never runs while `WORKOS_INFERENCE_DISABLED` is set.

## Tool contract

```bash
bun ~/.claude/WORKOS/ERRATA/Errata.ts enrich [--limit N]          # Claude low tier (Haiku) through WORKOS/TOOLS/Inference.ts
bun ~/.claude/WORKOS/ERRATA/Errata.ts list --json                  # enriched entries carry enrichment.class
```

Upstream also runs a trained triage that files Upgrades records on its own; WorkOS does not, so triage is the summary above and the principal's decision.

## Evals

- compiled: Assay checks every output against the Ideal State and Anti-criteria above.
