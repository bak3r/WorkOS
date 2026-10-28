# Prepare

**Contents:** Ideal State · Anti-criteria · Inputs · Tool contract · Output format

Run a Feynman-style oral exam on a branch, broad to fine, so the person can explain and defend every part of it to a reviewer.

## Ideal State

- Before the first question, the branch was studied silently: the full diff of production, migration, config and test files against the merge-base, every commit message, the service's own docs (`CLAUDE.md`, README), and enough of the surrounding unchanged code to know who calls the changed code and what it did before.
- With a ticket, its goal and acceptance criteria were extracted and each mapped to the code that satisfies it, or noted as met by nothing.
- From that study four private artifacts existed before the first question: **the layer plan** (Output format), filled with this branch's facts; **the tools and patterns inventory** (every library, framework feature, database feature, concurrency technique, test technique, CI change or design pattern the branch introduces, removes or leans on, each with what it is in one plain sentence, why it was used here, and the obvious alternative); **the likely-question bank**, ranked by how likely and how damaging a weak answer would be, with ticket-vs-code gaps and deleted code near the top; and **evidence tags** saying for each "why" whether it is stated (code, comment, commit, ticket, test) or inferred.
- The person saw only a short map of the layers ahead (one line each) before the first question.
- Every layer opened with one question that made the person explain, in plain words, as if to a new colleague: they talked before being taught.
- Every answer was judged against the study: it holds when it is correct, names the mechanism (not just the term), and can say why. A solid answer got one line of credit and a harder follow-up from the question bank, until the layer's likely questions were covered.
- Every weak spot was handled at once: exactly what was missing or wrong named in one line, the missing piece taught short and concrete, anchored to this branch's code (file and line), with a small ASCII sketch when a flow or race is easier seen than read, then re-asked from a new angle in the same turn's closing question. No layer moved on until the re-ask held; a re-ask that failed twice was taught a different way.
- "I don't know" was treated as a weak spot, not a failure, and taught the same way; an answer not recoverable from the evidence was named as a question the person must settle with the author or their own memory before the review.
- Old weak spots came back, unannounced, whenever a later layer touched them.
- The ledger at `~/.claude/WORKOS/MEMORY/STATE/PrepareMe/<repo>-<branch-slug>.md` (layers done, weak spots with status, open questions) was updated after each layer; when it already existed at the start, resuming from it was offered, beginning with the still-shaky items.

## Anti-criteria

- Never shows the study to the person.
- Never asks more than one question per turn, and never continues past the question: the turn ends at the question.
- Never invents a "why": an inferred reason is presented as inferred.
- Never quietly reconciles a ticket-vs-branch gap; it is raised as an explicit question.
- Never skips a layer without saying so, and skips one only when the branch truly has nothing in it (a one-line fix has no approach debate).

## Inputs

If no branch is named, use the current branch and say so in one line. If a named branch does not exist locally or on `origin`, stop and ask. If the person mentions a ticket but did not paste it, ask for the text once (Jira is often not reachable from the machine; use a Jira tool or MCP only if one is actually available). No ticket is fine: proceed without it.

## Tool contract

From the repo root:

```bash
bun ~/.claude/skills/PrepareMe/Tools/BranchDiff.ts [--branch <name>] [--base origin/<target>]
```

| User says | Flag |
|-----------|------|
| "branch X", "for feature/X" | `--branch X` |
| "into main", "targeting release/1.2" | `--base origin/main`, `--base origin/release/1.2` |
| (nothing) | current branch, base auto-picked |

## Output format

The session's shape. The layers, broad to fine:

1. **Purpose.** What problem exists without this branch, who feels it, and what is different after merge. With a ticket: the ticket's goal in the person's own words.
2. **System context.** Where this sits: which service, who calls it, what data flows through the changed path, what else depends on it.
3. **Approach.** The core design decision, the alternatives, and why this one won. What was deliberately not done.
4. **Tools and patterns.** Each item from the inventory: what it is, why here, what the alternative was. The person must be able to explain each one without the name of the thing doing the work.
5. **Mechanism.** The key files and the exact flow through them, including what was removed and why that removal is safe.
6. **Failure and edges.** Concurrency, error paths, retries, data already in production, rollout and rollback, config per environment.
7. **Proof.** What the tests prove and what they do not, how the person knows it works, what CI runs.

**Ticket round** (when a ticket was given), after Layer 3 or wherever it fits naturally: for each acceptance criterion, the person points to where the branch meets it. Any criterion with no matching code, or code that does more than the ticket asked, is raised as an explicit question: "the ticket says X, the branch does Y. A reviewer will ask why. What is your answer?"

**Mock review** (final round): five to eight questions drawn from all layers, in random order, phrased the way a reviewer would ask them, weighted toward earlier weak spots and the top of the question bank. The same loop rules apply.

**The closing summary:**

- **Solid:** layers and topics the person explained correctly on the first try.
- **Recovered:** weak spots that held after teaching, one line each with the key fact.
- **Still shaky:** anything that failed the re-ask, with the one thing to reread (file and line).
- **Open questions for the author:** reasons that could not be recovered from the evidence.
- **The 60-second pitch:** ask the person to give it; then tighten it with them. Their words, not yours.
