#!/usr/bin/env bun
/**
 * Substitute — Setup steps 4 and 9(d). Renders the identity/version placeholders
 * ({{PRINCIPAL_NAME}}, {{PRINCIPAL_FULL_NAME}}, {{DA_NAME}}, {{DA_FULL_NAME}},
 * {{WORKOS_VERSION}}) across the deployed tree, then verifies none survive.
 *
 * Thin entry point over InstallEngine.substituteTree() + checkSurvivingPlaceholders()
 * — same traversal for both, so anything the check cannot see was never substituted
 * either. Dry-run by default: reports the surviving placeholders and writes nothing.
 *
 * Scope: ONLY WorkOS-owned files under the config root (payload match, or recorded as
 * added in the install manifest) plus settings.json. LifeOS copies, the developer's files
 * and Claude Code's state are never read or rewritten — before this, a run over a LifeOS
 * root rewrote 116–232 LifeOS files with no backup. Each rewrite is backed up through the
 * ledger first. A --root outside the config root is taken as given.
 *
 * Usage:
 *   bun Substitute.ts --principal-name <n> --da-name <n>
 *       [--principal-full-name <n>] [--da-full-name <n>]   (default: the short name)
 *       [--version <v>]                                    (default: <configRoot>/WORKOS/VERSION)
 *       [--root <path>]...                                 (default: <configRoot>; repeatable)
 *       [--config-root <dir>] [--apply] [--allow-dev]
 *
 * Exit: 0 when no placeholder survives (after --apply) / dry-run report printed;
 *       1 when placeholders survive an --apply or a required name is missing; 2 dev tree.
 */

import { existsSync, readFileSync } from "node:fs";
import { homedir } from "node:os";
import { join, relative, isAbsolute } from "node:path";
import { checkSurvivingPlaceholders, detectDevTree, substituteTree, type TreeScope } from "./InstallEngine";
import { Classifier } from "./lib/inventory";
import { Ledger } from "./lib/ledger";

function main(): void {
  const a = process.argv.slice(2);
  const get = (f: string): string | undefined => {
    const i = a.indexOf(f);
    return i >= 0 && a[i + 1] && !a[i + 1].startsWith("--") ? a[i + 1] : undefined;
  };
  const home = process.env.HOME || homedir();
  const configRoot = get("--config-root") || process.env.CLAUDE_CONFIG_DIR || join(home, ".claude");
  const apply = a.includes("--apply");
  const roots = a.flatMap((v, i) => (v === "--root" && a[i + 1] && !a[i + 1].startsWith("--") ? [a[i + 1]] : []));
  if (roots.length === 0) roots.push(configRoot);

  if (detectDevTree(configRoot) && !a.includes("--allow-dev")) {
    console.log(JSON.stringify({ ok: false, refused: "dev-tree", detail: `${configRoot} is a source tree — refusing to substitute.` }, null, 2));
    process.exit(2);
  }

  const versionFile = join(configRoot, "WORKOS", "VERSION");
  const principal = get("--principal-name");
  const da = get("--da-name");
  const version = get("--version") || (existsSync(versionFile) ? readFileSync(versionFile, "utf8").trim() : undefined);

  const classifier = new Classifier(configRoot, get("--skill-root") || join(import.meta.dir, ".."));
  const filter = (file: string): boolean => {
    const rel = relative(configRoot, file);
    if (rel.startsWith("..") || isAbsolute(rel)) return true; // explicit root outside the config root
    if (rel === "settings.json") return true;
    return classifier.file(rel).cls === "workos";
  };
  const scope: TreeScope = { filter };
  const before = roots.map((r) => ({ root: r, ...checkSurvivingPlaceholders(r, scope) }));
  if (!apply) {
    console.log(JSON.stringify({
      ok: true, dryRun: true, configRoot, roots,
      surviving: before.reduce((n, r) => n + r.total, 0),
      sites: before.flatMap((r) => r.files),
      note: "dry-run — re-run with --apply and the names to substitute",
    }, null, 2));
    process.exit(0);
  }

  const missing = [!principal && "--principal-name", !da && "--da-name", !version && "--version (no WORKOS/VERSION found)"].filter(Boolean);
  if (missing.length) {
    console.log(JSON.stringify({ ok: false, error: `missing ${missing.join(", ")}` }, null, 2));
    process.exit(1);
  }

  const vars = {
    "{{PRINCIPAL_NAME}}": principal!,
    "{{PRINCIPAL_FULL_NAME}}": get("--principal-full-name") || principal!,
    "{{DA_NAME}}": da!,
    "{{DA_FULL_NAME}}": get("--da-full-name") || da!,
    "{{WORKOS_VERSION}}": version!,
  };
  const ledger = new Ledger(configRoot, "Substitute");
  const substituted = roots.map((r) => ({ root: r, ...substituteTree(r, vars, { filter, ledger }) }));
  const after = roots.map((r) => ({ root: r, ...checkSurvivingPlaceholders(r, scope) }));
  const surviving = after.reduce((n, r) => n + r.total, 0);
  console.log(JSON.stringify({
    ok: surviving === 0, configRoot, roots, substituted, surviving,
    sites: after.flatMap((r) => r.files),
  }, null, 2));
  process.exit(surviving === 0 ? 0 : 1);
}

main();
