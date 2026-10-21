#!/usr/bin/env bun
/**
 * InstallRun — opens and closes one install run, so every tool's backups land in ONE
 * `.workos-backup/<timestamp>/` and Rollback can undo the install as a unit.
 *
 *   bun InstallRun.ts start    new run id → <root>/.workos-backup/current-run (prints it)
 *   bun InstallRun.ts show     the active run, if any
 *   bun InstallRun.ts finish   closes the run (removes current-run; the backup stays)
 *
 * A writing tool that finds no active run starts one itself, so nothing ever escapes the
 * manifest — `start` just makes the boundary explicit. `WORKOS_INSTALL_RUN=<id>` overrides.
 * Usage: bun InstallRun.ts <start|show|finish> [--config-root <dir>]
 */

import { existsSync, readdirSync, rmdirSync, rmSync } from "node:fs";
import { homedir } from "node:os";
import { join } from "node:path";
import { BACKUP_DIRNAME, CURRENT_RUN_FILE, currentRun, startRun } from "./lib/ledger";

const a = process.argv.slice(2);
const i = a.indexOf("--config-root");
const root = (i >= 0 && a[i + 1]) || process.env.CLAUDE_CONFIG_DIR || join(process.env.HOME || homedir(), ".claude");
const cmd = a.find((x) => !x.startsWith("--") && x !== root) ?? "show";

if (cmd === "start") {
  console.log(JSON.stringify({ ok: true, run: startRun(root), backup: join(root, BACKUP_DIRNAME) }, null, 2));
} else if (cmd === "finish") {
  const run = currentRun(root, false);
  const f = join(root, BACKUP_DIRNAME, CURRENT_RUN_FILE);
  if (existsSync(f)) rmSync(f);
  const b = join(root, BACKUP_DIRNAME);
  if (existsSync(b) && readdirSync(b).length === 0) rmdirSync(b);
  console.log(JSON.stringify({ ok: true, finished: run, note: run ? `backup kept at ${join(b, run)} — Rollback.ts --run ${run} still undoes it` : "no active run" }, null, 2));
} else if (cmd === "show") {
  console.log(JSON.stringify({ ok: true, run: currentRun(root, false) }, null, 2));
} else {
  console.log(JSON.stringify({ ok: false, error: `unknown command ${cmd} (start|show|finish)` }, null, 2));
  process.exit(1);
}
