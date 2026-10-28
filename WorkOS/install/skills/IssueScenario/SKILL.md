---
name: IssueScenario
version: 1.1.0
description: "Explains a code issue as a concrete numbered scenario (who calls what, with which values, in what order, and what goes wrong at which step) instead of naming it abstractly, so a reader sees the failure happen. Two uses: reviewing a merge request and writing scenario-style MR comments for each issue found, or explaining a bug that was just found or reported. Options: junior mode (explain as to a junior developer, every term glossed) and flow mode (ASCII flowchart of the whole scenario). USE WHEN describe the scenario, how would this bug happen, steps to reproduce, walk me through when this breaks, explain this bug, why does this fail, review this MR with scenarios, scenario comments, explain like a junior, show me a flowchart of the bug, ascii flow of the failure. NOT FOR short question-form comments on already-found issues (use MergeRequestComment), MR descriptions (use MergeRequestDescription), QA test steps (use QaTestNotes), or explaining how working code is designed (use ExplainLikeJunior)."
metadata:
  short-description: "Explains a code issue as a concrete numbered scenario showing the failure happen, for MR review comments or bug explanations."
evals:
  manual:
    reason: "whether a scenario is reachable and true to the code needs a reader who checks it against the code"
    falsifier: "a step names a value, method or branch the code does not have, or the failing step's line does not do what the step says"
---

# IssueScenario

A reader understands a bug fastest when they watch it happen. This skill turns every issue into a short story told in numbered steps: a realistic starting state, the actions in order, the exact step where the code does the wrong thing, and what the user or system sees afterwards. The abstract label ("race condition", "null dereference") comes last, if at all. Nothing is posted anywhere; the principal places review comments by hand.

## Ideal State

- Every scenario is true to the code: each value, method name and branch comes from code that was read, and any step that rests on something unverified is marked `(assumed: …)`.
- Every scenario is reachable from an entry point, or says plainly that it would happen only if its trigger can reach the line.
- Every scenario names the exact failing step with `⚠️` and its `file:line`, in the contract `ScenarioFormat.md` defines.

## Intent Routing

| Intent | Trigger | File |
|--------|---------|------|
| **ReviewMergeRequest** | "review this MR with scenarios", "find issues on this branch and write comments", "scenario comments for the MR" | `Intents/ReviewMergeRequest.md` |
| **ExplainBug** | "explain this bug", "how would this break", "walk me through when this fails", "why does X happen" | `Intents/ExplainBug.md` |

| File | Read when |
|------|-----------|
| `ScenarioFormat.md` | before writing any scenario: the block, its rules, the MR comment variant, and the junior and flow additions |

## Options

Options combine freely and apply to either workflow. Detect them from plain words, not only flags.

| Option | The user says | Effect |
|--------|--------------------|--------|
| **junior** | "junior", "like I'm junior", "explain simply", `--junior` | Every technical term glossed in plain words the first time it appears, plus a "Why this matters" paragraph and a "What to look for next time" line. Same steps, more words around them. |
| **flow** | "flowchart", "ascii", "diagram", "flow", `--flow` | An ASCII flowchart of the whole scenario, with the failing step marked `✗`. Placed after the steps, never instead of them. |

Default (no option): steps only, written for a mid-level developer who knows the language.

## Gotchas

- **Scenarios drift into fiction.** Every value, method name and branch in the steps must come from the code you read, not from what such code usually looks like. If a step depends on something you did not verify (a caller you did not open, library behaviour), mark that step `(assumed: …)`. An invented step makes the whole comment wrong and wastes the author's time.
- **The trigger must be reachable.** A scenario that needs an impossible input (a value validation already rejects upstream) is a false positive. Check the path from the entry point before writing it; if you cannot confirm reachability, say "would happen if <X> can reach here" rather than asserting it.
- **One scenario per issue.** Two failure paths in one story confuse the reader about which one matters. Split them.
- **Name the exact failing step.** The step where the code misbehaves gets the `⚠️` marker and quotes the line (`file:line`). Without it the reader has the story but not the place to fix.
- **Steps are actions, not commentary.** "User B clicks Save at the same moment" is a step; "this is problematic because of concurrency" is not. Explanation belongs after the steps.
- **ASCII flowcharts break in proportional fonts and in some MR renderers.** Always wrap them in a fenced code block, keep them under ~70 columns so they do not wrap in a review pane, and use plain ASCII box characters (`+ - | v >`) for MR comments; Unicode box drawing is fine only in terminal output.
- **Junior mode is not a different scenario.** It adds glossing around the same steps. Do not dumb down the steps themselves; the junior reader needs the real names to find the code.

## Examples

**Example 1: MR review**
```
User: "review this branch against main and write scenario comments"
→ ReviewMergeRequest: reads the diff, verifies each finding, returns one File / Line / scenario comment block per issue
```

**Example 2: bug explanation, junior + flowchart**
```
User: "explain why the balance goes negative, like I'm junior, with an ascii flow"
→ ExplainBug: traces the code path, returns the numbered scenario, glossary-style explanations, and a flowchart marking the failing step
```

**Example 3: a single finding already in the conversation**
```
User: "describe that second issue as a scenario"
→ ExplainBug on the existing finding; no new review
```
