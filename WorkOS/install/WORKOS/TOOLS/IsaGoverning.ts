#!/usr/bin/env bun
/**
 * IsaGoverning — which ISA owns a file, for the code-sync checks (ISASystem.md § Code sync).
 *
 * A file's governing ISA is the nearest ISA.md walking up from it to its git repository root. An ISA whose
 * frontmatter says `code_sync: off` (the WorkOS root spine) owns nothing beneath it, so the walk stops there with
 * no governing ISA. Markdown files (ISAs, docs, CHANGELOG.md) and ISA.html are records, not code; media assets
 * (images, fonts, audio, video, PDF) and files the repo's .gitattributes marks linguist-generated (build outputs) or
 * linguist-documentation (content a site publishes, such as a blog's editorial data) are not code either.
 *
 * LINKED WORKOS ISAs (WorkOS addition, not in upstream). An ISA for an employer repo never lives inside that
 * repo; it lives in WorkOS memory at <WORKOS_DIR>/MEMORY/WORK/<slug>/ISA.md. When the walk above reaches the
 * repo root without finding an ISA.md, the file is governed by a LINKED ISA chosen like this:
 *
 *   Frontmatter contract (read from the ISA's first lines; every value may be quoted):
 *     repo:    REQUIRED to link. The repo root the ISA governs: absolute, or starting with `~` or `$HOME`.
 *              Matched after expansion and realpath against the changed file's git repo root. In a linked
 *              worktree the main checkout's root matches too, so one ISA covers every worktree of a repo.
 *     branch:  optional. The git branch the ISA is for (`feature/ABC-12-login`), exact match.
 *     ticket:  optional. A Jira-style key (`ABC-12`); a list (`[ABC-12, ABC-13]` or `ABC-12, ABC-13`) works.
 *              It matches when the key appears in the current branch name (case-insensitive, via lib/jira-keys).
 *     phase / status: an ISA whose `phase` or `status` is `complete` or `archived` is never chosen.
 *     code_sync: off  the chosen ISA owns nothing: no governing ISA (same meaning as in-repo).
 *
 *   Choice: among the live candidates whose `repo:` matches, take the tier that applies first:
 *     1. `branch:` equals the current branch   2. `ticket:` appears in the current branch name
 *     3. neither `branch:` nor `ticket:` set (the repo-wide ISA)
 *   An ISA that sets `branch:` and/or `ticket:` but fits no tier is out (a non-matching `branch:` can still
 *   match by `ticket:`). Inside the tier the most recently modified ISA.md wins (ties: path order). Complete
 *   and archived ISAs are dropped BEFORE the tier is picked, so a finished branch ISA never hides a live
 *   repo-wide one. No candidate: no governing ISA. `ticket:` is read from one line only (no YAML block lists).
 *
 *   The current branch is read from <repo>/.git/HEAD without spawning git (a `.git` FILE with `gitdir:` is a
 *   linked worktree and is followed). A detached HEAD has no branch, so only tier 3 can match. The WORK
 *   directory is scanned once per process and memoised, because the Stop gate asks once per edited file.
 *
 * One resolver for all the code-sync checks, so they can never disagree about which ISA governs a file:
 *   finish  hooks/IsaCodeSyncGate.hook.ts
 * (upstream also asks from a start-of-edit plugin and a release recorder; WorkOS ships neither.)
 *
 *   bun IsaGoverning.ts <path>      prints {"isa": "<abs path>" | null, "code": true|false}
 *
 * Pure file-system reads; no git process, so it is cheap enough to ask on every edit.
 */
import { closeSync, existsSync, openSync, readFileSync, readSync, readdirSync, realpathSync, statSync } from "node:fs";
import { basename, dirname, isAbsolute, join, resolve } from "node:path";
import { expandPath, getWorkosDir } from "./Paths";
import { extractJiraKeys } from "./lib/jira-keys";

/** Media and binary assets: content a page shows, never behavior an ISA criterion describes. */
const ASSET_EXT = /\.(png|jpe?g|webp|gif|avif|svg|ico|bmp|tiff?|heic|mp4|webm|mov|m4v|mp3|wav|m4a|ogg|flac|pdf|woff2?|ttf|otf|eot)$/;

/** Patterns the repo marks `linguist-generated` (regenerated files) or `linguist-documentation` (content, never behavior)
 *  in its root .gitattributes: the standard flags for files that are not code. */
const NOT_CODE_ATTR = /^linguist-(generated|documentation)(=true)?$/;
function generatedPatterns(repoRoot: string): RegExp[] {
  let text = "";
  try { text = readFileSync(join(repoRoot, ".gitattributes"), "utf8"); } catch { return []; }
  const out: RegExp[] = [];
  for (const raw of text.split("\n")) {
    const line = raw.trim();
    if (!line || line.startsWith("#")) continue;
    const [pattern, ...attrs] = line.split(/\s+/);
    if (!pattern || !attrs.some((a) => NOT_CODE_ATTR.test(a))) continue;
    const body = pattern.replace(/^\//, "").split("**").map((part) => part.replace(/[.+^${}()|[\]\\]/g, "\\$&").replace(/\*/g, "[^/]*").replace(/\?/g, "[^/]")).join(".*");
    out.push(new RegExp(pattern.includes("/") ? `^${body}$` : `(^|/)${body}$`));
  }
  return out;
}

/** The repo root above an absolute path, or null. */
function repoRootOf(path: string): string | null {
  let d = dirname(resolve(path));
  for (;;) {
    if (existsSync(join(d, ".git"))) return d;
    const up = dirname(d);
    if (up === d) return null;
    d = up;
  }
}

/** Code is what an ISA criterion describes. Records (Markdown, the rendered ISA page), media assets, and files the
 *  repo marks linguist-generated or linguist-documentation are not code. Pass an absolute path for the generated check to apply. */
export function isCodeFile(path: string): boolean {
  const name = basename(path).toLowerCase();
  if (name.endsWith(".md") || name === "isa.html" || name === ".gitattributes" || name === ".gitignore" || ASSET_EXT.test(name)) return false;
  if (!isAbsolute(path)) return true;
  const root = repoRootOf(path);
  if (!root) return true;
  const rel = resolve(path).slice(root.length + 1);
  return !generatedPatterns(root).some((re) => re.test(rel));
}

/** The real path of `path`, or of its nearest existing ancestor joined with the rest (a file a Write is about to create). */
function realish(path: string): string {
  const abs = resolve(path);
  let d = abs;
  const tail: string[] = [];
  while (!existsSync(d)) {
    const up = dirname(d);
    if (up === d) return abs;
    tail.unshift(basename(d));
    d = up;
  }
  return join(realpathSync(d), ...tail);
}

/** `code_sync: off` in the ISA's frontmatter. An unreadable file owns its tree (the safe reading). */
export function codeSyncOff(isaPath: string): boolean {
  try {
    const text = readFileSync(isaPath, "utf8");
    const fm = text.startsWith("---") ? text.slice(3, text.indexOf("\n---", 3)) : "";
    return /^code_sync:\s*["']?off["']?\s*$/m.test(fm);
  } catch {
    return false;
  }
}

function isRepoRoot(dir: string): boolean {
  return existsSync(join(dir, ".git"));
}

// ── linked WorkOS ISAs (see the header: frontmatter contract and choice rule) ───────────────────────────────

interface LinkedIsa { path: string; repo: string; branch: string | null; tickets: string[]; mtime: number; done: boolean }

const HEAD_BYTES = 8192;

/** The first HEAD_BYTES of a file as text; "" when unreadable. Frontmatter is all a link needs. */
function readHead(path: string): string {
  let fd = -1;
  try {
    fd = openSync(path, "r");
    const buf = Buffer.alloc(HEAD_BYTES);
    return buf.subarray(0, readSync(fd, buf, 0, HEAD_BYTES, 0)).toString("utf8");
  } catch {
    return "";
  } finally {
    if (fd >= 0) try { closeSync(fd); } catch { /* nothing to release */ }
  }
}

function frontmatterOf(text: string): string {
  if (!text.startsWith("---")) return "";
  const end = text.indexOf("\n---", 3);
  return text.slice(3, end === -1 ? undefined : end);
}

/** A scalar frontmatter value: quotes and a trailing ` # comment` removed; null when the key is absent or empty. */
function fmValue(fm: string, key: string): string | null {
  const m = new RegExp(`^${key}:[ \\t]*(.*)$`, "m").exec(fm);
  if (!m) return null;
  let v = m[1]!.trim();
  const quoted = /^(["'])(.*)\1/.exec(v);
  v = quoted ? quoted[2]! : v.replace(/\s+#.*$/, "").trim();
  return v || null;
}

function realOrResolve(p: string): string {
  try { return realpathSync(p); } catch { return resolve(p); }
}

const DONE_STATE = /^(complete|completed|archived)$/i;

let linkedScan: { dir: string; items: LinkedIsa[] } | null = null;

/** Forget the memoised WORK scan (tests; a long-lived process that wants a fresh look). */
export function resetLinkedIsaCache(): void {
  linkedScan = null;
}

/** Every ISA in <WORKOS_DIR>/MEMORY/WORK that names a `repo:`. Scanned once per process per WORK dir. */
function linkedIsas(): LinkedIsa[] {
  const dir = join(getWorkosDir(), "MEMORY", "WORK");
  if (linkedScan && linkedScan.dir === dir) return linkedScan.items;
  const items: LinkedIsa[] = [];
  let names: string[] = [];
  try { names = readdirSync(dir); } catch { /* no WORK dir: nothing is linked */ }
  for (const name of names) {
    const path = join(dir, name, "ISA.md");
    let mtime: number;
    try {
      const st = statSync(path);
      if (!st.isFile()) continue;
      mtime = st.mtimeMs;
    } catch { continue; }
    const fm = frontmatterOf(readHead(path));
    const repo = fmValue(fm, "repo");
    if (!repo) continue;
    const expanded = expandPath(repo);
    if (!isAbsolute(expanded)) continue; // a relative repo: names no place
    const ticketValue = fmValue(fm, "ticket") ?? "";
    items.push({
      path: realOrResolve(path),
      repo: realOrResolve(expanded),
      branch: fmValue(fm, "branch"),
      tickets: [...ticketValue.toUpperCase().matchAll(/[A-Z][A-Z0-9]{1,9}-\d+/g)].map((m) => m[0]),
      mtime,
      done: DONE_STATE.test(fmValue(fm, "phase") ?? "") || DONE_STATE.test(fmValue(fm, "status") ?? ""),
    });
  }
  linkedScan = { dir, items };
  return items;
}

/** The current branch and every root that names this checkout (the main checkout too, for a linked worktree). */
export function gitInfo(repoRoot: string): { branch: string | null; roots: string[] } {
  const roots = [realOrResolve(repoRoot)];
  const dotGit = join(repoRoot, ".git");
  let gitDir = dotGit;
  try {
    if (statSync(dotGit).isFile()) {
      const m = /^gitdir:\s*(.+)$/m.exec(readFileSync(dotGit, "utf8"));
      if (!m) return { branch: null, roots };
      gitDir = resolve(repoRoot, m[1]!.trim());
      try {
        const common = resolve(gitDir, readFileSync(join(gitDir, "commondir"), "utf8").trim());
        if (basename(common) === ".git") roots.push(realOrResolve(dirname(common)));
      } catch { /* a submodule gitdir has no commondir */ }
    }
    const head = /^ref:\s*refs\/heads\/(.+?)\s*$/m.exec(readFileSync(join(gitDir, "HEAD"), "utf8"));
    return { branch: head ? head[1]! : null, roots };
  } catch {
    return { branch: null, roots };
  }
}

/** The linked WorkOS ISA for a repo root, or null (no live candidate, or none that fits the branch). */
export function linkedIsa(repoRoot: string): string | null {
  const items = linkedIsas();
  if (!items.length) return null;
  const { branch, roots } = gitInfo(repoRoot);
  const live = items.filter((i) => !i.done && roots.includes(i.repo));
  if (!live.length) return null;
  const newest = (xs: LinkedIsa[]) => [...xs].sort((a, b) => b.mtime - a.mtime || a.path.localeCompare(b.path))[0]!;

  const onBranch = branch ? live.filter((i) => i.branch === branch) : [];
  if (onBranch.length) return newest(onBranch).path;

  if (branch) {
    // The known ticket prefixes are the project filter, so a real key like ES-5 is not read as a standard's name.
    const prefixes = [...new Set(live.flatMap((i) => i.tickets.map((t) => t.slice(0, t.lastIndexOf("-")))))];
    const inBranch = new Set(extractJiraKeys(branch.toUpperCase(), prefixes));
    const byTicket = live.filter((i) => i.tickets.some((t) => inBranch.has(t)));
    if (byTicket.length) return newest(byTicket).path;
  }

  const untiered = live.filter((i) => !i.branch && i.tickets.length === 0);
  return untiered.length ? newest(untiered).path : null;
}

/** The governing ISA of a code file, or null: not code, outside any git repo, no ISA in the repo and no linked WorkOS ISA, or an off ISA. */
export function governingIsa(path: string): string | null {
  if (!path || !isAbsolute(resolve(path)) || !isCodeFile(path)) return null;
  const real = realish(path);
  let d = existsSync(real) && statSync(real).isDirectory() ? real : dirname(real);
  for (;;) {
    const isa = join(d, "ISA.md");
    // The real path: a Read of a symlinked ISA records its real path, so returning the link would never match it.
    if (existsSync(isa)) return codeSyncOff(isa) ? null : realpathSync(isa);
    // The walk found no ISA.md up to the repo root: an employer repo keeps its ISA in WorkOS memory, linked by `repo:`.
    if (isRepoRoot(d)) { const linked = linkedIsa(d); return linked && !codeSyncOff(linked) ? linked : null; }
    const up = dirname(d);
    if (up === d) return null;
    d = up;
  }
}

/** A criterion id in any style an ISA uses: `ISC-12`, `ISC-A1`, `C50`, `F-3`, `C4.1` (the same shapes ISARender reads). */
export const CRITERION_ID = /^(?:ISC-[\w.-]*\w|[A-Z]{1,6}-[A-Z0-9][\w-]*|[A-Z]{1,4}-?\d+(?:\.\d+)*)$/;

/** The ids of the criteria whose line a unified diff of an ISA adds, removes or changes (`- [ ] ISC-…`, `- [x] C50: …`). */
export function changedCriteria(diff: string): Set<string> {
  const ids = [...diff.matchAll(/^[+-]\s*-\s\[[ xX]\]\s+([A-Z][\w.-]*\w)(?=[:\s])/gm)].map((m) => m[1]!);
  return new Set(ids.filter((id) => CRITERION_ID.test(id)));
}

/** True when a unified diff of an ISA adds, removes or changes at least one criterion line. */
export function diffTouchesCriterion(diff: string): boolean {
  return changedCriteria(diff).size > 0;
}

if (import.meta.main) {
  const p = process.argv[2];
  if (!p) { console.error("usage: bun IsaGoverning.ts <path>"); process.exit(2); }
  console.log(JSON.stringify({ isa: governingIsa(p), code: isCodeFile(p) }));
}
