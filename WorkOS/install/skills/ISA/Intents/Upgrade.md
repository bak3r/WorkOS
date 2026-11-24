# Upgrade

One ISA, a list, or every ISA on the install, checked against the current ISA template, brought up to it by hand, and labelled with the template version it now meets.

WorkOS ships no format-upgrade script and no stamping tool. This intent runs by reading each ISA against `WORKOS/DOCUMENTATION/ISA/ISAFormat.md`, using the ISA tools that do ship (`IsaLadder.ts`, `ISAGate.ts`), and making each fix as a hand edit.

## Ideal State

- Before anything is written, the run reports where each named ISA stands: a by-hand reading against the template, with the count behind it and the finding codes (`section-missing`, `ladder-missing`, `criterion-no-row`, `order`, `retired-section`, `no-criteria`, `harness-shape`, `stamp-unearned`).
- Every finding is fixed from the ISA's own content: invalid Test Strategy rows typed, `## Changelog` renamed `## Learning`, sections put in template order, the Ideal State ladder written (L3 one sentence from the summit; L2 one sentence and exactly four bullets on project, system and Features ISAs; L1 on project and system ISAs), `## Harness` on project ISAs for software a person drives (a draft yaml block built from commands the repo really has, or `None — <reason>`), and real assert rows where a criterion is literal and the command was run and passed. A `manual` row for a criterion that has none is added only when the principal asked for it, and is labelled as the exception it is.
- Every ISA that ends with an empty findings list carries the label: `isa_format: <template>` and `checkup: <date> upgraded <n>→0` (or `current 0→0` when it already conformed), so the next run can see what version it meets and when it was checked. The session writes the label by hand, only after the by-hand reading found nothing left.
- The report names the before and after counts, how many ISAs were labelled, and every ISA left behind with its remaining codes and the reason (a peer's uncommitted edit, a stub with no recorded work, a judgment fix not yet made).

## Anti-criteria

- No `isa_format` or `checkup` key written on an ISA whose by-hand reading still has findings, and none copied from another ISA.
- No criterion id or text, phase, or progress changed, and no content lost, by the format upgrade (adding criteria to an ISA that has none is the one exception, and it carries a dated comment and the matching `progress:`).
- No write to an ISA with uncommitted changes, an untracked ISA, or an ISA under a backup directory.
- No probe row that cannot fail, and no assert row whose command was not run.
- No ladder, Harness command or criterion invented from outside the ISA and its repo.

## Inputs

- The ISAs: a path, several paths, or "all of them": every task ISA under `WORKOS/MEMORY/WORK/`, and every project ISA in the repos the principal names.
- Whether rowless criteria get `manual` rows now. Closed history takes them; a live project ISA gets real asserts first and manual rows only where nothing executable exists.

## Safety gates

- **Report first.** Print the findings per ISA and read them before writing anything across several ISAs.
- **Shared trees.** Refuse dirty and untracked files. Commit each repo's ISAs with explicit paths (`git commit --only <paths>`), never `git add -A`. A linked ISA (frontmatter `repo:`) lives in WorkOS memory, never in the employer repo: do not copy it there.
- **Closed ISAs stay closed.** An Edit or Write tool call on a `phase: complete` ISA makes the ISA sync hook reopen it. A judgment fix on a closed ISA is written straight to disk with a `bun -e` read-insert-write (a function replacer or `split(a).join(b)`, never a replacement string containing `$`).

## Tool contract

Run from the config root. The ISA tools that ship:

```bash
bun WORKOS/TOOLS/IsaLadder.ts check <isa>     # ladder shape; floor warnings are advisory
bun WORKOS/TOOLS/IsaLadder.ts migrate <isa>   # folds a bare `## Goal` / `## Articulation` into the ladder (a model writes L3/L2)
bun WORKOS/TOOLS/ISAGate.ts <isa>             # hard and advisory findings the close gate would raise
```

The template check itself is a reading of the ISA's sections against ISAFormat's body-section table and Completeness Gate. There is no `conform` command to run.

### Intent-to-Flag Mapping

| The ask | What to do |
|---|---|
| "is this ISA current", "check format" | Read the ISA against ISAFormat; run `IsaLadder.ts check` and `ISAGate.ts`; report the finding codes |
| "are all our ISAs on the latest format" | The same reading over every ISA named in Inputs, one summary table |
| "upgrade this ISA" | Fix what the reading found, `IsaLadder.ts migrate` for a legacy ladder, then write the label |
| "upgrade them all and label them" | Report first, then fix and label ISA by ISA, leaving behind any that cannot be fixed with the reason |

## Gotchas

- **The reading decides, never the label.** An ISA claiming `isa_format: 2.30.0` that no longer meets the template shows `stamp-unearned`; it clears once the other findings are fixed.
- **`## Harness` is required on every non-task ISA,** including system ISAs and libraries; those take `None — <reason>`. Task ISAs never need it.
- **A project root reached through a symlink breaks the `HEAD` comparison.** Resolve it with `realpathSync` before comparing against `HEAD`, or `git show` comes back empty and every file looks changed.
- **Subagents do not write ISAs the main session owns:** delegates build candidates in a scratch folder and the main session checks and installs them.

## Output format

A table of scopes (system, project, task) with ISAs before and after behind, the number labelled, then one line per ISA still behind: path, remaining codes, reason.

## Examples

```
User: "are all our ISAs on the latest format?"
→ read each against ISAFormat → "9 of 12 conform to 2.30.0; 3 behind: 2 section-missing, 2 criterion-no-row …"
```

```
User: "upgrade this ISA and label it"
→ IsaLadder.ts check → fix the findings by hand → ISAGate.ts clean → write isa_format and checkup
```

## References

- `WORKOS/DOCUMENTATION/ISA/ISAFormat.md` — the template; § Field Rules for `isa_format` and `checkup`, § `## Harness`, § The Ideal State ladder.
