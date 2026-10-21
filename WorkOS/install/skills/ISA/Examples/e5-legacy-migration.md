<!-- Fictitious example. "Keystone" is a teaching project name; the company, systems, currencies' volumes and figures are invented, and any resemblance to a real fintech or migration is coincidental. Working-title only; no production endpoint. -->

---
task: "Keystone — migrate settlement out of the .NET Framework monolith into a .NET 8 service"
slug: 20251103-090000_keystone-settlement-migration
project: Keystone
effort: comprehensive
effort_source: explicit
phase: execute
progress: 16/40
mode: interactive
started: 2025-11-03T09:00:00Z
updated: 2026-03-27T17:30:00Z
---

## Problem

Settlement at a mid-size payments company runs inside a 12-year-old .NET Framework 4.8 monolith: a 400k-line WebForms/WCF solution on two Windows VMs, one SQL Server database shared by every module, and a nightly batch that nobody outside two senior engineers fully understands. Settlement is the module where an error costs real money. A single mismatched ledger entry means a manual reconciliation by the finance team, and a pattern of them means a regulator conversation. Past attempts to touch it have followed the same arc: a rewrite branch opens, scope grows to "while we're in there", the branch drifts from the monolith's weekly changes, and it is abandoned after four months. The goal this time is to move settlement out incrementally, with the old and new paths running side by side, without a single mismatched settlement reaching a customer or the ledger.

## Vision

A .NET 8 `Keystone.Settlement` service owns settlement for every currency the company supports. Finance closes the month, opens the reconciliation report, and finds nothing to chase. The on-call engineer gets paged at 02:10, opens one dashboard, sees exactly which settlement batch is stuck and why, and flips a flag to send that currency back to the old path in under two minutes, without waking anyone else. Six months after cutover, someone asks where the old settlement code went and the honest answer is "deleted, and nobody noticed." That is the euphoric surprise: the migration is so uneventful that finance and on-call forget it ever happened.

## Out of Scope

- **No new settlement features.** Behavior parity only. Every "while we're in there" improvement goes on a post-decommission backlog, including netting-rule changes and new payout rails.
- **No rewrite of other monolith modules.** Onboarding, KYC, card issuing and reporting stay where they are. Keystone extracts settlement and nothing else.
- **No database split of the whole schema.** Only the settlement tables get a new home. Shared reference tables (currencies, merchants) are read through a published contract, not migrated.
- **No big-bang cutover.** There is no single switch date. Each currency moves on its own flag with its own sign-off.
- **No change to external bank file formats.** ISO 20022 and legacy fixed-width outbound files stay byte-identical for the duration of the migration.
- **No platform change.** Same cloud provider, same message broker, same SQL Server edition. No Kubernetes adoption riding along with this project.
- **No rewriting history.** Historic settlement records stay in the legacy database and are archived, not transformed.

## Principles

- Zero mismatches is the contract, not a target. One unexplained diff stops the cutover clock for that currency.
- Strangler over rewrite. The monolith keeps serving until the new path has earned each slice of traffic with evidence.
- Characterize before you change. Captured production behavior is the specification; the old code's intent is a rumor.
- Every cutover must be reversible in minutes, by one person, without a deploy.
- Boring technology wins. The new service uses the stack the team already operates at 3 a.m.
- The people who live with the system sign off, not only the people who build it: finance for correctness, on-call for operability.
- Decommission is part of done. A migration that leaves the old path alive "just in case" has doubled the maintenance surface instead of halving it.

## Constraints

- Six calendar months: 2025-11-03 to 2026-05-01. Decommission of the old code path is calendared for 2026-05-01, not aspirational.
- Hosting: .NET 8 on the existing VM scale set behind the existing load balancer. SQL Server 2019 (same edition as the monolith). RabbitMQ with MassTransit for messaging; EF Core 8 plus Dapper for the hot path.
- Facade: YARP reverse proxy in front of the monolith's settlement endpoints. Routing decisions come from a feature-flag store with per-currency keys.
- Currency cutover order is fixed by risk: CHF, SEK, GBP, EUR, USD (lowest daily volume first).
- No change freeze on the monolith. The weekly release train continues; Keystone must absorb monolith changes through the characterization suite.
- Settlement window: the nightly batch must complete by 04:30 local time; the new path may not push that later.
- Budget: two engineers full time, one half-time QA, finance analyst 4 hours per week, on-call rotation of six. No extra headcount.
- Audit: every settlement decision must be reconstructable for 7 years; the new service writes the same audit fields as the old one.
- Zero changes to the finance team's reconciliation report layout.

## Goal

Move settlement for all five currencies from the .NET Framework 4.8 monolith into the .NET 8 `Keystone.Settlement` service between 2025-11-03 and 2026-05-01 using a strangler-fig pattern, with dual-run comparison proving zero settlement mismatches before each per-currency flag flip, a rollback path rehearsed and timed under two minutes, finance and on-call sign-off recorded per currency, and the legacy settlement code path deleted from the monolith by the decommission date.

## Criteria

### Characterization (Phase 1: Nov–Dec 2025)

- [x] ISC-1: Every settlement entry point in the monolith (WCF operations, scheduled jobs, stored procedures, SQL Agent steps) is inventoried by 2025-11-28, with caller, schedule and owner.
- [x] ISC-2: A golden-master capture of 60 consecutive business days of settlement inputs and outputs (request, ledger rows, outbound bank files) is stored read-only by 2025-12-12.
- [x] ISC-3: Settlement business rules (fee tiers, cut-offs, netting, rounding) are written as executable characterization tests, ≥ 400 cases, all green against the monolith by 2025-12-15.
- [x] ISC-4: Antecedent: the finance lead reads the settlement flow diagram aloud to the team and corrects no more than 2 steps.
- [x] ISC-5: The five currencies' cut-off times and rounding modes are documented in a single table signed off by finance by 2025-12-19.
- [x] ISC-6: A list of 15 or fewer known-weird historical cases (reversals, split settlements, back-dated holidays) is captured, each with a reproducing fixture.

### Build (Phase 2: Dec 2025–Jan 2026)

- [x] ISC-7: `Keystone.Settlement` deploys to staging from CI on every merge to `main`, with `dotnet test` and migrations applied by pipeline, not by hand.
- [x] ISC-8: The service computes settlements for all five currencies and passes the full characterization suite (ISC-3) with zero failures.
- [x] ISC-9: Antecedent: an on-call engineer who did not write the service traces one settlement from inbound message to ledger row using only logs and the dashboard, in under 10 minutes.
- [x] ISC-10: Every ledger write is idempotent: a replayed message produces zero duplicate rows (outbox pattern plus unique key on settlement id and leg).
- [x] ISC-11: Outbound bank files produced by Keystone are byte-identical to the monolith's for the golden-master days.

### Shadow / Dual-Run (Phase 3: Jan–Feb 2026)

- [x] ISC-12: The YARP facade mirrors 100% of live settlement requests to Keystone in shadow mode (response discarded, writes redirected to a shadow schema) by 2026-01-19.
- [x] ISC-13: A comparison job diffs every shadow settlement against the monolith's result field by field and publishes mismatch counts to the `Keystone / Parity` dashboard every 15 minutes.
- [x] ISC-14: Every mismatch seen in shadow is classified (defect, expected rounding, data-timing) and resolved or documented within 2 business days.
- [x] ISC-15: Each currency reaches 20 consecutive business days of zero unexplained mismatches in shadow before its cutover is scheduled.
- [ ] ISC-16: Shadow mode adds ≤ 5% p95 latency to the monolith's settlement endpoints and does not push the nightly batch past 04:30 (probe: batch end times for the last 20 nights).

### Cutover (Phase 4: Mar–Apr 2026)

- [ ] ISC-17: Per-currency feature flags (`settlement.keystone.CHF` through `.USD`) exist in the flag store, default off, with change history and an owner.
- [ ] ISC-18: CHF, SEK and GBP are cut over in that order, each at least 5 business days after the previous, each with a signed go/no-go checklist.
- [ ] ISC-19: After each cutover the parity job keeps running in reverse (monolith as shadow) for 10 business days with zero unexplained mismatches.
- [ ] ISC-20: EUR and USD are cut over by 2026-04-17 after their own 20-day clean shadow windows, with finance present during the first live batch.
- [ ] ISC-21: Antecedent: the operations lead watches a live cutover from the dashboard alone, without asking the engineers anything, and calls the batch healthy before the engineers do.

### Rollback & Stabilization (Phase 5: Apr 2026)

- [ ] ISC-22: A rollback runbook exists and was executed in staging by someone other than its author by 2026-03-20.
- [ ] ISC-23: Flipping a currency's flag off returns settlement to the monolith within 2 minutes, measured end to end (probe: timed drill, flag change to first monolith-settled message).
- [ ] ISC-24: In-flight messages during a rollback are neither lost nor settled twice (probe: replay test with 1,000 messages across a flip, ledger row count equals unique settlement ids).
- [ ] ISC-25: Dashboards and alerts for Keystone (consumer lag, dead-letter depth, parity drift, batch duration) are in place, each alert linked to a runbook section.
- [ ] ISC-26: Antecedent: finance signs off in writing per currency that two month-end closes ran on Keystone with no manual reconciliation entries.

### Decommission (Phase 6: Apr–May 2026)

- [ ] ISC-27: All five currency flags have been on for 30 consecutive days with zero rollbacks before any deletion begins.
- [ ] ISC-28: The legacy settlement assemblies, WCF operations, SQL Agent steps and stored procedures are removed from the monolith in one reviewed change set by 2026-04-28.
- [ ] ISC-29: Legacy settlement tables are archived to read-only storage with a documented restore procedure, then dropped from the live database.
- [ ] ISC-30: The YARP shadow route, parity job and per-currency flags are deleted; routing is unconditional.
- [ ] ISC-31: Monolith build and unit-test time drops, and the removed-lines count and test count are recorded in the release notes.
- [ ] ISC-32: Documentation is updated: architecture diagram, runbook, on-call handbook and the audit-trail description, with the old paths marked removed.

### Anti-criteria

- [x] ISC-33: Anti: scope creep — no settlement behavior change ships in Keystone before decommission; the parity diff would fail it (probe: characterization suite and parity job show no intentional diffs).
- [ ] ISC-34: Anti: silent mismatch — no mismatch counter reset or dashboard filter change is made to reach "zero" (probe: dashboard query and its git history reviewed by finance before each cutover).
- [ ] ISC-35: Anti: flag debt — no flag lives longer than 30 days past its currency's stable period (probe: flag store export sorted by age).
- [ ] ISC-36: Anti: big-bang — no two currencies cut over on the same day (probe: flag change history).
- [ ] ISC-37: Anti: dual-write drift — no code path writes to both legacy and new settlement tables outside the shadow schema (probe: query-store search for writes to `dbo.Settlement*` from the Keystone login).
- [ ] ISC-38: Anti: one-person knowledge — no runbook step requires a named individual (probe: runbook drill performed by two engineers who did not write it).
- [ ] ISC-39: Anti: late rewrite — no refactor of Keystone internals after 2026-03-01 except defect fixes; the cutover evidence is bound to a frozen design.
- [ ] ISC-40: Anti: zombie code — no reference to legacy settlement types remains after decommission (probe: `git grep` for the legacy namespace returns zero hits outside the archive).

## Test Strategy

```yaml
- isc: ISC-1
  type: count
  check: settlement entry points in inventory vs. discovered by static scan
  threshold: inventory covers 100% of scan results
  tool: rg -n "SettlementService|usp_Settle|Settle_" --glob '*.cs' --glob '*.sql' | compare to inventory.csv

- isc: ISC-4
  type: antecedent / experiential
  check: finance lead narrates the flow diagram and corrects no more than 2 steps
  threshold: ≤ 2 corrections, logged in the project notes
  tool: walkthrough session 2025-12-10 with correction tally

- isc: ISC-8
  type: characterization
  check: Keystone passes the full characterization suite
  threshold: 0 failures, ≥ 400 cases
  tool: dotnet test Keystone.Characterization.sln --logger trx

- isc: ISC-9
  type: antecedent / operability
  check: engineer who did not write the service traces one settlement end to end
  threshold: < 10 minutes, only logs and dashboard allowed
  tool: timed session, stopwatch and screen notes in on-call-trace.md

- isc: ISC-11
  type: byte parity
  check: outbound bank files for golden-master days
  threshold: identical SHA-256 per file
  tool: sha256sum golden/*.xml out/*.xml | sort | uniq -c -w64

- isc: ISC-13
  type: parity
  check: unexplained mismatches per currency per day
  threshold: 0
  tool: Keystone / Parity dashboard, panel "unexplained mismatches"; SELECT COUNT(*) FROM parity.Diff WHERE Class IS NULL

- isc: ISC-15
  type: soak
  check: consecutive clean business days per currency
  threshold: ≥ 20
  tool: SELECT Currency, COUNT(*) FROM parity.DailyStatus WHERE Clean = 1 GROUP BY Currency

- isc: ISC-23
  type: rollback timing
  check: seconds from flag flip to first message settled by the monolith
  threshold: ≤ 120
  tool: rollback drill script, timestamps from the flag audit log and ledger

- isc: ISC-26
  type: antecedent / sign-off
  check: finance has closed two months on Keystone with no manual entries
  threshold: signed sign-off note per currency with close dates
  tool: signoff/FINANCE-<currency>.md

- isc: ISC-34
  type: anti-probe / dashboard-integrity
  check: parity panel query and filters unchanged since baseline
  threshold: git diff of dashboard JSON shows no filter or reset changes
  tool: git log -p dashboards/parity.json

- isc: ISC-37
  type: anti-probe / dual-write
  check: writes to legacy settlement tables from the Keystone login
  threshold: 0 outside shadow schema
  tool: SELECT COUNT(*) FROM sys.dm_exec_query_stats qs ... WHERE text LIKE '%dbo.Settlement%' AND login = 'keystone_svc'

- isc: ISC-40
  type: anti-probe / dead-code
  check: references to the legacy settlement namespace
  threshold: 0 outside archive/
  tool: git grep -n "Legacy.Settlement" -- . ':!archive'
```

## Features

```yaml
- name: Inventory
  description: Enumerate every settlement entry point, schedule and owner
  satisfies: [ISC-1, ISC-5]
  depends_on: []
  parallelizable: false

- name: GoldenMaster
  description: Capture 60 days of production inputs/outputs and write characterization tests
  satisfies: [ISC-2, ISC-3, ISC-4, ISC-6]
  depends_on: [Inventory]
  parallelizable: false

- name: SettlementService
  description: .NET 8 service with idempotent ledger writes, CI/CD and traceability
  satisfies: [ISC-7, ISC-8, ISC-9, ISC-10, ISC-11]
  depends_on: [GoldenMaster]
  parallelizable: true

- name: ShadowRun
  description: YARP mirror, shadow schema, field-by-field comparison and Parity dashboard
  satisfies: [ISC-12, ISC-13, ISC-14, ISC-15, ISC-16]
  depends_on: [SettlementService]
  parallelizable: false

- name: FlagInfrastructure
  description: Per-currency flags with history and the reverse parity check
  satisfies: [ISC-17, ISC-19]
  depends_on: [ShadowRun]
  parallelizable: true

- name: CurrencyCutovers
  description: Ordered cutovers CHF, SEK, GBP, EUR, USD with go/no-go checklists
  satisfies: [ISC-18, ISC-20, ISC-21]
  depends_on: [FlagInfrastructure]
  parallelizable: false

- name: RollbackAndOps
  description: Runbook, timed drills, in-flight safety, alerts, finance sign-off
  satisfies: [ISC-22, ISC-23, ISC-24, ISC-25, ISC-26]
  depends_on: [ShadowRun]
  parallelizable: true

- name: Decommission
  description: Remove legacy code, archive and drop tables, delete flags and shadow route
  satisfies: [ISC-27, ISC-28, ISC-29, ISC-30, ISC-31, ISC-32]
  depends_on: [CurrencyCutovers, RollbackAndOps]
  parallelizable: false

- name: Guardrails
  description: Anti-criteria probes run weekly from CI
  satisfies: [ISC-33, ISC-34, ISC-35, ISC-36, ISC-37, ISC-38, ISC-39, ISC-40]
  depends_on: []
  parallelizable: true
```

## Decisions

- 2025-11-03 09:00: Strangler-fig with a YARP facade chosen over a branch-based rewrite or a database-level replication cutover. The facade lets traffic move one currency at a time and keeps the monolith's weekly releases flowing.
- 2025-11-10 14:00: Cutover unit is the currency, not the merchant or the endpoint. Currency maps to cut-off times, bank files and finance reporting, so it is the natural blast-radius boundary.
- 2025-11-24 10:00: Golden-master capture window set to 60 business days to include one quarter-end. Fewer days would miss the month-end netting behavior.
- 2025-12-05 17:00: ❌ DEAD END: Tried a "clean" domain model for settlement before characterization finished. Three weeks produced elegant aggregates that disagreed with the monolith on rounding in 11% of the golden cases. Reverted to a transaction-script port that mirrors the old calculation order and refactors only after parity. Don't retry.
- 2025-12-19 22:00: refined: ISC-3 test count raised from 250 to 400 cases after the weird-case list (ISC-6) turned up reversal and back-dated-holiday paths the first suite never touched.
- 2026-01-14 09:00: Messaging stays on RabbitMQ with MassTransit; moving to the cloud-native bus was considered and rejected as a second migration riding on the first.
- 2026-01-27 19:30: ❌ DEAD END: Tried comparing shadow results only on the final ledger totals per batch to keep the diff job cheap. A $0.01 rounding drift on two legs cancelled out and passed for nine days before the field-level backfill job caught it. Reverted to field-by-field comparison on every settlement leg. Don't retry.
- 2026-02-10 14:00: refined: ISC-15 threshold changed from 10 to 20 consecutive clean business days after the month-end cases showed up only in the second half of a month.
- 2026-02-23 18:00: refined: ISC-16 added — shadow mirroring must not cost the monolith more than 5% p95, after the first week of mirroring pushed the batch end time from 03:50 to 04:22.
- 2026-03-02 11:00: Design freeze for Keystone internals declared (ISC-39); only defect fixes after this date, so the evidence collected in shadow stays bound to the code that will cut over.
- 2026-03-12 16:30: refined: ISC-24 added after the first rollback drill showed 14 messages processed by both paths during a flip; the flip now drains the consumer before the flag changes.

## Changelog

- 2025-12-05 | conjectured: A clean domain model built up front will make the port easier to reason about and to extend later
  refuted by: the golden-master run disagreed with the new aggregates on rounding in 11% of cases, and the disagreements traced to implicit ordering in the old stored procedures
  learned: in a migration the old behavior is the specification, including its accidents; elegance is a post-parity activity
  criterion now: ISC-8 (characterization suite passes) is the only definition of "ported"; Decisions logs the dead end and the transaction-script rule

- 2026-01-27 | conjectured: Comparing batch-level totals is enough to prove parity and keeps the diff job cheap
  refuted by: two opposite $0.01 rounding errors cancelled inside a batch total for nine days; the field-level backfill caught them
  learned: aggregates hide the exact errors a migration produces; only leg-level, field-level equality is evidence
  criterion now: ISC-13 sharpened to field-by-field on every settlement leg; ISC-34 added so the parity number cannot be made to look better by changing the query

- 2026-02-10 | conjectured: Ten clean business days per currency is enough soak before scheduling a cutover
  refuted by: GBP stayed clean for 11 days, then produced three mismatches on the month-end netting run, a code path that only executes on the last two business days
  learned: soak time must cover at least one full business cycle of the thing being migrated; month-end behavior is invisible in a mid-month window
  criterion now: ISC-15 raised to 20 consecutive clean business days, with at least one month-end inside the window

- 2026-02-23 | conjectured: Mirroring live traffic to Keystone is invisible to the monolith
  refuted by: during the first week of 100% mirroring the nightly batch end time moved from 03:50 to 04:22, close to the 04:30 settlement window
  learned: shadow load is real load on the shared SQL Server; observation changes the system being observed
  criterion now: ISC-16 added — p95 latency and batch end time are measured while shadowing; mirroring is throttled to 50% in the batch window

- 2026-03-12 | conjectured: Flipping a flag off is a sufficient rollback
  refuted by: the staging drill left 14 in-flight messages that both consumers processed, producing duplicate ledger rows that idempotency caught only because the unique key was already in place
  learned: rollback is a protocol (drain, flip, verify), not a switch; the dangerous moment is the seconds around the flip
  criterion now: ISC-24 added — a 1,000-message replay across a flip must leave ledger rows equal to unique settlement ids; the runbook gains an explicit drain step

## Verification

- ISC-1: `rg -n "usp_Settle|SettlementService" --glob '*.cs' --glob '*.sql' | wc -l` on 2025-11-28 — 163 hits, all covered by the 41 entries in inventory.csv
- ISC-2: golden/ manifest committed 2025-12-12 — 60 business days, 18,404 settlement requests, 1,921 outbound bank files, SHA-256 per file
- ISC-3: `dotnet test Keystone.Characterization.sln` on 2025-12-15 against the monolith — 437 passed, 0 failed
- ISC-4: walkthrough-notes-2025-12-10.md — finance lead corrected 1 step (the GBP bank holiday cut-off)
- ISC-8: CI run 2026-01-09 — 437/437 characterization cases green on Keystone; 6 ported SQL helpers covered
- ISC-11: `sha256sum` comparison over 60 golden days — 1,921 of 1,921 files identical
- ISC-15: `parity.DailyStatus` query on 2026-02-27 — CHF 23, SEK 22, GBP 21, EUR 20, USD 20 consecutive clean business days, each window including a month-end
