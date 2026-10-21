#!/usr/bin/env bun
/**
 * DeployCore — WorkOS Core deploy step (Setup step 4.5). Lays down the two
 * things the bare skill SHIPS in its install payload but no prior Setup step
 * installed: the functional skills library and the WORKOS runtime tree
 * (Algorithm, documentation, tools, statusline, version, user-templates).
 * Without it a fresh install has exactly one skill, no runtime, and the active
 * `@WORKOS/DOCUMENTATION/ARCHITECTURE_SUMMARY.md` import in CLAUDE.md dangles.
 * Also places CLAUDE.md from install/CLAUDE.template.md when none exists yet.
 *
 * Every copy goes through InstallEngine.copyMissing — recursive, existsSync-
 * guarded, NEVER overwrites a populated target. So it is idempotent: a second
 * `--apply` copies 0. Every new path is recorded in the install ledger
 * (WORKOS/install-manifest.jsonl) so Rollback.ts can remove exactly it.
 *
 * Over an existing root (run Inventory + Adopt first when LifeOS is present):
 *   - a skill dir that already exists and is NOT WorkOS's (the developer's own, or an
 *     edited LifeOS skill) is never written into — no merging; reported `keptYours`.
 *   - an existing root package.json that is not WorkOS's is kept, and an existing
 *     node_modules/ is never touched: `bun install` runs only when the root has no
 *     node_modules yet (a vendored one that already satisfies the deps is fine). Dry-run by default (`--apply` to mutate); REFUSES the
 * author's live source tree (`--allow-dev` to override; exit 2). A required
 * payload source dir that is ABSENT is a LOUD blocker that fails the run
 * (exit 1) — never a silent ok (matches DeployComponents' failure contract).
 *
 * Targets the config-root runtime at the ALL-CAPS `<configRoot>/WORKOS/` so it
 * matches the `@WORKOS/...` imports in CLAUDE.md (NOT mixed-case `WorkOS`).
 *
 * Usage:
 *   bun DeployCore.ts [--config-root <dir>] [--skill-root <dir>] [--apply] [--allow-dev]
 *   (dry-run by default — reports the plan per target without writing)
 */

import { existsSync, lstatSync, mkdirSync, readdirSync, readFileSync } from "node:fs";
import { homedir } from "node:os";
import { basename, dirname, join } from "node:path";
import { copyMissing, detectDevTree } from "./InstallEngine";
import { Classifier } from "./lib/inventory";
import { Ledger } from "./lib/ledger";

/** One ledger per run of this tool, created lazily — dry-runs never write the manifest. */
let ledgerInstance: Ledger | null = null;
let classifierInstance: Classifier | null = null;
function ledgerFor(configRoot: string): Ledger {
  return (ledgerInstance ??= new Ledger(configRoot, "DeployCore"));
}

/** Is every file under an existing path WorkOS's (payload match or manifest add)? */
function workosOwned(configRoot: string, skillRoot: string, rel: string): boolean {
  const c = (classifierInstance ??= new Classifier(configRoot, skillRoot));
  if (c.isRecorded(rel)) return true;
  const files = c.walk(rel).filter((f) => !f.endsWith(".DS_Store") && !f.split("/").includes("node_modules"));
  return files.length > 0 && files.every((f) => c.file(f).cls === "workos");
}

// Runtime top-level entries this tool does NOT deploy:
//  - USER           shipped separately as a scaffold (ScaffoldUser) + symlinked (LinkUser)
//  - MEMORY         per-install state, never shipped — but scaffoldMemory() creates the
//                   empty tree at install so ISASync/hooks/memory writes have a home
//                   (this is where EmitSkill's "MEMORY scaffolded fresh at setup" becomes true)
//  - node_modules / .git  never deploy
// copyMissing's own SKIP_DIRS covers MEMORY when nested, but these
// are TOP-LEVEL entries of the runtime payload, so we filter them here explicitly.
const RUNTIME_SKIP = new Set(["USER", "MEMORY", "node_modules", ".git"]);

function arg(a: string[], flag: string): string | undefined {
  const i = a.indexOf(flag);
  return i >= 0 && a[i + 1] && !a[i + 1].startsWith("--") ? a[i + 1] : undefined;
}

interface SkillConflict {
  payload: string;
  existing: string;
  detail: string;
}

interface DeployResult {
  what: "skills" | "runtime" | "claude-md" | "memory" | "dependencies" | "nested-dependencies";
  src: string;
  dst: string;
  present: boolean;
  copied: number;
  actions: string[];
  blockers: string[];
  failures: string[];
  /** Skills NOT deployed because a pre-existing user skill collides case-insensitively. */
  conflicts?: SkillConflict[];
  /** Exact-name dirs that already existed and were merged file-additively (prior install / re-run). */
  mergedExisting?: string[];
  /** Existing dirs/files that are NOT WorkOS's — never written into, reported as kept (yours). */
  keptYours?: string[];
  /** Skill dirs this run deployed or found WorkOS-owned (nested-deps scope). */
  owned?: string[];
}

/**
 * (a) skills library: install/skills/<Skill> → configRoot/skills/<Skill>,
 * deployed PER SKILL DIRECTORY with case-insensitive collision detection
 * (public issue #1506, @mygirleatsmayo). On default macOS APFS, a payload
 * `Research/` resolves into a pre-existing user `research/` — one file-level
 * copyMissing would merge WorkOS files into the user's skill while skipping
 * its own SKILL.md, leaving OUR skill headless and THEIR dir polluted, with a
 * clean-looking report. A skill is atomic: it deploys whole into a dir we
 * created, or not at all.
 *
 *  - no entry with the same lowercased name → deploy (copyMissing)
 *  - EXACT-name dir already present → file-additive merge, reported in
 *    mergedExisting (keeps re-runs idempotent for prior WorkOS installs)
 *  - case-VARIANT name present (research vs Research) → foreign dir: SKIP the
 *    whole skill, record a conflict, tell the user how to resolve
 */
function deploySkills(payloadInstall: string, configRoot: string, apply: boolean): DeployResult {
  const src = join(payloadInstall, "skills");
  const dst = join(configRoot, "skills");
  const r: DeployResult = { what: "skills", src, dst, present: existsSync(src), copied: 0, actions: [], blockers: [], failures: [], conflicts: [], mergedExisting: [], keptYours: [], owned: [] };
  if (!r.present) {
    r.blockers.push(`skills payload missing: ${src} — the bare-skill payload is unpopulated (run EmitSkill, or point --skill-root at a staged release)`);
    return r;
  }
  const existingByLower = new Map<string, string>();
  if (existsSync(dst)) {
    for (const e of readdirSync(dst)) existingByLower.set(e.toLowerCase(), e);
  }
  for (const entry of readdirSync(src, { withFileTypes: true }).sort((a, b) => a.name.localeCompare(b.name))) {
    const name = entry.name;
    const es = join(src, name);
    const ed = join(dst, name);
    const match = existingByLower.get(name.toLowerCase());
    if (match !== undefined && match !== name) {
      r.conflicts!.push({
        payload: name,
        existing: match,
        detail: `pre-existing '${match}' collides case-insensitively with payload '${name}' — skill NOT deployed, existing dir untouched. Resolve by renaming/moving '${join(dst, match)}', then re-run.`,
      });
      continue;
    }
    if (match === name) {
      // Exists already: only a WorkOS-owned dir (a prior install / re-run) is topped up.
      // Anything else is the developer's — never merged into (that left OUR skill
      // headless and THEIR folder polluted).
      if (!workosOwned(configRoot, dirname(payloadInstall), `skills/${name}`)) {
        r.keptYours!.push(`skills/${name}`);
        continue;
      }
      if (entry.isDirectory()) r.mergedExisting!.push(name);
    }
    if (entry.isDirectory()) r.owned!.push(name);
    if (!apply) {
      r.actions.push(`copyMissing ${es} → ${ed}${match === name ? " (WorkOS-owned — tops up missing files, never overwrites)" : ""}`);
      continue;
    }
    const { copied, failures } = copyMissing(es, ed, ledgerFor(configRoot));
    r.copied += copied;
    r.failures.push(...failures);
  }
  return r;
}

/** (b) runtime: install/WORKOS/<entry> → configRoot/WORKOS/<entry>, skipping RUNTIME_SKIP. */
function deployRuntime(payloadInstall: string, configRoot: string, apply: boolean): DeployResult {
  // Prefer canonical all-caps WORKOS (matches @WORKOS/... imports on case-sensitive FS);
  // fall back to the legacy mixed-case dir so pre-fix tarballs still install.
  const src = existsSync(join(payloadInstall, "WORKOS")) ? join(payloadInstall, "WORKOS") : join(payloadInstall, "WorkOS");
  const dst = join(configRoot, "WORKOS");
  const r: DeployResult = { what: "runtime", src, dst, present: existsSync(src), copied: 0, actions: [], blockers: [], failures: [] };
  if (!r.present) {
    r.blockers.push(`runtime payload missing: ${src} — the bare-skill payload is unpopulated (run EmitSkill, or point --skill-root at a staged release)`);
    return r;
  }
  // Iterate top-level entries so USER (and the other skips) are excluded while the
  // rest of the runtime is copied via the shared, never-overwrite copyMissing.
  const entries = readdirSync(src, { withFileTypes: true })
    .filter((e) => !RUNTIME_SKIP.has(e.name))
    .map((e) => e.name)
    .sort();
  if (entries.length === 0) {
    r.blockers.push(`runtime payload at ${src} has nothing to deploy after skipping ${[...RUNTIME_SKIP].join(", ")}`);
    return r;
  }
  for (const name of entries) {
    const es = join(src, name);
    const ed = join(dst, name);
    if (!apply) {
      r.actions.push(`copyMissing ${es} → ${ed}`);
      continue;
    }
    const { copied, failures } = copyMissing(es, ed, ledgerFor(configRoot));
    r.copied += copied;
    r.failures.push(...failures);
  }
  return r;
}

/**
 * (b2) CLAUDE.md: install/CLAUDE.template.md → configRoot/CLAUDE.md, ONLY when absent
 * (copyMissing). Its `@WORKOS/DOCUMENTATION/ARCHITECTURE_SUMMARY.md` import resolves
 * against the runtime just deployed; the identity imports ship dormant and are turned
 * on by ActivateImports. An existing CLAUDE.md is the operator's — never touched here
 * (OverlaySystem is the update path, and backs it up first).
 */
function deployClaudeMd(payloadInstall: string, configRoot: string, apply: boolean): DeployResult {
  const src = join(payloadInstall, "CLAUDE.template.md");
  const dst = join(configRoot, "CLAUDE.md");
  const r: DeployResult = { what: "claude-md", src, dst, present: existsSync(src), copied: 0, actions: [], blockers: [], failures: [] };
  if (!r.present) {
    r.blockers.push(`CLAUDE.md template missing: ${src} — point --skill-root at a staged release`);
    return r;
  }
  if (existsSync(dst)) return r;
  if (!apply) {
    r.actions.push(`copy ${src} → ${dst}`);
    return r;
  }
  const { copied, failures } = copyMissing(src, dst, ledgerFor(configRoot));
  r.copied = copied;
  r.failures = failures;
  return r;
}

// MEMORY is NOT shipped in the payload (per-install state), but the runtime writes
// to it immediately (ISASync → WORK + STATE, hooks → OBSERVABILITY, memory loop →
// KNOWLEDGE/LEARNING). Without the tree a fresh install throws on first write. This
// makes EmitSkill's "MEMORY scaffolded fresh at setup" claim actually true.
const MEMORY_SUBDIRS = [
  "WORK", "KNOWLEDGE", "LEARNING", "STATE", "OBSERVABILITY", "SKILLS",
  // The rest of the rows MemorySystem.md lists as `active` — without them the
  // SessionEnd MemoryDirIntegrity check reports 12 drift items on a fresh install.
  "ARCHIVE", "DATA", "PLANS", "PROJECT", "REFERENCE", "RESEARCH", "SCRATCHPAD",
  "SECURITY", "SYSTEMUPDATES", "TEAMS", "UPGRADES", "WISDOM",
];

/** (c) MEMORY scaffold: create the empty per-install state dirs (never overwrites). */
function scaffoldMemory(configRoot: string, apply: boolean): DeployResult {
  const dst = join(configRoot, "WORKOS", "MEMORY");
  const r: DeployResult = { what: "memory", src: "(scaffold — not shipped)", dst, present: true, copied: 0, actions: [], blockers: [], failures: [] };
  for (const sub of MEMORY_SUBDIRS) {
    const d = join(dst, sub);
    if (existsSync(d)) continue;
    if (!apply) { r.actions.push(`mkdir -p ${d}`); continue; }
    try {
      ledgerFor(configRoot).recordAdd(d, undefined, "dir");
      mkdirSync(d, { recursive: true });
      r.copied++;
    } catch (err) {
      r.failures.push(`mkdir ${d}: ${err instanceof Error ? err.message : String(err)}`);
    }
  }
  // Generate KNOWLEDGE/_schema.md so the Cortex skill's documented contract
  // exists on a fresh install — SKILL.md points at it five times, but nothing
  // shipped or generated it (public issue #1583, @elhoim). Derived from
  // KnowledgeSchema.ts, the same generated-doc pattern as ARCHITECTURE_SUMMARY.md.
  // Skipped quietly when the runtime tools aren't deployed yet (dry-run planning
  // still records the action).
  const schemaDoc = join(dst, "KNOWLEDGE", "_schema.md");
  const generator = join(configRoot, "WORKOS", "TOOLS", "GenerateKnowledgeSchemaDoc.ts");
  if (!existsSync(schemaDoc) && existsSync(generator)) {
    if (!apply) {
      r.actions.push(`bun ${generator}`);
    } else {
      ledgerFor(configRoot).recordAdd(schemaDoc);
      const proc = Bun.spawnSync(["bun", generator], { stdout: "pipe", stderr: "pipe", env: { ...process.env, CLAUDE_CONFIG_DIR: configRoot } });
      if (proc.exitCode === 0) r.copied++;
      else r.failures.push(`GenerateKnowledgeSchemaDoc exited ${proc.exitCode}: ${proc.stderr.toString().trim()}`);
    }
  }
  return r;
}

/**
 * (d) shared runtime deps: install/package.json → configRoot/package.json, then
 * `bun install` in configRoot. Several deployed hooks/TOOLS scripts (e.g.
 * hooks/lib/identity.ts, WORKOS/TOOLS/Banner.ts) import npm packages (yaml)
 * that resolve via node_modules walked up from configRoot — without this step
 * those scripts throw "Cannot find package" on first run after a fresh install.
 */
function deployDependencies(payloadInstall: string, configRoot: string, apply: boolean): DeployResult {
  const src = join(payloadInstall, "package.json");
  const dst = join(configRoot, "package.json");
  const r: DeployResult = { what: "dependencies", src, dst, present: existsSync(src), copied: 0, actions: [], blockers: [], failures: [] };
  if (!r.present) {
    r.blockers.push(`dependency manifest missing: ${src} — point --skill-root at a staged release`);
    return r;
  }
  const pkgOurs = !existsSync(dst) || workosOwned(configRoot, dirname(payloadInstall), "package.json");
  const deps = Object.keys((JSON.parse(readFileSync(src, "utf8")) as { dependencies?: Record<string, string> }).dependencies ?? {});
  const nm = join(configRoot, "node_modules");
  const missingDeps = deps.filter((d) => !existsSync(join(nm, d, "package.json")));
  const nmExists = !!lstatSync(nm, { throwIfNoEntry: false });
  const runInstall = missingDeps.length > 0 && !nmExists;
  if (!pkgOurs) r.keptYours = ["package.json"];
  if (!apply) {
    if (pkgOurs) r.actions.push(`copyMissing ${src} → ${dst}`);
    else r.actions.push(`keep existing ${dst} (not WorkOS's)`);
    if (runInstall) r.actions.push(`bun install --cwd ${configRoot}`);
    else if (missingDeps.length === 0) r.actions.push(`dependencies already present in ${nm} — no bun install`);
    else r.blockers.push(`${nm} exists (yours — never touched) but lacks ${missingDeps.join(", ")}; add them yourself (WorkOS hooks import them)`);
    return r;
  }
  if (pkgOurs) {
    const { copied, failures } = copyMissing(src, dst, ledgerFor(configRoot));
    r.copied = copied;
    r.failures = failures;
  }
  if (missingDeps.length === 0) {
    r.actions.push(`dependencies already present in ${nm} — no bun install`);
  } else if (nmExists) {
    r.failures.push(`${nm} exists (yours — never touched) but lacks ${missingDeps.join(", ")}; add them yourself (WorkOS hooks import them)`);
  } else if (r.failures.length === 0) {
    const ledger = ledgerFor(configRoot);
    ledger.recordAdd(nm, "bun install output", "dir");
    for (const lock of ["bun.lock", "bun.lockb"]) if (!existsSync(join(configRoot, lock))) ledger.recordAdd(join(configRoot, lock), "bun install output");
    // A lockfile that already exists (not WorkOS's) is rewritten by bun install: back it up.
    for (const lock of ["bun.lock", "bun.lockb"]) if (existsSync(join(configRoot, lock))) ledger.beforeWrite(join(configRoot, lock), "modify", "bun install may rewrite it");
    const proc = Bun.spawnSync(["bun", "install"], { cwd: configRoot, stdout: "pipe", stderr: "pipe" });
    if (proc.exitCode !== 0) {
      r.failures.push(`bun install --cwd ${configRoot} exited ${proc.exitCode}: ${proc.stderr.toString().trim()}`);
    } else {
      r.actions.push(`bun install --cwd ${configRoot}`);
    }
  }
  return r;
}

/**
 * (e) nested runtime deps (public PR #1581, @elhoim): several directories
 * INSIDE the deployed runtime tree ship their OWN package.json (WORKOS/TOOLS,
 * ...) — declaring a dependency there does not make bun/node resolve it.
 * Module resolution stops walking up at the first ancestor directory that owns
 * a package.json, so the shared configRoot/node_modules deployDependencies()
 * just installed never satisfies these. Walk the deployed runtime tree for
 * every package.json (skipping node_modules/.git) and `bun install --cwd` each one.
 */
function findNestedDependencyDirs(runtimeDst: string, skip: Set<string> = new Set()): string[] {
  const found: string[] = [];
  const walk = (dir: string): void => {
    if (!existsSync(dir) || skip.has(dir)) return;
    for (const entry of readdirSync(dir, { withFileTypes: true })) {
      if (entry.name === "node_modules" || entry.name === ".git") continue;
      const p = join(dir, entry.name);
      if (entry.isDirectory()) {
        walk(p);
      } else if (entry.isFile() && entry.name === "package.json") {
        found.push(dir);
      }
    }
  };
  walk(runtimeDst);
  return found.sort();
}

function deployNestedDependencies(payloadInstall: string, configRoot: string, apply: boolean, ownedSkills: string[]): DeployResult {
  const runtimeDst = join(configRoot, "WORKOS");
  const skillsDst = join(configRoot, "skills");
  const r: DeployResult = {
    what: "nested-dependencies", src: runtimeDst, dst: runtimeDst,
    present: existsSync(runtimeDst), copied: 0, actions: [], blockers: [], failures: [],
  };
  if (!r.present) return r; // runtime not deployed yet — deployRuntime() already reports that blocker

  // Walk skills/ alongside WORKOS/ — skills ship nested package.json manifests
  // too (Apify, Evals, Prompting templates, Art tools), and installing
  // only the runtime tree left them import-broken. Public issue #1605, @cristbc.
  //
  // Scoped to the skills THIS payload ships, per skill dir (ported from public
  // PR #1739, @elhoim): configRoot/skills also holds the principal's own
  // pre-existing skills — running `bun install` in those mutates dirs we never
  // deployed (and whose install we don't own), and any failure there fails OUR
  // deploy. Skills we skipped on a case-insensitive collision are excluded for
  // the same reason (not in the payload-name → deployed-dir set we created).
  const payloadSkills = join(payloadInstall, "skills");
  // The deployed WorkOS skill carries a second full copy of this very payload
  // under <skill>/install — walking it re-installs every payload skill a second
  // time, into a tree nothing imports from.
  const nestedPayload = join(skillsDst, basename(dirname(payloadInstall)), "install");
  // Only skill dirs WorkOS deployed or owns — never a kept developer skill of the same name.
  const ownSkillDirs = existsSync(payloadSkills)
    ? readdirSync(payloadSkills, { withFileTypes: true })
        .filter((e) => e.isDirectory() && ownedSkills.includes(e.name))
        .map((e) => join(skillsDst, e.name))
        .filter(existsSync)
    : [];
  const dirs = [
    ...findNestedDependencyDirs(runtimeDst),
    ...ownSkillDirs.flatMap((d) => findNestedDependencyDirs(d, new Set([nestedPayload]))),
  ];
  for (const dir of dirs) {
    if (!apply) {
      r.actions.push(`bun install --cwd ${dir}`);
      continue;
    }

    const proc = Bun.spawnSync(["bun", "install"], { cwd: dir, stdout: "pipe", stderr: "pipe" });
    if (proc.exitCode !== 0) {
      r.failures.push(`bun install --cwd ${dir} exited ${proc.exitCode}: ${proc.stderr.toString().trim()}`);
      continue;
    }
    r.copied++;
    r.actions.push(`bun install --cwd ${dir}`);
  }
  return r;
}

function main(): void {
  const a = process.argv.slice(2);
  const home = process.env.HOME || homedir();
  const configRoot = arg(a, "--config-root") || process.env.CLAUDE_CONFIG_DIR || join(home, ".claude");
  const skillRoot = arg(a, "--skill-root") || join(import.meta.dir, "..");
  const payloadInstall = join(skillRoot, "install");
  const apply = a.includes("--apply");
  const allowDev = a.includes("--allow-dev");

  if (detectDevTree(configRoot) && !allowDev) {
    console.log(JSON.stringify({
      ok: false,
      refused: "dev-tree",
      detail: `${configRoot} is a WorkOS source tree (dev-tree marker present) — refusing to deploy core. Use --allow-dev only in a sandbox.`,
    }, null, 2));
    process.exit(2);
  }

  const skills = deploySkills(payloadInstall, configRoot, apply);
  const results = [
    skills,
    deployRuntime(payloadInstall, configRoot, apply),
    deployClaudeMd(payloadInstall, configRoot, apply),
    scaffoldMemory(configRoot, apply),
    deployDependencies(payloadInstall, configRoot, apply),
    deployNestedDependencies(payloadInstall, configRoot, apply, skills.owned ?? []),
  ];

  // A missing required payload source (blocker) or a copy failure is a hard
  // failure, not a silent success — `ok` requires both lists empty.
  const blockers = results.flatMap((r) => r.blockers);
  const failures = results.flatMap((r) => r.failures);
  const ok = blockers.length === 0 && failures.length === 0;
  const skillsResult = results.find((r) => r.what === "skills");
  const skillsCopied = skillsResult?.copied ?? 0;
  const runtimeCopied = results.find((r) => r.what === "runtime")?.copied ?? 0;
  const skillConflicts = skillsResult?.conflicts ?? [];
  const keptYours = results.flatMap((r) => r.keptYours ?? []);

  const notes: string[] = [];
  if (skillConflicts.length > 0) {
    notes.push(`⚠️ ${skillConflicts.length} skill(s) NOT deployed — case-insensitive name collision with pre-existing skills (see skillConflicts). SURFACE THIS TO THE USER: their dirs were left untouched, and the colliding WorkOS skills are not installed until resolved.`);
  }
  if (keptYours.length > 0) {
    notes.push(`kept (yours): ${keptYours.join(", ")} — existing and not WorkOS's, so WorkOS did not write into them; the WorkOS versions of those are not installed.`);
  }
  if (!apply) notes.push("dry-run — re-run with --apply to deploy (a blocked source fails the run in both modes)");

  console.log(JSON.stringify({
    ok,
    dryRun: !apply,
    configRoot,
    payloadInstall,
    skillsDst: join(configRoot, "skills"),
    runtimeDst: join(configRoot, "WORKOS"),
    skillsCopied,
    runtimeCopied,
    skillConflicts,
    keptYours,
    blockers,
    failures,
    results,
    note: notes.length > 0 ? notes.join(" | ") : undefined,
  }, null, 2));
  process.exit(ok ? 0 : 1);
}

main();
