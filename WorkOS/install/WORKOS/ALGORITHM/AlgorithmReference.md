# Algorithm reference

The resident Algorithm remains the run contract. These sections hold detail relocated out of it. Read the applicable section when its resident trigger fires; uncertain relevance requires reading that section. Skill, dispatch, spend, telemetry and close contracts remain resident.

## Loop background

Every capability in the system — context gathering, thinking skills, research, agents, audits, the nudge layer, the principal's corrections — exists to enhance the ISA: sharpen its criteria, surface its unknowns, fold in what the work teaches, until it is the hard-to-vary shape of what done actually means. Enhancement never stops: during the build (nudges), at the close (gates), and after completion (a reopened ISA continues the same climb in a later run; ~27% of runs iterate).

For anything with persistent identity — a service, a library, this system — the ISA outlives every run. Between runs it is the thing's current state: the criteria it satisfies, with evidence. A project's ISA lives in the repo as `ISA.md`, or, for a repo that is not yours to put files in (an employer repo), at `WORKOS/MEMORY/WORK/{slug}/ISA.md` with a `repo:` link, and re-running its Test Strategy rows (`bun test ./<path>` for code rows, `bun skills/Assay/Tools/EvalRunner.ts` for suite rows, the repo's own test command for employer code) re-checks its state on demand. "Add a feature" means "add criteria that don't hold yet."

Dynamic range is how spend serves the target: easy things finish in seconds on almost nothing; hard things earn agents, audits, stronger models, and days. Both overspending and underspending miss euphoric surprise — right output at the wrong cost is not the target. The criteria keep it honest: you cannot close what you did not verify, so difficulty pulls the right resources in on its own.

A run is the loop applied once. The resident file states what must be true when it is done. How to get there is my job.

## Events ask the rest

The live layer — nudges fired at the moment they're answerable, not standing prose. One runner, `hooks/AlgorithmNudge.hook.ts`, two scopes: *always-on* rows fire in any session; the rest only inside a live Algorithm run. The bound below is load-bearing and was violated by this file's own table until 2026-07-30: a `principal messages mid-run` row asked about a message sitting in the model's context, survived every review because it was dead, and is now cut. Deterministic, zero inference. Rows are bounded by construction: a row may only ask a question about an outcome already stated in the resident file, and only about **state the model cannot observe from its own context** — an unwritten or stale ISA, a destructive op's blast radius, a capability the manifest knows is broken. A row that maps surface phrases to mandated procedure, whose pass condition is "a tool was invoked," or that merely asks the model to notice something already in front of it, is banned. One named exception: entry rows — a depth directive or design-class work in a turn with no run — key on the prompt itself, because their job is making the run exist; an entry misjudgment leaves no run for any in-run check to bind.

Rows marked *(prose)* are not yet carried by `hooks/AlgorithmNudge.hook.ts`: the question stands here, and I ask it myself when the state it names holds.

| When | Ask |
|---|---|
| Deep into a session, no ISA registered *(always-on)* | Still trivial, or does done need writing down? |
| A criterion is about a behavioral/quality/regression property one direct probe can't close | Multi-sample class? Then its assert row is an `eval` row (a suite run through `skills/Assay/Tools/EvalRunner.ts`) — the row is required, only its depth (cadence, k) is a spend call. A choice between candidates (which draft, which design) is a `pairwise` row (schema only in WorkOS: Assay-lite has no tournament runner, so judge each candidate on one anchored `llm-rubric` and compare them with `Compare.ts`). Otherwise a direct-probe row closes it. |
| Long stretch with no ISA edits | Is the ISA still the true shape of done? |
| An ISA carrying `## Features` is edited with no `absence_review:` frontmatter key and phase ≠ complete *(always-on, prose)* | Run the absence pass (ISA Scaffold § Absence pass): one non-forked fresh reviewer briefed from the ladder, Problem, Vision, Constraints, and Out of Scope only — never the criteria — names at most seven failures the work must survive; disposition each as an `absence` manifest row, or log the skip as a Decisions row and set `absence_review: skipped — <reason>`. |
| A destructive infra op ran (delete service/domain/zone/record/bucket/route) *(always-on)* | What did that resource own per the provider's authority API? Re-list from the authority post-op — a warm-cache probe is not the authority — and prove the flow it served still runs at baseline (criterion 16). |
| An ISA edit landed on a project ISA with no L1 in its ladder (and no legacy `## Articulation` section) *(always-on, prose)* | This project's describe-it-in-text ideal state was never extracted (ISAFormat v2.28.0). `IsaAlign.ts status` reports it as owing a Discuss round in `discover` mode: run it before building further, drafting from the ISA's own text first (`IsaLadder.ts migrate <isa> --full`) so the round confirms rather than starts cold, or take the principal's `proceed` and log it (criterion 6). |
| An ISA edit landed on an ISA whose `IsaAlign.ts status` carries an `align` or `deepen` reason *(always-on, prose)* | The ISA's own state says direction is uncertain (a corrected restate never re-aligned, asks clustering, thick fog, no ladder). Run `Skill("ISA","discuss <isa>")` at the mode and depth the line names before building the uncertain part, or take the principal's `proceed` and log it as a dated `discuss skipped` Decisions row (criterion 6). |

## Source provenance

Ported from upstream LifeOS Algorithm 8.45.0 into WorkOS Algorithm 8.45.0 (see `changelog.md`); the current Algorithm version is in `LATEST`. The sixteen completion criteria and everyday execution contracts remain in the resident file.

## Telemetry & records

Read before working an ISA with other sessions, fanning criteria out, or changing run-state telemetry.

- **Run states.** `phase:` is a lifecycle bracket, never a station walk. `deriveAscent()` in `WORKOS/TOOLS/ascent.ts` is the one table that names and colours every run state across the Kitty tab, the status line and the ISA HTML mirror; ISASync mirrors every ISA write to `work.json`. Model: `WORKOS/DOCUMENTATION/Algorithm/AscentStates.md`. On every ISA write whose derived state changed, `hooks/ISASync.hook.ts` injects a `<workos-ascent-delta>` block, and the model echoes it verbatim once per transition.
- **The frontier.** Criteria may carry ordering edges, a trailing `(after: ID, ID)` (ISAFormat v2.21.0). `bun WORKOS/TOOLS/IsaFrontier.ts frontier|claim|release|status|validate <isa>` computes the takeable set (open, blockers resolved, unlocked) and gives concurrent sessions atomic per-criterion locks (`MEMORY/STATE/isa-locks/`, 2h stale TTL). This is optional tooling for concurrent sessions: a session working an ISA another session may also be working can take its unit before building and release it at close; a solo run never needs the protocol, and no run requires it. Edges are optional: encode real ordering only, and no gate may require them. IsaFrontier never writes the ISA.
- **Fan-out.** When agents or a Workflow written for the task carry a build, the shape is my call; nothing requires a fixed lane structure, waves, or a plan-approval wait. Lane agents never write the ISA, push or deploy; the main session is the ISA's only writer, by hand or through `IsaFold.ts`, and ticks a criterion only from evidence it has seen. The principal's only optional input is width ("go wide", "keep it serial").
- **Second looks.** In-family only, labeled a same-vendor second look: `Agent(subagent_type:"Max")`, the read-only scrutiny agent (Fable where the provider offers it; the installer pins it to Opus where it does not), or any non-forked dispatch with `model: "opus"`, briefed with the ISA and the stated goal restated verbatim. A fork inherits the build context and defends its own code, and a review that lost its context returns a confident, hollow verdict, so the brief restates the goal and criteria.
- **Records.** Registry: `MEMORY/STATE/work.json`. Reflections land in `WORKOS/MEMORY/LEARNING/REFLECTIONS/algorithm-reflections.jsonl`; `Reflect.ts` derives the operational fields, never self-scored.

## Routing

**These are BLE rules: routing preferences, followed by their intent, with freedom in how.** Each rule says what routing should achieve and what usually gets it; none prescribes steps. I follow every one on every dispatch, inside an Algorithm run or not, and when the work shows a better way to the same intent I take it and say why in one sentence. The hard floors bind as written: rule 12 (the effort range), rule 14 (the blast-radius floor) and rule 22 (the stakes floor for claims about real people or companies). The principal's own rung doctrine in OPERATIONAL_RULES § Model selection outranks these rules where the two differ.

**The written route makes the preferences checkable.** A run with features may write one `Lane: <rung> · <effort>` or `Lane: inline` line per feature before building (ISAFormat § Feature blocks), and each dispatch's description names its feature (`build:F3 api`). At close I read what ran against what was written; nothing here waits on a model or refuses work.

This section is the single system home for routing: who runs what, at what effort and how wide. WorkOS runs Claude only, on Amazon Bedrock: no other vendor, lane or side lane exists here. Each numbered rule is 16 words or fewer. Model IDs behind each rung live in `WORKOS/TOOLS/models.ts`.

**The ladder**

1. First goal: highest-quality results that cause euphoric surprise; time to a usable result is quality.
2. Second: on a close call, take the smarter model and higher effort; spend comes last.
3. These are BLE preferences: follow each one's intent; the named hard floors bind as written.
4. Opus: strongest at open judgment, design and max work at xhigh. The default and the advisor.
5. Sonnet: execution: building, fixing, documents and polish once the approach is set.
6. Fable, where the provider offers it: the top model, costliest. Hardest judgment only, one leg.
7. No Fable on the provider: the max rung is Opus at xhigh (`EFFORT_MODEL` in models.ts).
8. Haiku: cheapest; near-mechanical work a script could almost do.

**Handoff**

9. Inline: stay in session when the work needs this conversation's context or is quick.
10. Handoffs work best for a separable leg a brief can fully describe.

**Effort**

11. Effort usually follows how hard the thinking is and what a quiet mistake costs, not size.
12. Never low, never max: medium, high or xhigh. High suits most work.

**Guardrails**

13. The rung usually follows how much deciding is left more than job size.
14. Deploys, secrets, auth, migrations, irreplaceable data need a careful model: Sonnet minimum.
15. Depth words: the hard part gets Opus xhigh (an agent if needed) and thinking skills.
16. Publish-bound, security and core-surface work gets an independent Opus-rung look, or a logged reason.
17. Routine checker: Sonnet at medium, one per run; exhaustive or security checks go to Opus.
18. A brief sent below Opus names acceptance and paths, or goes up a rung.
19. Scheduled jobs run on the cheapest rung that does the job: Haiku or Sonnet.
20. Evals test the model the DA runs on; no judge grades its own output.

**Width**

21. Width follows separable parts: one or two inline, three or more a Workflow tier.
22. Claims about real people or companies run at tier five with adversarial verification.

**Subagents**

23. Same-model subagents only for parallel width, fresh-eyes review, or context the session can't hold.
24. Teach the how with a skill and act with a tool before adding an agent.

**Width tiers**

Rules 21 and 22 size how wide a run goes by counting its separable parts: pieces of the run that do not wait on each other and can each be checked on their own (a Feature in a build, one researcher's source family, one critic's lens).

| Tier | Separable parts in this run | Shape |
|---|---|---|
| 1 | one | Inline, no Workflow; the part's check runs |
| 2 | two, or a few small ones in one place | Inline, no Workflow; each part's check reruns |
| 3 | three or four | A Workflow, one lane per part, each lane's check rerun by the script, one merged pass |
| 4 | five or more, independent | Parallel lanes with per-lane deadlines and retries, each lane's check rerun by the script |
| 5 | a large slice, or claims about real people or companies | Many lanes with deadlines, multi-lens adversarial verification, a completeness critic, resumable |

- The tier comes from the work asked for, never from the size of what it touches, and is named in one line before the work starts.
- Stakes raise the floor: output asserting facts about a real person or company is tier 5 however few its parts; deploys, secrets and auth keep rule 14.
- A skill run the principal asked for may run as a Workflow at tier 3 or above; no scheduled or self-initiated loop does.
- Speed is part of quality: a fast single-synthesis job stays inline even when it touches many files, and code that already fans out stays code.
