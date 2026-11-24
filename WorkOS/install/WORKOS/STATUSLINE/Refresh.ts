#!/usr/bin/env bun
/**
 * The statusline's refresher. It plans every shared refresh from the caches as they stand (today only the Claude Code
 * version, for harnesses that leave it out of stdin), runs the stale ones under one deadline, prints a JSON report, and
 * exits. The statusline itself only reads files. MaintenanceJobs runs it at session start (job `statusline-refresh`),
 * since a Docker Sandbox has no scheduler; it is safe to run by hand at any time.
 *
 * Upstream LifeOS refreshes weather, tide, cosmos, Claude and Codex usage and a GitHub work queue here every minute.
 * WorkOS draws none of those: its WORK row reads the local ledger and the WorkContext cache directly, and LoadContext
 * keeps that cache fresh.
 *
 * A signal releases every lock this process holds before it exits, so a cancelled run never blocks the next one.
 * An InvariantViolation fails the run.
 */
import { buildState, type State } from "./State";
import { releaseHeldLocks, runRefreshes, type RefreshJob, type RefreshReport } from "./producers/Background";
import { harnessVersionRefresh } from "./producers/Versions";

/** Every job is awaited at most this long. */
export const REFRESH_DEADLINE_MS = 45_000;

/** Every stale shared cache's refresh job, planned from the caches as they stand now. */
export function planRefreshes(state: State): RefreshJob[] {
  const jobs: Array<RefreshJob | null> = [
    harnessVersionRefresh(state.cache),
  ];
  return jobs.filter((job): job is RefreshJob => job !== null);
}

export interface RefreshRun extends RefreshReport { planned: string[]; skipped?: string }

/** Plan and run once. `env` and `nowMs` are injectable so tests run against a temp tree. */
export async function refreshOnce(env: Record<string, string | undefined>, nowMs = Date.now(), deadlineMs = REFRESH_DEADLINE_MS): Promise<RefreshRun> {
  // A fixed width keeps buildState from probing the terminal: this process has none.
  const state = buildState("{}", { ...env, COLUMNS: "80" }, nowMs);
  if (state.failClosed) return { planned: [], ran: [], timedOut: [], failed: [], skipped: "install root is not absolute" };
  state.cache.initialize();
  state.cache.sweep();
  const jobs = planRefreshes(state);
  const report = await runRefreshes(jobs, deadlineMs);
  return { planned: jobs.map((job) => job.name), ...report };
}

if (import.meta.main) {
  const stop = (code: number) => (): void => { releaseHeldLocks(); process.exit(code); };
  process.on("SIGTERM", stop(143));
  process.on("SIGHUP", stop(129));
  process.on("SIGINT", stop(130));
  const run = await refreshOnce(process.env);
  process.stdout.write(`${JSON.stringify(run)}\n`);
  // Jobs past the deadline still hold the event loop; their locks were left for the age rule to throttle.
  process.exit(0);
}
