---
name: MergeRequestComment
version: 1.1.0
description: "Turns an issue already raised in a code review into a ready-to-paste merge request comment: the exact file and line to anchor it on (verified against the branch tip), plus a short question-form comment — 'Wouldn't this be an issue if <trigger>? <mechanism>. That would cause <consequence>.' USE WHEN MR comment, merge request comment, PR comment, write a comment for this issue, where should I comment, which line should I comment on, turn this finding into a review comment, phrase this for the MR, comment for issue N, draft review comments. NOT FOR finding the issues in the first place (use code-review), the MR description (use MergeRequestDescription), QA test steps (use QaTestNotes), or posting comments to GitLab/GitHub."
metadata:
  short-description: "Turns a code-review finding into a paste-ready MR comment: the verified file and line, and a short question-form comment."
evals:
  manual:
    reason: "whether a comment reads as a fair, concrete question a colleague would answer needs the principal's reading"
    falsifier: "the principal rewrites the comment before posting, or the anchored line does not show the issue at the branch tip"
---

# MergeRequestComment

Converts a review finding from the conversation into something the principal pastes into the MR: where to put it, and what to say. The finding already exists; this skill locates and phrases it. Nothing is posted anywhere: the principal places every comment by hand.

## Ideal State

- Every comment is anchored on a line verified at the branch tip, given on the MR's right-hand (new) side, with the code on that line quoted so it can be found even if the number is off by one.
- Every comment is a short question naming one concrete trigger, the mechanism, and the consequence, in the code's own names and plain English.
- The certainty of each comment matches what the review earned: "Wouldn't" only when the code shows the failure.

## Intent Routing

| Intent | Trigger | File |
|--------|---------|------|
| **WriteComment** | "MR comment for that issue", "where do I comment on this", "comments for issues 1 and 3" | `Intents/WriteComment.md` |

## Data & Config

Optional customizations at `<configRoot>/WORKOS/USER/CUSTOMIZATIONS/SKILLS/MergeRequestComment/` (`configRoot` is `$CLAUDE_CONFIG_DIR`, else `~/.claude`): `Example.md`, a reference comment to match in tone, length and density, and `PREFERENCES.md`. Without them the defaults here stand.

## Gotchas

- **Line numbers from the review go stale.** The review may have cited a line from a different revision, a working-tree file with local edits, or from memory. Re-read the line at the branch tip before giving it; quote the code so the principal can find it even if the number is off by one.
- **The MR shows the new (right-hand) file.** Give the line number in the branch version, not the base version and not a diff hunk offset.
- **Anchor on a changed line when you can.** A comment on a line the MR did not touch needs the diff context expanded first, and on some setups cannot be placed at all. If the root cause sits on an unchanged line, anchor on the nearest changed line that causes or exposes it, and say why in the location note.
- **"Wouldn't" asserts, "Would" asks.** Use "Wouldn't this be an issue if…" when the code shows the failure; use "Would this be an issue if…" when it depends on something the code does not show (library behaviour not verified, a caller not read). Never claim certainty the review did not earn.
- **The trigger must be concrete and realistic.** "if Redis is unreachable at release time", not "if something goes wrong". A reviewer can test a concrete trigger; a vague one reads as noise and gets resolved without a reply.

## Examples

**Example 1: one issue from the review**
```
User: "write the MR comment for the second issue you found"
→ re-reads the cited file at the branch tip, confirms the line
→ returns File / Line (with quoted code) / Comment block
```

**Example 2: several issues**
```
User: "give me comments for all of them"
→ one File / Line / Comment block per issue, in the order they were raised
```
