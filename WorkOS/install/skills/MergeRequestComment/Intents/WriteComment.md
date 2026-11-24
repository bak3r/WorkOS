# WriteComment

Turn one or more issues already raised in this conversation's review into MR comments the principal can paste, each with an exact anchor.

## Ideal State

- Each issue the principal meant gets one block: "that one" is the last issue discussed; "all" is every issue from the most recent review, in the order raised.
- Each block's line was confirmed at the branch tip and is the right-hand (new) side number; the branch is the current one unless the review named another.
- Each comment is in question form, starting "Wouldn't this be an issue if…" or "Would this be an issue if…" (SKILL.md § Gotchas says which), and the question names the trigger; the rest explains it.
- Each comment is short: two to four sentences, roughly 40–80 words, one trigger, one mechanism chain, one consequence.
- Each comment uses concrete names from the code: types, methods, states and settings in their real spelling. A cross-reference to another line (`the comment at :259-262`) is welcome when it shows the code contradicts its own intent.
- When the line moved from the review's original citation, or was anchored on a changed line instead of the root-cause line, one line above the block says so.

## Anti-criteria

- Never invents a finding: with no review in this conversation and none pasted, ask for the finding in one line.
- No greeting, no "nit:", and no suggested fix unless the principal asks for one; the question invites the author to find it.
- No internal IDs or review-tool jargon: the comment goes to colleagues in plain English.
- Nothing is posted anywhere.

## Inputs

When the request is ambiguous between two issues, pick the likelier, say so in one line (`⚠️ Taking the Dispose-in-finally issue; redirect if you meant the retry one.`), and continue.

## Tool contract

Confirm the anchor at the branch tip, from the repo root:

```bash
git show <branch>:<path> | sed -n '<start>,<end>p' | cat -n   # or Read the file when the working tree is the branch tip
git diff <merge-base> <branch> -- <path>                      # is the line changed in this MR?
```

## Output format

For each issue, one block, in the order the issues were raised, separated by a blank line:

```
**File:** `<repo-relative path>`
**Line:** <n> — `<the code on that line, trimmed>` (<short locator: "first statement in the finally", "the catch at the end of HandleAsync">)

**Comment:**

> Wouldn't this be an issue if <concrete trigger>? <mechanism: what the code does in that case, one or two sentences>. That would cause <consequence the reviewer cares about>.
```

Blocks only; the principal places the comments by hand.
