#!/usr/bin/env bun
/**
 * DetectEnv — Setup step 1. Read-only environment detection for the WorkOS
 * installer. Emits the JSON the Setup workflow branches on (OS, harness, GUI,
 * SSH, bun, existing install `{workos, lifeos}`, dev-tree refusal flag, settings/CLAUDE.md
 * state).
 *
 * Thin entry point over InstallEngine.detectEnv() — all logic lives there.
 *
 * Usage: bun DetectEnv.ts [--json]   (--json is the default and only format)
 */

import { join } from "node:path";
import { detectEnv } from "./InstallEngine";
import { inventory } from "./lib/inventory";

function main(): void {
  const env = detectEnv();
  // existingInstall.lifeos from the real Inventory (hash-classified), not the cheap signal:
  // Setup runs Inventory + Adopt before DeployCore when it is true.
  try {
    const inv = inventory(env.configRoot, join(import.meta.dir, ".."));
    env.existingInstall = { workos: env.existingInstall.workos || inv.workos.present, lifeos: inv.lifeos.present };
  } catch { /* unreadable root — keep the quick signal */ }
  // Single JSON object, jq-pipeable. The Setup workflow reads these fields by name.
  console.log(JSON.stringify(env, null, 2));
  // Exit 0 always — detection never "fails"; the workflow decides on the data.
  process.exit(0);
}

main();
