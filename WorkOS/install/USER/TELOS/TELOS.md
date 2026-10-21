---
provenance: template
last_updated: 2026-01-01T00:00:00Z
last_updated_by: bootstrap-template
convention: pai-freshness-v1
---

# TELOS — Your Name

> 🎯 SAMPLE TEMPLATE — this is the single source of truth for your work TELOS: where you stand at work, where you want to get, and how. Every entry below is a placeholder showing the SHAPE of the data. Run `/interview` (or just talk to your DA) to replace these samples with your real work context. Keep the `##` headings — the summary generator reads them.

## Current State (role, team, and career right now)

- Role: (sample) Senior backend developer on the payments team, 3 years in.
- Team: (sample) 6 developers, 1 QA, 1 product owner; two-week sprints.
- Career: (sample) Owns two services end to end; not yet leading cross-team work.

## Ideal State (where you want to be at work)

- Role: (sample) Trusted technical lead for the payments domain.
- Team: (sample) Releases are boring: green pipeline, no manual deploy steps.
- Career: (sample) Known for clear designs and reviews that catch real bugs.

## Mission (professional)

- **M0:** (sample) Build backend systems that move money correctly and stay easy to change.

## Problems (what the team or product is solving)

- **P0:** (sample) Settlement jobs fail silently and are found by customers, not by us.
- **P1:** (sample) Onboarding a new developer to the codebase takes weeks.

## Goals (sprint, quarter, career; measurable)

- **G0:** (sample) Ship the reconciliation service to production by end of Q2 — measurable: runs nightly with zero manual fixes for 30 days.
- **G1:** (sample) Raise integration-test coverage of the settlement module — measurable: every public handler has at least one test by end of quarter.
- **G2:** (sample) Lead one cross-team design review this half-year.

## Challenges (what gets in the way)

- **C0:** (sample) Context switching between support tickets and feature work.
- **C1:** (sample) I postpone writing the design doc and go straight to code.

## Strategies (how you will handle the challenges)

- **S0:** (sample) Write a one-page design note before any change that touches two services.
- **S1:** (sample) Batch support tickets into one fixed block per day.

## Projects (the work that pursues the strategies)

- **PJ0:** (sample) Reconciliation service — in progress, MR open for the matching engine.

## Narratives (talking points for reviews, demos, 1:1s)

- **N0:** (sample) I turned an unreliable nightly batch into a service with alerts and an audit trail.

## Context Filter

When steering work, bias toward: (sample — what the DA should favour when choosing between options, e.g. correctness over speed, small reviewable MRs over big ones, boring proven tech over new tools).

## Models (how you think about engineering)

- **MD0:** (sample) Make the failure loud: an error nobody sees is worse than a crash.

## Wrong (things you were wrong about)

- (sample) I thought more mocks made tests safer; they mostly hid integration bugs.

## Wisdom (engineering lessons)

- (sample) The bug is usually in the code you were sure about.

---
*This file is the canonical work TELOS. Optional professional sections the interview also recognizes: `## Beliefs`, `## Frames`, `## Predictions`. After editing, regenerate the summary: `bun <configRoot>/WORKOS/TOOLS/GenerateTelosSummary.ts`.*
