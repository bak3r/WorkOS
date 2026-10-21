<!-- Fictitious example. "Tallybridge" and the transfers API are teaching placeholders; any resemblance to real companies, products, or RFCs is coincidental. -->

---
task: "Write a technical design doc (RFC) proposing idempotency keys for the Tallybridge payments API's POST /transfers endpoint, for the architecture review"
slug: 20260511-094500_rfc-transfers-idempotency
project: TransfersIdempotencyRfc
effort: advanced
effort_source: explicit
phase: execute
progress: 11/34
mode: interactive
started: 2026-05-11T07:45:00Z
updated: 2026-05-14T13:20:00Z
---

## Problem

Clients of `POST /transfers` retry on timeouts, and a retry that arrives after the first request already committed creates a second transfer. Support has traced four duplicate-transfer incidents in the last quarter to this, each needing a manual reversal. The fix is understood by the three engineers who debugged it; it isn't written down. A first draft reads like an incident report: it lists symptoms, buries the actual decision on page four, and gives reviewers no way to see what happens when two retries race. An architecture review that has to reconstruct the design from the prose will defer the decision to next month.

## Vision

A design doc that a reviewer reads in about twelve minutes, understands well enough to predict the API's behaviour on a concurrent retry before reaching the section that states it, and approves in a single review meeting with questions about rollout rather than about what is being proposed. Euphoric surprise: the review meeting spends its time on the TTL and the purge job, the decision is recorded before the hour ends, and two weeks later the on-call team links the doc from the transfers runbook because it answers the question they get paged about.

## Out of Scope

- **Not an API-wide idempotency framework.** `POST /transfers` only. Refunds, payouts, and webhooks are named as follow-ups, not designed here.
- **Not a client SDK design.** The doc specifies the wire contract; retry policy in client libraries is a separate RFC.
- **No exactly-once delivery claims.** The doc proposes at-most-once creation per key, and says so plainly.
- **No new infrastructure.** No Redis, no new message broker; storage is the existing SQL Server instance.
- **Not a postmortem.** The four incidents are one paragraph of motivation, not the structure of the document.

## Principles

- The decision requested sits in the first sentence of the Summary. A reviewer who stops reading there still knows what they are being asked.
- One diagram carries the concurrency story. Prose that restates the diagram is cut.
- Every rejected alternative is rejected for a reason tied to a stated constraint, not taste.
- Concrete > abstract. Every behaviour has an example request and response, or it does not belong in the doc.
- A number without a source is an opinion. Latency and size figures cite a benchmark or are removed.

## Constraints

- 2200–3000 words in the body (frontmatter and code blocks excluded).
- At most 6 rendered pages; reading time ≤ 15 minutes at 200wpm.
- Seven H2 sections only: Summary, Context, Proposal, Alternatives, Failure Modes, Rollout, Open Questions.
- Code limited to the table DDL and one handler sketch of ≤ 40 lines (C#, ASP.NET Core).
- Sequence diagram in Mermaid so it renders in the internal docs portal and in the PR preview.
- Published as one Markdown file in the `docs/rfcs/` directory, frontmatter included.
- Review invite sent with the doc link at least 48 hours before the meeting.

## Goal

Ship a 2200–3000-word design doc that states its decision in the first sentence, specifies the `Idempotency-Key` header contract, a SQL Server `dbo.IdempotencyRecord` table with a unique index on `(MerchantId, IdempotencyKey)`, a 24-hour TTL with a batched purge, and explicit behaviour for concurrent retries (409 with `Retry-After`) and body mismatch (422), so the architecture review can approve it in one meeting and the on-call team can use it as the reference.

## Criteria

### Length and structure

- [x] ISC-1: Body word count ∈ [2200, 3000] (probe: `awk '/^---$/{c++; next} c==2' rfc.md | wc -w`, code fences excluded).
- [x] ISC-2: Exactly seven H2 sections in the specified order (probe: `rg -c "^## " rfc.md` returns 7; `rg "^## " rfc.md` matches the Constraints list).
- [ ] ISC-3: Rendered PDF is ≤ 6 pages (probe: `pandoc rfc.md -o rfc.pdf && pdfinfo rfc.pdf | rg Pages`).
- [ ] ISC-4: Reading time ≤ 15 minutes at 200wpm (computed: `wc -w / 200`).

### Proposal content

- [x] ISC-5: The Summary is ≤ 150 words and its first sentence names the decision requested (probe: human review confirms "We ask the review to approve ..." or equivalent opens the section).
- [x] ISC-6: The header contract is specified: name `Idempotency-Key`, opaque string ≤ 64 characters, required on `POST /transfers`, missing key returns 400 with error code `idempotency_key_required` (probe: `rg "idempotency_key_required" rfc.md` returns ≥ 1).
- [x] ISC-7: The storage section includes DDL for `dbo.IdempotencyRecord` with a unique index on `(MerchantId, IdempotencyKey)` (probe: `rg "UNIQUE.*MerchantId.*IdempotencyKey" rfc.md` returns ≥ 1).
- [ ] ISC-8: TTL is stated as 24 hours with a purge job deleting in batches of ≤ 5000 rows to avoid lock escalation (probe: `rg "24 hours|5000" rfc.md` returns both).

### Concurrency and replay behaviour

- [x] ISC-9: A second request with the same key while the first is in flight returns 409 with a `Retry-After` header (probe: the behaviour table has a row for "in flight", status 409, `Retry-After` present).
- [ ] ISC-10: A request with the same key but a different body hash returns 422 `idempotency_key_reused` (probe: the behaviour table has the row; the fingerprint is SHA-256 over the canonicalised body).
- [x] ISC-11: The Mermaid sequence diagram covers three flows: first request, sequential replay, concurrent retry (probe: `rg -c "^\s*(alt|else|par)" rfc.md` ≥ 2; diagram renders without error in the portal preview).
- [ ] ISC-12: A replayed response returns the stored status and body plus an `Idempotent-Replayed: true` header (probe: example request/response pair in the doc shows the header).

### Antecedent ISCs (preconditions for the target experience)

- [x] ISC-13: **Antecedent:** after reading only the Summary, ≥ 3 of 4 reviewers can state the decision requested and the one-line mechanism (probe: 4 reviewers read the Summary, then answer two questions in writing without opening the rest).
- [ ] ISC-14: **Antecedent:** the sequence diagram alone lets a reviewer predict the response to a concurrent retry (probe: show 4 reviewers the diagram with the 409 label covered; ≥ 3/4 predict "reject with retry hint" and not "wait" or "duplicate").
- [ ] ISC-15: **Antecedent:** each rejected alternative has a one-sentence rejection reason that cites a stated constraint, so a reviewer can answer "why not Redis" without reading the section (probe: human review of the Alternatives section against the Constraints list; every reason names a constraint).

### Clarity discipline

- [x] ISC-16: Every acronym is expanded on first use (probe: script lists all-caps tokens of ≥ 2 letters, checks each has a first-use expansion or is in the glossary line).
- [ ] ISC-17: No sentence longer than 40 words and no paragraph longer than 7 lines (probe: sentence and paragraph length script over the body).

### Anti-criteria

- [x] ISC-18: Anti: out of scope — the Proposal does NOT specify behaviour for endpoints other than `POST /transfers` (probe: `rg "POST /(refunds|payouts)|/webhooks" rfc.md` matches only inside the Out of Scope or Open Questions sections).
- [ ] ISC-19: Anti: unresolved — the doc contains no `TBD`, `TODO`, or "to be decided" (probe: `rg -i "tbd|todo|to be decided" rfc.md` returns 0).
- [ ] ISC-20: Anti: unsourced numbers — no latency, size, or throughput figure appears without a benchmark reference (probe: every digit-plus-unit match of `ms|MB|req/s` has a link or footnote id within the same paragraph).
- [ ] ISC-21: Anti: scope drift — the doc does NOT claim exactly-once semantics (probe: `rg -i "exactly[- ]once" rfc.md` returns 0 outside the Alternatives section).

### Iteration discipline

- [x] ISC-22: At least 3 drafts are captured in `drafts/` before the final (probe: `ls drafts/ | wc -l` ≥ 3).
- [ ] ISC-23: One engineer outside the transfers team read the draft cold and left written comments (probe: Decisions entry citing reviewer initials and the comment count).
- [ ] ISC-24: A 15-minute dry run of the review meeting was held with one colleague playing a sceptical reviewer (probe: Decisions entry recording the question that landed hardest).

### Publishing

- [ ] ISC-25: Final file is `docs/rfcs/rfc-0042-transfer-idempotency.md` with frontmatter `title`, `status`, `authors`, `reviewers`, `review_date`.
- [ ] ISC-26: The Markdown and the Mermaid diagram render cleanly in the docs portal preview (probe: preview screenshot shows seven sections and a drawn diagram).
- [ ] ISC-27: The review invite, with the doc link, was sent ≥ 48 hours before the meeting (probe: calendar invite timestamp vs meeting start).
- [ ] ISC-28: A `decision-template.md` is attached with fields for decision, conditions, and owners, so the outcome is recorded in the meeting (probe: file exists next to the RFC).

### Post-review reception probes

- [ ] ISC-29: Within 7 days of the review, ≥ 3 of the 4 required reviewers have approved (probe: `gh pr view <n> --json reviews --jq '[.reviews[] | select(.state=="APPROVED")] | length'` ≥ 3).
- [ ] ISC-30: Within 14 days, the on-call transfers runbook links the RFC unprompted (probe: `rg "rfc-0042" runbooks/transfers/` returns ≥ 1, committed by someone other than the author).

### Author discipline

- [ ] ISC-31: A `cuts.md` file preserves what was removed from the draft (probe: file exists, ≥ 400 words of cuts).
- [ ] ISC-32: Frontmatter `started` and the publish timestamp reflect at least 3 working days of drafting (probe: timestamps).
- [ ] ISC-33: A Decisions entry records the section that took the most rewriting and why (lessons for the next RFC).
- [ ] ISC-34: At least one ❌ DEAD END Decisions entry exists (a design direction tried and abandoned).

## Test Strategy

```yaml
- isc: ISC-1
  type: word-count
  check: total words in body, code fences excluded
  threshold: 2200-3000
  tool: awk '/^---$/{c++; next} c==2' rfc.md | wc -w

- isc: ISC-7
  type: content-presence
  check: DDL declares a unique index on the idempotency key pair
  threshold: ≥ 1 match
  tool: rg "UNIQUE.*MerchantId.*IdempotencyKey" rfc.md

- isc: ISC-13
  type: antecedent-probe
  check: reviewers state decision and mechanism from the Summary alone
  threshold: ≥ 3/4
  tool: 4-person cold read of the Summary, 2 written questions each

- isc: ISC-14
  type: antecedent-probe
  check: reviewers predict the concurrent-retry response from the diagram with the label covered
  threshold: ≥ 3/4
  tool: 4-person diagram test, answers collected before the full doc is shown

- isc: ISC-29
  type: post-review
  check: required reviewers approve within 7 days
  threshold: ≥ 3 approvals
  tool: gh pr view <n> --json reviews --jq '[.reviews[] | select(.state=="APPROVED")] | length'
```

## Features

```yaml
- name: SummaryAndContext
  description: Decision-first Summary plus a one-paragraph motivation from the four incidents
  satisfies: [ISC-3, ISC-5, ISC-13, ISC-17]
  depends_on: []
  parallelizable: false  # the Summary gates every other section

- name: ProposalSpec
  description: Header contract, DDL with unique index, TTL and purge job, replay response shape
  satisfies: [ISC-3, ISC-6, ISC-7, ISC-8, ISC-12, ISC-20]
  depends_on: [SummaryAndContext]
  parallelizable: false

- name: ConcurrencyDiagram
  description: Mermaid sequence diagram and behaviour table for in-flight and mismatch cases
  satisfies: [ISC-3, ISC-9, ISC-10, ISC-11, ISC-14]
  depends_on: [ProposalSpec]
  parallelizable: false  # the diagram must match the spec exactly

- name: AlternativesAndRollout
  description: Rejected options with constraint-linked reasons, failure modes, phased rollout
  satisfies: [ISC-15, ISC-18, ISC-19, ISC-21, ISC-30]
  depends_on: [ConcurrencyDiagram]
  parallelizable: true  # both sections read from the finished spec

- name: ReviewPrep
  description: Cold read, meeting dry run, invite, decision template, clarity scrub
  satisfies: [ISC-16, ISC-17, ISC-23, ISC-24, ISC-27, ISC-28, ISC-29]
  depends_on: [AlternativesAndRollout]
  parallelizable: true  # reader passes are independent
```

## Decisions

- 2026-05-11 09:45: Seven sections, locked, with the Summary first. The form constraint forces the decision to be stated before the history.
- 2026-05-12 11:00: ❌ DEAD END: Tried opening with the four incident timelines to make the case. Reviewers' attention went to blame and root cause rather than the proposal. Moved to a one-paragraph motivation. Don't retry.
- 2026-05-12 16:30: refined: ISC-13 sharpened from "reviewers find the Summary clear" to "≥ 3 of 4 reviewers can state the decision and the one-line mechanism from the Summary alone." The first phrasing was unfalsifiable; the second isolates the moment that decides whether the meeting is spent on the proposal.
- 2026-05-13 10:15: ❌ DEAD END: Tried a Redis-backed key store to keep the hot path off SQL Server. It added a second failure domain and broke the no-new-infrastructure constraint; the stored response also had to be written transactionally with the transfer. Kept as a rejected alternative with that reason. Don't retry.
- 2026-05-13 14:45: refined: ISC-9 sharpened from "concurrent retries are handled safely" to "a second request while the first is in flight returns 409 with `Retry-After`." Waiting on the first request was the other candidate, and the vague phrasing hid that the doc had not chosen.
- 2026-05-14 13:20: refined: ISC-20 added (no unsourced numbers) after a draft claimed the unique-index lookup added "negligible latency" with no measurement. The benchmark is now linked or the claim is gone.

<!--
E3 experiential work-writing ISA. Required sections: Problem, Vision, Out of Scope, Constraints, Goal, Criteria, Features, Test Strategy.
Optional Principles included because the design doc is experiential (reviewers must understand and approve it in one meeting) and the principles do real work in the writing pass.
ISC count of 34 exceeds the E3 floor of 32. Three Antecedent ISCs (ISC-13, 14, 15) carry the experiential-goal contract: they name the preconditions that reliably produce the target review experience. Without them, ISC-29 and ISC-30 (post-review reception) would be unfalsifiable hopes rather than testable claims. Anti-criteria (ISC-18, 19, 20, 21) cover scope, unresolved placeholders, unsourced numbers, and an overclaim trap. The Decisions section shows two ❌ DEAD ENDs and three refinements — typical density for a draft that knows its decision but is still finding its load-bearing moments.
-->
