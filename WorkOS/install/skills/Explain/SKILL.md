---
name: Explain
evals:
  manual:
    reason: "the skill succeeds only when the principal can explain or apply what was taught, and that shows in their own answers"
    falsifier: "after a lesson, an explanation or a quiz, the principal cannot answer an application question on the material, or a quiz verdict disagrees with the live source"
metadata:
  short-description: "Keeps the principal current on the fundamentals of their projects, work and infrastructure: text lessons, deep explanations and quizzes."
version: 2.0.2
description: Keeps the principal current on the fundamentals of what is going on in their projects, work and technical infrastructure: interactive text lessons on the conversation topic, deep explanations of an area's fundamentals read fresh from live sources, and quizzes that remember what the principal missed. USE WHEN teach me, /tm, /teach-me, tutorial, teach me this, walk me through this interactively, learn mode, quiz me, help me actually understand what we just did, explain fundamentals, /ef, what are the fundamentals of, how does this project actually work, catch me up on, refresh me on, quiz fundamentals, /qf, quiz me on the fundamentals, test what I know about, am I still current on. NOT FOR plain written explanations with no dialogue (just answer directly), authored or published content, discovery interviews on a half-formed idea (/discuss).
---

# Explain

Keeps the principal up on the fundamentals of what is going on across their projects, work and technical infrastructure, deeply and thoroughly. The principal lives inside many systems at once and cannot hold all of them in mind, so this skill teaches the topic in front of them, explains the parts of any area that it cannot lose, and quizzes the principal so gaps show up before they cost anything. It absorbed the Teach skill when it was ported from upstream 8.761.0; WorkOS runs it text-only, with no voice narration.

## Ideal State

- The principal leaves each session able to explain or apply the material, shown by the principal's own answers, not by how much was printed.
- What they are told about a project, area or piece of infra is true of it today: read this session from the live source, never recalled.
- Over time the skill knows where their understanding is thin, because every quiz answer is on the learning record (`WORKOS/TOOLS/LearningLog.ts`), and each new quiz goes after the misses and whatever changed since they were last tested.

## Intent Routing

| Intent | Trigger | File |
|--------|---------|------|
| **Teach** | "teach me", "/tm", "/teach-me", "tutorial", "quiz me" on what we just covered | `Intents/Teach.md` |
| **ExplainFundamentals** | "/ef", "explain the fundamentals of", "catch me up on", "how does X actually work" | `Intents/ExplainFundamentals.md` |
| **QuizFundamentals** | "/qf", "quiz me on the fundamentals of", "test what I know about", "am I still current on" | `Intents/QuizFundamentals.md` |

Teach works on the conversation topic as a text dialogue. ExplainFundamentals and QuizFundamentals work on a standing area (a project, a work stream, a system) whether or not we touched it this session, and share one set of fundamentals per area so the quiz tests what the explanation taught.

## Gotchas

- **"Quiz me" means two things.** Right after a lesson or a piece of work, it is Teach's quiz protocol on that material. Naming an area ("quiz me on the billing service", "/qf the build pipeline") is QuizFundamentals, which reads the live source and the record of past answers.
- **The learning record lives in the user tree.** `WORKOS/USER/LEARNING/learning.jsonl` is created on the first write and is never shipped in the payload.

## Examples

**Example 1: Teach the thing we just built**
```
User: "teach me" (after a session debugging DNS records)
→ Teach intent
→ Short intro, a concept map of 3-5 ideas, one beat and one question per turn
→ Ends with a 2-3 question quiz and a recap diagram
```

**Example 2: Explain an area's fundamentals**
```
User: "/ef billing service"
→ ExplainFundamentals intent
→ Reads its PROJECTS.md row, the project ISA and its code layout this session
→ The fundamentals by the "without X it can no longer ___" test, each with what it connects to, one flow diagram, what changed lately
```

**Example 3: Quiz on fundamentals**
```
User: "/qf build pipeline"
→ QuizFundamentals intent
→ Reads the live sources and the learning record, asks 5 application questions one per turn, weighted to past misses
→ Each answer gets a verdict against the source and is appended to the learning record
```
