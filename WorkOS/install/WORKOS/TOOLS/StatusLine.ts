#!/usr/bin/env bun
/**
 * StatusLine.ts — switch the statusline off or back on.
 *
 * The statusline is the one always-visible status display; off removes it and nothing replaces it, and on brings it
 * back with one command.
 *
 * settings.json is generated (MergeSettings.ts: settings.system.json ⊕ the user overlay, at every SessionStart, after
 * SettingsBackport.ts copies hand edits of settings.json into the overlay), so the switch lives in the overlay, never
 * in the output. settings.system.json ships no statusLine; the installer's block reaches the overlay through the
 * backport. Off runs the backport, moves the overlay's `statusLine` into MEMORY/STATE/statusline-kept.json and
 * deletes it; on puts that block back (or the stock one). Either way it then regenerates settings.json with the same
 * two steps SessionStart runs.
 *
 *   bun StatusLine.ts off | on | status
 *
 * A running session reads settings at start: the change shows in new sessions.
 */
import { existsSync, mkdirSync, readFileSync, renameSync, writeFileSync } from "node:fs";
import { spawnSync } from "node:child_process";
import { dirname, join } from "node:path";
import { defaultClaudeDir, getClaudeDir, getWorkosDir } from "./Paths";
import { invariant } from "./Invariant";

export const STOCK = { type: "command", command: "$HOME/.claude/WORKOS/WORKOS_StatusLine.sh", refreshInterval: 5 } as const;
/**
 * The stock block for the install at `workosDir` (default: the live one). A default install keeps the portable
 * `$HOME/.claude/WORKOS` form (STOCK); an install at another root (a sandbox's CLAUDE_CONFIG_DIR) gets that root's
 * script, single-quoted so a path with spaces or metacharacters reaches the shell as one word.
 */
export function stockBlock(workosDir: string = getWorkosDir(), home: string = process.env.HOME ?? ""): { type: string; command: string; refreshInterval: number } {
  if (home && workosDir === join(defaultClaudeDir(home), "WORKOS")) return STOCK;
  const script = join(workosDir, "WORKOS_StatusLine.sh");
  return { type: "command", command: `'${script.split("'").join(`'\\''`)}'`, refreshInterval: STOCK.refreshInterval };
}

export interface Paths { system: string; user: string; output: string; kept: string }

export function defaultPaths(): Paths {
  const root = getClaudeDir();
  return {
    system: join(root, "settings.system.json"),
    user: join(getWorkosDir(), "USER", "CONFIG", "settings.user.json"),
    output: join(root, "settings.json"),
    kept: join(getWorkosDir(), "MEMORY", "STATE", "statusline-kept.json"),
  };
}

type Obj = Record<string, unknown>;

function readObj(p: string): Obj {
  const raw = JSON.parse(readFileSync(p, "utf8")) as unknown;
  invariant(raw && typeof raw === "object" && !Array.isArray(raw), `${p} is not a JSON object`);
  return raw as Obj;
}

/** Write through a temp file so a crash never leaves the overlay half written. */
function writeObj(p: string, o: Obj, keysBefore: number, delta: number): void {
  invariant(Object.keys(o).length === keysBefore + delta, `the overlay must change by exactly ${delta} key(s)`);
  const tmp = `${p}.statusline-tmp`;
  writeFileSync(tmp, JSON.stringify(o, null, 2) + "\n");
  JSON.parse(readFileSync(tmp, "utf8"));
  renameSync(tmp, p);
}

function bunTool(name: string, args: string[]): void {
  const r = spawnSync("bun", [join(getWorkosDir(), "TOOLS", name), ...args], { encoding: "utf8", timeout: 30_000 });
  invariant(r.status === 0, `${name} failed: ${(r.stderr || r.stdout || "").trim().slice(0, 300)}`);
}

/** SessionStart's first step: copy any hand edit of settings.json (the installer's statusLine among them) into the overlay. */
export function backport(_paths: Paths): void {
  bunTool("SettingsBackport.ts", []);
}

/** SessionStart's second step, so the output and its merge snapshot agree. */
export function regenerate(paths: Paths): void {
  bunTool("MergeSettings.ts", ["--system", paths.system, "--user", paths.user, "--output", paths.output]);
}

export function status(paths = defaultPaths()): "on" | "off" {
  return readObj(paths.output).statusLine ? "on" : "off";
}

export function off(paths = defaultPaths(), regen: (p: Paths) => void = regenerate, sync: (p: Paths) => void = backport): string {
  sync(paths);
  const u = readObj(paths.user);
  invariant(!readObj(paths.system).statusLine, "settings.system.json carries a statusLine; the overlay cannot switch it off");
  if (!("statusLine" in u)) {
    regen(paths);
    return status(paths) === "off" ? "already off" : "off failed: settings.json still has a statusLine";
  }
  const keys = Object.keys(u).length;
  mkdirSync(dirname(paths.kept), { recursive: true });
  writeFileSync(paths.kept, JSON.stringify(u.statusLine, null, 2) + "\n");
  delete u.statusLine;
  writeObj(paths.user, u, keys, -1);
  regen(paths);
  invariant(status(paths) === "off", "settings.json still carries a statusLine after the merge");
  return "off: new sessions draw no statusline (the old block is kept)";
}

export function on(paths = defaultPaths(), regen: (p: Paths) => void = regenerate, stock: unknown = stockBlock(), sync: (p: Paths) => void = backport): string {
  sync(paths);
  const u = readObj(paths.user);
  if (u.statusLine) { regen(paths); return "already on"; }
  let block: unknown = stock;
  if (existsSync(paths.kept)) {
    try { block = JSON.parse(readFileSync(paths.kept, "utf8")); } catch { block = stock; }
  }
  invariant(block && typeof block === "object" && typeof (block as { command?: unknown }).command === "string", "the statusLine block to restore has no command");
  const keys = Object.keys(u).length;
  const had = "statusLine" in u;
  u.statusLine = block;
  writeObj(paths.user, u, keys, had ? 0 : 1);
  regen(paths);
  invariant(status(paths) === "on", "settings.json has no statusLine after the merge");
  return "on: new sessions draw the statusline again";
}

if (import.meta.main) {
  const verb = process.argv[2] ?? "status";
  if (verb === "off") console.log(off());
  else if (verb === "on") console.log(on());
  else if (verb === "status") console.log(status());
  else { console.error("usage: bun StatusLine.ts off | on | status"); process.exit(2); }
}
