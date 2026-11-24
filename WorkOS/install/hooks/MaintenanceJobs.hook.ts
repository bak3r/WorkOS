#!/usr/bin/env bun
/**
 * @version 2.3.0
 * MaintenanceJobs.hook.ts — throttled background maintenance, per-job intervals.
 *
 * PURPOSE:
 * Runs the recurring jobs that used to need cron, launchd or systemd, from
 * SessionStart instead (Docker Sandboxes guarantee no systemd):
 *   1. memory-consolidation (20h): SessionHarvester.ts --recent 20
 *                                  && LearningPatternSynthesis.ts --week
 *   2. proposal-gc          (20h): ProposalGC.ts --auto
 *   3. worksweep             (1h): WorkSweep.ts             (work ledger catch-up)
 *   4. commitment-sweep     (20h): CommitmentSweep.ts       (due/overdue digest)
 *   5. observability-prune  (20h): archive whole stale logs in MEMORY/OBSERVABILITY
 *                                  (in-process, see "OBSERVABILITY PRUNE" below)
 *   6. ledger-compact      (168h): CortexLedger.ts maintain (checkpoint + compact the
 *                                  memory ledger once 200 rows follow its last checkpoint)
 *   7. statusline-refresh    (1h): STATUSLINE/Refresh.ts (the statusline's shared caches;
 *                                  upstream runs it every minute from its Workflows clock)
 * The systemd timers for WorkSweep / CommitmentSweep stay as optional extras;
 * running both is harmless (ledger writes are slug-idempotent).
 *
 * OBSERVABILITY PRUNE (job 5) — the local stand-in for upstream LifeOS 8.761.0's nightly
 * `observability-prune` workflow, which runs LIFEOS/TOOLS/ObservabilityPrune.ts. Upstream
 * archives ROWS older than 30 days (7 for bunker-runs.jsonl) out of every OBSERVABILITY
 * .jsonl of 1 MB or more, rewriting the kept file through Bunker's race-safe window pruner;
 * rows with no parseable ts are kept. This job keeps the 30-day window but NEVER rewrites a
 * file: a top-level *.jsonl / *.log (or rotated *.jsonl.N / *.log.N) whose last write is
 * older than 30 days holds no row newer than that, so the whole file moves to
 * OBSERVABILITY/ARCHIVE/<name>.until-<date>.gz (nothing is deleted). A file that is still
 * being written is left byte-for-byte alone even if its oldest rows are past the window;
 * those are only reported. Nothing outside MEMORY/OBSERVABILITY is touched.
 * Manual: `bun hooks/MaintenanceJobs.hook.ts --prune-observability [--apply] [--days=N]`
 * (dry run unless --apply; point it at another tree with WORKOS_DIR).
 *
 * MODES:
 * - (default)  SessionStart: if any job's interval has elapsed since ITS last
 *              start and no worker holds the lock, spawn this file with --run,
 *              detached and unref'd, then exit immediately. Never blocks.
 * - --run      Worker: take the lock (O_EXCL create), run only the due jobs in
 *              order with per-job timeouts, stamp each job's start/end/exit,
 *              append all output to the log, release the lock.
 *
 * SAFETY:
 * - Single instance: one lock for all jobs; a lock older than LOCK_STALE_H is
 *   treated as a crashed worker and reclaimed.
 * - Each job's stamp is written when that job STARTS, so a failing job is
 *   retried once per its interval, not on every session start.
 * - Exits 0 on every path, including internal errors. Skips subagents.
 *
 * OUTPUTS:
 * - MEMORY/STATE/maintenance-jobs.json   ({ jobs: { <name>: { last_start, last_end, exit } } })
 * - MEMORY/STATE/maintenance-jobs.lock   (present only while a worker runs)
 * - MEMORY/OBSERVABILITY/maintenance-jobs.log (job stdout/stderr, appended)
 * - MEMORY/OBSERVABILITY/ARCHIVE/<name>.until-<date>.gz (whole stale logs, observability-prune)
 * - MEMORY/LEDGER/archive/events-<first>-<last>.jsonl (compacted ledger rows, ledger-compact)
 */

import { appendFileSync, closeSync, existsSync, lstatSync, mkdirSync, openSync, readFileSync, readSync, readdirSync, realpathSync, renameSync, statSync, unlinkSync, writeFileSync, writeSync } from "node:fs";
import { spawn, spawnSync } from "node:child_process";
import { dirname, join } from "node:path";
import { gunzipSync, gzipSync } from "node:zlib";
import { getWorkosDir } from "./lib/paths";
import { resolveBun } from "./lib/resolve-bin";
import { isSubagentContext } from "./lib/subagent";

const LOCK_STALE_H = 2;
const HOUR_MS = 3_600_000;

const WORKOS = getWorkosDir();
const TOOLS = join(WORKOS, "TOOLS");
const STATE_DIR = join(WORKOS, "MEMORY", "STATE");
const LOG_DIR = join(WORKOS, "MEMORY", "OBSERVABILITY");
const STAMP = join(STATE_DIR, "maintenance-jobs.json");
const LOCK = join(STATE_DIR, "maintenance-jobs.lock");
const LOG = join(LOG_DIR, "maintenance-jobs.log");

export interface JobOutcome { code: number | null; summary: string }
// `run` is for a job that is code, not a script: it runs in the worker process, `steps` stays empty.
export interface Job { name: string; intervalH: number; timeoutMs: number; steps: string[][]; run?: () => JobOutcome }
export interface JobStamp { last_start?: string; last_end?: string; exit?: number | null }
export interface StampFile { jobs: Record<string, JobStamp> }

// Each job is a sequence of steps; a step only runs if the previous one exited 0
// (the `&&` semantics of the original schedule).
export const JOBS: Job[] = [
  {
    name: "memory-consolidation",
    intervalH: 20,
    timeoutMs: 600_000,
    steps: [
      [join(TOOLS, "SessionHarvester.ts"), "--recent", "20"],
      [join(TOOLS, "LearningPatternSynthesis.ts"), "--week"],
    ],
  },
  {
    name: "proposal-gc",
    intervalH: 20,
    timeoutMs: 120_000,
    steps: [[join(TOOLS, "ProposalGC.ts"), "--auto"]],
  },
  {
    name: "worksweep",
    intervalH: 1,
    timeoutMs: 120_000,
    steps: [[join(TOOLS, "WorkSweep.ts")]],
  },
  {
    name: "commitment-sweep",
    intervalH: 20,
    timeoutMs: 60_000,
    steps: [[join(TOOLS, "CommitmentSweep.ts")]],
  },
  {
    name: "observability-prune",
    intervalH: 20,
    timeoutMs: 60_000,
    steps: [],
    run: () => runObservabilityPrune(),
  },
  {
    name: "ledger-compact",
    intervalH: 168,
    timeoutMs: 120_000,
    steps: [[join(TOOLS, "CortexLedger.ts"), "maintain"]],
  },
  {
    name: "statusline-refresh",
    intervalH: 1,
    timeoutMs: 60_000,
    steps: [[join(WORKOS, "STATUSLINE", "Refresh.ts")]],
  },
];

// ── observability prune ──────────────────────────────────────────────────────

export const OBS_RETENTION_DAYS = 30;
const DAY_MS = 86_400_000;
// Top-level log files and their rotated segments only; never a directory, never ARCHIVE.
const OBS_LOG_NAME = /^[A-Za-z0-9][A-Za-z0-9._-]*\.(jsonl|log)(\.\d+)?$/;

export interface PruneOptions { root: string; nowMs: number; days?: number; apply: boolean }
export interface PruneReport {
  applied: boolean;
  days: number;
  cutoff: string;
  /** Whole files (planned when dry-run, done when applied) moved to ARCHIVE as .gz. */
  archived: Array<{ file: string; bytes: number; archive: string }>;
  /** Files still being written whose first row is older than the window: reported, never edited. */
  keptOverWindow: Array<{ file: string; bytes: number; firstRowAgeDays: number }>;
  keptFiles: number;
  errors: string[];
}

/** ts/timestamp of one JSONL row as epoch ms; null when absent or unparseable. */
export function rowTimeMs(line: string): number | null {
  try {
    const o = JSON.parse(line);
    const v = o?.ts ?? o?.timestamp;
    const n = typeof v === "number" ? v : typeof v === "string" ? Date.parse(v) : NaN;
    return Number.isFinite(n) ? n : null;
  } catch {
    return null;
  }
}

function firstLine(path: string): string {
  const fd = openSync(path, "r");
  try {
    const buf = Buffer.alloc(8192);
    const n = readSync(fd, buf, 0, buf.length, 0);
    return buf.subarray(0, n).toString("utf8").split("\n")[0] ?? "";
  } finally {
    closeSync(fd);
  }
}

/**
 * Archive whole stale logs under `root` (a MEMORY/OBSERVABILITY directory). Rules:
 *  - only regular, non-symlink files directly in root whose name is *.jsonl, *.log or a
 *    numbered rotation of those; the real path must sit directly in the real root;
 *  - stale = last write more than `days` ago (default 30), so every row in it is older too;
 *  - a stale file is renamed into root/ARCHIVE (atomic, so a writer racing us just starts a
 *    fresh file), gzipped there, read back and size-checked, and only then is the renamed
 *    original unlinked. On any failure the renamed original stays in ARCHIVE as *.pending;
 *  - a file that is not stale is never opened for writing. Rows are never rewritten.
 */
export function pruneObservability(opts: PruneOptions): PruneReport {
  const days = opts.days ?? OBS_RETENTION_DAYS;
  const cutoffMs = opts.nowMs - days * DAY_MS;
  const report: PruneReport = {
    applied: opts.apply, days, cutoff: new Date(cutoffMs).toISOString().slice(0, 10),
    archived: [], keptOverWindow: [], keptFiles: 0, errors: [],
  };
  if (!existsSync(opts.root)) return report;
  const root = realpathSync(opts.root);
  const archiveDir = join(root, "ARCHIVE");
  try {
    const a = lstatSync(archiveDir);
    if (a.isSymbolicLink() || !a.isDirectory()) {
      report.errors.push("ARCHIVE exists but is not a plain directory; nothing was moved");
      return report;
    }
  } catch {}

  for (const name of readdirSync(root).sort()) {
    if (!OBS_LOG_NAME.test(name)) continue;
    const path = join(root, name);
    try {
      const st = lstatSync(path);
      if (!st.isFile()) continue; // symlinks and directories are not ours to move
      if (dirname(realpathSync(path)) !== root) continue;
      if (st.mtimeMs >= cutoffMs) {
        report.keptFiles++;
        const t = st.size > 0 ? rowTimeMs(firstLine(path)) : null;
        if (t !== null && t < cutoffMs) {
          report.keptOverWindow.push({ file: name, bytes: st.size, firstRowAgeDays: Math.floor((opts.nowMs - t) / DAY_MS) });
        }
        continue;
      }
      let dest = join(archiveDir, `${name}.until-${new Date(st.mtimeMs).toISOString().slice(0, 10)}.gz`);
      for (let i = 2; existsSync(dest) || existsSync(`${dest}.pending`); i++) {
        dest = join(archiveDir, `${name}.until-${new Date(st.mtimeMs).toISOString().slice(0, 10)}-${i}.gz`);
      }
      report.archived.push({ file: name, bytes: st.size, archive: `ARCHIVE/${dest.slice(archiveDir.length + 1)}` });
      if (!opts.apply) continue;
      mkdirSync(archiveDir, { recursive: true });
      const pending = `${dest}.pending`;
      renameSync(path, pending);
      try {
        const raw = readFileSync(pending);
        writeFileSync(dest, gzipSync(raw));
        if (gunzipSync(readFileSync(dest)).length !== raw.length) throw new Error("archive read-back size mismatch");
        unlinkSync(pending);
      } catch (e) {
        report.archived.pop();
        report.errors.push(`${name}: ${(e as Error).message}; original kept as ${pending}`);
      }
    } catch (e) {
      report.errors.push(`${name}: ${(e as Error).message}`);
    }
  }
  return report;
}

/** Worker entry: apply the 30-day rule to this install's MEMORY/OBSERVABILITY. */
function runObservabilityPrune(): JobOutcome {
  const r = pruneObservability({ root: LOG_DIR, nowMs: Date.now(), apply: true });
  const mib = (r.archived.reduce((n, a) => n + a.bytes, 0) / 1048576).toFixed(1);
  const over = r.keptOverWindow.length
    ? `; ${r.keptOverWindow.length} active file(s) hold rows past ${r.days}d and are left untouched: ${r.keptOverWindow.map((k) => `${k.file} (${k.firstRowAgeDays}d)`).join(", ")}`
    : "";
  const errs = r.errors.length ? `; errors: ${r.errors.join(" | ")}` : "";
  return { code: r.errors.length ? 1 : 0, summary: `archived ${r.archived.length} file(s) (${mib} MiB, last write before ${r.cutoff}), kept ${r.keptFiles}${over}${errs}` };
}

function log(line: string): void {
  try {
    mkdirSync(LOG_DIR, { recursive: true });
    appendFileSync(LOG, `[${new Date().toISOString()}] ${line}\n`);
  } catch {}
}

/**
 * Read the stamp file. The pre-2.0 shape ({ last_start, jobs: { name: exitCode } })
 * is upgraded in place: its single last_start applies to the jobs it lists, so
 * an upgrade does not re-run every job on the next session start.
 */
export function parseStamp(raw: string): StampFile {
  try {
    const s = JSON.parse(raw);
    const jobs: Record<string, JobStamp> = {};
    for (const [name, v] of Object.entries((s?.jobs ?? {}) as Record<string, unknown>)) {
      if (v && typeof v === "object") jobs[name] = v as JobStamp;
      else jobs[name] = { last_start: s.last_start, last_end: s.last_end, exit: v as number | null };
    }
    return { jobs };
  } catch {
    return { jobs: {} };
  }
}

function readStamp(): StampFile {
  try {
    return parseStamp(readFileSync(STAMP, "utf-8"));
  } catch {
    return { jobs: {} };
  }
}

/** Pure: names of the jobs whose interval has elapsed since their own last start. */
export function dueJobs(jobs: Job[], stamp: StampFile, nowMs: number): string[] {
  return jobs
    .filter((j) => {
      const t = Date.parse(stamp.jobs[j.name]?.last_start ?? "");
      return !Number.isFinite(t) || nowMs - t >= j.intervalH * HOUR_MS;
    })
    .map((j) => j.name);
}

function lockHeld(): boolean {
  try {
    return Date.now() - statSync(LOCK).mtimeMs < LOCK_STALE_H * HOUR_MS;
  } catch {
    return false;
  }
}

/** Exclusive lock create; reclaims a stale lock once. */
function acquireLock(): boolean {
  mkdirSync(STATE_DIR, { recursive: true });
  for (let attempt = 0; attempt < 2; attempt++) {
    try {
      const fd = openSync(LOCK, "wx");
      writeSync(fd, String(process.pid));
      closeSync(fd);
      return true;
    } catch {
      if (attempt === 0 && !lockHeld()) {
        try { unlinkSync(LOCK); } catch {}
        continue;
      }
      return false;
    }
  }
  return false;
}

function runWorker(): void {
  if (!acquireLock()) return; // another worker won the race
  const bun = resolveBun();
  try {
    const stamp = readStamp();
    const due = new Set(dueJobs(JOBS, stamp, Date.now()));
    const save = () => writeFileSync(STAMP, JSON.stringify(stamp, null, 2));
    for (const job of JOBS) {
      if (!due.has(job.name)) continue;
      const entry: JobStamp = { last_start: new Date().toISOString() };
      stamp.jobs[job.name] = entry;
      save();
      let code: number | null = 0;
      if (job.run) {
        log(`${job.name}: in-process`);
        try {
          const out = job.run();
          log(`${job.name}: ${out.summary}`);
          code = out.code;
        } catch (e) {
          log(`${job.name}: ${(e as Error)?.message ?? String(e)}`);
          code = -1;
        }
      }
      for (const step of job.run ? [] : job.steps) {
        if (!existsSync(step[0])) {
          log(`${job.name}: missing ${step[0]}, skipped`);
          code = null;
          break;
        }
        log(`${job.name}: bun ${step.join(" ")}`);
        const r = spawnSync(bun, ["run", ...step], { encoding: "utf-8", timeout: job.timeoutMs, cwd: WORKOS });
        if (r.stdout) log(r.stdout.trimEnd());
        if (r.stderr) log(r.stderr.trimEnd());
        code = r.error ? -1 : r.status;
        if (r.error) log(`${job.name}: ${r.error.message}`);
        if (code !== 0) break;
      }
      entry.exit = code;
      entry.last_end = new Date().toISOString();
      save();
      log(`${job.name}: exit ${code}`);
    }
  } catch (e) {
    log(`worker error: ${(e as Error)?.message ?? String(e)}`);
  } finally {
    try { unlinkSync(LOCK); } catch {}
  }
}

function main(): void {
  if (process.argv.includes("--prune-observability")) {
    const daysArg = process.argv.find((a) => a.startsWith("--days="));
    const days = daysArg ? Number(daysArg.slice("--days=".length)) : OBS_RETENTION_DAYS;
    if (!Number.isFinite(days) || days <= 0) {
      console.error(`bad --days: ${daysArg}`);
      return;
    }
    console.log(JSON.stringify(pruneObservability({ root: LOG_DIR, nowMs: Date.now(), days, apply: process.argv.includes("--apply") }), null, 2));
    return;
  }
  if (process.argv.includes("--run")) {
    runWorker();
    return;
  }
  if (isSubagentContext() || lockHeld() || dueJobs(JOBS, readStamp(), Date.now()).length === 0) return;
  const proc = spawn(resolveBun(), [import.meta.path, "--run"], {
    stdio: "ignore",
    detached: true,
    cwd: WORKOS,
  });
  proc.on("error", (e) => log(`spawn failed: ${e.message}`));
  proc.unref();
}

if (import.meta.main) {
  try {
    main();
  } catch (e) {
    log(`hook error: ${(e as Error)?.message ?? String(e)}`);
  }
  process.exit(0);
}
