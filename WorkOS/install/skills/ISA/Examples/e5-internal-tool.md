<!-- Fictitious example. "TraceDesk" is a teaching project name; any resemblance to real products or organizations is coincidental. The tracedesk.example.org domain is RFC 2606 reserved. -->

---
task: "TraceDesk — read-only transaction tracing tool for support and on-call engineers"
slug: 20260115-090000_tracedesk-v1
project: TraceDesk
effort: comprehensive
effort_source: explicit
phase: execute
progress: 45/54
mode: interactive
started: 2026-01-15T17:00:00Z
updated: 2026-04-27T22:30:00Z
---

## Problem

When a customer reports "my transfer is stuck", a support or on-call engineer has to reconstruct what happened from four places that were never designed to be read together. The API gateway writes structured logs into Loki. The message broker hops live as OpenTelemetry spans in Tempo. The state transitions live in system-versioned SQL Server tables owned by three different services. Each has its own query language, its own access request, and its own idea of what a correlation ID is called. A typical investigation is a 25-minute tour of three browser tabs and a psql session, done under pressure, often with production database credentials that are far broader than the task needs, and with raw card numbers and IBANs scrolling past in terminal output. Nobody can say afterwards who looked at which customer's data. The middle ground — one read-only place where an engineer pastes a correlation ID and sees the whole path, with the sensitive fields already masked and every lookup on record — does not exist inside the company today.

## Vision

A small internal tool that a team of 20 to 60 support and on-call engineers uses without training. They open `tracedesk`, paste a correlation ID from a support ticket, and within three seconds see one merged timeline: the gateway request, the three queue hops, the retry that dead-lettered, and the exact moment the payment row moved from `Pending` to `Held`. IBANs and card numbers show as stable tokens, so two events can be seen to concern the same account without anyone seeing the account. When an engineer genuinely needs a raw value, they ask for a time-boxed break-glass elevation with a ticket number, and the on-call channel sees it happen. Euphoric surprise: the 25-minute tour becomes a 20-second paste, and the security review that used to block access requests for weeks is replaced by "it is read-only, masked, and fully audited."

## Out of Scope

- **No write path of any kind.** TraceDesk reads. It never retries a message, redrives a dead-letter queue, edits a row, or restarts a service. No "fix it" button in v1.
- **No log search product.** TraceDesk answers "what happened to this one ID". Free-text search across all logs stays in Loki and Grafana.
- **No metrics or alerting product.** Dashboards and paging remain in the existing observability stack. TraceDesk only alerts on its own break-glass usage.
- **No customer-facing exposure.** Internal network only, behind the corporate IdP. No public endpoint, no customer portal.
- **No cross-environment lookups.** One TraceDesk instance serves one environment. Production and staging are separate deployments with separate source credentials.
- **No ingestion or indexing of source data.** The tool queries sources live and keeps nothing except its own audit metadata. It is not a second observability store.
- **No sources that cannot be read with a scoped read-only credential.** Loki, Tempo, and SQL Server temporal tables: yes. The mainframe batch ledger that only offers a shared admin login: deferred until it gets a read-only account.

## Principles

- Read-only is not a feature, it is the entire posture. If a capability requires a write credential, it belongs in a different tool.
- Masking happens at the boundary where data enters TraceDesk, never at the edge where it is displayed. A value that was never unmasked in memory cannot leak through a HAR file, a log line, or a screenshot.
- Every lookup is on the record. An engineer's right to look is only defensible if the audit trail makes the looking visible.
- Partial truth, stated honestly, beats a blank screen. When one source is down, the timeline renders the others and says plainly which one is missing.
- A tool used at 3 a.m. by someone who has never seen it must be obvious in one screen. Anything that needs a manual is a defect.

## Constraints

- .NET 8 (LTS) with ASP.NET Core minimal APIs; the CLI is a self-contained single-file publish of the same core library. The web UI is a static Preact build served by the API.
- TraceDesk's own state (audit, role mappings, saved views) lives in PostgreSQL 16. It never shares a database server with the SQL Server estate it inspects.
- Sources are reached with read-only credentials only: a Loki bearer token with query scope, Tempo with query scope, and a SQL Server login that holds `db_datareader` and nothing else.
- Authentication is OIDC authorization code with PKCE against the corporate IdP; the CLI uses the device-code flow. No local passwords, no API keys, no service-account bypass in v1.
- Self-hosted on the internal Kubernetes cluster and as a `docker compose` bundle for small teams. API image ≤ 120MB compressed.
- Per-adapter timeout is 5 seconds. A lookup never waits longer than that on any single source, and a source query never spans more than 24 hours.
- The UI must remain responsive (60fps scroll, ≤ 100ms interaction latency p95) with a 5,000-event timeline on a 2019 laptop with 8GB RAM.

## Goal

Ship a .NET 8 tool — code-named TraceDesk, with a CLI and a small web UI deployed from `tracedesk.example.org` release artifacts — that takes one correlation ID, queries the gateway logs, queue-hop spans, and database state history in parallel and read-only, masks personal data at the adapter boundary, renders one merged timeline in ≤ 3 seconds p95, enforces role-based access with audited break-glass elevation, and keeps working offline for already-exported trace bundles.

## Criteria

### Build & Deployment

- [x] ISC-1: `dotnet publish -c Release` produces the `tracedesk-api` container image (linux/amd64 and linux/arm64) and a self-contained `tracedesk` CLI for linux-x64, osx-arm64, and win-x64.
- [x] ISC-2: The API image is signed with cosign; `cosign verify --key cosign.pub registry.example.org/tracedesk/api:1.0.0` exits 0.
- [x] ISC-3: The API image is ≤ 120MB compressed and each CLI binary is ≤ 30MB.
- [x] ISC-4: `docker compose up -d` from `deploy/` brings API, web UI, and Postgres to healthy within 60 seconds; `GET /healthz/ready` returns 200.
- [x] ISC-5: `tracedesk --version` prints a semver matching `<Version>` in `Directory.Build.props`.

### Onboarding & Configuration

- [x] ISC-6: A new team goes from an empty compose file to a first successful trace lookup in ≤ 30 minutes with one Loki source, one Tempo source, and one SQL Server source.
- [x] ISC-7: `tracedesk doctor` reports reachability, credential validity, and clock offset for every configured source in ≤ 30 seconds.
- [x] ISC-8: Loki source setup accepts a base URL and a query-scoped token and verifies them with `GET /loki/api/v1/labels`.
- [x] ISC-9: SQL source setup accepts a connection string and refuses to start if the login holds any permission beyond read, checked with `HAS_PERMS_BY_NAME(DB_NAME(), 'DATABASE', 'INSERT')` and its UPDATE and DELETE equivalents.
- [x] ISC-10: A source marked `heuristic` (the legacy settlement database with no correlation column, matched by account and time window) requires `allow_heuristic_match: true`, and the UI marks every row from it with an "approximate match" badge.
- [ ] ISC-11: No source secret appears in `appsettings.json`; secrets resolve only from environment variables or mounted `*_FILE` paths, and `tracedesk doctor --lint-config` fails on a literal secret.

### Source Adapters

- [x] ISC-12: The gateway adapter queries Loki `query_range` for the correlation ID, using a window derived from the known span extents (default ±15 minutes, hard cap 24 hours), and parses the gateway's structured JSON lines into `GatewayHop` events (route, status, latency_ms, upstream).
- [x] ISC-13: The trace adapter reads OTLP spans from Tempo `GET /api/traces/{traceId}` and maps `messaging.system=rabbitmq` spans to `QueueHop` events (exchange, routing key, queue, publish-to-consume delay).
- [x] ISC-14: The database adapter reads state transitions from the system-versioned table `dbo.TransactionHistory` using `FOR SYSTEM_TIME ALL WHERE CorrelationId = @id ORDER BY ValidFrom`.
- [ ] ISC-15: Dead-letter hops are surfaced from `x-death` data recorded on spans, including original queue, reason, and delivery count.
- [x] ISC-16: An adapter that times out or returns 5xx shows as `partial: <source> unavailable` in the response; the remaining sources still render and the lookup never fails as a whole.
- [x] ISC-17: Adapter query latency p95 ≤ 800ms for Loki and Tempo at 10M log lines per day, and ≤ 300ms for SQL Server.

### Merged Timeline & Storage

- [x] ISC-18: The TraceDesk Postgres schema contains `lookup_audit`, `role_mapping`, `elevation`, `saved_view`, `source_config`, `bundle`, `webhook_outbox`, and `schema_version`.
- [x] ISC-19: The merged timeline is assembled in memory per request and never persisted; only audit metadata (subject, ID, sources, outcome) is stored.
- [x] ISC-20: `lookup_audit` is partitioned by month and partitions older than 13 months are dropped; `saved_view` is kept until its owner deletes it.
- [x] ISC-21: At startup the API compares `schema_version` with the binary; a mismatch aborts with an explicit message and non-zero exit, and production never auto-migrates.
- [x] ISC-22: `tracedesk export --lookup <id> --format json` writes the merged, masked timeline in ≤ 5 seconds for traces of up to 5,000 events.

### UI / Trace View

- [x] ISC-23: Pasting a correlation ID (GUID, 32-hex W3C trace id, or legacy `TXN-` prefixed ID) resolves and renders the merged timeline in ≤ 3 seconds p95.
- [x] ISC-24: The timeline lists events from all sources in UTC order with source, service, duration, and status per row; non-2xx and error rows are highlighted.
- [x] ISC-25: A service-path diagram renders gateway, services, queues, and database writes with per-hop latency, and the failed or slowest hop is highlighted.
- [ ] ISC-26: Drill-down on any event shows the masked payload, headers, and for database events a before/after row diff, with a copy-as-JSON action.
- [x] ISC-27: A 5,000-event timeline scrolls at 60fps (virtualised list) on a 2019 laptop with 8GB RAM.
- [x] ISC-28: Filter toggles (source, status, service) over 5,000 events respond with p95 ≤ 100ms.

### PII Masking

- [x] ISC-29: IBANs, payment card numbers (Luhn-valid 13 to 19 digits), email addresses, phone numbers, and national ID numbers are masked in every adapter's output before the timeline is merged; recall ≥ 99.5% on the 200-sample labelled corpus.
- [x] ISC-30: Masking runs server-side; the web UI and CLI never receive an unmasked value unless the caller holds an active elevation.
- [x] ISC-31: Masked values are deterministic within one lookup (the same IBAN always renders as `‹IBAN:a3f9›`, via HMAC with a per-lookup key) so equality is visible without the value.
- [x] ISC-32: Free-text fields (log messages, exception text, JSON bodies) pass through the same masker; if the masker throws, the field is replaced with `[unmaskable: dropped]`, never passed through.

### Audit & Alerts

- [x] ISC-33: Every lookup writes a `lookup_audit` row (subject, roles, correlation ID, sources queried, outcome, elapsed_ms) before the response body is returned.
- [x] ISC-34: A break-glass elevation writes an audit row and posts a webhook message to the on-call channel with subject, ticket, and expiry.
- [x] ISC-35: Audit and pending webhook messages survive an API restart (outbox pattern); a webhook that failed while Postgres or the channel was down is delivered on the next start.
- [ ] ISC-36: When the audit store is unreachable the API fails closed with 503 and serves no trace data.

### Access Control (RBAC)

- [x] ISC-37: Sign-in uses OIDC authorization code with PKCE; the CLI uses the device-code flow; there are no local passwords.
- [x] ISC-38: Roles come from IdP group claims (`td-viewer`, `td-oncall`, `td-pii-reader`, `td-admin`); a user with no mapped group gets 403.
- [x] ISC-39: Break-glass elevation to unmasked values requires `td-pii-reader`, a ticket ID matching `^[A-Z]{2,6}-\d{1,6}$`, and a reason of at least 20 characters; it auto-expires after 15 minutes and more than 5 elevations per user per day are refused.
- [x] ISC-40: Tokens failing issuer, audience, or expiry validation return 401; web sessions time out after 30 minutes idle.

### Trace Bundles (offline, optional, restricted by default)

- [ ] ISC-41: Bundle export is OFF in default settings; enabling it requires `td-admin` and shows a single screen stating that masked trace data will leave the service as a file.
- [ ] ISC-42: `tracedesk bundle export <id>` writes a `.tdbundle` (zip with `timeline.json`, `manifest.json`, `signature`) containing only already-masked data; values from an active elevation are never included.
- [ ] ISC-43: Bundles are signed with an Ed25519 instance key; `tracedesk open file.tdbundle` verifies the signature and renders the timeline fully offline.
- [ ] ISC-44: The manifest carries `expires_at` (default 7 days); `tracedesk open` refuses an expired bundle with a clear message.
- [ ] ISC-45: Revoking an instance key marks earlier bundles invalid on the next `tracedesk open` when the revocation list is reachable, and warns when it is not.

### Releases

- [x] ISC-46: The CLI checks `tracedesk.example.org/api/release/latest` at most once per 24 hours and only prints a notice; it never updates itself.
- [x] ISC-47: Each release ships a signed CycloneDX SBOM and provenance attestation; `cosign verify-attestation` passes for the API image.

### Operational

- [x] ISC-48: `tracedesk support-bundle` zips redacted config, adapter health, version info, and the last 24 hours of API logs (masked) into one file, with no trace payloads.
- [x] ISC-49: Self-instrumentation via OpenTelemetry OTLP is opt-in and attribute-allow-listed; `tracedesk telemetry --show` prints the exact allow-list, and spans carry only a hashed correlation ID.

### Anti-criteria

- [x] ISC-50: Anti: PII leak — seeded canary values (card `4111111111111111`, IBAN `SI56 0000 0000 0000 000`) never appear in any API response, application log, or audit row for a non-elevated caller.
- [x] ISC-51: Anti: out of scope — there is no retry, redrive, replay, or edit route; the route table lists no mutating verb outside auth, elevation, saved views, and bundles.
- [x] ISC-52: Anti: queue side effects — the queue adapter never calls the broker management `/get` or `/publish` endpoints, so a lookup cannot consume or requeue a message.
- [x] ISC-53: Anti: dependency creep — no `Newtonsoft.Json` and no vendor APM SDK in the dependency graph; `dotnet list package --include-transitive | rg -i "newtonsoft|applicationinsights"` returns empty.
- [x] ISC-54: Anti: telemetry — `rg "google-analytics|sentry|mixpanel|posthog|fullstory" src/` returns zero matches.

## Test Strategy

```yaml
- isc: ISC-2
  type: image-signature
  check: container image signature verifies against the release key
  threshold: cosign exits 0
  tool: cosign verify --key cosign.pub registry.example.org/tracedesk/api:1.0.0

- isc: ISC-3
  type: bundle-size
  check: compressed image and CLI binary size
  threshold: image ≤ 120MB, each CLI ≤ 30MB
  tool: docker manifest inspect registry.example.org/tracedesk/api:1.0.0 | jq '[.layers[].size] | add'

- isc: ISC-9
  type: least-privilege
  check: SQL login holds no write permission
  threshold: every HAS_PERMS_BY_NAME write probe returns 0
  tool: sqlcmd -S $SQL_HOST -U tracedesk_ro -Q "SELECT HAS_PERMS_BY_NAME(DB_NAME(),'DATABASE','INSERT'), HAS_PERMS_BY_NAME(DB_NAME(),'DATABASE','UPDATE'), HAS_PERMS_BY_NAME(DB_NAME(),'DATABASE','DELETE')"

- isc: ISC-14
  type: adapter-integration
  check: temporal query returns ordered state transitions for the fixture transaction
  threshold: 4 rows, ValidFrom strictly ascending, final State = 'Held'
  tool: dotnet test tests/TraceDesk.Adapters.Tests --filter "FullyQualifiedName~TemporalHistoryTests"

- isc: ISC-21
  type: startup-guard
  check: API refuses to start against a database with a newer schema_version
  threshold: exit code != 0 and message names both versions
  tool: dotnet run --project src/TraceDesk.Api -- --connection "$STALE_SCHEMA_DB"

- isc: ISC-23
  type: lookup-latency
  check: paste-to-rendered-timeline p95 against the seeded staging stack
  threshold: ≤ 3000ms
  tool: dotnet run --project tools/LoadProbe -- --runs 200 --ids fixtures/correlation-ids.txt

- isc: ISC-27
  type: performance
  check: 60fps scroll with a 5,000-event timeline
  threshold: median frame time ≤ 16.6ms
  tool: Chrome DevTools performance recorder on fixtures/timeline-5000.json

- isc: ISC-28
  type: interaction-latency
  check: filter toggle to repaint p95
  threshold: ≤ 100ms
  tool: npx playwright test e2e/filter-latency.spec.ts --repeat-each 200

- isc: ISC-29
  type: masking-recall
  check: masker recall over the labelled corpus
  threshold: ≥ 99.5% recall, 0 Luhn-valid PANs unmasked
  tool: dotnet test tests/TraceDesk.Masking.Tests --filter "Category=Corpus"

- isc: ISC-42
  type: bundle-integrity
  check: a bundle with one flipped byte fails signature verification
  threshold: tracedesk open exits 3 with "signature invalid"
  tool: tracedesk open fixtures/tampered.tdbundle

- isc: ISC-50
  type: anti-probe
  check: seeded canary values across responses, logs, and audit rows
  threshold: 0 occurrences
  tool: bun run scripts/canary-sweep.ts --env staging --roles viewer,oncall

- isc: ISC-52
  type: anti-side-effect
  check: queue adapter source contains no consuming or publishing calls
  threshold: 0 matches
  tool: rg "/api/queues/.*/get|/api/exchanges/.*/publish" src/TraceDesk.Adapters/

- isc: ISC-53
  type: anti-dep
  check: no banned packages in the dependency graph
  threshold: empty match
  tool: dotnet list package --include-transitive | rg -i "newtonsoft|applicationinsights"

- isc: ISC-54
  type: anti-telemetry
  check: no third-party telemetry SDK strings in source
  threshold: 0 matches
  tool: rg "google-analytics|sentry|mixpanel|posthog|fullstory" src/
```

## Features

```yaml
- name: AdapterGateway
  description: Loki query_range client and gateway JSON log parser with derived time window
  satisfies: [ISC-7, ISC-8, ISC-12, ISC-16, ISC-17]
  depends_on: []
  parallelizable: true

- name: AdapterTraces
  description: Tempo trace fetch and RabbitMQ span-to-hop mapping, including dead-letter hops
  satisfies: [ISC-13, ISC-15, ISC-16, ISC-17]
  depends_on: []
  parallelizable: true

- name: AdapterDatabase
  description: SQL Server temporal-table reader with read-only login enforcement and heuristic-source flag
  satisfies: [ISC-9, ISC-10, ISC-14, ISC-16, ISC-17]
  depends_on: []
  parallelizable: true

- name: PiiMasker
  description: Boundary masking for IBAN, PAN, email, phone, and national ID with per-lookup HMAC tokens
  satisfies: [ISC-29, ISC-30, ISC-31, ISC-32, ISC-50]
  depends_on: []
  parallelizable: true

- name: AuditStore
  description: Postgres schema, monthly partitions, outbox, and fail-closed audit writes
  satisfies: [ISC-18, ISC-19, ISC-20, ISC-21, ISC-33, ISC-35, ISC-36]
  depends_on: []
  parallelizable: false

- name: AuthRbac
  description: OIDC PKCE and device-code sign-in, group-to-role mapping, secret lint
  satisfies: [ISC-11, ISC-37, ISC-38, ISC-40]
  depends_on: [AuditStore]
  parallelizable: false

- name: BreakGlass
  description: Time-boxed unmasking elevation with ticket check, rate limit, and on-call webhook
  satisfies: [ISC-34, ISC-39]
  depends_on: [AuthRbac, AuditStore, PiiMasker]
  parallelizable: false

- name: TraceView
  description: Merged timeline, service-path diagram, filters, and event drill-down
  satisfies: [ISC-23, ISC-24, ISC-25, ISC-26, ISC-27, ISC-28, ISC-51]
  depends_on: [AdapterGateway, AdapterTraces, AdapterDatabase, PiiMasker, AuditStore]
  parallelizable: false

- name: CliDoctor
  description: CLI lookup, export, and doctor command for first-run verification
  satisfies: [ISC-5, ISC-6, ISC-7, ISC-22]
  depends_on: [AdapterGateway, AdapterTraces, AdapterDatabase]
  parallelizable: true

- name: TraceBundles
  description: Signed, expiring, masked offline bundles with revocation
  satisfies: [ISC-41, ISC-42, ISC-43, ISC-44, ISC-45]
  depends_on: [AuthRbac, PiiMasker]
  parallelizable: false

- name: Distribution
  description: Container and CLI build pipeline, signing, SBOM, release notice
  satisfies: [ISC-1, ISC-2, ISC-3, ISC-4, ISC-46, ISC-47, ISC-53]
  depends_on: []
  parallelizable: true

- name: Diagnostics
  description: Support bundle and opt-in allow-listed self-telemetry
  satisfies: [ISC-48, ISC-49, ISC-52, ISC-54]
  depends_on: [AuditStore]
  parallelizable: true
```

## Decisions

- 2026-01-15 17:00: Static Preact UI served by the ASP.NET Core API over Blazor WebAssembly, because the bundle budget (≤ 180KB gzipped) is impossible with the Blazor WASM runtime baseline (~2MB) and because on-call engineers open this tool over a VPN link where cold-start time is the whole experience.
- 2026-01-22 11:00: PostgreSQL for TraceDesk's own state rather than reusing SQL Server, because append-only monthly-partitioned audit is natural in Postgres and because a tool that inspects the SQL Server estate must not share a failure domain with it.
- 2026-02-04 14:30: ❌ DEAD END: Tried querying Loki, Tempo, and SQL Server sequentially to keep the merge logic simple. Result: one slow Loki response pushed lookup p95 to 4.1 seconds, past ISC-23, and a hung Tempo connection blocked the whole request. Reverted to `Task.WhenAll` over per-adapter calls with linked 5-second cancellation tokens and isolated `HttpClient` pools. Don't retry.
- 2026-02-19 09:00: refined: ISC-20 retention split — original "keep every audit row indefinitely" was naive; monthly partitions with a 13-month drop is the shape that satisfies the annual access review without unbounded growth.
- 2026-03-02 22:15: ❌ DEAD END: Tried masking in the web UI so the API could stay a thin pass-through. A reviewer exported a HAR file from the browser and it contained raw IBANs from the network tab. Moved masking to the adapter boundary on the server. Don't retry.
- 2026-03-14 16:00: Trace bundles deferred from v1 to v1.1 — a file that leaves the service changes the threat model (forwarding, retention, key revocation), and shipping the read-only online tool first is more honest than shipping the export path beside it.
- 2026-03-29 13:00: refined: ISC-50 sharpened from "responses contain no PII" to "seeded canary values never appear in any response, log, or audit row" after review found a card number inside a Tempo span attribute `exception.message` from a validation failure, which the field-level masker had skipped. The masker now runs on exception text and all free-text attributes.
- 2026-04-10 19:30: The legacy settlement database kept in v1 as a `heuristic` source rather than dropped, because it holds the data support needs most for stuck bank transfers. The "approximate match" badge and the explicit opt-in in ISC-10 are the honest compromise.
- 2026-04-22 10:00: refined: ISC-3 image target tightened from 200MB to 120MB after moving the base image from the Debian `aspnet:8.0` variant to the chiseled Ubuntu one; the original 200MB target was generous.

## Changelog

- 2026-02-04 | conjectured: Querying the three sources one after another will keep the merge simple without a measurable cost
  refuted by: a slow Loki response pushed lookup p95 to 4.1 seconds, and a hung Tempo connection stalled the entire request
  learned: sequential I/O across independent backends turns the slowest source's worst day into every request's latency
  criterion now: ISC-16 added — a timed-out source degrades to a `partial` marker instead of failing the lookup; ISC-17 split into Loki/Tempo (≤ 800ms) and SQL (≤ 300ms) budgets; adapters run in parallel with isolated clients

- 2026-02-22 | conjectured: A fixed ±15 minute window around the first gateway timestamp captures every hop of a transaction
  refuted by: a settlement flow that dead-lettered and retried arrived 40 minutes after the gateway request, and the database rows from the retry were missing from the timeline
  learned: the window must follow the transaction's own span extents, not the first event's clock
  criterion now: ISC-12 sharpened — window derived from known span extents, default ±15 minutes, hard cap 24 hours

- 2026-03-02 | conjectured: Masking in the browser is enough, because the screen is what a person sees
  refuted by: a HAR export taken for a bug report contained raw IBANs and a card number straight from the API response
  learned: anything the server sends unmasked is on the network, in caches, and in files, whatever the UI shows
  criterion now: ISC-30 added — masking is server-side and unmasked values require an active elevation; ISC-29 now measures masker recall against the corpus

- 2026-03-29 | conjectured: Masking known PII fields by name covers the data TraceDesk shows
  refuted by: a canary sweep found a card number inside the free-text `exception.message` of a Tempo span, a field no mask rule named
  learned: PII hides in free text and exception messages; masking must be pattern-based on content, and the audit must check outputs, not just rules
  criterion now: ISC-32 added for free-text and exception fields; ISC-50 sharpened from "no PII in responses" to canary values absent from every response, log, and audit row

## Verification

- ISC-2: `cosign verify --key cosign.pub registry.example.org/tracedesk/api:1.0.0` — `Verification for registry.example.org/tracedesk/api:1.0.0 -- The cosign claims were validated`
- ISC-3: `docker manifest inspect ... | jq` — `api 97 MB`; `du -m dist/tracedesk-linux-x64` — `24M`; `dist/tracedesk-osx-arm64` — `22M`; `dist/tracedesk-win-x64.exe` — `26M`
- ISC-9: `sqlcmd ... HAS_PERMS_BY_NAME` probe as `tracedesk_ro` — `0  0  0`
- ISC-14: `TemporalHistoryTests` against the seeded fixture — 4 rows, `Pending → Authorised → Held`, ValidFrom strictly ascending
- ISC-23: LoadProbe, 200 runs on the seeded staging stack — p95 paste-to-render 2,140ms
- ISC-27: DevTools recorder, 5,000-event fixture on a 2019 laptop with 8GB RAM — median frame time 13.8ms during scroll
- ISC-28: Playwright `filter-latency.spec.ts`, 200 repeats — p95 filter-to-repaint 64ms
- ISC-29: `dotnet test --filter Category=Corpus` — recall 99.8% over 200 samples, 0 Luhn-valid PANs unmasked
- ISC-50: `canary-sweep.ts --env staging --roles viewer,oncall` — 0 occurrences across 1,840 responses, 11,206 log lines, and 612 audit rows
- ISC-52: `rg "/api/queues/.*/get|/api/exchanges/.*/publish" src/TraceDesk.Adapters/` — empty
- ISC-53: `dotnet list package --include-transitive | rg -i "newtonsoft|applicationinsights"` — empty
- ISC-54: `rg "google-analytics|sentry|mixpanel|posthog|fullstory" src/` — empty
