# sync — porting upstream LifeOS releases into WorkOS

WorkOS is a renamed, hand-edited fork of LifeOS, so upstream changes cannot be merged with git. This folder is the maintainer tooling for porting them file by file without losing WorkOS's own edits. Nothing here ships in the install payload.

`SyncPlan.ts` compares three trees:

- **base**: the upstream release WorkOS currently matches (`upstream.json` → `base`), renamed;
- **target**: the upstream release being brought in, renamed;
- **local**: `WorkOS/install` in this repository.

"Renamed" means every upstream path and text file is first passed through `rename.json`, the same `LifeOS → WorkOS` substitutions the fork made. So a file WorkOS never edited compares equal to its upstream original.

Every path in the three trees lands in exactly one class, the tool checks that the counts add up, and the sync is done when nothing is pending.

## Files

| File | What it holds |
|---|---|
| `SyncPlan.ts` | The planner (`bun sync/SyncPlan.ts --help`). |
| `SyncPlan.test.ts` | Tests on a small fixture upstream and fork (`bun test sync/`). |
| `upstream.json` | Where the upstream clone is (default `../LifeOS`), its payload folder, and the base release. |
| `rename.json` | Text and path substitutions, plus files the fork moved. |
| `scope.json` | Areas left out, each with a reason: removed at the fork, skipped from 8.761.0, or WorkOS's own lineage. Matches are SKIPPED, which counts as done. |
| `decisions.json` | Per-file decisions for pending paths, each with its reason, the target release and the exact WorkOS content it was made against. |
| `reports/` | Saved plan snapshots, to measure progress against. |

## Classes

Done: `UNCHANGED`, `KEEP` (only WorkOS changed), `ALREADY` (WorkOS already equals the target), `LOCAL-ONLY`, `FORK-REMOVED` (removed at the fork and untouched upstream since), `SKIPPED`, `RESOLVED`.

Pending: `TAKE` (only upstream changed), `ADD` (new upstream), `MERGE-CLEAN` (both changed, merges without conflict), `CONFLICT`, `UPSTREAM-DELETED`, `MISSING` (removed at the fork but changed upstream since).

## Workflow

```bash
bun sync/SyncPlan.ts --target v8.761.0 --by-dir              # counts, pending per area
bun sync/SyncPlan.ts --target v8.761.0 --only hooks/ --list CONFLICT
bun sync/SyncPlan.ts --target v8.761.0 --diff hooks/lib/subagent.ts   # upstream change and WorkOS change
bun sync/SyncPlan.ts --target v8.761.0 --only hooks/ --apply           # TAKE / ADD / MERGE-CLEAN, clean tree only
bun sync/SyncPlan.ts --target v8.761.0 --resolve <path> --as keep-local|take-upstream|accept-delete|skip --reason "<why>"
bun sync/SyncPlan.ts --target v8.761.0 --mark-base            # only when PENDING is 0
```

Rules the tool enforces:

- **Git is the backup.** `--apply` refuses unless `WorkOS/install` has no uncommitted changes. Review every apply with `git diff` before committing.
- **Nothing is deleted.** `UPSTREAM-DELETED` and `accept-delete` only record the decision; removing the file is a separate, explicit commit.
- **Every decision needs a reason.** A decision is tied to the target and to the exact WorkOS file content, so it expires when either changes.
- **Undecided areas stay visible.** Only add an area to `scope.json` once it has been decided; don't add it to make the pending count smaller.

Apply area by area (`--only`), in the phase order of the upgrade plan. A `TAKE` is mechanically safe but not always wanted: an upstream change can depend on new modules WorkOS lacks, so test each area before committing it.

## Starting point

The first plan, v7.40.4 → v8.761.0 against WorkOS 1.0.2, is in `reports/v7.40.4-to-v8.761.0-start.txt`. It has 4,876 paths and 2,608 pending: 1,780 ADD, 331 CONFLICT, 232 TAKE, 146 UPSTREAM-DELETED, 77 MISSING and 42 MERGE-CLEAN.
