#!/usr/bin/env bun
/**
 * InstallDerivedSync.ts - Install the derived-file sync watcher as a systemd --user .path unit.
 *
 *   bun ~/.claude/WORKOS/TOOLS/InstallDerivedSync.ts             # install
 *   bun ~/.claude/WORKOS/TOOLS/InstallDerivedSync.ts --uninstall # remove
 *   bun ~/.claude/WORKOS/TOOLS/InstallDerivedSync.ts --status    # check
 *
 * Linux only (systemd --user via lib/SystemdUser). One PathModified= per watched directory.
 * ported from public PR #1698, @elhoim
 */

import { getClaudeDir, workosPath } from "./Paths";
import { existsSync, realpathSync } from "fs";
import { join } from "path";
import * as systemd from "./lib/SystemdUser";

const LABEL = "com.workos.derivedsync";

async function linuxSpec(): Promise<systemd.UnitSpec> {
  const bunPath = await systemd.which("bun");
  if (!bunPath) throw new Error("bun not found in PATH - install bun first");
  // WORKOS/USER is a symlink into the private config repo, and watching the
  // link rather than its target would never fire on a write to the real file.
  const userDir = realpathSync(workosPath("USER"));
  return {
    label: LABEL,
    description: "WorkOS derived-file sync",
    exec: [bunPath, workosPath("TOOLS", "DerivedSync.ts")],
    logPath: workosPath("MEMORY", "OBSERVABILITY", "derived-sync-systemd.log"),
    workingDirectory: getClaudeDir(),
    schedule: {
      kind: "watch",
      // A missing directory is dropped: systemd refuses to start a .path unit
      // naming a path that isn't there.
      paths: [
        userDir,
        join(userDir, "TELOS"),
        join(userDir, "PRINCIPAL"),
        join(userDir, "DIGITAL_ASSISTANT"),
        join(userDir, "CONFIG"),
      ].filter((p) => existsSync(p)),
    },
  };
}

async function main(): Promise<void> {
  const arg = process.argv[2];
  if (!systemd.isLinux()) {
    console.error("[InstallDerivedSync] systemd --user (Linux) only — run DerivedSync.ts on demand elsewhere");
    process.exit(1);
  }
  const spec = await linuxSpec();
  const log = (m: string) => console.log(`[InstallDerivedSync] ${m}`);
  if (arg === "--uninstall") { await systemd.uninstall(spec, log); return; }
  if (arg === "--status") { if (!(await systemd.status(spec, log))) process.exit(1); return; }
  if (!(await systemd.install(spec, log))) process.exit(1);
}

main().catch((err) => { console.error(`[InstallDerivedSync] Fatal: ${err}`); process.exit(1); });
