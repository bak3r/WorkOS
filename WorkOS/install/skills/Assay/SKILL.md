---
name: Assay
metadata:
  short-description: "Evaluates prompts, models and outputs with code asserts, Claude judges, pass^k with confidence intervals, A/B tests, and Proof receipts."
version: 1.0.0
evals:
  suites: [core-dispositions]
  deterministic:
    - command: "bun test ./skills/Assay"
      falsifier: "an unavailable judge or model counts as a pass or a fail, a partial trial set claims pass^k, a judge that passes the adversarial fixture leaves the suite passing, a judged no blocks a Proof, or a stale or hand-edited receipt reads as fresh"
  manual:
    reason: "whether a judge's verdicts match the principal's own reading needs the principal's labels"
    falsifier: "the principal disagrees with the judge on a sample of its verdicts"
description: "Assertion-first eval framework: code asserts, Claude judges, pass^k with SEM and 95% CI, paired A/B comparison, and Proof receipts bound to an artifact's bytes. USE WHEN eval, evaluate, benchmark, judge, judge prompt, regression test, assert, llm-rubric, pass@k, pass^k, grade output, compare prompts or models, A/B test, ablation, with/without, proof this, check the output, did it come out as asked. NOT FOR scientific-method framing (Science), property testing (Hardening), live UI verification (Interceptor), non-eval prompts (Prompting)."
---

# Assay

**Contents:** Ideal State · Intent Routing · The ladder · Data & Config · Gotchas · Examples

An eval gives a model an input, then applies **assertions** to its output (Anthropic's definition). A case is `{id, prompt, assert:[...]}`. Each assertion is code (`Tools/Assertions.ts`, free) or a Claude judge (`Tools/Judge.ts`). Cases run several trials and report **pass^k** (every trial passed: the reliability metric and the regression gate) beside **pass@k** (any trial passed), with SEM and a 95% CI (`Tools/Stats.ts`). **Proof** applies the same tiers to one run's output before the principal sees it, and writes a receipt bound to its bytes.

This is Assay-lite: a slim rebuild of upstream LifeOS 8.761.0 Assay for WorkOS, which absorbed the old Evals skill. Upstream also runs a judgment-layer question engine, judges from other vendors, image and video lanes, a label store for earned calibration, and send and hand-off gates. None is ported: WorkOS runs Claude only, through `WORKOS/TOOLS/Inference.ts`, and has no send tools to gate.

Sources: [Demystifying evals for AI agents](https://www.anthropic.com/engineering/demystifying-evals-for-ai-agents), [A Statistical Approach to Model Evaluations](https://www.anthropic.com/research/statistical-approach-to-model-evals), [develop tests](https://platform.claude.com/docs/en/docs/build-with-claude/develop-tests).

## Ideal State

- Every check sits at the lowest tier that can honestly answer it (code, then judge, then the principal), and every countable part of a property is a code assert before any judge reads it.
- Every score ships with pass^k, SEM and a 95% CI from the trials that completed, with requested and completed trial counts beside it; fewer completed trials than requested never claims pass^k.
- A model or judge that gave no verdict is reported as unavailable evidence (no verdict, exit 2), never as a pass or a quality failure.
- Every judged suite carries an adversarial fixture its judge must fail; a judge that passes it fails the suite.
- A produced artifact is checked by Proof against what was asked before the principal sees it, the receipt is bound to its sha256, and every judged flag is stated when it is presented.
- WorkOS judges are uncalibrated: their verdicts are reported as such, and a judged "no" flags rather than blocks.

## Intent Routing

| Intent | Trigger | File |
|--------|---------|------|
| **Proof** | "proof this", "check the output", "did it come out as asked", before showing any produced artifact | `Intents/Proof.md` |
| **RunEval** | "run the eval", "run suite", "evaluate this" | `Intents/RunEval.md` |
| **CreateSuite** | "new eval", "create a suite", "eval for X", "eval for this skill" | `Intents/CreateSuite.md` |
| **CreateJudge** | "write a judge", "llm-rubric", "grading criteria" | `Intents/CreateJudge.md` |
| **Compare** | "compare prompts", "compare models", "A/B this", "with/without", "ablation" | `Intents/Compare.md` |
| **ViewResults** | "eval results", "how did it score", "saturation" | `Intents/ViewResults.md` |

| File | Read when |
|------|-----------|
| `Setup.md` | first-time setup: nothing to fill in, and an offline proof that the tools work |
| `Suites/` | the skill's eval suites; eval data, never edited as prose |
| `Tools/` | `EvalRunner.ts`, `Judge.ts`, `Proof.ts`, `IntentRubric.ts`, `Compare.ts`, `SuiteManager.ts`, `FailureToCase.ts`, `Assertions.ts`, `Stats.ts`; each prints its usage with `--help` or no arguments |

## The ladder

| Tier | Verifier | Speed | Where |
|------|----------|-------|-------|
| code | a tool that says no: an `Assertions.ts` type, `bun test`, a probe | free, instant | every suite and Proof; the only tier on a blocking path |
| judge | a Claude model reading the output: `llm-assert` (one literal claim per line) or `llm-rubric` (an anchored ladder) | seconds | suite asserts, Proof's intent and ask checks |
| human | the principal recognizing it | on encounter | `manual` evals in a skill's frontmatter |

A check moves down the ladder as it earns trust: a judged property that turns out to be checkable becomes a code assert. `judged_residue` in every run reports the share of a suite still judged; it should fall over time.

## Data & Config

Suites resolve USER-first: `WORKOS/USER/CUSTOMIZATIONS/SKILLS/Assay/Suites/` (or the legacy `Evals/` directory while only that one exists), then this skill's `Suites/`. Results land in `WORKOS/MEMORY/STATE/Evals-Results/<suite>/` (the name predates the rename and is kept so old runs stay in one series). Proof receipts land in `WORKOS/MEMORY/STATE/Proof/receipts/`. The config-change suite that `WORKOS/TOOLS/ConfigEvalOnChange.ts` runs is set in that USER directory's `config.json` (`{"config_change_suite": "..."}`).

## Gotchas

- **The model under test runs single-shot with no tools**, with the live system prompt and DA identity. A property that needs a tool call or a file written cannot pass in a suite; check the artifact with Proof instead.
- **A bare JSON verdict with nested objects used to be read from its innermost brace** and dropped as unparseable (found 2026-10-28 while building this port; the old Evals judge had the same code). `Judge.extractJson` now walks back to the widest span that parses.
- **Assertions.ts compiles `regex` values with no flags**, so `\p{L}` and other Unicode classes are read literally. Word counts use whitespace tokens (`IntentRubric.maxWordsRegex`).

## Examples

**Example 1: Proof a draft before showing it**
```
User: "write the MR description, and proof it first"
→ Proof: run --artifact desc.md --intent skills/MergeRequestDescription/SKILL.md --ask "<the ask>"
→ PASS, or ADMITTED-FLAGGED with each 🚩 stated when the draft is shown
```

**Example 2: Did the config change break anything?**
```
User: "run the core dispositions eval"
→ RunEval: EvalRunner -s core-dispositions
→ pass^k with SEM and CI, the transcripts of the worst case read before the score is reported
```

**Example 3: Is the shorter prompt as good?**
```
User: "compare the old and new system prompt"
→ Compare: both arms on the same suite, paired 95% CI, TIE with a power hint when the CI includes 0
```
