import { describe, expect, test } from "bun:test";
import { existsSync, mkdirSync, mkdtempSync, readFileSync, readdirSync, rmSync, symlinkSync, utimesSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { gunzipSync } from "node:zlib";
import { JOBS, dueJobs, parseStamp, pruneObservability, rowTimeMs, type Job } from "./MaintenanceJobs.hook";

const H = 3_600_000;
const D = 24 * H;
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
      "memory-consolidation": 20, "proposal-gc": 20, worksweep: 1, "commitment-sweep": 20, "observability-prune": 20,
    });
  });

  test("the prune is an in-process job with no script step to spawn", () => {
    const prune = JOBS.find((j) => j.name === "observability-prune")!;
    expect(typeof prune.run).toBe("function");
    expect(prune.steps).toEqual([]);
  });
});

// A scratch tree shaped like an install: <base>/WORKOS/MEMORY/OBSERVABILITY, plus neighbours the
// prune must never touch.
const NOW = Date.parse("2026-10-28T12:00:00Z");
function fixture() {
  const base = mkdtempSync(join(tmpdir(), "obs-prune-"));
  const obs = join(base, "WORKOS", "MEMORY", "OBSERVABILITY");
  const state = join(base, "WORKOS", "MEMORY", "STATE");
  mkdirSync(obs, { recursive: true });
  mkdirSync(state, { recursive: true });
  const put = (dir: string, name: string, body: string, ageDays: number) => {
    const p = join(dir, name);
    writeFileSync(p, body);
    const t = (NOW - ageDays * D) / 1000;
    utimesSync(p, t, t);
    return p;
  };
  return { base, obs, state, put, done: () => rmSync(base, { recursive: true, force: true }) };
}
const row = (ageDays: number) => JSON.stringify({ ts: new Date(NOW - ageDays * D).toISOString(), e: "x" }) + "\n";

describe("observability prune", () => {
  test("rowTimeMs reads ts or timestamp, string or number, and rejects the rest", () => {
    expect(rowTimeMs('{"ts":"2026-10-01T00:00:00Z"}')).toBe(Date.parse("2026-10-01T00:00:00Z"));
    expect(rowTimeMs('{"timestamp":1760000000000}')).toBe(1760000000000);
    expect(rowTimeMs('{"no":"time"}')).toBeNull();
    expect(rowTimeMs("not json")).toBeNull();
  });

  test("dry run reports the plan and changes nothing", () => {
    const f = fixture();
    try {
      f.put(f.obs, "old.jsonl", row(60), 45);
      f.put(f.obs, "fresh.jsonl", row(1), 1);
      const r = pruneObservability({ root: f.obs, nowMs: NOW, apply: false });
      expect(r.applied).toBe(false);
      expect(r.archived.map((a) => a.file)).toEqual(["old.jsonl"]);
      expect(readdirSync(f.obs).sort()).toEqual(["fresh.jsonl", "old.jsonl"]);
    } finally { f.done(); }
  });

  test("apply archives a whole stale file as gzip with identical bytes, keeps a fresh one untouched", () => {
    const f = fixture();
    try {
      const body = row(60) + row(50);
      f.put(f.obs, "old.jsonl", body, 45);
      const freshBody = row(40) + row(1); // first row past the window, but the file is live
      const fresh = f.put(f.obs, "tool-activity.jsonl", freshBody, 0.1);
      const r = pruneObservability({ root: f.obs, nowMs: NOW, apply: true });
      expect(r.errors).toEqual([]);
      expect(existsSync(join(f.obs, "old.jsonl"))).toBe(false);
      const gz = join(f.obs, "ARCHIVE", readdirSync(join(f.obs, "ARCHIVE"))[0]);
      expect(gz.endsWith(".gz")).toBe(true);
      expect(gunzipSync(readFileSync(gz)).toString()).toBe(body);
      // the live file: same bytes, never rewritten, reported only
      expect(readFileSync(fresh, "utf8")).toBe(freshBody);
      expect(r.keptFiles).toBe(1);
      expect(r.keptOverWindow).toEqual([{ file: "tool-activity.jsonl", bytes: freshBody.length, firstRowAgeDays: 40 }]);
    } finally { f.done(); }
  });

  test("window boundary: a file written 29 days ago stays, 31 days ago goes; --days is honoured", () => {
    const f = fixture();
    try {
      f.put(f.obs, "a.log", "x\n", 29);
      f.put(f.obs, "b.log", "x\n", 31);
      expect(pruneObservability({ root: f.obs, nowMs: NOW, apply: false }).archived.map((a) => a.file)).toEqual(["b.log"]);
      expect(pruneObservability({ root: f.obs, nowMs: NOW, days: 7, apply: false }).archived.map((a) => a.file)).toEqual(["a.log", "b.log"]);
    } finally { f.done(); }
  });

  test("only top-level log files and numbered rotations are candidates", () => {
    const f = fixture();
    try {
      f.put(f.obs, "rotated.jsonl.1", "x\n", 90);
      f.put(f.obs, "notes.txt", "x\n", 90);
      f.put(f.obs, "state.json", "{}", 90);
      mkdirSync(join(f.obs, "sub"));
      f.put(join(f.obs, "sub"), "deep.jsonl", "x\n", 90);
      const r = pruneObservability({ root: f.obs, nowMs: NOW, apply: true });
      expect(r.archived.map((a) => a.file)).toEqual(["rotated.jsonl.1"]);
      expect(existsSync(join(f.obs, "notes.txt"))).toBe(true);
      expect(existsSync(join(f.obs, "state.json"))).toBe(true);
      expect(existsSync(join(f.obs, "sub", "deep.jsonl"))).toBe(true);
    } finally { f.done(); }
  });

  test("never touches anything outside OBSERVABILITY, including through a symlink", () => {
    const f = fixture();
    try {
      const outside = f.put(f.state, "capabilities.jsonl", "x\n", 90);
      const sibling = f.put(join(f.base, "WORKOS", "MEMORY"), "root.jsonl", "x\n", 90);
      symlinkSync(outside, join(f.obs, "link.jsonl"));
      f.put(f.obs, "old.jsonl", "x\n", 90);
      const r = pruneObservability({ root: f.obs, nowMs: NOW, apply: true });
      expect(r.archived.map((a) => a.file)).toEqual(["old.jsonl"]);
      expect(readFileSync(outside, "utf8")).toBe("x\n");
      expect(readFileSync(sibling, "utf8")).toBe("x\n");
      expect(existsSync(join(f.obs, "link.jsonl"))).toBe(true); // the link itself is left alone too
    } finally { f.done(); }
  });

  test("a symlinked or non-directory ARCHIVE aborts the run without moving anything", () => {
    const f = fixture();
    try {
      f.put(f.obs, "old.jsonl", "x\n", 90);
      mkdirSync(join(f.state, "elsewhere"));
      symlinkSync(join(f.state, "elsewhere"), join(f.obs, "ARCHIVE"));
      const r = pruneObservability({ root: f.obs, nowMs: NOW, apply: true });
      expect(r.errors.length).toBe(1);
      expect(r.archived).toEqual([]);
      expect(existsSync(join(f.obs, "old.jsonl"))).toBe(true);
      expect(readdirSync(join(f.state, "elsewhere"))).toEqual([]);
    } finally { f.done(); }
  });

  test("a second run is a no-op and a repeated stale name does not overwrite an earlier archive", () => {
    const f = fixture();
    try {
      f.put(f.obs, "old.jsonl", "first\n", 45);
      pruneObservability({ root: f.obs, nowMs: NOW, apply: true });
      expect(pruneObservability({ root: f.obs, nowMs: NOW, apply: true }).archived).toEqual([]);
      f.put(f.obs, "old.jsonl", "second\n", 45); // same name, same mtime day
      pruneObservability({ root: f.obs, nowMs: NOW, apply: true });
      const bodies = readdirSync(join(f.obs, "ARCHIVE")).map((n) => gunzipSync(readFileSync(join(f.obs, "ARCHIVE", n))).toString()).sort();
      expect(bodies).toEqual(["first\n", "second\n"]);
    } finally { f.done(); }
  });

  test("a missing OBSERVABILITY directory is not an error", () => {
    const r = pruneObservability({ root: join(tmpdir(), "obs-prune-does-not-exist"), nowMs: NOW, apply: true });
    expect(r.errors).toEqual([]);
    expect(r.archived).toEqual([]);
  });
});
