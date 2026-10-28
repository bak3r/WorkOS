# Record

One erratum filed from the principal's words as one new ledger line.

## Ideal State

- One new ledger line exists whose `complaint` is the principal's words verbatim. The only changes are a leading kind tag (`bug:` and the rest of the table below), which sets `kind` and is removed, and whitespace trimmed from both ends.
- When the complaint is about one skill's output, `--skill` names that skill; when it is about a file the session produced, `--artifact` names the file, so a Proof-passed file reads as a false pass.
- Its context carries what was being asked (`--requested`, the principal's last request in their words) and what the system was doing (`--doing`), so a stranger could investigate the line a month later without the transcript.
- The reply shows the id, the kind and the skill on one line, and says so when the entry was marked a false pass.

## Anti-criteria

- Never restates the complaint in its own words: the principal's text is the one field that cannot be regenerated.
- Never adds a `rating` the principal did not type, and never a tag beyond the skill and what the code derives.
- Never files a standing rule ("from now on X") here: `hooks/SatisfactionCapture.hook.ts` already files those in the Upgrades store (`WORKOS/MEMORY/UPGRADES/`), and a second copy here is a duplicate.
- Never files the same complaint twice: one `/er` is one line.

## Inputs

Everything after `/er` is the payload. The skill is the one whose output drew the complaint, when there is one; ask only when two skills are equally plausible.

## Tool contract

```bash
bun ~/.claude/WORKOS/ERRATA/Errata.ts record --text "<the principal's words>" [--skill <Name>] [--artifact <file>] \
  [--requested "<the ask in flight>"] [--doing "<what the system was doing>"] [--isa <path>] [--session <id>] [--rating <1-10>] [--json]
```

| Leading tag in the text | kind |
|---|---|
| `bug:` | bug |
| `feature:` / `feat:` | feature-request |
| `praise:` | praise |
| `question:` / `q:` | question |
| `incident:` | incident |
| `correction:` | correction |
| (none) | complaint |

Exit 1 means it was not recorded (machine text, not a human's words). Secrets and card numbers are redacted on write.

## Output format

`recorded <ERR-id> (<kind>[, <skill>])`, then `false pass: its Proof receipt said presentable` when the entry carries that tag.

## Evals

- compiled: Assay checks every output against the Ideal State and Anti-criteria above.
