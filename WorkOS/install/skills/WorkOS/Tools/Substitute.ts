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
import { join } from "node:path";
import { checkSurvivingPlaceholders, detectDevTree, substituteTree } from "./InstallEngine";

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

  const before = roots.map((r) => ({ root: r, ...checkSurvivingPlaceholders(r) }));
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
  const substituted = roots.map((r) => ({ root: r, ...substituteTree(r, vars) }));
  const after = roots.map((r) => ({ root: r, ...checkSurvivingPlaceholders(r) }));
  const surviving = after.reduce((n, r) => n + r.total, 0);
  console.log(JSON.stringify({
    ok: surviving === 0, configRoot, roots, substituted, surviving,
    sites: after.flatMap((r) => r.files),
  }, null, 2));
  process.exit(surviving === 0 ? 0 : 1);
}

main();
