import { describe, expect, test } from "bun:test";
import { JOBS, dueJobs, parseStamp, type Job } from "./MaintenanceJobs.hook";

const H = 3_600_000;
const jobs: Job[] = [
  { name: "hourly", intervalH: 1, timeoutMs: 1, steps: [] },
  { name: "daily", intervalH: 20, timeoutMs: 1, steps: [] },
];

describe("MaintenanceJobs interval logic", () => {
  test("never-run jobs are due", () => {
    expect(dueJobs(jobs, { jobs: {} }, Date.now())).toEqual(["hourly", "daily"]);
  });

  test("each job is due on its own interval", () => {
    const now = Date.parse("2026-10-21T12:00:00Z");
    const stamp = { jobs: { hourly: { last_start: new Date(now - 2 * H).toISOString() }, daily: { last_start: new Date(now - 2 * H).toISOString() } } };
    expect(dueJobs(jobs, stamp, now)).toEqual(["hourly"]);
    expect(dueJobs(jobs, stamp, now + 18 * H)).toEqual(["hourly", "daily"]);
  });

  test("pre-2.0 stamp (single last_start + exit codes) upgrades without re-running everything", () => {
    const now = Date.parse("2026-10-21T12:00:00Z");
    const old = JSON.stringify({ last_start: new Date(now - 3 * H).toISOString(), jobs: { daily: 0 } });
    const s = parseStamp(old);
    expect(s.jobs.daily.exit).toBe(0);
    expect(dueJobs(jobs, s, now)).toEqual(["hourly"]);
    expect(parseStamp("garbage")).toEqual({ jobs: {} });
  });

  test("shipped schedule", () => {
    expect(Object.fromEntries(JOBS.map((j) => [j.name, j.intervalH]))).toEqual({
      "memory-consolidation": 20, "proposal-gc": 20, worksweep: 1, "commitment-sweep": 20,
    });
  });
});
