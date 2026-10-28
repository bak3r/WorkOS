# ReviewMergeRequest

Review a branch or merge request for real defects and return one ready-to-paste scenario comment per issue, each anchored on an exact file and line.

## Ideal State

- **Only real, reachable defects** are reported: correctness, data loss, concurrency, security, error handling that hides failures, contract breaks. Each finding survived an attempt to disprove it: the path was traced from an entry point and the failing step holds.
- **Each finding is written as the MR comment variant in `ScenarioFormat.md`**, with the junior and flow additions when those options are on (SKILL.md § Options). In flow mode the flowchart goes inside the comment body, plain ASCII.
- **Each comment is anchored on a changed line** where possible. When the root cause sits on an unchanged line, the anchor is the nearest changed line that exposes it, and one line above the block says so. Line numbers are the branch (right-hand) side, re-read at the branch tip.
- **Findings are ordered most severe first.** Above the blocks, one line per issue: `1. <title> (<severity: high / medium / low>)`.
- When nothing survives verification, the report says so plainly and lists what was checked in two or three lines.

## Anti-criteria

- No style, naming or "consider" remarks; those belong to other tools.
- Never pads the review with weak findings.
- A large diff split across subagents by file group never returns bare labels: each subagent returns findings with the scenario evidence.
- Nothing is posted to GitLab or GitHub.

## Inputs

Default: the current branch against the repository's default branch (`main` or `master`, whichever exists; `develop` if the repo uses it as the integration branch). When the repo or branch is ambiguous, pick the likelier, say so in one line (`⚠️ Reviewing feature/x against develop; redirect if wrong.`), and continue.

## Tool contract

```bash
git merge-base <target> <branch>
git diff --stat <merge-base> <branch>
git diff <merge-base> <branch> -- <path>
git log --oneline <merge-base>..<branch>
```

Read the changed files at the branch tip, plus the callers and callees needed to judge whether a path is reachable.

## Output format

The summary list, then the blocks separated by a blank line. The user places the comments by hand.
