# Review

Show recent errata so the principal can see what the ledger holds.

## Ideal State

- A short table of the last entries (default 20) is shown: id, when, kind, status, skill, the first words of the complaint, and whether it is enriched.
- Filters the principal names map straight to flags, per the table under Tool contract.
- Asked about one entry, the whole entry is shown with its context and any enrichment (`show`).
- Asked how a skill is doing, its complaint rate per call is shown from `skills`, and before and after a change from `impact`.

## Anti-criteria

- Never drops or reinterprets a filter the principal named.
- Never presents an enrichment (a model's reading) as the principal's words.

## Tool contract

```bash
bun ~/.claude/WORKOS/ERRATA/Errata.ts list [--limit 20] [--kind <kind>] [--status <status>] [--skill <Name>] [--since YYYY-MM-DD] [--unenriched] [--json]
bun ~/.claude/WORKOS/ERRATA/Errata.ts show <ERR-id>
bun ~/.claude/WORKOS/ERRATA/Errata.ts stats
bun ~/.claude/WORKOS/ERRATA/Errata.ts skills [--since YYYY-MM-DD]
bun ~/.claude/WORKOS/ERRATA/Errata.ts impact --skill <Name> --since YYYY-MM-DD [--days 14]
bun ~/.claude/WORKOS/ERRATA/Errata.ts misses
```

| Principal says | Flag |
|---|---|
| "the bugs", "just bugs" | `--kind bug` |
| "about <skill>" | `--skill <Name>` |
| "the ones nobody looked at" | `--status new` or `--unenriched` |
| "this week" | `--since <date 7 days ago>` |

## Evals

- compiled: Assay checks every output against the Ideal State and Anti-criteria above.
