#!/usr/bin/env bun
/**
 * InstallAtlas.ts — Materialize the Atlas tick unit(s) and bootstrap them.
 *
 *   bun ~/.claude/WORKOS/ATLAS/InstallAtlas.ts             # install
 *   bun ~/.claude/WORKOS/ATLAS/InstallAtlas.ts --uninstall # remove
 *   bun ~/.claude/WORKOS/ATLAS/InstallAtlas.ts --status    # check
 *
 * Same pattern as WORKOS/TOOLS/InstallWorkSweep.ts — Linux only (systemd --user):
 * substitutes into com.workos.atlas.{service,timer}.template, writes them to
 * ~/.config/systemd/user/, enables the timer with `systemctl --user`, and runs
 * `loginctl enable-linger` so it survives logout. Hints written by
 * AtlasEventCapture.hook.ts wait for the next tick, which only costs latency.
 * Idempotent: install tears down the prior unit before enabling the fresh one.
 *
 * ported from public PR #1743, @schmetti-dev
 */

import { existsSync, readFileSync, writeFileSync, mkdirSync, unlinkSync } from "fs";
import { join } from "path";

declare const Bun: { spawn: (cmd: string[], opts?: any) => any };

const HOME = process.env.HOME || "";
const LABEL = "com.workos.atlas";
const IS_LINUX = process.platform === "linux";

const SERVICE_TEMPLATE_PATH = join(HOME, ".claude", "WORKOS", "ATLAS", "com.workos.atlas.service.template");
const TIMER_TEMPLATE_PATH = join(HOME, ".claude", "WORKOS", "ATLAS", "com.workos.atlas.timer.template");
const SYSTEMD_USER_DIR = join(HOME, ".config", "systemd", "user");
const TARGET_SERVICE = join(SYSTEMD_USER_DIR, `${LABEL}.service`);
const TARGET_TIMER = join(SYSTEMD_USER_DIR, `${LABEL}.timer`);
const TIMER_UNIT = `${LABEL}.timer`;

async function run(cmd: string[]): Promise<{ ok: boolean; out: string; err: string }> {
  const proc = Bun.spawn(cmd, { stdout: "pipe", stderr: "pipe" });
  const out = await new Response(proc.stdout).text();
  const err = await new Response(proc.stderr).text();
  const exit = await proc.exited;
  return { ok: exit === 0, out, err };
}

async function username(): Promise<string> {
  // `id -un` rather than process.env.USER — USER isn't guaranteed to be set in a
  // non-interactive shell, and `loginctl enable-linger ""` fails on the empty string.
  const proc = Bun.spawn(["id", "-un"], { stdout: "pipe", stderr: "ignore" });
  const out = await new Response(proc.stdout).text();
  await proc.exited;
  return out.trim();
}

/** `which <bin>`, or null when it isn't on PATH. */
async function which(bin: string): Promise<string | null> {
  const proc = Bun.spawn(["which", bin], { stdout: "pipe", stderr: "ignore" });
  const out = await new Response(proc.stdout).text();
  await proc.exited;
  return out.trim() || null;
}

async function detectBun(): Promise<string> {
  // Survives different install paths (homebrew, ~/.bun, asdf). Hard requirement:
  // the unit's ExecStart IS bun, so there is nothing to degrade to.
  const path = await which("bun");
  if (!path) throw new Error("bun not found in PATH — install bun first");
  return path;
}

async function detectGlab(): Promise<string | null> {
  // The gitlab collector shells out to `glab`, so its directory is worth putting on
  // the unit's PATH — but a missing `glab` is a normal state, not a fault: Gitlab.ts
  // already degrades to an incomplete run when the binary is absent. Refusing to install the
  // whole Atlas tick because one collector can't reach its source would
  // be strictly worse than installing it and letting that collector report PARTIAL.
  const path = await which("glab");
  if (!path) console.warn("[InstallAtlas] glab not found in PATH — installing anyway; the gitlab collector will report incomplete until it is installed");
  return path;
}

/**
 * Unit PATH: the detected tool dirs first, then the usual install prefixes.
 * Deduped in order, so a bun and glab that share a prefix (the common homebrew case)
 * don't emit that prefix twice, and an absent glab simply contributes nothing.
 */
function unitPath(bunDir: string, glabDir: string | null): string {
  const parts = [bunDir, glabDir, join(HOME, ".local/bin"), "/opt/homebrew/bin", "/usr/local/bin", "/usr/bin", "/bin"];
  const seen = new Set<string>();
  return parts.filter((p): p is string => !!p && !seen.has(p) && (seen.add(p), true)).join(":");
}

function materialize(templatePath: string, bunPath: string, path: string): string {
  return readFileSync(templatePath, "utf-8")
    .replace(/\{\{HOME\}\}/g, HOME)
    .replace(/\{\{BUN\}\}/g, bunPath)
    .replace(/\{\{PATH\}\}/g, path);
}

async function detected(): Promise<{ bunPath: string; path: string }> {
  const bunPath = await detectBun();
  const glabPath = await detectGlab();
  const path = unitPath(bunPath.replace(/\/bun$/, ""), glabPath?.replace(/\/glab$/, "") ?? null);
  console.log(`[InstallAtlas] detected bun at ${bunPath}${glabPath ? `, glab at ${glabPath}` : ""}`);
  return { bunPath, path };
}

async function installLinux(): Promise<void> {
  if (!existsSync(SERVICE_TEMPLATE_PATH) || !existsSync(TIMER_TEMPLATE_PATH)) {
    console.error(`[InstallAtlas] template missing — expected ${SERVICE_TEMPLATE_PATH} and ${TIMER_TEMPLATE_PATH}`);
    process.exit(1);
  }
  const { bunPath, path } = await detected();

  if (!existsSync(SYSTEMD_USER_DIR)) mkdirSync(SYSTEMD_USER_DIR, { recursive: true });

  // Idempotent teardown (ignore failures — first install has nothing to remove)
  await run(["systemctl", "--user", "disable", "--now", TIMER_UNIT]);

  writeFileSync(TARGET_SERVICE, materialize(SERVICE_TEMPLATE_PATH, bunPath, path));
  writeFileSync(TARGET_TIMER, materialize(TIMER_TEMPLATE_PATH, bunPath, path));
  console.log(`[InstallAtlas] wrote ${TARGET_SERVICE}`);
  console.log(`[InstallAtlas] wrote ${TARGET_TIMER}`);

  await run(["systemctl", "--user", "daemon-reload"]);

  // Survive logout/reboot. An empty username would make `enable-linger` fail, so skip loudly.
  const lingerUser = await username();
  if (lingerUser) await run(["loginctl", "enable-linger", lingerUser]);
  else console.warn("[InstallAtlas] could not resolve username via 'id -un' — skipping loginctl enable-linger (timer may not survive logout)");

  const r = await run(["systemctl", "--user", "enable", "--now", TIMER_UNIT]);
  if (!r.ok) {
    console.error(`[InstallAtlas] enable --now failed: ${r.err.trim()}`);
    process.exit(1);
  }
  console.log(`[InstallAtlas] systemd timer enabled — ${TIMER_UNIT} active`);

  const list = await run(["systemctl", "--user", "list-timers", TIMER_UNIT, "--no-pager"]);
  if (list.ok) console.log(list.out.trim());
}

async function uninstallLinux(): Promise<void> {
  await run(["systemctl", "--user", "disable", "--now", TIMER_UNIT]);
  let removed = false;
  for (const f of [TARGET_SERVICE, TARGET_TIMER]) {
    if (existsSync(f)) {
      try { unlinkSync(f); console.log(`[InstallAtlas] removed ${f}`); removed = true; } catch {}
    }
  }
  if (!removed) console.log(`[InstallAtlas] no unit files found — nothing to do`);
  await run(["systemctl", "--user", "daemon-reload"]);
}

async function statusLinux(): Promise<void> {
  const r = await run(["systemctl", "--user", "status", TIMER_UNIT, "--no-pager"]);
  console.log(r.out || r.err);
  const list = await run(["systemctl", "--user", "list-timers", TIMER_UNIT, "--no-pager"]);
  if (list.ok) console.log(list.out.trim());
  if (!r.ok) process.exit(1);
}

function unsupported(): never {
  console.error(`[InstallAtlas] unsupported platform: ${process.platform} (Linux/systemd only)`);
  process.exit(1);
}

async function main(): Promise<void> {
  const arg = process.argv[2];
  if (!IS_LINUX) unsupported();
  if (arg === "--uninstall") return uninstallLinux();
  if (arg === "--status") return statusLinux();
  return installLinux();
}

if (import.meta.main) {
  main().catch((err) => { console.error(`[InstallAtlas] Fatal: ${err}`); process.exit(1); });
}
