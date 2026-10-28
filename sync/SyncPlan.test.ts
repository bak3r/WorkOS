import { afterAll, beforeAll, describe, expect, test } from "bun:test";
import { spawnSync } from "node:child_process";
import { mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync, existsSync } from "node:fs";
import { tmpdir } from "node:os";
import { dirname, join } from "node:path";

const TOOL = join(import.meta.dir, "SyncPlan.ts");
let dir: string, up: string, repo: string;

const sh = (cwd: string, ...a: string[]) => {
  const r = spawnSync("git", ["-C", cwd, ...a], { encoding: "utf8", env: { ...process.env, GIT_AUTHOR_NAME: "t", GIT_AUTHOR_EMAIL: "t@t", GIT_COMMITTER_NAME: "t", GIT_COMMITTER_EMAIL: "t@t" } });
  if (r.status !== 0) throw new Error(`git ${a.join(" ")}: ${r.stderr}`);
  return r.stdout;
};
const put = (root: string, rel: string, body: string) => { mkdirSync(dirname(join(root, rel)), { recursive: true }); writeFileSync(join(root, rel), body); };
const lines = (...xs: string[]) => xs.join("\n") + "\n";
const run = (...a: string[]) => spawnSync("bun", [TOOL, "--root", repo, "--target", "v2", ...a], { encoding: "utf8" });
const plan = () => { const r = run("--json"); return { code: r.status, j: JSON.parse(r.stdout) }; };
const cls = (j: any, p: string) => Object.entries(j.paths as Record<string, string[]>).find(([, ps]) => ps.includes(p))?.[0];

// One upstream with two releases, and a WorkOS repo forked from v1 with local edits.
beforeAll(() => {
  dir = mkdtempSync(join(tmpdir(), "syncplan-test-"));
  up = join(dir, "LifeOS"); repo = join(dir, "WorkOS");
  const P = join(up, "LifeOS/install");
  mkdirSync(P, { recursive: true }); sh(up, "init", "-q");
  const long = (tag: string) => lines("a", "b", "c", "d", "e", "f", "g", tag, "i", "j");
  put(P, "LIFEOS/TOOLS/same.ts", "// LifeOS tool\n");
  put(P, "LIFEOS/TOOLS/take.ts", "v1 LifeOS\n");
  put(P, "LIFEOS/TOOLS/keep.ts", "v1\n");
  put(P, "LIFEOS/TOOLS/merge.ts", long("h"));
  put(P, "LIFEOS/TOOLS/conflict.ts", "line v1\n");
  put(P, "LIFEOS/TOOLS/gone.ts", "removed upstream later\n");
  put(P, "skills/Removed/SKILL.md", "fork removed, upstream untouched\n");
  put(P, "skills/Changed/SKILL.md", "fork removed, upstream changes it\n");
  put(P, "LIFEOS/PULSE/app.ts", "pulse v1\n");
  put(P, "skills/Loop/SKILL.md", "loop LifeOS\n");
  sh(up, "add", "-A"); sh(up, "commit", "-qm", "v1"); sh(up, "tag", "v1");

  put(P, "LIFEOS/TOOLS/take.ts", "v2 LifeOS\n");
  put(P, "LIFEOS/TOOLS/merge.ts", long("H-upstream"));
  put(P, "LIFEOS/TOOLS/conflict.ts", "line upstream\n");
  rmSync(join(P, "LIFEOS/TOOLS/gone.ts"));
  put(P, "skills/Changed/SKILL.md", "fork removed, upstream changed it\n");
  put(P, "LIFEOS/TOOLS/new.ts", "new in LifeOS v2\n");
  put(P, "LIFEOS/PULSE/new.ts", "new pulse\n");
  put(P, "LIFEOS/PULSE/app.ts", "pulse v2\n");
  sh(up, "add", "-A"); sh(up, "commit", "-qm", "v2"); sh(up, "tag", "v2");

  const W = join(repo, "WorkOS/install");
  mkdirSync(W, { recursive: true }); sh(repo, "init", "-q");
  put(repo, "sync/upstream.json", JSON.stringify({ clone: "../LifeOS", payload: "LifeOS/install", local: "WorkOS/install", base: "v1" }));
  put(repo, "sync/rename.json", JSON.stringify({ text: [["LifeOS", "WorkOS"]], paths: [["LIFEOS", "WORKOS"]], moves: { "skills/Loop/SKILL.md": "skills/Iterate/SKILL.md" } }));
  put(repo, "sync/scope.json", JSON.stringify({ exclude: [{ group: "fork-removed", pattern: "WORKOS/PULSE/", reason: "dashboard" }] }));
  put(repo, "sync/decisions.json", "{}\n");
  put(W, "WORKOS/TOOLS/same.ts", "// WorkOS tool\n");
  put(W, "WORKOS/TOOLS/take.ts", "v1 WorkOS\n");
  put(W, "WORKOS/TOOLS/keep.ts", "v1 + WorkOS edit\n");
  put(W, "WORKOS/TOOLS/merge.ts", lines("a-workos", "b", "c", "d", "e", "f", "g", "h", "i", "j"));
  put(W, "WORKOS/TOOLS/conflict.ts", "line workos\n");
  put(W, "WORKOS/TOOLS/gone.ts", "removed upstream later\n");
  put(W, "WORKOS/TOOLS/mine.ts", "WorkOS only\n");
  put(W, "skills/Iterate/SKILL.md", "loop WorkOS\n");
  sh(repo, "add", "-A"); sh(repo, "commit", "-qm", "fork");
});
afterAll(() => rmSync(dir, { recursive: true, force: true }));

describe("SyncPlan", () => {
  test("every path lands in exactly one class, and the expected one", () => {
    const { code, j } = plan();
    expect(code).toBe(10);
    const expected: Record<string, string> = {
      "WORKOS/TOOLS/same.ts": "UNCHANGED",          // equal only after the text rename
      "skills/Iterate/SKILL.md": "UNCHANGED",       // equal only after the move
      "WORKOS/TOOLS/take.ts": "TAKE",
      "WORKOS/TOOLS/keep.ts": "KEEP",
      "WORKOS/TOOLS/merge.ts": "MERGE-CLEAN",
      "WORKOS/TOOLS/conflict.ts": "CONFLICT",
      "WORKOS/TOOLS/gone.ts": "UPSTREAM-DELETED",
      "WORKOS/TOOLS/new.ts": "ADD",
      "WORKOS/TOOLS/mine.ts": "LOCAL-ONLY",
      "skills/Removed/SKILL.md": "FORK-REMOVED",
      "skills/Changed/SKILL.md": "MISSING",
      "WORKOS/PULSE/app.ts": "SKIPPED",
      "WORKOS/PULSE/new.ts": "SKIPPED",
    };
    for (const [p, c] of Object.entries(expected)) expect([p, cls(j, p)]).toEqual([p, c]);
    expect(j.universe).toBe(Object.keys(expected).length);
    expect(Object.values(j.counts as Record<string, number>).reduce((a, b) => a + b, 0)).toBe(j.universe);
    // shared with v1: same, take, keep, merge, conflict, gone, Iterate; identical after rename: same, take, gone, Iterate
    expect(j.fidelity).toEqual({ shared: 7, identical: 4 });
  });

  test("--resolve needs a reason, then the path counts as RESOLVED", () => {
    expect(run("--resolve", "WORKOS/TOOLS/conflict.ts", "--as", "keep-local").status).toBe(2);
    expect(run("--resolve", "WORKOS/TOOLS/keep.ts", "--as", "keep-local", "--reason", "x").status).toBe(2); // not pending
    expect(run("--resolve", "WORKOS/TOOLS/conflict.ts", "--as", "keep-local", "--reason", "WorkOS wording wins").status).toBe(0);
    expect(cls(plan().j, "WORKOS/TOOLS/conflict.ts")).toBe("RESOLVED");
    const d = JSON.parse(readFileSync(join(repo, "sync/decisions.json"), "utf8"));
    expect(d["WORKOS/TOOLS/conflict.ts"]).toMatchObject({ as: "keep-local", target: "v2", reason: "WorkOS wording wins" });
  });

  test("--apply refuses on a dirty tree, then writes renamed TAKE, ADD and MERGE-CLEAN files", () => {
    put(join(repo, "WorkOS/install"), "WORKOS/TOOLS/mine.ts", "dirty\n");
    expect(run("--apply").status).toBe(2);
    sh(repo, "checkout", "--", "WorkOS/install/WORKOS/TOOLS/mine.ts");
    expect(run("--apply").status).toBe(0);
    const W = join(repo, "WorkOS/install");
    expect(readFileSync(join(W, "WORKOS/TOOLS/take.ts"), "utf8")).toBe("v2 WorkOS\n");
    expect(readFileSync(join(W, "WORKOS/TOOLS/new.ts"), "utf8")).toBe("new in WorkOS v2\n");
    expect(readFileSync(join(W, "WORKOS/TOOLS/merge.ts"), "utf8")).toBe(lines("a-workos", "b", "c", "d", "e", "f", "g", "H-upstream", "i", "j"));
    expect(existsSync(join(W, "WORKOS/TOOLS/gone.ts"))).toBe(true); // never deleted
    expect(existsSync(join(W, "WORKOS/PULSE/new.ts"))).toBe(false); // skipped stays out
    const { j } = plan();
    for (const p of ["WORKOS/TOOLS/take.ts", "WORKOS/TOOLS/new.ts", "WORKOS/TOOLS/merge.ts"]) expect(cls(j, p)).toBe("ALREADY");
  });

  test("--mark-base refuses while anything is pending", () => {
    const r = run("--mark-base");
    expect(r.status).toBe(10);
    expect(JSON.parse(readFileSync(join(repo, "sync/upstream.json"), "utf8")).base).toBe("v1");
  });
});
