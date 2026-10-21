#!/usr/bin/env bun
/**
 * InstallWorkSweep.ts — Materialize the WorkSweep scheduler unit(s) and bootstrap them.
 *
 *   bun ~/.claude/WORKOS/TOOLS/InstallWorkSweep.ts             # install
 *   bun ~/.claude/WORKOS/TOOLS/InstallWorkSweep.ts --uninstall # remove
 *   bun ~/.claude/WORKOS/TOOLS/InstallWorkSweep.ts --status    # check
 *
 * Linux only (systemd --user): substitutes {{HOME}}/{{BUN}}/{{BUN_DIR}} into
 * com.workos.worksweep.{service,timer}.template, writes them to
 * ~/.config/systemd/user/, and enables the timer with `systemctl --user`.
 * Needs `loginctl enable-linger` to survive logout. Idempotent — install tears
 * down the prior unit first. (public PR #1692, @takanorinishida)
 */

import { existsSync, readFileSync, writeFileSync, mkdirSync, unlinkSync } from "fs";
import { join } from "path";
import { homedir } from "node:os";

declare const Bun: { spawn: (cmd: string[], opts?: any) => any };

const HOME = process.env.HOME ?? process.env.USERPROFILE ?? homedir();
const LABEL = "com.workos.worksweep";
const IS_LINUX = process.platform === "linux";

const SERVICE_TEMPLATE_PATH = join(HOME, ".claude", "WORKOS", "TOOLS", "com.workos.worksweep.service.template");
const TIMER_TEMPLATE_PATH = join(HOME, ".claude", "WORKOS", "TOOLS", "com.workos.worksweep.timer.template");
const SYSTEMD_USER_DIR = join(HOME, ".config", "systemd", "user");
const TARGET_SERVICE = join(SYSTEMD_USER_DIR, `${LABEL}.service`);
const TARGET_TIMER = join(SYSTEMD_USER_DIR, `${LABEL}.timer`);
const TIMER_UNIT = `${LABEL}.timer`;

async function username(): Promise<string> {
  // `id -un` rather than process.env.USER — USER isn't guaranteed to be set in a
  // non-interactive shell, and `loginctl enable-linger ""` fails on the empty string.
  const proc = Bun.spawn(["id", "-un"], { stdout: "pipe", stderr: "ignore" });
  const out = await new Response(proc.stdout).text();
  await proc.exited;
  return out.trim();
}

async function run(cmd: string[]): Promise<{ ok: boolean; out: string; err: string }> {
  const proc = Bun.spawn(cmd, { stdout: "pipe", stderr: "pipe" });
  const out = await new Response(proc.stdout).text();
  const err = await new Response(proc.stderr).text();
  const exit = await proc.exited;
  return { ok: exit === 0, out, err };
}

function materialize(templatePath: string, bunPath: string, bunDir: string): string {
  return readFileSync(templatePath, "utf-8")
    .replace(/\{\{HOME\}\}/g, HOME)
    .replace(/\{\{BUN\}\}/g, bunPath)
    .replace(/\{\{BUN_DIR\}\}/g, bunDir);
}

async function detectBun(): Promise<string> {
  // Detect bun via `which bun` — survives different install paths (homebrew, ~/.bun, asdf).
  const proc = Bun.spawn(["which", "bun"], { stdout: "pipe", stderr: "ignore" });
  const out = await new Response(proc.stdout).text();
  await proc.exited;
  const path = out.trim();
  if (!path) throw new Error("bun not found in PATH — install bun first");
  return path;
}

async function installLinux(): Promise<void> {
  if (!existsSync(SERVICE_TEMPLATE_PATH) || !existsSync(TIMER_TEMPLATE_PATH)) {
    console.error(`[InstallWorkSweep] template missing — expected ${SERVICE_TEMPLATE_PATH} and ${TIMER_TEMPLATE_PATH}`);
    process.exit(1);
  }
  const bunPath = await detectBun();
  const bunDir = bunPath.replace(/\/bun$/, "");
  console.log(`[InstallWorkSweep] detected bun at ${bunPath}`);

  if (!existsSync(SYSTEMD_USER_DIR)) mkdirSync(SYSTEMD_USER_DIR, { recursive: true });

  // Idempotent teardown (ignore failures — first install has nothing to remove)
  await run(["systemctl", "--user", "disable", "--now", TIMER_UNIT]);

  writeFileSync(TARGET_SERVICE, materialize(SERVICE_TEMPLATE_PATH, bunPath, bunDir));
  writeFileSync(TARGET_TIMER, materialize(TIMER_TEMPLATE_PATH, bunPath, bunDir));
  console.log(`[InstallWorkSweep] wrote ${TARGET_SERVICE}`);
  console.log(`[InstallWorkSweep] wrote ${TARGET_TIMER}`);

  await run(["systemctl", "--user", "daemon-reload"]);
  await run(["loginctl", "enable-linger", await username()]);

  const r = await run(["systemctl", "--user", "enable", "--now", TIMER_UNIT]);
  if (!r.ok) {
    console.error(`[InstallWorkSweep] enable --now failed: ${r.err.trim()}`);
    process.exit(1);
  }
  console.log(`[InstallWorkSweep] systemd timer enabled — ${TIMER_UNIT} active`);

  const list = await run(["systemctl", "--user", "list-timers", TIMER_UNIT, "--no-pager"]);
  if (list.ok) console.log(list.out.trim());
}

async function uninstallLinux(): Promise<void> {
  await run(["systemctl", "--user", "disable", "--now", TIMER_UNIT]);
  let removed = false;
  for (const f of [TARGET_SERVICE, TARGET_TIMER]) {
    if (existsSync(f)) {
      try { unlinkSync(f); console.log(`[InstallWorkSweep] removed ${f}`); removed = true; } catch {}
    }
  }
  if (!removed) console.log(`[InstallWorkSweep] no unit files found — nothing to do`);
  await run(["systemctl", "--user", "daemon-reload"]);
}

async function statusLinux(): Promise<void> {
  const r = await run(["systemctl", "--user", "status", TIMER_UNIT, "--no-pager"]);
  console.log(r.out || r.err);
  const list = await run(["systemctl", "--user", "list-timers", TIMER_UNIT, "--no-pager"]);
  if (list.ok) console.log(list.out.trim());
  if (!r.ok) process.exit(1);
}

async function main(): Promise<void> {
  const arg = process.argv[2];
  if (!IS_LINUX) {
    console.error("[InstallWorkSweep] systemd --user (Linux) only — run WorkSweep.ts on demand elsewhere");
    process.exit(1);
  }
  if (arg === "--uninstall") return uninstallLinux();
  if (arg === "--status") return statusLinux();
  return installLinux();
}

if (import.meta.main) {
  main().catch((err) => { console.error(`[InstallWorkSweep] Fatal: ${err}`); process.exit(1); });
}
