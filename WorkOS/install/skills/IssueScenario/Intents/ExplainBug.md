# ExplainBug

Explain a bug (found in this conversation, reported by someone, or seen in logs or a stack trace) as a step-by-step scenario that shows how it happens.

## Ideal State

- **The cause is confirmed in the code**, not guessed from the symptom: the code path was read from the entry point to the failing line. When the cause cannot be pinned down, the report says what is known, gives the most likely scenario with its uncertain steps marked `(assumed: …)`, and names what would confirm it (a log line, a query, a test).
- **One block per bug in the format from `ScenarioFormat.md`**, with the junior and flow additions when those options are on (SKILL.md § Options). Unicode box drawing is allowed in the flowchart since this goes to the terminal.
- **When the bug was reported with a symptom**, the scenario ends in that symptom and the **Result** line matches it in the user's own words, so they can recognise it.
- **A reproduction hint** follows the block when one is practical: the smallest test, request or data setup that would trigger it (one to three lines). When reproduction needs production-only conditions, the hint is skipped and the report says so.
- When several bugs share one root cause, one scenario is written and the other symptoms are listed under **Result**.

## Anti-criteria

- Never invents a story: with no code to read and no finding in the conversation, ask for the file, the stack trace, or the symptom in one line.
- No fix unless asked, or unless the question is "how do I fix this"; then one `**Possible fix:**` paragraph after the block.
- No preamble.

## Inputs

"That one" means the last issue discussed; "all" means every issue from the most recent review, in order.

## Output format

The block(s), then the reproduction hint.
