---
name: Errata
version: 1.0.0
description: "Front door to Errata, the WorkOS complaint ledger: file a complaint, bug, correction, feature request or praise about WorkOS or a skill as one verbatim line with context, list recent entries, and enrich them with a model. USE WHEN /er, errata, file feedback, log a complaint, this is broken and I want it recorded, that answer was wrong log it, feature request for WorkOS, review errata, what have I complained about, enrich errata. NOT FOR ratings (a bare number is already captured), standing rules (say from now on), or the Upgrades queue."
metadata:
  short-description: "File complaints, bugs and praise about WorkOS or a skill into the Errata ledger verbatim, list them back, and enrich them with a model."
evals:
  deterministic:
    - command: "bun test ./WORKOS/ERRATA"
      falsifier: "a recorded line is not the principal's words verbatim, a rating is invented, praise counts toward a complaint rate, a complaint against a file with a presentable Proof receipt is not marked a false pass, a malformed enrichment is written, or the kill switch lets enrichment run"
  manual:
    reason: "whether a filed complaint carried enough context to investigate a month later is judged when it is read back"
    falsifier: "a Review of an entry filed through /er cannot say what was asked or what the system was doing"
---

# Errata

The complaint ledger. Errata keeps one JSON line per moment the principal was unhappy with WorkOS or one of its skills (or pleased with it), in their own words at capture, enriched later by a model, never rewritten in place: corrections and enrichments are appended patches that fold onto the entry when it is read. The ledger lives in `WORKOS/USER/ERRATA/errata-YYYY-MM.jsonl` and the engine in `WORKOS/ERRATA/` (`Errata.ts` is the CLI). Its readers are HillClimb (the survey's pain signal and the before-and-after `verify`), Development's Checkup, and SuggestSkills.

Errata-lite, ported from upstream LifeOS 8.761.0's ledger (Schema.ts and Store.ts unchanged in shape, so a ledger can move between the two). Not ported: capture from the conversation by a hook, trained triage into Upgrades records, mining past sessions, and sending feedback upstream. Entries are filed only through `/er`. Because WorkOS has no output ledger, a skill's complaint rate is complaints per Skill-tool call (`WORKOS/MEMORY/SKILLS/execution.jsonl`), and a complaint is tied to a skill only when `--skill` names it.

## Ideal State

- Every complaint, bug, correction, feature request or praise the principal files becomes exactly one ledger line holding their own words and enough context to investigate it a month later.
- Nothing in the ledger is invented at capture: no paraphrase, no estimated rating, no summary or tag the principal did not give or the code did not derive.
- A complaint about a skill's output names that skill, so its complaint rate moves, and a complaint about a file Proof had passed is marked a false pass, so the check that missed it becomes a hill.
- Review and Enrich read the same live ledger HillClimb and Checkup read, so what the principal reads back is what the climbs climb on.

## Intent Routing

| Intent | Trigger | File |
|--------|---------|------|
| **Record** | `/er <text>`, "file this", "log a complaint", "bug:", "feature:", "praise:" | `Intents/Record.md` |
| **Review** | `/er review`, "what have I complained about", "recent errata" | `Intents/Review.md` |
| **Enrich** | `/er enrich`, `/er triage`, "enrich the errata" | `Intents/Enrich.md` |

## Gotchas

- **A complaint with no `--skill` moves no skill's rate.** HillClimb's survey and `verify` read rates per skill, so an unattributed complaint is visible in Review but invisible to the climbs. Name the skill whenever the complaint is about one skill's output.
- **The ledger is under `WORKOS/USER/`, the principal's own tree.** It holds their words and is never part of the WorkOS payload or a public repo.

## Examples

**Example 1: A wrong MR description**
```
User: "/er the MR description invented a ticket number"
→ Record: one line, kind complaint, tagged skill:MergeRequestDescription, the ask and the draft's path as context
→ "recorded ERR-20261028-142233-a1b2 (complaint, MergeRequestDescription)"
```

**Example 2: What have I complained about this week?**
```
User: "/er review this week"
→ Review: the last entries since 7 days ago, id, date, kind, status, skill and the first words
```
