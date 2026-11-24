# ViewResults

Read what the suites last said, honestly.

## Ideal State

- Every suite's last real verdict is shown with its pass^k, mean, 95% CI, trial counts and age, and a suite that has never run says so.
- A no-verdict run (evaluator unavailable) is shown as such, beside the last real verdict it did not replace.
- A suite at 100% pass^k on every recent run is named as saturated: it no longer discriminates, and needs harder cases.
- The judged residue of each suite is shown, so a suite that is mostly judges is visible.

## Anti-criteria

- A cached verdict presented as current when the suite, its prompt or its judge has changed since.
- A latest.json number reported without reading the run.json behind any surprising one.

## Tool contract

```bash
bun ~/.claude/skills/Assay/Tools/SuiteManager.ts list
cat ~/.claude/WORKOS/MEMORY/STATE/Evals-Results/<suite>/latest.json
ls -t ~/.claude/WORKOS/MEMORY/STATE/Evals-Results/<suite>/   # every run, newest first; each has run.json with transcripts
```
