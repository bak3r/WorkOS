---
name: PrepareMe
version: 1.1.0
description: "Prepares the person to explain and defend how and why a branch was implemented, before a code review, MR walkthrough, demo or handover. Studies the branch diff, commits and tests (plus a Jira ticket if one is given), then runs a Feynman-style oral exam from the broadest view to the finest detail: the person explains each layer in plain words, weak spots are named on the spot, filled with the missing knowledge, and re-tested from a new angle before moving on. Calls out every tool, library and pattern the branch relies on. USE WHEN prepare me, PrepareMe, prepare me for the review, prepare me for questions about this branch, do I understand this branch, quiz me on this implementation, grill me on the code, defend my MR, explain why it was built this way, review prep, handover prep, ticket prep. NOT FOR writing the MR description (use MergeRequestDescription), QA test steps (use QaTestNotes), finding bugs (use code-review), or a general tutorial on a topic not tied to a branch (use Explain)."
metadata:
  short-description: "Prepares the person to explain and defend a branch: studies the diff, then runs an oral exam from purpose down to code detail."
evals:
  deterministic:
    - command: "bun skills/PrepareMe/Tools/BranchDiff.ts --help"
      falsifier: "the branch-diff tool fails to load or print its usage"
  manual:
    reason: "whether the person can now defend the branch is judged by the person in the real review"
    falsifier: "a reviewer asks a question the session's question bank should have raised and the person cannot answer it"
---

# PrepareMe

Turns a branch into an oral exam the person must pass before anyone else questions them. The model studies the branch first, then makes the person explain it, layer by layer, and does not move on until each layer holds.

## Ideal State

- The model knows the branch better than the reviewer will before the first question, and every "why" it teaches is tagged as stated in the evidence or inferred.
- Every weak spot the person shows is named, taught from this branch's code, and re-asked from a new angle until it holds.
- The session ends with a summary of what is solid, recovered and still shaky, the open questions for the author, and the person's own 60-second pitch.

## Intent Routing

| Intent | Trigger | File |
|--------|---------|------|
| **Prepare** | "prepare me", "quiz me on this branch", "prepare me for the review", a pasted Jira ticket with "prepare me" | `Intents/Prepare.md` |

**Tool:** `Tools/BranchDiff.ts` — branch vs merge-base: commits, files grouped as production / migration / mock / config / generated / test / docs. Read-only git.

## Data & Config

Optional `PREFERENCES.md` at `<configRoot>/WORKOS/USER/CUSTOMIZATIONS/SKILLS/PrepareMe/` (`configRoot` is `$CLAUDE_CONFIG_DIR`, else `~/.claude`): default base branch, ticket-key pattern, language level, who the usual reviewers are. The session ledger lives in `WORKOS/MEMORY/STATE/PrepareMe/`.

## Gotchas

- **Jargon is not understanding.** "It uses optimistic concurrency" or "it's idempotent" passes no layer. Ask what happens, step by step, when the thing it protects against actually occurs. A correct term with no mechanism behind it is a weak spot.
- **The re-ask must come from a new angle.** Asking the same question again only tests whether the person remembers your explanation. Change the scenario, flip it ("what breaks if we remove X?"), or ask them to apply it to a case you did not cover.
- **End the turn at the question.** Answering your own question, or adding "for example, you might say…", gives the answer away and turns the exam into a lecture.
- **Never invent the "why".** If the reason for a choice is not in the code, comments, commit messages, ticket or tests, say it is inferred, or tell the person this is a question they must answer from their own knowledge (or ask the author). A made-up rationale they repeat in a review is worse than "I don't know".
- **Deleted code is examined too.** A removed interface, lock, package or test is a decision, and reviewers ask "why was it safe to remove?" more often than "what does the new code do?".
- **Lock files, generated clients and formatting inflate the diff.** Study production, migration, config and test files; mention the noise only when it signals something (a removed package = a dropped dependency).
- **Diff against the merge-base, never the base tip.** `git diff origin/dev..branch` with a moved base shows other people's work as removals. The tool already does this.
- **The ticket and the branch can disagree.** A gap between acceptance criteria and what was built is the single most likely review question. Raise it explicitly; do not quietly reconcile it.

## Examples

**Example 1: current branch, no ticket**
```
User: "prepare me for the review of this branch"
→ BranchDiff.ts, reads the production/test diff, commits, service docs
→ one-line map of the layers ahead, then Layer 1 question: "In two sentences, what problem does this branch solve, and for whom?"
→ answer is vague about the race → names the weak spot, explains it from the code, re-asks with a new scenario
→ continues down to code-level detail, ends with a mixed mock-review round and a solid/shaky summary
```

**Example 2: with a Jira ticket**
```
User: "prepare me, here's the ticket: <pasted text>"
→ extracts goal and acceptance criteria, maps each to the code that satisfies it
→ asks the person to show where each criterion is met, and raises any criterion the branch does not visibly cover
```
