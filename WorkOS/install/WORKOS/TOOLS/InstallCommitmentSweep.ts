#!/usr/bin/env bun
/**
 * InstallCommitmentSweep.ts — Install the daily commitment sweep as a systemd --user timer.
 *
 *   bun ~/.claude/WORKOS/TOOLS/InstallCommitmentSweep.ts             # install
 *   bun ~/.claude/WORKOS/TOOLS/InstallCommitmentSweep.ts --uninstall # remove
 *   bun ~/.claude/WORKOS/TOOLS/InstallCommitmentSweep.ts --status    # show unit state
 *
 * Linux only (systemd --user via lib/SystemdUser). Idempotent — re-runs cleanly replace existing.
 * ported from public PR #1698, @elhoim
 */

import { join } from "path";
import * as systemd from "./lib/SystemdUser";
import { homedir } from "node:os";

const HOME = process.env.HOME ?? process.env.USERPROFILE ?? homedir();
const STATE_DIR = join(HOME, ".claude", "WORKOS", "MEMORY", "STATE");
const LABEL = "com.workos.commitmentsweep";

async function linuxSpec(): Promise<systemd.UnitSpec> {
  const bunPath = await systemd.which("bun");
  if (!bunPath) throw new Error("bun not found in PATH - install bun first");
  return {
    label: LABEL,
    description: "WorkOS commitment sweep",
    exec: [bunPath, join(HOME, ".claude", "WORKOS", "TOOLS", "CommitmentSweep.ts")],
    logPath: join(STATE_DIR, "com.workos.commitmentsweep.log"),
    workingDirectory: join(HOME, ".claude"),
    schedule: { kind: "calendar", hour: 7, minute: 0 },
  };
}

async function main() {
  const args = process.argv.slice(2);
  if (!systemd.isLinux()) {
    console.error("[InstallCommitmentSweep] systemd --user (Linux) only — run CommitmentSweep.ts on demand elsewhere");
    process.exit(1);
  }
  const spec = await linuxSpec();
  const log = (m: string) => console.log(`[InstallCommitmentSweep] ${m}`);
  if (args.includes("--uninstall")) { await systemd.uninstall(spec, log); return; }
  if (args.includes("--status")) { if (!(await systemd.status(spec, log))) process.exit(1); return; }
  if (!(await systemd.install(spec, log))) process.exit(1);
}

if (import.meta.main) main().catch((err) => { console.error(`[InstallCommitmentSweep] Fatal: ${err}`); process.exit(1); });
