#!/usr/bin/env bun
// BranchDiff — deterministic facts about a branch vs its merge target, for preparing someone to explain and defend it.
// Usage: bun BranchDiff.ts [--branch <name>] [--base <remote/branch>] [--repo <path>] [--json]
// Read-only: runs git log/diff/merge-base only. Never fetches, checks out, or writes.

import { spawnSync } from "node:child_process";

type Kind = "production" | "mock" | "test" | "generated" | "migration" | "config" | "docs";
interface FileChange { path: string; added: number; removed: number; kind: Kind }

const args = process.argv.slice(2);
const flag = (name: string) => {
  const i = args.indexOf(`--${name}`);
  return i >= 0 ? args[i + 1] : undefined;
};
if (args.includes("--help")) {
  console.log("bun BranchDiff.ts [--branch <name>] [--base <remote/branch>] [--repo <path>] [--json]");
  process.exit(0);
}

const repo = flag("repo") ?? process.cwd();
const git = (...a: string[]) => {
  const r = spawnSync("git", ["-C", repo, ...a], { encoding: "utf8", maxBuffer: 64 * 1024 * 1024 });
  return { ok: r.status === 0, out: (r.stdout ?? "").trim(), err: (r.stderr ?? "").trim() };
};

const branch = flag("branch") ?? git("branch", "--show-current").out;
if (!branch) { console.error("No branch given and HEAD is detached."); process.exit(2); }
const tip = git("rev-parse", "--verify", branch).ok ? branch : `origin/${branch}`;
if (!git("rev-parse", "--verify", tip).ok) { console.error(`Branch not found: ${branch}`); process.exit(2); }

// origin/HEAD is often stale or points at an old feature branch, so it is NOT a trusted default.
const BASE_CANDIDATES = ["origin/dev", "origin/develop", "origin/main", "origin/master"];
let base = flag("base");
if (!base) {
  // Pick the candidate whose merge-base is closest to the tip (fewest commits on the branch).
  let best: { name: string; count: number } | undefined;
  for (const c of BASE_CANDIDATES) {
    if (!git("rev-parse", "--verify", c).ok) continue;
    const n = Number(git("rev-list", "--count", `${c}..${tip}`).out);
    if (!best || n < best.count) best = { name: c, count: n };
  }
  base = best?.name;
}
if (!base) { console.error("No base branch found; pass --base."); process.exit(2); }

const mergeBase = git("merge-base", base, tip).out;
const commits = git("log", "--format=%h %s", `${mergeBase}..${tip}`).out.split("\n").filter(Boolean);

const classify = (p: string): Kind => {
  const l = p.toLowerCase();
  if (/(^|\/)(tests?|specs?|__tests__)\/|\.tests?(\.|\/)|testing\.|[._-](test|spec)s?\.[a-z]+$|tests?\.cs$/.test(l)) return "test";
  if (/(^|\/)(mocks?|fakes?|stubs?)\/|mock(data)?\.[a-z]+$/.test(l)) return "mock";
  if (/\/migrations?\/|\.sql$/.test(l)) return "migration";
  if (/\.g\.cs$|\.generated\.|\.designer\.cs$|openapi.*\.json$|api\.json$|swagger.*\.json$|\.lock$|lock\.json$/.test(l)) return "generated";
  if (/\.(md|txt|adoc)$/.test(l)) return "docs";
  if (/(^|\/)(deploy|\.gitlab|\.github|helm|k8s|docker)|dockerfile|\.ya?ml$|appsettings.*\.json$|\.csproj$|\.sln$|nuget\.config$|\.props$|\.targets$/.test(l)) return "config";
  return "production";
};

const files: FileChange[] = git("diff", "--numstat", mergeBase, tip).out.split("\n").filter(Boolean).map((line) => {
  const [a, r, ...rest] = line.split("\t");
  const path = rest.join("\t");
  return { path, added: Number(a) || 0, removed: Number(r) || 0, kind: classify(path) };
});

// Endpoint-shaped lines touched in the diff (ASP.NET attributes, Express/Fastify-style routes, Spring mappings).
const ROUTE = /\[(Http(Get|Post|Put|Patch|Delete)|Route)\b[^\]]*\]|\b(app|router)\.(get|post|put|patch|delete)\(|@(Get|Post|Put|Patch|Delete|Request)Mapping/;
const routeLines = git("diff", "-U0", mergeBase, tip, "--", ...files.filter((f) => f.kind === "production").map((f) => f.path))
  .out.split("\n").filter((l) => /^[+-][^+-]/.test(l) && ROUTE.test(l)).map((l) => l.trim());

// Test cases added/removed in test files (xUnit, NUnit, MSTest, jest/vitest/bun, pytest).
const TEST_CASE = /\[(Fact|Theory|Test|TestCase|TestMethod)\b|^\s*[+-]\s*(it|test)\(|^\s*[+-]\s*def test_/;
const testDiff = git("diff", "-U0", mergeBase, tip, "--", ...files.filter((f) => f.kind === "test").map((f) => f.path)).out.split("\n");
const testsAdded = testDiff.filter((l) => l.startsWith("+") && TEST_CASE.test(l)).length;
const testsRemoved = testDiff.filter((l) => l.startsWith("-") && TEST_CASE.test(l)).length;

const report = { branch, tip, base, mergeBase, commits, files, routeLines, testsAdded, testsRemoved };

if (args.includes("--json")) {
  console.log(JSON.stringify(report, null, 2));
} else {
  console.log(`Branch: ${branch}\nBase:   ${base} (merge-base ${mergeBase.slice(0, 8)})\nCommits: ${commits.length}`);
  commits.forEach((c) => console.log(`  ${c}`));
  for (const kind of ["production", "migration", "mock", "config", "generated", "test", "docs"] as Kind[]) {
    const group = files.filter((f) => f.kind === kind);
    if (!group.length) continue;
    console.log(`\n[${kind}] ${group.length} file(s)`);
    group.forEach((f) => console.log(`  +${f.added} -${f.removed}  ${f.path}`));
  }
  if (routeLines.length) { console.log("\nRoute lines touched:"); routeLines.forEach((l) => console.log(`  ${l}`)); }
  console.log(`\nTest cases: +${testsAdded} / -${testsRemoved} (attribute/call lines in test files)`);
}
