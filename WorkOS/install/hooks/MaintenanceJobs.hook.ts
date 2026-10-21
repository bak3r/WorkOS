#!/usr/bin/env bun
/**
 * @version 2.0.0
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
 * The systemd timers for WorkSweep / CommitmentSweep stay as optional extras;
 * running both is harmless (ledger writes are slug-idempotent).
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
 */

import { appendFileSync, closeSync, existsSync, mkdirSync, openSync, readFileSync, statSync, unlinkSync, writeFileSync, writeSync } from "node:fs";
import { spawn, spawnSync } from "node:child_process";
import { join } from "node:path";
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

export interface Job { name: string; intervalH: number; timeoutMs: number; steps: string[][] }
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
];

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
      for (const step of job.steps) {
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
