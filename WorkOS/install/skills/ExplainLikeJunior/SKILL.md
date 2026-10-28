---
name: ExplainLikeJunior
version: 1.1.0
description: Written explanation of a concept, codebase, system or piece of code the way a patient senior would explain it to a junior developer — zooms from the widest overview down to the specific details, with ASCII diagrams and concrete runnable examples at each level. USE WHEN explain like I'm a junior, explain to a junior dev, explain from the top down, big picture first, zoom in on, how does X work, walk me through this codebase, onboard me to, ELI-junior. NOT FOR interactive voice tutorials with quizzes (use Explain).
metadata:
  short-description: "Explains a concept, codebase or code top-down for a junior developer, with ASCII diagrams and runnable examples at each level."
evals:
  manual:
    reason: "whether a junior could follow the explanation needs a reader at that level"
    falsifier: "a level uses an unglossed term, contradicts a later level, or names a file, class or flow the code does not have"
---

# ExplainLikeJunior

Explains anything — a concept, a library, a system, a file, a function — top-down. The reader first learns *why the thing exists and where it sits*, then *what its parts are*, then *how one real request flows through it*, and only then *the specific code-level details*. Each level is something the reader could stop at and still have a correct (if coarse) mental model.

## Ideal State

- A reader who stops after any level has a correct, if coarse, model, and every new term was glossed in plain words on first use.
- For workspace code, every specific (file, class, flow) was read in the code, cited with `file:line` at the deepest level, and nothing was invented.

## Intent Routing

| Intent | Trigger | File |
|--------|---------|------|
| **Explain** | any explain / walk-me-through / zoom-in request | `Intents/Explain.md` |

## Data & Config

Optional `PREFERENCES.md` at `<configRoot>/WORKOS/USER/CUSTOMIZATIONS/SKILLS/ExplainLikeJunior/` (`configRoot` is `$CLAUDE_CONFIG_DIR`, else `~/.claude`): preferred example language, phrasing level, depth defaults.

## Examples

**Example 1: A concept**
```
User: "Explain dependency injection like I'm a junior"
→ Explain intent
→ L0 one-sentence purpose → L1 the problem it solves (diagram: tightly coupled vs injected)
→ L2 the parts (container, registration, lifetimes) → L3 one request resolving a service
→ L4 code: registration + constructor injection, lifetime gotchas → where to go next
```

**Example 2: The codebase in front of us**
```
User: "Walk me through how this service handles an incoming payment, top down"
→ Explain intent reads the actual code first
→ Overview diagram of the real components, then one payment traced end to end
→ Specifics cite real file:line locations, not invented ones
```

**Example 3: Zoom in on one level**
```
User: "Go deeper on level 3"
→ Re-enters the ladder at that level and expands only that part
```
## Gotchas

- **Overlaps with the Explain skill.** Explain's Teach intent is an interactive, quiz-driven tutorial (text-only in WorkOS). This skill is a single written explanation the reader can scroll back through. If the user asks to be quizzed or taught interactively, route to Explain.
- **Mermaid does not render in the terminal.** Diagrams go in ASCII/box-drawing inside a fenced code block. Mermaid only when the output is an HTML artifact or a doc that renders it.
- **Box-drawing diagrams break when lines have uneven width.** Keep each diagram narrow (≤ 70 columns) and check alignment before sending; a misaligned box reads as noise.
- **When the topic is code in the current workspace, read it before explaining.** An explanation of "how our X works" built from general knowledge is confidently wrong about the specifics. Cite `file:line` at the deepest level.
- **Jargon creep.** Senior explanations quietly use terms they never defined. Every new term gets a short plain-language gloss on first use.
