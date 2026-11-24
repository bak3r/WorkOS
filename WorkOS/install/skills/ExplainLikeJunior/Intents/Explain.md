# Explain

**Contents:** Ideal State · Anti-criteria · Inputs · Output format

Produce one written, top-down explanation of the requested topic, pitched at a capable junior developer: knows how to program, does not yet know this topic or this codebase.

## Ideal State

- The explanation descends the zoom ladder (Output format), widest first, using the levels that fit the topic: a level that would be empty is skipped, and levels are never reordered. A small function might need L0, L3, L4 only; a whole system needs all levels.
- Each level begins with a heading that names the level (`## L1 — The big picture`) so the reader can say "go deeper on L3".
- A reader who stops after any level has a correct, if coarse, model — no level contradicts a later one.
- Every new term is glossed in plain words on first use.
- At least one diagram appears wherever structure or flow exists: ASCII/box-drawing in a fenced block, ≤ 70 columns wide.
- At least one concrete example appears; examples are minimal and would actually run or compile.
- The same running example is reused across levels where possible, so the reader is not re-learning context at each level.
- Plain, simple sentences. Short paragraphs. No hype.
- For workspace code, the relevant files were read first, and anything that could not be confirmed is said to be unconfirmed.
- The whole ladder arrives in one response, ending with an offer to go deeper on any level.

## Anti-criteria

- Not interactive: never a quiz or a turn-by-turn lesson (that is the Explain skill's Teach intent).
- For workspace code: no invented file names, classes or flows.
- Never crams a very large system into the terminal: when it would exceed what reads well there, offer to publish it as an HTML page instead.

## Inputs

If the topic is ambiguous in a way that would change the whole explanation (e.g. "explain the pipeline" in a repo with three pipelines), ask one short question. If it is workable, pick the most likely reading, say so in one line (`⚠️ Explaining X, not Y — redirect if wrong.`), and continue.

## Output format

**The zoom ladder:**

| Level | Answers | Typical content |
|-------|---------|-----------------|
| **L0 — One sentence** | What is it, and why does it exist? | A single sentence a junior could repeat to a colleague. |
| **L1 — The big picture** | Where does it sit and what problem does it solve? | The world without it vs. with it; neighbours it talks to. **Diagram.** An everyday analogy if one fits honestly. |
| **L2 — The parts** | What are its main pieces and what is each one responsible for? | 3–7 named components, one line each. **Diagram** of how they connect. |
| **L3 — One thing flowing through** | What actually happens, step by step, for one concrete case? | Trace a single real example end to end (one request, one message, one call). **Sequence/flow diagram.** |
| **L4 — The specifics** | What does the code / config / API look like? | A small, realistic, runnable example. For workspace code: real snippets with `file:line`. |
| **Watch out** | What do people get wrong? | 2–5 common mistakes or traps, each with the symptom you would see. |
| **Where to go next** | What to read or try to go deeper? | 2–4 concrete pointers: files, docs, a small exercise. |

**Diagram vocabulary:**

```
Boxes and arrows (structure)      Sequence (flow over time)

┌────────┐      ┌────────┐        Client      API        DB
│ Client │ ───► │  API   │          │ request  │          │
└────────┘      └───┬────┘          │ ───────► │  query   │
                    │               │          │ ───────► │
                    ▼               │          │ ◄─────── │
               ┌────────┐           │ ◄─────── │  rows    │
               │   DB   │           │ response │          │
               └────────┘
```

Layers can be shown as stacked boxes; before/after as two diagrams side by side.
