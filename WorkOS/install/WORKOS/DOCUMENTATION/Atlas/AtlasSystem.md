---
last_updated: 2026-07-22T04:00:00Z
last_updated_by: da
convention: pai-freshness-v1
version: 1.1.4
---

# Atlas — the WorkOS Asset Graph

> **Atlas is a graph-based current-state asset management system.** It maintains the current state of everything in the ecosystem as a queryable graph: repos, projects, systemd services, machines, credentials — one local SQLite system of record, reconciled from sources of authority and queried through the `atlas` CLI. It is the current-state half of the WorkOS thesis made concrete: before you can climb toward an ideal state you need an accurate picture of the state you're in.

Modeled on CNCF Cartography's design (sync-and-expire collectors, per-source observations, first/last-seen stamps on every fact), rebuilt WorkOS-native: TypeScript, bun:sqlite, no server daemon, no Neo4j. Design hardened by a 2026-07-21 audit.

## Where things live

| Piece | Path |
|---|---|
| CLI + store + collectors | `WORKOS/ATLAS/` (`Atlas.ts`, `Store.ts`, `collectors/*.ts`) |
| Database (SQLite, WAL) | `~/.local/state/workos/atlas/atlas.db` — **outside both git repos, by design** |
| Redacted snapshot | `~/.local/state/workos/atlas/snapshot.json` |
| Event hints | `~/.local/state/workos/atlas/events.jsonl` |
| Hint hook | `hooks/AtlasEventCapture.hook.ts` (PostToolUse: Bash, Write, Edit, MultiEdit) |
| Background service | `com.workos.atlas` — systemd --user timer (Linux, 15-min `OnUnitActiveSec`); installed by `WORKOS/ATLAS/InstallAtlas.ts` |
| Tests | `WORKOS/ATLAS/tests/store.test.ts` (sweep invariants) |

## Architecture

**One writer class, one reader artifact.** Collectors are the only thing that writes graph facts. Readers use the exported snapshot, never the live DB. `atlas sql` opens read-only. This keeps the WAL single-writer model honest with zero daemon.

**Observations, not assertions.** Every asset carries per-collector `source_observation` rows — the same domain can be observed by `github` and `projects` at once, on ONE asset (canonical keys like `github:repo:owner/name`). An asset's lifecycle derives from ALL observations: active while any collector still sees it; stale, then expired, only when everyone has stopped. One source going quiet expires that source's observation, never the asset.

**Sync-and-expire with hard gates (the Cartography pattern, plus audit teeth).** Each run stamps what it saw. Sweeping — marking observations unfresh — happens ONLY on a successful, enumeration-complete, `full`-scope run, and only within that collector's own observations. A partial page, an API error, a rate limit → `PARTIAL` run, no sweep, prior state intact. Targeted runs are structurally incapable of expiring anything.

**Two-tier updates: reconciliation is truth, hints are latency.**
- *Reconciliation:* `atlas tick` runs a full sync when the last one is >1h old (the timer fires every 15 min).
- *Hints:* the `AtlasEventCapture` hook watches mutating tool calls (`glab repo` mutations, edits to PROJECTS.md, systemctl ops) and appends `{ts, source}` hints. The next `atlas tick` consumes the hints and runs a *targeted* re-collect of just those sources. **Hints never write facts** — the collector re-pulls truth from the authority. A missed hint costs nothing; the hourly cycle heals.

**No secrets, ever (Anti-claim A1).** No token, key, or cookie value is stored, logged, or exported. Credential-class assets, when added, carry references only, and the snapshot strips their attrs at export. Even value-free, the graph is a map of the estate — hence local-only, outside git, behind full-disk encryption.

## Collectors

| Collector | Source of authority | Produces |
|---|---|---|
| `gitlab` | `glab api --method GET projects?membership=true&simple=true` (paginated, read-only) | repos the user is a member of (archived, last_activity_at) |
| `projects` | `USER/PROJECTS.md` main table | projects; SERVES → domains, DEPLOYED_FROM → repos |
| `systemd` | `~/.config/systemd/user/com.{workos,pai}.*.{service,timer}` (unit files parsed directly, no subprocess) | services, this machine; RUNS_ON edges |
| `secrets` | the incident-response credential registry (`GenerateRegistry.ts --json`) + tier shapes (`DetectCriticalKeys.ts --format json`) | credentials (priority/cadence/vendor/dependencies attrs), orphaned credentials; HOLDS edges from this machine and from the config repo when the env file is tracked in it |

v2 candidates: network devices, credentials that live only at a vendor (OAuth grants, dashboard-issued tokens) — currently invisible to every collector.

## CLI

```
bun ~/.claude/WORKOS/ATLAS/Atlas.ts <cmd>

sync [collector ...]        full reconcile (all collectors default)
sync X --targeted <scope>   scoped upsert-only run (never sweeps)
tick                        events-then-hourly entry (what the timer runs)
status                      per-collector runs + counts
owns <key>                  OWNS closure — what deleting <key> orphans
blast <key>                 inbound operational closure — what relies on <key>
exposed <key>               credentials <key> would leak if compromised (priority-ordered)
stale                       assets no collector sees anymore
insights                    structural metrics (kind/edge census, projects with no repo, stale count)
sql "SELECT ..."            read-only SQL passthrough
export                      rewrite the redacted snapshot
```

**Credentials in the graph (2026-07-24).** Credentials are assets (`kind: credential`); whatever stores one gets a `HOLDS` edge to it. Because `HOLDS` is an operational edge kind, one relationship answers both directions: `atlas exposed <asset>` walks outbound (OWNS+HOLDS) for the incident-response question — *this got compromised, what did it leak* — while `atlas blast credential:X` walks inbound for the rotation question — *what breaks when I rotate this*. Exposure output is priority-ordered, compromise-tier first, and a credential the registry never classified still carries its tier when the shapes match, so the most dangerous entries can't sort to the bottom.

Values never enter the graph. Collectors read names only, and `exportSnapshot()` blanks credential attrs before the snapshot is written.

**Destructive-op doctrine:** `atlas owns`/`atlas blast` are DERIVED EVIDENCE for Algorithm claim 16 — run them for the blast-radius preview, then confirm against the provider's authority API before any delete. Atlas never replaces the authority; the CLI prints this reminder on every owns/blast call.

## What it catches (live examples from first sync)

- **Blast radius:** `atlas owns <key>` lists what deleting an asset would orphan — the query whose absence causes surprise-deletion incidents.
- **Drift:** an asset that stops being observed goes stale visibly (`atlas stale` + lifecycle events) instead of silently vanishing.

## Absence-metric rule

**A metric that claims a thing is unused/orphaned/dead must be built on COMPLETE edge coverage — absence of one edge type is never absence of use.** When adding a new asset type, enumerate every way it can be connected before writing an absence query over it.

## Lineage

Cartography (Lyft → CNCF Sandbox 2024) proved the model: typed nodes/edges, intel modules, sync-and-expire, drift detection. Atlas keeps the model and swaps the substrate — SQLite for Neo4j (the 2026-07-21 audit's concurrency finding: embedded columnar graph engines are single-write-process; SQLite WAL matches the multi-process no-daemon topology), TS collectors for Python modules, recursive CTEs for Cypher.
