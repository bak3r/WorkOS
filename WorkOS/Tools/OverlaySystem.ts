#!/usr/bin/env bun
/**
 * OverlaySystem.ts — the update-path counterpart to DeployCore: refresh SYSTEM-OWNED files
 * that already exist, which copyMissing by contract cannot do.
 *
 * Ported from public PR #1771, @bnkath2o (posted by "Abe" on Ben's behalf). Fixes #1770.
 * Adaptation on the way in: an operator's CLAUDE.md and system prompt are BACKED UP to a
 * timestamped file before they are overlaid, so hand-edits to the constitution are
 * recoverable rather than silently lost. See overlayFile()'s backupFirst path.
 *
 * DeployCore is additive: `copyMissing` writes only when the destination is absent, so a
 * populated install can receive NEW files but never an UPDATED one. That is the right
 * contract for a fresh install and the wrong one for an update — `Workflows/Update.md`
 * step 3 ("Re-overlay system") describes this tool, which did not previously exist.
 *
 * Scope is deliberately narrow. Only paths WorkOS owns are written:
 *
 *   hooks/ · skills/ (not skills/WorkOS, which install.sh replaces) · agents/ · commands/ ·
 *   every WORKOS/ entry the payload ships except USER, MEMORY and VERSION ·
 *   plus CLAUDE.md and WORKOS/WORKOS_SYSTEM_PROMPT.md
 *
 * Never touched: USER/ (the principal's tree), WORKOS/MEMORY/ (per-install state),
 * settings.json (hook registrations — InstallHooks owns that merge), node_modules, .git.
 *
 * Each existing file at a payload path is sorted by the past WorkOS releases
 * (Tools/data/workos-<version>.sha256):
 *   - same as the new payload (placeholders filled or not) → left alone;
 *   - byte-identical to a file a past release shipped there → an untouched older copy, updated;
 *   - anything else WorkOS owns → the developer edited it: kept, with the new version written
 *     beside it as <file>.new to merge by hand;
 *   - not WorkOS's (a LifeOS copy, an edited LifeOS file, the developer's own) → never written.
 * A file a past release shipped that the new payload no longer does is RETIRED: an untouched
 * copy moves to the backup (a retired skill leaves the install), an edited one is kept and
 * reported. Nothing else is ever removed. A skill dir that is not WorkOS's is never written
 * into. Every overwrite and removal goes through the ledger (.workos-backup/<run>/), so
 * Rollback undoes it. A CLAUDE.md that someone else owns is never replaced: its WorkOS block
 * is rebuilt in place.
 *
 * Placeholders: a written file gets the identity values the install's own untouched copies
 * carry ({{PRINCIPAL_NAME}} → the name Substitute filled in), and {{WORKOS_VERSION}} the new
 * version. A placeholder no copy told us is left and reported; Substitute.ts fills it.
 *
 * VERSION is written LAST and only on a fully successful --apply, so a partial update can
 * never present as complete (the failure mode where the marker says the new version while
 * the machinery is still the old one).
 *
 * Dry-run by default (`--apply` to mutate); REFUSES the author's live source tree
 * (`--allow-dev` to override; exit 2), matching DeployCore's failure contract.
 *
 * Usage:
 *   bun OverlaySystem.ts [--config-root <dir>] [--skill-root <dir>] [--apply] [--allow-dev]
 */

import { chmodSync, existsSync, lstatSync, mkdirSync, readdirSync, readFileSync, rmdirSync, statSync, writeFileSync, type Stats } from "node:fs";
import { homedir } from "node:os";
import { basename, dirname, join, relative } from "node:path";
import { detectDevTree, isTemplateFile, isTestFile } from "./InstallEngine";
import { atomicWriteText } from "./lib/atomic-write";
import { blockState, buildBlock, findBlock, upsertBlock } from "./lib/claude-md";
import { Classifier, WORKOS_TOKENS, loadWorkosManifests, workosFillValues, workosReleaseMatch } from "./lib/inventory";
import { Ledger, addedPaths, readManifest } from "./lib/ledger";

interface Owner { configRoot: string; classifier: Classifier; legacy: boolean; ledger: () => Ledger; values: Map<string, string> }

/**
 * Is this existing file WorkOS's to update? WorkOS's own (manifest add, payload match,
 * WORKOS/ runtime) yes; LifeOS copies / edited LifeOS files never; the developer's files
 * never — except on a pre-manifest WorkOS install (`legacy`), where WorkOS-path files that
 * no LifeOS release knows are taken to be WorkOS's. Whether it is then overwritten or gets a
 * .new beside it is the release check's call (plan()).
 */
function mayOverwrite(o: Owner, abs: string): boolean {
  const rel = relative(o.configRoot, abs);
  const cls = o.classifier.file(rel).cls;
  if (cls === "workos") return true;
  if (cls === "user" && o.legacy) return true;
  // A path a past WorkOS release shipped is WorkOS's even where a LifeOS release ships the
  // same path (many skill files are byte-identical in both). Only an exact past-release copy
  // is ever overwritten or retired; anything else there gets a .new beside it.
  return workosReleaseMatch(rel, readFileSync(abs)).known;
}

/** Directories inside a system tree that are never overlaid, at any depth. */
const SKIP_DIRS = new Set(["node_modules", ".git", "MEMORY", "USER", "out", ".next"]);

/**
 * System-owned trees every full payload carries: [payload-relative, configRoot-relative].
 * Anything not listed here or in runtimeEntries() is left alone — absence is the safety property.
 */
const SYSTEM_TREES: Array<[string, string]> = [
  ["hooks", "hooks"],
  ["skills", "skills"],
  ["agents", "agents"],
  ["commands", "commands"],
  ["WORKOS/TOOLS", "WORKOS/TOOLS"],
  ["WORKOS/DOCUMENTATION", "WORKOS/DOCUMENTATION"],
  ["WORKOS/ALGORITHM", "WORKOS/ALGORITHM"],
  ["WORKOS/RULES", "WORKOS/RULES"],
];

/** WORKOS/ entries that are never overlaid: the principal's data, per-install state, the marker (written last). */
const RUNTIME_KEEP = new Set(["USER", "MEMORY", "VERSION", "WORKOS_SYSTEM_PROMPT.md", "node_modules", ".git"]);

/** install.sh replaces skills/WorkOS whole (backing up the old one); the overlay never writes there. */
const BOOTSTRAP_OWNED = "skills/WorkOS";

/** The rest of the payload's WORKOS/ (STATUSLINE, ERRATA, WORKOS_StatusLine.sh, …): [trees, files]. */
function runtimeEntries(payloadInstall: string): { trees: Array<[string, string]>; files: string[] } {
  const listed = new Set(SYSTEM_TREES.map(([ps]) => ps));
  const trees: Array<[string, string]> = [];
  const files: string[] = [];
  const dir = join(payloadInstall, "WORKOS");
  if (!existsSync(dir)) return { trees, files };
  for (const e of readdirSync(dir, { withFileTypes: true }).sort((a, b) => a.name.localeCompare(b.name))) {
    const rel = `WORKOS/${e.name}`;
    if (RUNTIME_KEEP.has(e.name) || listed.has(rel)) continue;
    if (e.isDirectory()) trees.push([rel, rel]);
    else if (e.isFile()) files.push(rel);
  }
  return { trees, files };
}

/**
 * System-owned single files: [payload-relative, configRoot-relative, backupFirst].
 * backupFirst files are ones an operator is likely to have hand-edited (the constitution
 * and the system prompt), so we snapshot the existing copy before overwriting it.
 */
const SYSTEM_FILES: Array<[string, string, boolean]> = [
  ["WORKOS/WORKOS_SYSTEM_PROMPT.md", "WORKOS/WORKOS_SYSTEM_PROMPT.md", true],
  ["CLAUDE.template.md", "CLAUDE.md", true],
];

function arg(a: string[], flag: string): string | undefined {
  const i = a.indexOf(flag);
  return i >= 0 && a[i + 1] && !a[i + 1].startsWith("--") ? a[i + 1] : undefined;
}

/** Timestamp safe for a filename: 2026-08-06T05-59-00-000Z. */
function stamp(): string {
  return new Date().toISOString().replace(/[:.]/g, "-");
}

type Op = "create" | "update" | "beside" | "retire";
interface Action { op: Op; src?: string; dst: string; rel: string }

interface OverlayResult {
  what: string;
  src: string;
  dst: string;
  present: boolean;
  /** existed, an untouched older WorkOS copy → rewritten */
  updated: number;
  /** already the new version → untouched */
  current: number;
  /** absent → created */
  created: number;
  /** edited by the developer → kept, the new version written beside as <file>.new */
  edited: string[];
  /** shipped by a past release, gone from this one, untouched → moved to the backup */
  retired: string[];
  /** shipped by a past release, gone from this one, edited → kept */
  retiredKept: string[];
  /** path of the backup written before an operator-owned file was overlaid, if any */
  backupPath?: string;
  /** existing paths that are not WorkOS's — never written */
  keptYours: string[];
  failures: string[];
  actions: Action[];
}

function result(what: string, src: string, dst: string): OverlayResult {
  return { what, src, dst, present: existsSync(src), updated: 0, current: 0, created: 0, edited: [], retired: [], retiredKept: [], keptYours: [], failures: [], actions: [] };
}

/** Learn the identity values an untouched copy carries; the first value seen for a token wins. */
function learn(o: Owner, values: Map<string, string>): void {
  for (const [t, v] of values) if (t !== "{{WORKOS_VERSION}}" && !o.values.has(t)) o.values.set(t, v);
}

/**
 * Decide what happens to one payload file at an existing or absent destination. Pure apart
 * from reads; nothing is written until apply().
 */
function plan(o: Owner, r: OverlayResult, sp: string, dp: string): void {
  const rel = relative(o.configRoot, dp);
  if (!existsSync(dp)) { r.created++; r.actions.push({ op: "create", src: sp, dst: dp, rel }); return; }
  // An existing lockfile is bun install's: the install step rewrote it, and the next one keeps it in step.
  if (/^bun\.lockb?$/.test(basename(dp))) { r.current++; return; }
  const buf = readFileSync(dp);
  const same = workosFillValues(sp, buf);
  if (same) { learn(o, same); r.current++; return; }
  if (!mayOverwrite(o, dp)) { r.keptYours.push(rel); return; }
  const past = workosReleaseMatch(rel, buf);
  if (past.equal) { learn(o, past.values); r.updated++; r.actions.push({ op: "update", src: sp, dst: dp, rel }); return; }
  r.edited.push(rel);
  r.actions.push({ op: "beside", src: sp, dst: `${dp}.new`, rel });
}

/**
 * Walk the payload tree and plan each file at the matching relative path under dst.
 * Updates and creations are both planned; removals only through retire().
 */
function overlayTree(src: string, dst: string, what: string, o: Owner): OverlayResult {
  const r = result(what, src, dst);
  if (!r.present) return r;

  const walk = (s: string, d: string): void => {
    let entries: string[];
    try {
      entries = readdirSync(s);
    } catch (err) {
      r.failures.push(`readdir ${s}: ${String(err)}`);
      return;
    }
    for (const name of entries) {
      const sp = join(s, name);
      const dp = join(d, name);
      let st: Stats;
      try {
        st = lstatSync(sp);
      } catch {
        continue;
      }
      if (st.isSymbolicLink()) continue; // never follow or replace symlinks (USER is one)
      if (st.isDirectory()) {
        if (SKIP_DIRS.has(name)) continue;
        const rel = relative(o.configRoot, dp);
        if (rel === BOOTSTRAP_OWNED) continue;
        // A skill dir is atomic: an existing one that is not WorkOS's is never merged into.
        if (what === "skills" && s === src && existsSync(dp)) {
          const files = o.classifier.walk(rel).filter((f) => !f.endsWith(".DS_Store") && !f.split("/").includes("node_modules"));
          const owned = o.classifier.isRecorded(rel) || files.every((f) => mayOverwrite(o, join(o.configRoot, f)));
          if (!owned) { r.keptYours.push(rel); continue; }
        }
        walk(sp, dp);
        continue;
      }
      if (!st.isFile() || isTestFile(name)) continue;
      plan(o, r, sp, dp);
    }
  };

  walk(src, dst);
  return r;
}

/**
 * Files a past WorkOS release shipped inside the overlay's scope that this payload no longer
 * ships. An untouched copy is planned for the backup; an edited one is kept and reported.
 */
function retire(o: Owner, payloadInstall: string, inScope: (rel: string) => boolean): OverlayResult {
  const r = result("retired", "(past releases)", o.configRoot);
  r.present = true;
  for (const key of [...loadWorkosManifests().byPath.keys()].sort()) {
    if (!key.startsWith("install/")) continue;
    const rel = key.slice("install/".length);
    if (!inScope(rel) || isTestFile(rel.slice(rel.lastIndexOf("/") + 1))) continue;
    if (existsSync(join(payloadInstall, rel))) continue;
    const abs = join(o.configRoot, rel);
    const st = lstatSync(abs, { throwIfNoEntry: false });
    if (!st?.isFile()) continue;
    if (!mayOverwrite(o, abs)) { r.keptYours.push(rel); continue; }
    if (workosReleaseMatch(rel, readFileSync(abs)).equal) {
      r.retired.push(rel);
      r.actions.push({ op: "retire", dst: abs, rel });
    } else r.retiredKept.push(rel);
  }
  return r;
}

/**
 * The payload file's text with every placeholder we know filled in. Bytes are untouched when
 * it has none, or when Substitute would not render its file type either.
 */
function render(o: Owner, src: string): Buffer {
  const buf = readFileSync(src);
  const text = buf.toString("latin1");
  if (!isTemplateFile(src) || !WORKOS_TOKENS.some((t) => text.includes(t))) return buf;
  let out = buf.toString("utf8");
  for (const [t, v] of o.values) out = out.split(t).join(v);
  return Buffer.from(out, "utf8");
}

/** Remove the dirs a retirement emptied, up to (not including) the config root. */
function pruneEmpty(root: string, file: string): void {
  for (let d = dirname(file); d !== root && d.startsWith(root + "/"); d = dirname(d)) {
    try {
      if (readdirSync(d).length > 0) return;
      rmdirSync(d);
    } catch {
      return;
    }
  }
}

function execute(o: Owner, r: OverlayResult): void {
  for (const a of r.actions) {
    try {
      if (a.op === "retire") {
        o.ledger().moveToBackup(a.dst, "overlay: retired by the new WorkOS release");
        pruneEmpty(o.configRoot, a.dst);
        continue;
      }
      const bytes = render(o, a.src!);
      if (a.op === "beside" && existsSync(a.dst) && readFileSync(a.dst).equals(bytes)) continue;
      if (existsSync(a.dst)) o.ledger().beforeWrite(a.dst, "replace", a.op === "beside" ? "overlay: new version beside an edited file" : "overlay: newer WorkOS release");
      else o.ledger().recordAdd(a.dst);
      mkdirSync(dirname(a.dst), { recursive: true });
      writeFileSync(a.dst, bytes);
      chmodSync(a.dst, statSync(a.src!).mode & 0o777); // a hook runs by path: keep the payload's executable bit
    } catch (err) {
      r.failures.push(`${a.op} ${a.rel}: ${String(err)}`);
    }
  }
}

function overlayFile(src: string, dst: string, what: string, apply: boolean, backupFirst: boolean, o: Owner): OverlayResult {
  const r = result(what, src, dst);
  if (!r.present) return r;
  const exists = existsSync(dst);
  const isClaudeMd = relative(o.configRoot, dst) === "CLAUDE.md";
  if (exists && isClaudeMd && !addedPaths(o.configRoot).includes("CLAUDE.md")) {
    // Someone else's CLAUDE.md: rebuild only the WorkOS block, keeping its import state.
    const text = readFileSync(dst, "utf8");
    const loc = findBlock(text);
    if (!loc) {
      r.keptYours.push("CLAUDE.md (no WorkOS block — run ActivateImports.ts to insert one)");
      return r;
    }
    const { block } = buildBlock(readFileSync(src, "utf8"), blockState(loc.inner), () => false);
    const up = upsertBlock(text, block);
    if (up.action === "unchanged") { r.current = 1; return r; }
    if (apply) {
      try {
        o.ledger().beforeWrite(dst, "claude-md-block", "overlay: WorkOS block rebuilt from the new template");
        atomicWriteText(dst, up.text);
        r.backupPath = o.ledger().backupPathFor(dst);
      } catch (err) {
        r.failures.push(`block ${dst}: ${String(err)}`);
        return r;
      }
    }
    r.updated = 1;
    return r;
  }
  if (exists && isClaudeMd) {
    // WorkOS's own CLAUDE.md always differs from the template once ActivateImports has run, so
    // the release check would call it edited every time. It is replaced, backed up first, and
    // Update step 6 re-activates the imports.
    if (workosFillValues(src, readFileSync(dst))) { r.current = 1; return r; }
    r.updated = 1;
    r.actions.push({ op: "update", src, dst, rel: "CLAUDE.md" });
    if (apply) r.backupPath = o.ledger().backupPathFor(dst);
    return r;
  }
  plan(o, r, src, dst);
  if (apply && backupFirst && r.actions.some((a) => a.op === "update")) r.backupPath = o.ledger().backupPathFor(dst);
  return r;
}

function main(): void {
  const a = process.argv.slice(2);
  const apply = a.includes("--apply");
  const allowDev = a.includes("--allow-dev");
  const configRoot = arg(a, "--config-root") || process.env.CLAUDE_CONFIG_DIR || join(homedir(), ".claude");
  const skillRoot = arg(a, "--skill-root") || join(configRoot, "skills", "WorkOS");
  const payloadInstall = join(skillRoot, "install");

  if (!allowDev && detectDevTree(configRoot)) {
    console.log(JSON.stringify({ ok: false, refused: "dev-tree", detail: `${configRoot} is a source tree — refusing to overlay.` }, null, 2));
    process.exit(2);
  }
  if (!existsSync(payloadInstall)) {
    console.log(JSON.stringify({ ok: false, blockers: [`payload absent: ${payloadInstall}`] }, null, 2));
    process.exit(1);
  }

  // Payload-completeness preflight. On an installed system, skills/WorkOS/install/ holds
  // only the bootstrap files (install.sh, templates) — the full system payload exists there
  // only right after the bootstrap has fetched a release. Overlaying from a bootstrap-only
  // dir would report every tree absent and exit ok:true having refreshed nothing, which
  // presents a no-op as a successful update. Refuse instead, and say what to do.
  const missingTrees = SYSTEM_TREES.map(([ps]) => ps).filter((ps) => !existsSync(join(payloadInstall, ps)));
  if (missingTrees.length === SYSTEM_TREES.length) {
    console.log(JSON.stringify({
      ok: false,
      blockers: [
        `payload at ${payloadInstall} is bootstrap-only (no system trees: ${missingTrees.join(", ")}) — run \`bash ${join(skillRoot, "install", "install.sh")}\` to fetch the full release payload, then re-run this overlay`,
      ],
    }, null, 2));
    process.exit(1);
  }
  if (missingTrees.length > 0) {
    console.log(JSON.stringify({
      ok: false,
      blockers: [`payload at ${payloadInstall} is incomplete — missing system tree(s): ${missingTrees.join(", ")}. Re-fetch the release payload before overlaying.`],
    }, null, 2));
    process.exit(1);
  }

  let ledger: Ledger | null = null;
  const owner: Owner = {
    configRoot,
    classifier: new Classifier(configRoot, skillRoot),
    legacy: readManifest(configRoot).length === 0 && existsSync(join(configRoot, "WORKOS", "VERSION")),
    ledger: () => (ledger ??= new Ledger(configRoot, "OverlaySystem")),
    values: new Map(),
  };
  const runtime = runtimeEntries(payloadInstall);
  const trees = [...SYSTEM_TREES, ...runtime.trees];
  const files: Array<[string, string, boolean]> = [...runtime.files.map((f): [string, string, boolean] => [f, f, false]), ...SYSTEM_FILES];
  const results: OverlayResult[] = [];
  for (const [ps, ds] of trees) {
    results.push(overlayTree(join(payloadInstall, ps), join(configRoot, ds), ps, owner));
  }
  for (const [ps, ds, backup] of files) {
    results.push(overlayFile(join(payloadInstall, ps), join(configRoot, ds), ps, apply, backup, owner));
  }
  const scope = new Set([...trees.map(([, ds]) => ds), ...files.map(([, ds]) => ds)]);
  results.push(retire(owner, payloadInstall, (rel) =>
    rel !== BOOTSTRAP_OWNED && !rel.startsWith(BOOTSTRAP_OWNED + "/") &&
    !rel.split("/").some((seg) => SKIP_DIRS.has(seg)) &&
    [...scope].some((d) => rel === d || rel.startsWith(d + "/")) ||
    // a whole WORKOS/ subtree a past release shipped and this one dropped
    /^WORKOS\/[^/]+\//.test(rel) && !RUNTIME_KEEP.has(rel.split("/")[1])));

  // {{WORKOS_VERSION}} always renders as the version being installed.
  const versionSrc = join(payloadInstall, "WORKOS", "VERSION");
  if (existsSync(versionSrc)) owner.values.set("{{WORKOS_VERSION}}", readFileSync(versionSrc, "utf8").trim());
  if (apply) for (const r of results) execute(owner, r);

  const failures = results.flatMap((r) => r.failures);
  const ok = failures.length === 0;
  const updated = results.reduce((n, r) => n + r.updated, 0);
  const created = results.reduce((n, r) => n + r.created, 0);
  const current = results.reduce((n, r) => n + r.current, 0);
  const backups = results.map((r) => r.backupPath).filter((p): p is string => Boolean(p));
  const keptYours = results.flatMap((r) => r.keptYours);
  const edited = results.flatMap((r) => r.edited);
  const retired = results.flatMap((r) => r.retired);
  const retiredKept = results.flatMap((r) => r.retiredKept);
  const unfilled = WORKOS_TOKENS.filter((t) => !owner.values.has(t) && results.some((r) => r.actions.some((x) => x.src && isTemplateFile(x.src) && readFileSync(x.src, "latin1").includes(t))));

  // VERSION last, and only when everything else succeeded — a partial update must never
  // leave a marker claiming the new version.
  const version: { from: string | null; to: string | null; written: boolean } = { from: null, to: null, written: false };
  const versionDst = join(configRoot, "WORKOS", "VERSION");
  if (existsSync(versionSrc)) {
    version.to = readFileSync(versionSrc, "utf8").trim();
    version.from = existsSync(versionDst) ? readFileSync(versionDst, "utf8").trim() : null;
    if (apply && ok) {
      try {
        owner.ledger().beforeWrite(versionDst, "replace", "overlay: VERSION");
        writeFileSync(versionDst, readFileSync(versionSrc));
        version.written = true;
      } catch (err) {
        failures.push(`write VERSION: ${String(err)}`);
      }
    }
  }

  const notes: string[] = [];
  if (!apply) notes.push("dry-run — re-run with --apply to overlay (VERSION is written only on a successful apply)");
  notes.push("USER/, WORKOS/MEMORY/ and settings.json are never touched; only files a past release shipped and this one retired are removed, into the backup");
  if (edited.length) notes.push(`${edited.length} file(s) you edited were kept; the new version of each is beside it as <file>.new — merge by hand, then delete the .new`);
  if (retiredKept.length) notes.push(`${retiredKept.length} retired file(s) you edited were kept: ${retiredKept.join(", ")}`);
  if (unfilled.length) notes.push(`no untouched copy carried ${unfilled.join(", ")}: run Substitute.ts --apply with the names to fill them`);
  if (backups.length) {
    notes.push(
      `backed up ${backups.length} operator file(s) before overlay: ${backups.join(", ")} — reconcile any hand-edits from the backup, then run ActivateImports.ts --apply and read CLAUDE.md back to confirm the identity imports resolve`,
    );
  }

  console.log(JSON.stringify({
    ok: failures.length === 0,
    dryRun: !apply,
    configRoot,
    payloadInstall,
    releasesKnown: loadWorkosManifests().versions,
    updated,
    created,
    alreadyCurrent: current,
    edited,
    retired,
    retiredKept,
    unfilled,
    backups,
    keptYours,
    version,
    failures,
    results: results.map(({ actions, ...r }) => ({ ...r, actions: actions.length })),
    note: notes.join(" | "),
  }, null, 2));
  process.exit(failures.length === 0 ? 0 : 1);
}

main();
