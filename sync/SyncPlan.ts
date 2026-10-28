#!/usr/bin/env bun
/**
 * SyncPlan — three-way plan for porting an upstream LifeOS release into WorkOS.
 *
 * WorkOS is a renamed, hand-edited fork, so upstream trees are never compared raw.
 * Each upstream blob is first renamed the way the fork was (sync/rename.json), giving:
 *
 *   base   = the upstream release WorkOS currently matches (sync/upstream.json "base"), renamed
 *   target = the upstream release being brought in (--target), renamed
 *   local  = the WorkOS payload in this repository (WorkOS/install)
 *
 * Every path in base ∪ target ∪ local lands in exactly ONE class, and the tool asserts
 * that the class counts sum to the number of paths. "Done" means zero PENDING.
 * Paths matched by sync/scope.json are SKIPPED (done) with their recorded reason.
 *
 * Reads only by default. --apply writes TAKE / ADD / MERGE-CLEAN files into WorkOS/install
 * and refuses unless that tree is clean in git, so git is the backup. Nothing is ever
 * deleted, pushed or fetched unless asked (--fetch is the only network call).
 *
 * Derived from the principal's private _LIFEOSSYNC SyncPlan (2026-10), retargeted at a
 * renamed fork: rename-aware trees, a scope file, repo-local decisions, git as the backup.
 */
import { createHash } from "node:crypto";
import { existsSync, lstatSync, mkdirSync, mkdtempSync, readdirSync, readFileSync, rmSync, writeFileSync, chmodSync } from "node:fs";
import { dirname, join, resolve } from "node:path";
import { tmpdir } from "node:os";
import { spawnSync } from "node:child_process";

const HELP = `SyncPlan — three-way plan for porting an upstream LifeOS release into WorkOS

Usage:
  bun sync/SyncPlan.ts --target <tag> [--base <tag>] [--upstream <clone>] [--root <repo>]
                       [--list CLASS[,CLASS]] [--only <path-prefix>] [--by-dir] [--json]
                       [--diff <path>] [--apply]
                       [--resolve <path> --as keep-local|take-upstream|accept-delete|skip --reason "<why>"]
                       [--mark-base] [--fetch]

  --target TAG     upstream release to bring in (default: newest tag in the clone)
  --base TAG       release WorkOS matches (default: sync/upstream.json "base")
  --upstream DIR   upstream clone (default: sync/upstream.json "clone", relative to the repo)
  --root DIR       WorkOS repository root (default: the parent of this file's folder)
  --fetch          git fetch --tags in the clone first (the only network call)
  --list CLASSES   print the paths in these classes
  --only PREFIX    restrict to paths under PREFIX (WorkOS-side, e.g. hooks/ or WORKOS/TOOLS/)
  --by-dir         per-area counts of pending paths
  --json           machine-readable plan
  --diff PATH      show base→target (upstream change) and base→local (WorkOS change) for one path
  --apply          write TAKE, ADD, MERGE-CLEAN files (refuses unless WorkOS/install is clean in git)
  --resolve PATH --as D --reason R   record a decision for a pending path in sync/decisions.json
                   (take-upstream also writes the renamed target file)
  --mark-base      set sync/upstream.json "base" to the target; refuses while anything is pending

Classes (done):
  UNCHANGED        base = target = local, or absent from target and local
  KEEP             only WorkOS changed (a local edit), left alone
  ALREADY          WorkOS already equals the target
  LOCAL-ONLY       exists only in WorkOS
  FORK-REMOVED     WorkOS removed it at the fork and upstream did not change it
  SKIPPED          matched by sync/scope.json (reason recorded there)
  RESOLVED         a decision in sync/decisions.json covers this exact local content and target
Classes (pending, marked *):
  TAKE*            only upstream changed, safe to write the renamed target
  ADD*             new upstream, absent in WorkOS
  MERGE-CLEAN*     both changed, git merge-file merges without conflict
  CONFLICT*        both changed and the merge conflicts (or binary, or deleted upstream but edited in WorkOS)
  UPSTREAM-DELETED* removed upstream, unchanged in WorkOS; never deleted automatically
  MISSING*         WorkOS removed it at the fork but upstream changed it since

Exit: 0 nothing pending · 10 pending items remain · 2 usage/config error · 3 git failure
`;

const DONE = ["UNCHANGED", "KEEP", "ALREADY", "LOCAL-ONLY", "FORK-REMOVED", "SKIPPED", "RESOLVED"];
const PENDING_LIST = ["TAKE", "ADD", "MERGE-CLEAN", "CONFLICT", "UPSTREAM-DELETED", "MISSING"];
const ORDER = [...DONE, ...PENDING_LIST];
const PENDING = new Set(PENDING_LIST);
const DECISIONS = new Set(["keep-local", "take-upstream", "accept-delete", "skip"]);
const SKIP_DIRS = new Set(["node_modules", ".git"]);

const argv = process.argv.slice(2);
const flag = (n: string) => { const i = argv.indexOf(n); return i >= 0 && i + 1 < argv.length && !argv[i + 1].startsWith("--") ? argv[i + 1] : undefined; };
const has = (n: string) => argv.includes(n);
const die = (msg: string, code = 2): never => { process.stderr.write(msg + "\n"); process.exit(code); };
if (has("--help") || has("-h")) { process.stdout.write(HELP); process.exit(0); }

// ── config ──
const root = resolve(flag("--root") ?? join(import.meta.dir, ".."));
const syncDir = join(root, "sync");
const readJson = <T>(name: string): T => {
  const p = join(syncDir, name);
  if (!existsSync(p)) die(`missing ${p}`);
  try { return JSON.parse(readFileSync(p, "utf8")) as T; } catch (e) { return die(`${p}: ${(e as Error).message}`); }
};
type UpstreamCfg = { clone: string; payload: string; local: string; base: string };
type RenameCfg = { text: [string, string][]; paths: [string, string][]; moves: Record<string, string> };
type ScopeRule = { group: string; pattern: string; reason: string };
type Decision = { as: string; target: string; localSha: string | null; reason: string; at: string };
const cfg = readJson<UpstreamCfg>("upstream.json");
const ren = readJson<RenameCfg>("rename.json");
const scope = readJson<{ exclude: ScopeRule[] }>("scope.json");
const decisionsPath = join(syncDir, "decisions.json");
const decisions = readJson<Record<string, Decision>>("decisions.json");

const upstream = resolve(root, flag("--upstream") ?? cfg.clone);
const payload = cfg.payload.replace(/\/$/, "");
const local = join(root, cfg.local);
if (!existsSync(join(upstream, ".git"))) die(`not a git clone: ${upstream}`);
if (!existsSync(local)) die(`no WorkOS payload at ${local}`);

function git(dir: string, ...a: string[]): string {
  const r = spawnSync("git", ["-C", dir, ...a], { encoding: "utf8", maxBuffer: 512 * 1024 * 1024 });
  if (r.status !== 0) die(`git ${a.join(" ")} failed: ${r.stderr.trim()}`, 3);
  return r.stdout;
}

if (has("--fetch")) git(upstream, "fetch", "--tags", "--quiet");
const tags = git(upstream, "tag", "--sort=-v:refname").split("\n").filter(Boolean);
const base = flag("--base") ?? cfg.base;
const target = flag("--target") ?? tags[0] ?? die("no tags in the upstream clone");
for (const t of [base, target]) if (spawnSync("git", ["-C", upstream, "rev-parse", "--verify", "--quiet", `${t}^{commit}`]).status !== 0) die(`ref ${t} not in ${upstream}. Try --fetch.`);

// ── rename ──
const sub = (s: string, rules: [string, string][]) => rules.reduce((a, [f, t]) => a.split(f).join(t), s);
const moves = Object.fromEntries(Object.entries(ren.moves ?? {}).filter(([k]) => !k.startsWith("$")));
function mapPath(p: string): string { const m = sub(p, ren.paths); return moves[m] ?? m; }
const isBinary = (b: Buffer) => b.includes(0);
function mapContent(b: Buffer): Buffer { return isBinary(b) ? b : Buffer.from(sub(b.toString("utf8"), ren.text), "utf8"); }

// ── scope ──
const globRe = (pat: string) => new RegExp("^" + pat.replace(/[.+^${}()|[\]\\]/g, "\\$&").replace(/\*\*/g, "\u0000").replace(/\*/g, "[^/]*").replace(/\u0000/g, ".*") + (pat.endsWith("/") ? "" : "$"));
const rules = scope.exclude.map((r) => ({ ...r, re: globRe(r.pattern) }));
const skipRule = (p: string) => rules.find((r) => r.re.test(p));

// ── trees ──
const blobHash = (buf: Buffer) => createHash("sha1").update(`blob ${buf.length}\0`).update(buf).digest("hex");
type Entry = { hash: string; mode: string; content: Buffer; src: string };

function treeAt(ref: string): Map<string, Entry> {
  const rows: { mode: string; sha: string; rel: string }[] = [];
  for (const line of git(upstream, "ls-tree", "-r", ref, "--", payload).split("\n")) {
    const m = /^(\d+) (\w+) ([0-9a-f]+)\t(.+)$/.exec(line);
    if (!m || m[2] !== "blob" || m[1] === "120000") continue; // symlinks are not synced
    const rel = m[4].slice(payload.length + 1);
    if (rel.split("/").some((s) => SKIP_DIRS.has(s))) continue;
    rows.push({ mode: m[1], sha: m[3], rel });
  }
  // One cat-file --batch call for the whole tree.
  const r = spawnSync("git", ["-C", upstream, "cat-file", "--batch"], { input: rows.map((x) => x.sha).join("\n") + "\n", maxBuffer: 1024 * 1024 * 1024 });
  if (r.status !== 0) die(`git cat-file --batch failed for ${ref}`, 3);
  const out = r.stdout as Buffer;
  const tree = new Map<string, Entry>();
  let off = 0;
  for (const row of rows) {
    const nl = out.indexOf(10, off);
    const header = out.subarray(off, nl).toString();
    const size = Number(header.split(" ")[2]);
    if (!Number.isFinite(size)) die(`unexpected cat-file header for ${row.rel}: ${header}`, 3);
    const raw = out.subarray(nl + 1, nl + 1 + size);
    off = nl + 1 + size + 1;
    const content = mapContent(Buffer.from(raw));
    tree.set(mapPath(row.rel), { hash: blobHash(content), mode: row.mode, content, src: row.rel });
  }
  return tree;
}

const localFiles = new Map<string, string>();
function walk(rel: string) {
  const abs = rel ? join(local, rel) : local;
  let st; try { st = lstatSync(abs); } catch { return; }
  if (st.isSymbolicLink()) return;
  if (st.isDirectory()) { for (const n of readdirSync(abs)) if (!SKIP_DIRS.has(n) && n !== ".DS_Store") walk(rel ? `${rel}/${n}` : n); return; }
  if (st.isFile()) localFiles.set(rel, blobHash(readFileSync(abs)));
}
walk("");

const B = treeAt(base), T = treeAt(target);

// ── classify ──
const tmp = mkdtempSync(join(tmpdir(), "workos-syncplan-"));
function mergeClean(path: string, b: Entry, t: Entry): Buffer | null {
  const lb = readFileSync(join(local, path));
  if ([lb, b.content, t.content].some(isBinary)) return null; // binary: never auto-merge
  const [fl, fb, ft] = ["l", "b", "t"].map((n) => join(tmp, n));
  writeFileSync(fl, lb); writeFileSync(fb, b.content); writeFileSync(ft, t.content);
  const r = spawnSync("git", ["merge-file", "-p", fl, fb, ft], { maxBuffer: 64 * 1024 * 1024 });
  return r.status === 0 ? (r.stdout as Buffer) : null;
}

const onlyPrefix = flag("--only");
const universe = [...new Set([...B.keys(), ...T.keys(), ...localFiles.keys()])].filter((p) => !onlyPrefix || p.startsWith(onlyPrefix)).sort();
const plan = new Map<string, string>();
const skipReason = new Map<string, string>();
const merged = new Map<string, Buffer>();
for (const p of universe) {
  const b = B.get(p), t = T.get(p), l = localFiles.get(p) ?? null;
  let cls: string;
  const rule = skipRule(p);
  if (rule) { cls = "SKIPPED"; skipReason.set(p, `${rule.group}: ${rule.reason}`); }
  else if (l === null) cls = !t ? "UNCHANGED" : !b ? "ADD" : b.hash === t.hash ? "FORK-REMOVED" : "MISSING";
  else if (!t) cls = !b ? "LOCAL-ONLY" : l === b.hash ? "UPSTREAM-DELETED" : "CONFLICT";
  else if (!b) cls = l === t.hash ? "ALREADY" : "CONFLICT";
  else if (l === t.hash) cls = b.hash === t.hash ? "UNCHANGED" : "ALREADY";
  else if (l === b.hash) cls = "TAKE";
  else if (b.hash === t.hash) cls = "KEEP";
  else {
    const m = mergeClean(p, b, t);
    // Merging again yields the local file itself: the WorkOS edit already sits on top of target.
    if (m && blobHash(m) === l) cls = "ALREADY";
    else if (m) { cls = "MERGE-CLEAN"; merged.set(p, m); } else cls = "CONFLICT";
  }
  const d = decisions[p];
  if (PENDING.has(cls) && d && d.target === target && d.localSha === l) cls = "RESOLVED";
  plan.set(p, cls);
}
rmSync(tmp, { recursive: true, force: true });

const counts: Record<string, number> = Object.fromEntries(ORDER.map((c) => [c, 0]));
for (const c of plan.values()) counts[c]++;
const total = Object.values(counts).reduce((a, b) => a + b, 0);
if (total !== universe.length) die(`INVARIANT BROKEN: classes sum to ${total}, universe is ${universe.length}`, 3);
const pending = [...plan.values()].filter((c) => PENDING.has(c)).length;

// Rename fidelity: of the files WorkOS shares with the base, how many match the renamed base exactly.
let shared = 0, fidelity = 0;
for (const [p, l] of localFiles) { const b = B.get(p); if (b && !skipRule(p)) { shared++; if (b.hash === l) fidelity++; } }

// ── --diff ──
const diffPath = flag("--diff");
if (diffPath) {
  const b = B.get(diffPath), t = T.get(diffPath);
  const show = (label: string, a: Buffer | null, z: Buffer | null) => {
    const d = mkdtempSync(join(tmpdir(), "workos-syncdiff-"));
    writeFileSync(join(d, "a"), a ?? ""); writeFileSync(join(d, "z"), z ?? "");
    const r = spawnSync("git", ["diff", "--no-index", "--no-color", join(d, "a"), join(d, "z")], { encoding: "utf8", maxBuffer: 64 * 1024 * 1024 });
    rmSync(d, { recursive: true, force: true });
    process.stdout.write(`### ${label}\n${r.stdout.split("\n").slice(4).join("\n") || "(identical)"}\n`);
  };
  const lb = existsSync(join(local, diffPath)) ? readFileSync(join(local, diffPath)) : null;
  process.stdout.write(`${diffPath}: ${plan.get(diffPath) ?? "(not in universe)"}${skipReason.has(diffPath) ? ` (${skipReason.get(diffPath)})` : ""}\n` +
    `  upstream: ${b ? `${base}:${b.src}` : "-"} → ${t ? `${target}:${t.src}` : "-"}\n\n`);
  show(`upstream change (${base} → ${target}, renamed)`, b?.content ?? null, t?.content ?? null);
  show(`WorkOS change (${base} renamed → WorkOS)`, b?.content ?? null, lb);
  process.exit(0);
}

// ── writes ──
function requireCleanTree() {
  const st = spawnSync("git", ["-C", root, "status", "--porcelain", "--", cfg.local], { encoding: "utf8" });
  if (st.status !== 0) die(`${root} is not a git repository; refusing to write without git as the backup`);
  if (st.stdout.trim()) die(`refusing: ${cfg.local} has uncommitted changes. Commit or stash first, so git is the backup.`);
}
function write(p: string, content: Buffer, mode: string) {
  const abs = join(local, p);
  mkdirSync(dirname(abs), { recursive: true });
  writeFileSync(abs, content);
  if (mode === "100755") chmodSync(abs, 0o755);
}

const resolvePath = flag("--resolve");
if (resolvePath) {
  const as = flag("--as"), reason = flag("--reason");
  if (!as || !DECISIONS.has(as)) die(`--resolve needs --as ${[...DECISIONS].join("|")}`);
  if (!reason) die("--resolve needs --reason \"<why>\" so the decision can be judged later");
  const cls = plan.get(resolvePath);
  if (!cls || !PENDING.has(cls)) die(`${resolvePath} is ${cls ?? "not in the universe"}, nothing to resolve`);
  let localSha = localFiles.get(resolvePath) ?? null;
  if (as === "take-upstream") {
    const t = T.get(resolvePath) ?? die("no upstream version to take (it was deleted upstream; use accept-delete)");
    write(resolvePath, t.content, t.mode);
    localSha = t.hash;
  }
  decisions[resolvePath] = { as, target, localSha, reason, at: new Date().toISOString() };
  const sorted = Object.fromEntries(Object.entries(decisions).sort(([a], [b]) => a.localeCompare(b)));
  writeFileSync(decisionsPath, JSON.stringify(sorted, null, 2) + "\n");
  process.stdout.write(`recorded ${as} for ${resolvePath} (was ${cls}) against ${target}\n`);
  process.exit(0);
}

if (has("--apply")) {
  requireCleanTree();
  let n = 0;
  for (const [p, c] of plan) {
    if (c === "TAKE" || c === "ADD") { const t = T.get(p)!; write(p, t.content, t.mode); n++; }
    else if (c === "MERGE-CLEAN") { write(p, merged.get(p)!, T.get(p)!.mode); n++; }
  }
  process.stdout.write(`applied ${n} file(s) into ${cfg.local}. Review with git diff; re-run without --apply to see what is still pending.\n`);
  process.exit(0);
}

if (has("--mark-base")) {
  if (pending > 0) die(`refusing: ${pending} item(s) still pending against ${target}`, 10);
  if (onlyPrefix) die("refusing: --mark-base needs the whole universe, not --only");
  writeFileSync(join(syncDir, "upstream.json"), JSON.stringify({ ...cfg, base: target }, null, 2) + "\n");
  process.stdout.write(`sync/upstream.json base = ${target}\n`);
  process.exit(0);
}

// ── report ──
const listClasses = (flag("--list") ?? "").split(",").filter(Boolean).map((s) => s.toUpperCase());
const area = (p: string) => { const s = p.split("/"); return s.length <= 2 ? s[0] : s.slice(0, 2).join("/"); };
const byDir = () => {
  const m = new Map<string, Record<string, number>>();
  for (const [p, c] of plan) if (PENDING.has(c)) { const a = area(p); const r = m.get(a) ?? {}; r[c] = (r[c] ?? 0) + 1; m.set(a, r); }
  return [...m].sort((x, y) => Object.values(y[1]).reduce((a, b) => a + b, 0) - Object.values(x[1]).reduce((a, b) => a + b, 0));
};
if (has("--json")) {
  const byClass: Record<string, string[]> = {};
  for (const [p, c] of plan) (byClass[c] ??= []).push(p);
  process.stdout.write(JSON.stringify({ upstream, payload, base, target, local: cfg.local, universe: universe.length, pending, counts,
    fidelity: { shared, identical: fidelity },
    pendingByArea: Object.fromEntries(byDir()),
    paths: listClasses.length ? Object.fromEntries(listClasses.map((c) => [c, byClass[c] ?? []])) : byClass }, null, 2) + "\n");
} else {
  process.stdout.write(`${base} → ${target}   WorkOS: ${cfg.local}${onlyPrefix ? `   only: ${onlyPrefix}` : ""}\n\n`);
  for (const c of ORDER) process.stdout.write(`  ${PENDING.has(c) ? "*" : " "} ${c.padEnd(17)} ${String(counts[c]).padStart(5)}\n`);
  process.stdout.write(`    ${"TOTAL".padEnd(17)} ${String(total).padStart(5)}  (= ${universe.length} paths)\n\n`);
  process.stdout.write(`  rename fidelity: ${fidelity} of ${shared} in-scope files WorkOS shares with ${base} match the renamed upstream exactly\n`);
  process.stdout.write(`\n  PENDING: ${pending}${pending ? "  (not done)" : "  (nothing left to do)"}\n`);
  if (has("--by-dir")) {
    process.stdout.write(`\n  pending by area:\n`);
    for (const [a, r] of byDir()) process.stdout.write(`    ${a.padEnd(36)} ${Object.entries(r).map(([c, n]) => `${c} ${n}`).join(", ")}\n`);
  }
  for (const c of listClasses) {
    process.stdout.write(`\n${c}:\n`);
    for (const [p, cc] of plan) if (cc === c) process.stdout.write(`  ${p}${c === "SKIPPED" ? `   (${skipReason.get(p)})` : ""}\n`);
  }
}
// exitCode, not exit(): exit() can cut off a large piped stdout write before it flushes.
process.exitCode = pending > 0 ? 10 : 0;
