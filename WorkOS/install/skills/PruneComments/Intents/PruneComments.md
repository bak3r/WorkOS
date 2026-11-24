# PruneComments

**Contents:** Ideal State · Anti-criteria · Inputs · Safety gates · Tool contract · Output format

Reduce the comments a branch or commit added to the ones that tell a reader something the code cannot.

## Ideal State

- Every comment passed one test: **would a competent reader of this code lose something if it were gone?** Where the answer was unclear, the comment was kept, because deleting a comment that held a real reason costs more than leaving one that didn't.
- **Kept** (shortened if padded):
  - Why the code is this way: a constraint, invariant, limit, unit, timezone, ordering or concurrency requirement not visible in the code.
  - Warnings about surprising behaviour, and workarounds with the issue or link that justifies them.
  - Reasons for a choice that looks wrong ("linear scan on purpose: n ≤ 20").
  - `TODO` / `FIXME` / `HACK` that name follow-up work, unless this same change already did it.
  - Everything tagged `directive`, and doc comments the project requires (SKILL.md § Gotchas).
- **Cut:**
  - Restating the next line or the member name (`// get the user`, `/// Gets the user.` on `GetUser`).
  - Step narration of code whose names already say it (`// Step 1: validate input`).
  - Change history: "added for", "changed from X to Y", "new implementation", "fixed", "updated to use". Git keeps history; the comment rots.
  - Commented-out code (often tagged `looks-like-code`; confirmed by reading).
  - Section banners and closing-brace labels (`// ===== Helpers =====`, `} // end if`).
  - Empty or echo doc tags (`<param name="id"></param>`, `<returns>The result</returns>`, `@param id the id`), unless docs are required.
  - Assistant-session residue addressed to a reviewer rather than a future reader ("as requested", "now correctly handles", "this is important").
- **C# doc blocks, by scan tag:**
  - `non-public` with `echoes-name` or `empty:*`: the whole block removed, or just the empty or echo tags.
  - `public-api` with `docs-required-by-build`: the `<summary>` never deleted; only empty or echo `<param>` / `<returns>` tags removed, and only when the project does not also require those (CS1573 and CS1591 cover different cases; if unsure, keep).
  - `may-feed-openapi`: the text is published API documentation, cut only when it adds nothing to an API consumer either.
  - `inheritdoc`: kept.
- **Shortened**: a comment with one real fact buried in padding keeps the fact, in one line, in the comment's existing style.
- `verify` exited 0 before done was reported. On a violation (code changed), that hunk was restored (`git diff` shows it) and the edit redone, never explained away.

## Anti-criteria

- Never edits a block the scan did not list, and never touches anything but comment text: no reformatting, no renames, no code touch-ups while in the file.
- Never commits, amends, rebases or pushes unless asked.
- In dry-run mode, nothing is edited.

## Inputs

No branch or commit named → use the current branch against the auto-picked base, and say so in one line. A named branch that is not checked out, or a commit that is not an ancestor of `HEAD` (`git merge-base --is-ancestor <sha> HEAD`) → stop and ask before any checkout. Scan reports zero `comment`, `doc` and `inline` blocks → say so and stop.

## Safety gates

- **Clean tree first.** `git status --porcelain --untracked-files=no` must be empty before editing. If it is not, stop and ask; stashing or committing is the user's choice.
- **Never commit, amend, rebase or push** unless asked. The result is an uncommitted working-tree change the user reviews.
- **Edit only blocks the scan listed**, and only their comment text.

## Tool contract

From the repo root:

```bash
bun ~/.claude/skills/PruneComments/Tools/CommentScan.ts scan [FLAGS]
```

| User says | Flag |
|-----------|------|
| (nothing), "this branch" | current branch, base auto-picked from `origin/dev`, `develop`, `main`, `master` |
| "branch X", "feature/X" | `--branch X` |
| "into main", "against release/1.2" | `--base origin/main`, `--base origin/release/1.2` |
| "commit abc123", "the last commit" | `--commit abc123`, `--commit HEAD` |
| "include generated code too" | `--include-generated` |
| "just show me", "don't change anything", "dry run" | scan only, then report proposals without editing |

After editing:

```bash
bun ~/.claude/skills/PruneComments/Tools/CommentScan.ts verify
```

Exit 0 is required before reporting done.

## Output format

After `verify` passes, report in plain text:
- One line: range scanned, files touched, comments removed / shortened / kept.
- A short list of the removals grouped by reason (restates code, change history, commented-out code, …), with file and line for each.
- Any comment deliberately kept that looks removable at first sight, with the reason in a few words.
- The verify result, and one line on how to commit it (a new commit on the branch, or `git commit --fixup <sha>` when a single older commit was targeted). Do not run it.

In dry-run mode, the same list is the proposal.
