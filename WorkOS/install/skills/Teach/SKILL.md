---
name: Teach
version: 1.1.0
description: Interactive text tutorial on whatever the current conversation is about — teaches the topic beat by beat with ASCII diagrams in the terminal, asking one question per beat and quizzing until the ideas land. USE WHEN teach me, /teach-me, tutorial, teach me this, walk me through this interactively, explain this like a lesson, learn mode, quiz me, help me actually understand what we just did. NOT FOR plain written explanations with no dialogue (just answer directly), authored/published content, or discovery interviews that shape a half-formed idea (use grill-me).
---

# Teach

Turns the current conversation topic into a live, Socratic tutorial in the terminal. Each teaching beat is a short prose explanation plus an ASCII diagram, and ends with one question to the learner. The session is a dialogue: answer, response, next beat, quiz, recap.

## Notification

**When executing a workflow:**

1. **Output text notification**:
   ```
   Running the **Teach** workflow in the **Teach** skill to tutor TOPIC...
   ```

## Workflow Routing

| Workflow | Trigger | File |
|----------|---------|------|
| **Teach** | "teach me", "/teach-me", "tutorial", "quiz me" | `Workflows/Teach.md` |

## Gotchas

- **A beat ends at its question. Stop the turn there.** Answering your own question and continuing turns the tutorial back into a lecture — the failure mode this skill exists to prevent.
- **Keep each beat's prose short (2-3 sentences).** A beat that needs more text than that is too big — split it.

## Examples

**Example 1: Teach the thing we just built**
```
User: "teach me" (after a session debugging DNS records)
→ Invokes Teach workflow
→ Names the topic, gives a short intro, draws a concept map of 3-5 ideas
→ Beat 1: explains how DNS resolution flows, draws the resolver chain in ASCII, asks "which server actually holds the answer?"
→ User answers; skill responds to the answer, corrects or confirms, moves to beat 2
→ Ends with a 2-3 question quiz and a recap diagram
```

**Example 2: Explicit topic override**
```
User: "/teach-me OAuth refresh tokens"
→ Teaches the named topic instead of the conversation default
→ Same beat/question/quiz loop
```

**Example 3: Quiz-only**
```
User: "quiz me on what we just covered"
→ Skips the lesson beats, runs the quiz protocol directly on the session's material
```
