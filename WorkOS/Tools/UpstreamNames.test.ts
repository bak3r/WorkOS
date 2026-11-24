/**
 * WorkOS ships under its own name: the upstream project's name appears nowhere in the
 * skill or the install payload, except in the files that must say it to do their job.
 * Ports from upstream land text that says where they came from; this check fails the
 * release until that text is reworded (Ales, 2026-11-24).
 *
 * Allowed: the installer's migration from an existing upstream install (it detects,
 * inventories and adopts upstream paths, env keys and release manifests), and tests
 * that assert the name is absent. A new entry needs a reason that is a job, not history.
 */
import { describe, expect, test } from "bun:test";
import { readdirSync, readFileSync, statSync } from "node:fs";
import { join, relative } from "node:path";

const SKILL_ROOT = join(import.meta.dir, "..");
const NAME = /lifeos/i;

/** Paths relative to the skill root. The skill ships a second copy of itself at install/skills/WorkOS/. */
const MIGRATION = [
  "Tools/Adopt.ts", // moves untouched upstream copies to the backup, keeps edited ones
  "Tools/Inventory.ts", // classifies an existing install's files as upstream copy / edited / data
  "Tools/lib/inventory.ts", // the classification itself, against upstream release manifests
  "Tools/lib/claude-md.ts", // rewrites upstream paths in an adopted CLAUDE.md
  "Tools/data/", // upstream release manifests (sha256 per shipped file) and their generator
  "Tools/InstallEngine.ts", // detects an existing upstream install (existingInstall.lifeos)
  "Tools/DetectEnv.ts", // reports that detection to Setup
  "Tools/ScanConflicts.ts", // upstream presence and hook registrations feed the conflict decision
  "Tools/ActivateImports.ts", // --fix-lifeos-paths rewrites upstream paths in an adopted CLAUDE.md
  "Tools/OverlaySystem.ts", // never overwrites upstream copies; legacy-install rule
  "Tools/InstallHooks.ts", // refuses to register onto upstream hook files, points to Adopt
  "Tools/Substitute.ts", // never reads or rewrites upstream copies
  "Tools/DeployCore.ts", // runs Inventory and Adopt first when an upstream install is present
  "Tools/DeployComponents.ts", // never writes into edited upstream copies
  "INSTALL.md", // the user-facing migration guide (Inventory classes, Adopt, Rollback)
  "SKILL.md", // Setup summary: adopt an upstream install when present
  "Workflows/Setup.md", // the setup steps that run the migration
  "Workflows/Uninstall.md", // Rollback restores the upstream install
  "Tools/Installer.test.ts", // tests the migration above
  "Tools/UpstreamNames.test.ts", // this check
];
const ALLOWED = [
  ...MIGRATION,
  ...MIGRATION.map((p) => `install/skills/WorkOS/${p}`),
  "install/WORKOS/STATUSLINE/StatusLine.test.ts", // asserts the status line never shows the name
];

const allowed = (rel: string) => ALLOWED.some((a) => (a.endsWith("/") ? rel.startsWith(a) : rel === a));

function* files(dir: string): Generator<string> {
  for (const e of readdirSync(dir, { withFileTypes: true })) {
    if (e.name === "node_modules" || e.name === ".git") continue;
    const p = join(dir, e.name);
    if (e.isDirectory()) yield* files(p);
    else if (e.isFile() && statSync(p).size < 5_000_000) yield p;
  }
}

describe("upstream name", () => {
  test("appears only where the installer's migration needs it", () => {
    const hits: string[] = [];
    for (const p of files(SKILL_ROOT)) {
      const rel = relative(SKILL_ROOT, p);
      if (allowed(rel)) continue;
      const lines = readFileSync(p, "utf8").split("\n");
      lines.forEach((l, i) => { if (NAME.test(l) || NAME.test(rel)) hits.push(`${rel}:${i + 1}`); });
    }
    expect(hits).toEqual([]);
  });
});
