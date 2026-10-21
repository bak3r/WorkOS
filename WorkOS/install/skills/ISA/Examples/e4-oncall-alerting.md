<!-- Fictitious example. "Lantern" is a teaching project name and "Halyard Pay" a made-up company; any resemblance to real products or organizations is coincidental. The example.com domain is RFC 2606 reserved. -->
---
task: "Build the Lantern on-call alerting and runbook system from a noisy rule pile to first 5 runbooks"
slug: 20260302-091500_lantern-oncall-alerting-redesign
project: Lantern
effort: deep
effort_source: explicit
phase: execute
progress: 17/56
mode: interactive
started: 2026-03-02T09:15:00Z
updated: 2026-05-14T14:10:00Z
---

## Problem

Halyard Pay runs a payments platform with a team of fourteen engineers and a single on-call rotation. Three weeks ago the nightly settlement queue stalled for 94 minutes. Nothing paged. A dashboard showed it, a Slack channel muted months ago showed it, and a merchant support ticket finally woke someone up at 04:40. The alerting stack is not short of alerts: there are 41 rules, 29 of them fire weekly, and engineers have learned to ignore the pager unless the title says "SEV1." Titles read `HighCPU`, `QueueDepthWarn`, `svc_err_rate_2`. Half the alerts link to a wiki page that was last edited in 2023, and the rest link to nothing.

The monitoring is not the failure. The failure is the last meter: a tired engineer, woken at 3am, with a phone in one hand, has to work out what the alert means, which service it is about, where the instructions are, and what is safe to do. Right now that takes a median of 22 minutes in the incident log, and in the settlement stall the first responder spent 40 minutes just finding the right dashboard. Every alert is a small puzzle written by the person who built the service and read by someone who did not.

## Vision

A newly hired engineer on their second on-call shift gets paged at 03:12. The lock screen says `[SEV1] settlement-worker: nightly batch not progressing for 10m`. They tap the link, land on a runbook whose first block says what is safe to do right now, and they do it. Four minutes after the page, the batch is moving again and they are writing an ack note, still half asleep. Nobody had to wake the person who built the service. Euphoric surprise: in the retrospective an engineer says "I didn't have to think. I just followed it," and the engineer who wrote the old wiki page says "I don't miss it."

## Out of Scope

- Replacing the metrics stack. Prometheus, Alertmanager and Grafana stay. Lantern changes rules, routing, dashboards and docs, not the platform.
- Replacing the paging vendor. The existing pager service and its phone app stay; Lantern configures it, does not swap it.
- Auto-remediation. Runbooks tell a human the first safe action; no alert triggers a script on its own in v1.
- Log-based and tracing-based alerting. Metrics alerts only for v1.
- Runbooks beyond the first five. The other 20-odd services get the template and a backlog, not finished runbooks.
- Customer-facing status page changes. Internal on-call experience only.
- Rewriting the SLOs. Lantern consumes the SLOs the payments team already agreed; it does not renegotiate targets.

## Principles

- **An alert is a message to a stranger.** It is written by someone who knows the system and read by someone who may not. If the reader needs the author, the alert is unfinished.
- **Every page must be actionable.** If the best response to a page is to go back to sleep, it is not a page. It is a ticket or a dashboard.
- **First safe action before diagnosis.** The runbook leads with something reversible a half-awake engineer can do, and only then explains why.
- **Constraint produces clarity.** Three severity levels and one naming scheme beat a taxonomy of seven levels. We start small and earn additions.
- **Every artifact must survive the smallest screen.** A phone lock screen cuts the title at about 80 characters. If the symptom is not in the first 80, it is not in the alert.
- **The runbook is a probe target, not a document.** The test of a runbook is a stranger following it under time pressure, not a reviewer nodding at it.
- **Borrow the language of the incidents.** Names and wording come from how responders described past incidents in the log, not from how the metric was named in code.

## Constraints

- One naming scheme for all alerts: `[SEV<n>] <service>: <symptom>`. No other title formats.
- Exactly three severity levels: SEV1 pages immediately 24/7, SEV2 pages in business hours and queues overnight, SEV3 creates a ticket and never pages.
- Every paging alert has a `runbook_url` annotation that returns HTTP 200 and a `dashboard_url` annotation that loads a dashboard built for that alert.
- Runbooks live in the repo at `runbooks/` as Markdown, reviewed like code, and render at `lantern.example.com/runbooks`.
- Alert rules, Alertmanager config and dashboards ship from the repo at `github.example.com/halyard/lantern`; nothing is edited by hand in a UI.
- Every rule file must pass `promtool check rules`, and each of the first five alerts must have a `promtool test rules` unit test.
- Page body fits five lines: customer impact, since when, dashboard link, runbook link, ack link.
- Escalation windows are fixed: primary 5 minutes to acknowledge, secondary 10, engineering manager 15.
- No paid add-ons to the stack for v1. Open-source tooling and the existing pager contract only.
- All old alerts keep running in parallel for 14 days after the new set goes live; none is deleted before the parallel run ends.

## Goal

Deliver Lantern v1 for Halyard Pay: one alert naming scheme, three severity levels, a runbook template, one dashboard per paging alert, an escalation policy as code, and the first five runbooks (payment authorization failures, settlement batch late, ledger write latency, webhook delivery backlog, card processor timeouts) — all designed so that an engineer who did not build the system, paged at 3am, can understand the alert, open the right runbook and take the first safe action within 5 minutes. Packaged as a public-to-the-company repo and a rendered runbook site, and ready to replace the old rotation on the confirmed rollout date of June 2, 2026.

## Criteria

- [x] ISC-1: Alert naming scheme documented at `docs/alerting/naming.md` with the single title format `[SEV<n>] <service>: <symptom>` and 6 worked renamings of existing alerts.
- [x] ISC-2: Severity levels defined as exactly three (SEV1, SEV2, SEV3) in `docs/alerting/severity.md`, each with one-line definition, who is paged, and one real example.
- [x] ISC-3: Antecedent: alert title names the symptom and the service (probe: `bun scripts/alert-lint.ts alerts/` exits 0; every `summary` matches `^\[SEV[123]\] [a-z-]+: .+` and the symptom is not a bare metric name).
- [x] ISC-4: Antecedent: every paging alert carries a `runbook_url` annotation that resolves to HTTP 200 (probe: `bun scripts/link-check.ts alerts/` exits 0).
- [x] ISC-5: All rule files validate (probe: `promtool check rules alerts/*.rules.yaml` exits 0).
- [ ] ISC-6: Every alert has a `for:` duration with a one-line rationale in a comment above it.
- [x] ISC-7: Runbook template exists at `runbooks/_template.md` with exactly six headings: First safe action, What this alert means, Customer impact, Diagnose, Escalate, Do not.
- [x] ISC-8: Template puts "First safe action" first and caps it at 5 lines.
- [x] ISC-9: Template includes a mandatory "Do not" section listing at least 2 unsafe actions.
- [ ] ISC-10: Antecedent: each paging alert links to exactly one dashboard that loads in 3 seconds or less and shows the alert's own metric in the top panel (probe: Skill('Interceptor') screenshot of every `dashboard_url`, 100% pass).
- [x] ISC-11: Dashboards are stored as code in `dashboards/*.json` and provisioned from the repo.
- [x] ISC-12: Dashboard layout standard applied to every Lantern dashboard: row 1 symptom, row 2 saturation, row 3 dependencies.
- [x] ISC-13: Severity-to-routing map implemented in `alertmanager.yml` (SEV1 to 24/7 pager, SEV2 to business-hours pager, SEV3 to ticket queue).
- [x] ISC-14: Escalation policy defines the acknowledge windows: primary 5 minutes, secondary 10, engineering manager 15.
- [x] ISC-15: Each of the first five alerts has a `promtool test rules` unit test that fires and clears (probe: `promtool test rules tests/*.test.yaml` exits 0).
- [ ] ISC-16: Escalation policy exported as code at `escalation/policy.yaml` and applied to the pager service by CI.
- [ ] ISC-17: Antecedent: an engineer who did not write the alert, given only the page and no prior briefing, takes the first safe action within 5 minutes (probe: game-day drill with 3 engineers from other teams, at least 2 of 3 succeed).
- [ ] ISC-18: Every paging alert has a `customer_impact` annotation of one plain sentence, no jargon.
- [x] ISC-19: Runbook 1 `runbooks/payments-auth-failure-rate.md` exists and follows the template.
- [ ] ISC-20: Runbook 2 `runbooks/settlement-batch-late.md` exists and follows the template.
- [ ] ISC-21: Runbook 3 `runbooks/ledger-write-latency.md` exists and follows the template.
- [ ] ISC-22: Runbook 4 `runbooks/webhook-delivery-backlog.md` exists and follows the template.
- [ ] ISC-23: Runbook 5 `runbooks/card-processor-timeouts.md` exists and follows the template.
- [ ] ISC-24: All five runbooks pass the runbook lint (probe: `bun scripts/runbook-lint.ts runbooks/` exits 0; checks headings, order, first-action length, presence of Do not).
- [ ] ISC-25: The first safe action in each of the five runbooks is reversible and states its own rollback command.
- [ ] ISC-26: Each runbook is reviewed by an engineer who is not its author, recorded in the PR approval.
- [ ] ISC-27: Runbooks render at `lantern.example.com/runbooks` and each alert's `runbook_url` points to the rendered page.
- [ ] ISC-28: CI fails any runbook whose `last_reviewed` date is older than 90 days.
- [ ] ISC-29: Antecedent: the page is readable on a phone lock screen — title at or under 80 characters with service and symptom in the first line (probe: `bun scripts/alert-lint.ts --max-title 80` exits 0, plus a push-notification screenshot from a test device).
- [ ] ISC-30: Page body is at most 5 lines: customer impact, since when, dashboard link, runbook link, ack link.
- [ ] ISC-31: Every SEV1 alert maps to a named SLO and says which one in its annotations.
- [ ] ISC-32: SEV1 SLO alerts use multi-window burn rate (5m and 1h fast burn, 30m and 6h slow burn).
- [ ] ISC-33: Anti: any paging alert lacks a `runbook_url` (probe: `rg -L runbook_url alerts/` lists no SEV1 or SEV2 file).
- [ ] ISC-34: Anti: any alert title is only a metric name with no symptom, such as `HighCPU` (probe: alert-lint rejects titles with no verb or no service prefix).
- [x] ISC-35: The missed settlement stall, replayed against staging with recorded metrics, fires SEV1 within 3 minutes of the stall start.
- [ ] ISC-36: Anti: one underlying fault pages more than once in a 15-minute window (probe: replay the settlement stall and count pages; target exactly 1).
- [ ] ISC-37: Alertmanager groups by `service` and `alertname` and has inhibition rules so a dependency outage suppresses its downstream symptom pages.
- [ ] ISC-38: Anti: more than 20% of pages in the parallel run led to no human action (probe: page log reviewed against ack notes; actionable ratio at least 80%).
- [ ] ISC-39: Pages per on-call week stay at or below 10 during the 14-day parallel run (probe: pager export, `bun scripts/page-count.ts`).
- [ ] ISC-40: Silence and maintenance-window policy documented; every silence expires within 24 hours (probe: Alertmanager API lists no silence longer than 24h).
- [ ] ISC-41: Alert inventory generated at `docs/alerting/inventory.csv` listing alert, owner, severity, runbook and dashboard; regenerated by CI.
- [x] ISC-42: Every alert carries an `owner` team label.
- [ ] ISC-43: Anti: any alert without an `owner` label exists in the repo (probe: alert-lint, zero findings).
- [ ] ISC-44: On-call schedule and rotation membership exported to `escalation/schedule.yaml`, with no person listed in two tiers at once.
- [ ] ISC-45: A dead-man's-switch alert exists and pages if the alerting pipeline itself has been silent for 10 minutes.
- [ ] ISC-46: Median time to acknowledge across all game-day drills is at or below 3 minutes, against a 22-minute baseline from the incident log.
- [ ] ISC-47: A one-page on-call cheat sheet exists at `docs/alerting/oncall-cheatsheet.md`, at most 60 lines.
- [ ] ISC-48: Cheat sheet renders at `lantern.example.com/oncall` and is linked from the pager app's rotation description.
- [ ] ISC-49: Three on-call engineers, given an alert and five runbook links cold, pick the correct runbook in under 60 seconds in 4 of 5 trials.
- [ ] ISC-50: The head of payments engineering signs off in writing on the three severity definitions.
- [x] ISC-51: All retired alerts (the 41 legacy rules, the stale wiki pages) are moved to `alerts/_retired/` with a README explaining why each was cut or merged.
- [ ] ISC-52: Anti: more than 2 new alerts or any new severity level is added between v1 freeze and rollout (probe: git diff of `alerts/` between freeze tag and rollout tag, additions at most 2).
- [ ] ISC-53: A "v1 freeze" tag is cut on the repo at least 7 days before rollout.
- [ ] ISC-54: Old alerts remain live for a 14-day parallel run and are disabled only after ISC-38 and ISC-39 pass.
- [ ] ISC-55: Launch retrospective scheduled for June 16, 2026, with the on-call leads, the head of payments engineering and the platform owner.
- [ ] ISC-56: Antecedent: an on-call engineer reports the "I just followed it" experience after a real or drilled page — captured verbatim in the retro notes (probe: retro doc, search for the quote or a paraphrase the engineer confirms).

## Test Strategy

```yaml
- isc: ISC-3
  type: lint-probe
  check: alert titles name service and symptom
  threshold: zero lint findings across all rule files
  tool: bun scripts/alert-lint.ts alerts/

- isc: ISC-4
  type: link-probe
  check: runbook_url resolves for every paging alert
  threshold: 100% return HTTP 200
  tool: bun scripts/link-check.ts alerts/

- isc: ISC-5
  type: syntax-probe
  check: rule files are valid Prometheus rules
  threshold: exit 0
  tool: promtool check rules alerts/*.rules.yaml

- isc: ISC-10
  type: experiential-probe
  check: dashboard loads fast and leads with the alert's own metric
  threshold: all dashboards load in 3s or less, top panel matches alert expression
  tool: Skill('Interceptor') screenshot of each dashboard_url

- isc: ISC-17
  type: experiential-probe
  check: cold responder reaches first safe action
  threshold: at least 2/3 engineers within 5 minutes
  tool: game-day drill in staging, stopwatch from page delivery to first action

- isc: ISC-35
  type: replay-probe
  check: the missed incident would now page
  threshold: SEV1 fires within 3 minutes of stall start
  tool: promtool test rules with recorded settlement-queue series

- isc: ISC-38
  type: anti-probe
  check: pages are actionable
  threshold: at least 80% of parallel-run pages have a recorded action
  tool: pager export joined to ack notes

- isc: ISC-46
  type: experiential-probe
  check: median time to acknowledge versus baseline
  threshold: median at or below 3 minutes across all drills (baseline 22)
  tool: bun scripts/drill-report.ts

- isc: ISC-49
  type: experiential-probe
  check: right runbook found from the alert alone
  threshold: 4 of 5 trials under 60 seconds
  tool: 5-trial pick test with planted near-duplicate runbooks
```

## Features

```yaml
- name: AlertTaxonomy
  description: One naming scheme, three severities, annotations (impact, SLO, runbook, dashboard), lock-screen-readable page format, burn-rate SLO alerts, grouping and inhibition, dead-man's switch.
  satisfies: [ISC-1, ISC-2, ISC-3, ISC-5, ISC-6, ISC-18, ISC-29, ISC-30, ISC-31, ISC-32, ISC-33, ISC-34, ISC-36, ISC-37, ISC-45]
  depends_on: []
  parallelizable: false

- name: DashboardsAndRouting
  description: One dashboard per paging alert, provisioned from code with a standard three-row layout; severity routing; escalation policy and schedule as code; silence policy; owner labels.
  satisfies: [ISC-10, ISC-11, ISC-12, ISC-13, ISC-14, ISC-16, ISC-40, ISC-42, ISC-43, ISC-44]
  depends_on: []
  parallelizable: true

- name: RunbookTemplate
  description: Six-heading runbook template with first safe action up front and a mandatory Do-not section; rendered site; review-date enforcement in CI.
  satisfies: [ISC-7, ISC-8, ISC-9, ISC-27, ISC-28]
  depends_on: []
  parallelizable: true

- name: FirstFiveRunbooks
  description: Auth failure rate, settlement batch late, ledger write latency, webhook delivery backlog, card processor timeouts — each following the template, each with a reversible first action, unit-tested alert, and non-author review; the missed-incident replay.
  satisfies: [ISC-4, ISC-15, ISC-19, ISC-20, ISC-21, ISC-22, ISC-23, ISC-24, ISC-25, ISC-26, ISC-35]
  depends_on: [AlertTaxonomy, RunbookTemplate]
  parallelizable: true

- name: RolloutGovernance
  description: Game-day drills and MTTA measurement; cheat sheet; inventory; v1 freeze; 14-day parallel run with actionability audit; sign-off; retired-alert archive; retrospective and the "I just followed it" capture.
  satisfies: [ISC-17, ISC-38, ISC-39, ISC-41, ISC-46, ISC-47, ISC-48, ISC-49, ISC-50, ISC-51, ISC-52, ISC-53, ISC-54, ISC-55, ISC-56]
  depends_on: [FirstFiveRunbooks, DashboardsAndRouting]
  parallelizable: false
```

## Decisions

- 2026-03-02 09:15: Three severities over five. The incident log shows responders could not reliably tell SEV2 from SEV3 in the old five-level scheme, and the difference never changed what they did. Pick the three that map to three different behaviors: wake someone, tell someone in the morning, open a ticket.
- 2026-03-06 16:40: Title format is `[SEV<n>] <service>: <symptom>`, with the symptom in the words of the person affected. "settlement-worker: nightly batch not progressing" beats "SettlementQueueDepthHigh." The incident log shows responders describe problems by what stopped, not by which counter moved.
- 2026-03-12 11:30: Symptom wording derives from the incident log, not from metric names. Pulled 60 past incident summaries and the phrases responders actually used: "stuck," "not progressing," "timing out," "backing up." Those became the allowed symptom verbs. Metric-style names were rejected because no responder used them.
- 2026-03-19 10:00: ❌ DEAD END: Tried generating runbooks automatically from alert expressions and service READMEs — 9 days of work. Killed because the output described what the metric measured, never what was safe to do, and the first safe action cannot be inferred from a query. Runbooks are written by hand by someone who has handled the incident.
- 2026-03-26 15:20: refined: ISC-3 and ISC-4 promoted to Antecedent prefix. They are not just lint checks; they are the preconditions for the Vision. If the title does not name the symptom or the link does not exist, a 3am stranger cannot succeed regardless of how good everything else is.
- 2026-04-02 13:45: ❌ DEAD END: Considered a paid incident-management platform with built-in runbook automation and AI triage. Rejected after pricing and a two-week pilot — $31,000/year at our seat count, and its suggested actions were wrong for 3 of our 5 target incidents. Rolled back to Markdown in the repo plus the existing pager. The constraint produced the better answer: the runbooks are reviewed like code and the team owns them.
- 2026-04-09 17:10: refined: added ISC-17 and ISC-46 after the platform owner asked "how do we know a stranger can actually do this?" A game-day drill with engineers from other teams is the only honest probe. If only the author can follow the runbook, it is a note to self.
- 2026-04-16 09:30: refined: ISC-38 added after the first draft rule set paged 31 times in a simulated week. A rule set that is technically correct but nobody can live with gets silenced within a month. The parallel run must show the pager is livable, not just accurate.
- 2026-04-23 14:00: The head of payments engineering signed off on the three severity definitions in writing. Logged the retirement of the old five-level scheme to `alerts/_retired/README.md` with their quote: "The old levels were a vocabulary test. These are an instruction."
- 2026-05-07 12:15: refined: ISC-49 added — three on-call engineers given an alert and five runbook links cold, asked to pick the right one. If the people who will carry the pager cannot find the right runbook without a walkthrough, the system is not self-explanatory yet.

## Changelog

- 2026-03-19 conjectured: runbooks could be generated from alert expressions and service READMEs, leaving humans to review rather than write. / refuted by: nine days of generation produced runbooks that explained what each metric measured and never what was safe to do; in a replay of the settlement stall, three reviewers each chose a different "first action" from the generated text and one of them would have restarted the worker mid-batch. / learned: the first safe action depends on knowing which action has already hurt someone before, which lives in incident memory, not in the query or the README. / criterion now: ISC-8 (first safe action up front, at most 5 lines) and ISC-25 (reversible, with rollback command) stand; the abandoned generator is documented in `_retired/runbook-generation.md`.

- 2026-03-26 conjectured: title format and runbook links were ordinary verifiable ISCs, checkable by lint. / refuted by: the Vision names a specific experience — a stranger, woken at 3am, succeeding within five minutes — and that experience is impossible if the title hides the symptom or the link is dead. The lint checks are not just verifying; they are the precondition for the Vision to be reachable at all. / learned: experiential goals require Antecedent ISCs — preconditions that must hold for the target experience to even be possible. Without them, the Vision is decoupled from the criteria. / criterion now: ISC-3 and ISC-4 carry the `Antecedent:` prefix; ISC-10, ISC-17, ISC-29, ISC-56 added as additional Antecedents anchoring other Vision claims.

- 2026-04-02 conjectured: a commercial incident platform with AI triage would shorten time to first action more than hand-written runbooks. / refuted by: a two-week pilot on the five target incidents produced a wrong suggested action in 3 of 5, at $31,000/year, and put the content outside code review. / learned: for a team this size, the quality of the first action matters more than the speed of finding it, and only reviewed, owned text gives that. Tooling that hides its reasoning is a lock-in that compounds with every service added. / criterion now: ISC-24 (runbook lint) and ISC-26 (non-author review) are hard gates; the repo-and-pager constraint stands.

- 2026-04-16 conjectured: if every rule was correct against its own SLO, the rotation would be livable. / refuted by: the draft rule set, each rule individually justified, paged 31 times in a simulated week because one dependency failure fanned out into eleven symptom pages. / learned: correctness per alert is not livability per week; the unit of experience is the whole night, so grouping and inhibition are part of the product, not tuning. / criterion now: ISC-36 (one fault, one page), ISC-37 (grouping and inhibition) and ISC-38 (actionable ratio at least 80%) added; ISC-39 caps pages per week.

## Verification

- ISC-1: `docs/alerting/naming.md` shows the single format with 6 renamings, for example `SettlementQueueDepthHigh` becomes `[SEV1] settlement-worker: nightly batch not progressing`. Verified 2026-03-09.
- ISC-3: `bun scripts/alert-lint.ts alerts/` exits 0; output confirms 22/22 rules have service prefix, symptom verb and severity tag. Verified 2026-03-30.
- ISC-4: `bun scripts/link-check.ts alerts/` exits 0; 14/14 paging alerts return HTTP 200 on `runbook_url`. Verified 2026-04-03.
- ISC-5: `promtool check rules alerts/*.rules.yaml` prints `SUCCESS: 22 rules found` for all 4 files. Verified 2026-03-30.
- ISC-8: `runbooks/_template.md` shows "First safe action" as the first heading with a 5-line cap enforced by the runbook lint. Verified 2026-04-08.
- ISC-13: `amtool config routes show` prints three routes matching SEV1, SEV2 and SEV3 receivers. Verified 2026-04-10.
- ISC-15: `promtool test rules tests/*.test.yaml` exits 0; `SUCCESS` for the auth-failure test, the first of five. Verified 2026-05-12.
- ISC-19: `runbooks/payments-auth-failure-rate.md` passes `bun scripts/runbook-lint.ts` and was approved by a non-author in the PR. Verified 2026-05-13.
- ISC-35: staging replay of the recorded settlement-queue series fires `[SEV1] settlement-worker: nightly batch not progressing for 10m` at stall start plus 2m40s. Verified 2026-04-28.
- ISC-42: `rg -L 'owner:' alerts/` returns no alert files. Verified 2026-04-14.
- ISC-51: `ls alerts/_retired/` shows `legacy-rules.yaml`, `wiki-pages.md` and `README.md` with retirement rationale for each of the 41 rules. Verified 2026-04-23.
