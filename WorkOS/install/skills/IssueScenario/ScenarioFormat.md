# ScenarioFormat

The output contract shared by both workflows. One block per issue.

## The block

```
### <Short title in plain words: what the user/system experiences, not the bug class>

**Where:** `<repo-relative path>:<line>` (`<the code on that line, trimmed>`)

**Scenario:**

1. <Starting state: concrete data, config, who is involved. "Account A has a balance of 100.">
2. <First action, with real method/endpoint names. "Request 1 calls `WithdrawAsync(A, 80)`.">
3. <Next action, keeping order and timing explicit. "Before request 1 saves, request 2 calls `WithdrawAsync(A, 50)`.">
4. ⚠️ <The step where the code does the wrong thing, and why, with the line. "Both read balance 100 at `AccountService.cs:42`, so both checks pass.">
5. <What follows from it.>

**Result:** <What the user, the data or the system ends up with. Observable, concrete. "Both withdrawals succeed, 130 is paid out of an account that held 100, and the stored balance is 50.">

**Expected:** <What should have happened instead, one line.>
```

Rules:

- **3 to 7 steps.** Fewer means the trigger is not concrete; more means setup is leaking into the story. Fold setup into step 1.
- **Concrete values** (`100`, `"2026-03-31"`, `null`, two users named A and B) over placeholders. Pick values that make the failure obvious when read.
- **Real names from the code** in their exact spelling, so the reader can search for them.
- **The bug class goes last.** If naming it helps ("this is a lost update"), add one line after **Expected**. Never as the title.
- **Assumptions are marked inline** on the step they affect: `(assumed: the retry policy is enabled in production)`.
- **No fix by default.** Add `**Possible fix:**` (one or two lines) only when the user asks for fixes, or in ExplainBug when the fix is the point of the question.

## Merge request comment variant

For ReviewMergeRequest, the block above is split: **Where** becomes the anchor the user places the comment on, and the comment body is the scenario itself, written so it reads naturally to the MR author:

```
**File:** `<repo-relative path>`
**Line:** <n> (`<code on that line, trimmed>`)

**Comment:**

> Here's a case where I think this breaks:
>
> 1. ...
> 2. ...
> 3. ⚠️ ...
>
> Result: ...
> Expected: ...
```

The opener can vary ("I think this can fail like this:", "Could this happen?") but keeps the collegial, slightly questioning tone: the author may know something the reviewer does not. Use the more questioning form when any step is marked assumed.

## Junior mode additions

After **Expected**, add:

- **Terms used:** each technical term from the steps with a one-line plain explanation (`race condition: two things run at the same time and the result depends on which finishes first`). Only terms actually used.
- **Why this matters:** two to four sentences in plain words: why the code looked correct, what the hidden assumption was, and why that assumption is false here.
- **What to look for next time:** one line naming the pattern to spot in other code ("a read, then a check, then a write, with no lock or transaction around them").

Short sentences, simple English, idioms avoided. Do not soften or skip the real code names.

## Flow mode addition

After the block (or after the junior additions), an ASCII flowchart of the whole scenario in a fenced code block:

```
 [Request 1]                 [Request 2]
     |                           |
     v                           |
 read balance = 100              |
     |                           v
     |                   read balance = 100
     v                           |
 100 >= 80 ? yes                 v
     |                   100 >= 50 ? yes
     v                           |
 save 100-80 = 20                v
     |                   save 100-50 = 50   <-- ✗ overwrites 20
     v                           v
   final balance = 50, but 130 was paid out of 100
```

- Every step from the scenario appears; the failing step is marked `✗` with a short arrow note.
- Parallel actors get side-by-side columns; a single path flows top to bottom.
- Decision points as `condition ? yes/no` with both branches drawn when the wrong branch is the bug.
- Max ~70 columns. Plain ASCII in MR comments; Unicode box drawing allowed in terminal output only.
