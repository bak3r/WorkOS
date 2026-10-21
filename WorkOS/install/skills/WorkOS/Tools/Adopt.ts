#!/usr/bin/env bun
/**
 * Adopt — Setup step 0b. Takes over a config root that already holds LifeOS, BEFORE
 * DeployCore runs, so WorkOS installs onto a clean slate instead of deduping onto LifeOS's
 * files. Dry-run by default; `--apply` mutates, every change through the ledger
 * (`.workos-backup/<run>/` + `WORKOS/install-manifest.jsonl`), so Rollback undoes it.
 *
 * What --apply does, in order:
 *   1. Moves every untouched LifeOS copy (Inventory class `lifeos-copy`) into the backup:
 *      hook files, whole skill dirs, commands, agents, root package.json. A skill dir that
 *      mixes copies with edited/own files is `lifeos-edited` and is KEPT whole.
 *   2. Copies LIFEOS/MEMORY/* into WORKOS/MEMORY/ without overwriting — every subtree the
 *      WorkOS memory system reads (WORK, KNOWLEDGE, LEARNING, WISDOM, RESEARCH, OBSERVABILITY,
 *      …) EXCEPT STATE/, which MemorySystem.md defines as ephemeral runtime state (it holds
 *      LifeOS-path caches WorkOS rebuilds on first run). STATE stays in the backup.
 *   3. settings.json: removes the hook registrations whose command points at a LifeOS copy,
 *      a statusLine that runs a LifeOS copy, and LIFEOS_* env keys still at LifeOS defaults.
 *      Your own hooks and every other key are left alone.
 *   4. Moves the whole LIFEOS/ dir into the backup.
 * Never touches: lifeos-edited / user / claude-owned paths, node_modules/.
 *
 * Usage: bun Adopt.ts [--config-root <dir>] [--skill-root <dir>] [--apply] [--allow-dev]
 * Exit: 0 ok (or nothing to adopt) · 1 failure · 2 dev tree
 */

import { cpSync, existsSync, lstatSync, mkdirSync, readdirSync, readFileSync, readlinkSync, realpathSync, symlinkSync } from "node:fs";
import { homedir } from "node:os";
import { join } from "node:path";
import { detectDevTree } from "./InstallEngine";
import { atomicWriteText } from "./lib/atomic-write";
import { inventory, type Inventory } from "./lib/inventory";
import { Ledger } from "./lib/ledger";

/** MEMORY subtrees NOT carried over (ephemeral runtime state — see MemorySystem.md). */
export const MEMORY_SKIP = new Set(["STATE"]);

function arg(a: string[], flag: string): string | undefined {
  const i = a.indexOf(flag);
  return i >= 0 && a[i + 1] && !a[i + 1].startsWith("--") ? a[i + 1] : undefined;
}

export interface SettingsPlan {
  removeRegistrations: Array<{ event: string; matcher: string; command: string }>;
  removeStatusLine: string | null;
  removeEnv: string[];
  keptLifeosEnv: string[];
}

export function planSettings(inv: Inventory): SettingsPlan {
  const s = inv.settings;
  return {
    removeRegistrations: s.registrations.filter((r) => r.owner === "lifeos").map(({ event, matcher, command }) => ({ event, matcher, command })),
    removeStatusLine: s.statusLine.owner === "lifeos" ? s.statusLine.command ?? null : null,
    removeEnv: s.lifeosEnv.filter((e) => e.isDefault).map((e) => e.key),
    keptLifeosEnv: s.lifeosEnv.filter((e) => !e.isDefault).map((e) => e.key),
  };
}

/** Apply a SettingsPlan to parsed settings (pure). Empty groups/events/env are dropped. */
export function applySettingsPlan(settings: Record<string, any>, plan: SettingsPlan): Record<string, any> {
  const s = JSON.parse(JSON.stringify(settings));
  const drop = new Set(plan.removeRegistrations.map((r) => `${r.event}\u0000${r.matcher}\u0000${r.command}`));
  if (s.hooks && typeof s.hooks === "object") {
    for (const [ev, groups] of Object.entries(s.hooks)) {
      if (!Array.isArray(groups)) continue;
      const kept = (groups as any[]).map((g) => ({
        ...g,
        hooks: (g.hooks ?? []).filter((h: any) => !drop.has(`${ev}\u0000${g.matcher ?? ""}\u0000${h?.command}`)),
      })).filter((g) => g.hooks.length > 0);
      if (kept.length) s.hooks[ev] = kept;
      else delete s.hooks[ev];
    }
    if (Object.keys(s.hooks).length === 0) delete s.hooks;
  }
  if (plan.removeStatusLine !== null) delete s.statusLine;
  if (s.env && typeof s.env === "object") {
    for (const k of plan.removeEnv) delete s.env[k];
    if (Object.keys(s.env).length === 0) delete s.env;
  }
  return s;
}

/** Copy src → dst without overwriting; records every new top-most path in the ledger. */
function copyMemory(src: string, dst: string, ledger: Ledger | null, stats: { copied: number; existing: number }): void {
  const st = lstatSync(src);
  if (st.isSymbolicLink()) {
    if (lstatSync(dst, { throwIfNoEntry: false })) { stats.existing++; return; }
    if (ledger) { ledger.recordAdd(dst); mkdirSync(join(dst, ".."), { recursive: true }); symlinkSync(readlinkSync(src), dst); }
    stats.copied++;
    return;
  }
  if (st.isDirectory()) {
    if (!existsSync(dst) && ledger) { ledger.recordAdd(dst, undefined, "dir"); mkdirSync(dst, { recursive: true }); }
    for (const e of readdirSync(src)) {
      if (e === ".DS_Store") continue;
      copyMemory(join(src, e), join(dst, e), ledger, stats);
    }
    return;
  }
  if (existsSync(dst)) { stats.existing++; return; }
  if (ledger) { ledger.recordAdd(dst); mkdirSync(join(dst, ".."), { recursive: true }); cpSync(src, dst, { preserveTimestamps: true }); }
  stats.copied++;
}

function main(): void {
  const a = process.argv.slice(2);
  const home = process.env.HOME || homedir();
  const root = arg(a, "--config-root") || process.env.CLAUDE_CONFIG_DIR || join(home, ".claude");
  const skillRoot = arg(a, "--skill-root") || join(import.meta.dir, "..");
  const apply = a.includes("--apply");

  if (detectDevTree(root) && !a.includes("--allow-dev")) {
    console.log(JSON.stringify({ ok: false, refused: "dev-tree", detail: `${root} is a WorkOS source tree — refusing to adopt.` }, null, 2));
    process.exit(2);
  }

  const inv = inventory(root, skillRoot);
  if (inv.settings.parseError) {
    console.log(JSON.stringify({ ok: false, error: `settings.json is not valid JSON (${inv.settings.parseError}) — fix it first; nothing was changed.` }, null, 2));
    process.exit(1);
  }
  if (!inv.lifeos.present) {
    console.log(JSON.stringify({ ok: true, dryRun: !apply, lifeos: false, note: "no LifeOS found — nothing to adopt; continue with DeployCore" }, null, 2));
    process.exit(0);
  }

  const moves = inv.units.filter((u) => u.cls === "lifeos-copy" && !u.path.startsWith("LIFEOS/")).map((u) => u.path);
  const kept = inv.units.filter((u) => u.cls === "lifeos-edited" || u.cls === "collision")
    .map((u) => ({ path: u.path, cls: u.cls, ...(u.base ? { base: u.base } : {}), ...(u.note ? { note: u.note } : {}) }));
  const yours = inv.units.filter((u) => u.cls === "user" && !u.path.endsWith(".DS_Store")).map((u) => u.path);
  const memSrc = join(root, "LIFEOS", "MEMORY");
  const memDir = existsSync(memSrc) ? realpathSync(memSrc) : null;
  const memSubs = memDir ? readdirSync(memDir).filter((e) => e !== ".DS_Store" && lstatSync(join(memDir, e)).isDirectory()) : [];
  const memCopy = memSubs.filter((e) => !MEMORY_SKIP.has(e));
  const sPlan = planSettings(inv);
  const lifeosDirPresent = existsSync(join(root, "LIFEOS"));

  const plan = {
    moveToBackup: moves,
    memory: { copy: memCopy.map((e) => `LIFEOS/MEMORY/${e} → WORKOS/MEMORY/${e}`), leftInBackup: memSubs.filter((e) => MEMORY_SKIP.has(e)).map((e) => `LIFEOS/MEMORY/${e}`) },
    settings: {
      removeRegistrations: sPlan.removeRegistrations.length,
      removeStatusLine: sPlan.removeStatusLine,
      removeEnv: sPlan.removeEnv,
      keptLifeosEnv: sPlan.keptLifeosEnv,
    },
    lifeosDir: lifeosDirPresent ? "LIFEOS/ → backup (after the memory copy)" : null,
    kept,
    yours,
  };

  if (!apply) {
    console.log(JSON.stringify({ ok: true, dryRun: true, root, plan, note: "dry-run — nothing written. Show this to the human; on a yes re-run with --apply. Every move goes to .workos-backup/<run>/ and Rollback.ts undoes it." }, null, 2));
    process.exit(0);
  }

  const ledger = new Ledger(root, "Adopt");
  const failures: string[] = [];
  const moved: string[] = [];
  for (const rel of moves) {
    try { ledger.moveToBackup(rel, "untouched LifeOS copy"); moved.push(rel); }
    catch (e) { failures.push(`move ${rel}: ${e instanceof Error ? e.message : String(e)}`); }
  }

  const memStats: Record<string, { copied: number; existing: number }> = {};
  if (memDir) {
    for (const sub of memCopy) {
      const stats = { copied: 0, existing: 0 };
      try { copyMemory(join(memDir, sub), join(root, "WORKOS", "MEMORY", sub), ledger, stats); }
      catch (e) { failures.push(`copy MEMORY/${sub}: ${e instanceof Error ? e.message : String(e)}`); }
      memStats[sub] = stats;
    }
  }

  let settingsChanged = false;
  const sp = join(root, "settings.json");
  if (existsSync(sp) && (sPlan.removeRegistrations.length || sPlan.removeStatusLine !== null || sPlan.removeEnv.length)) {
    try {
      const next = applySettingsPlan(JSON.parse(readFileSync(sp, "utf8")), sPlan);
      ledger.beforeWrite(sp, "settings-key", `removed ${sPlan.removeRegistrations.length} LifeOS hook registration(s)` +
        `${sPlan.removeStatusLine !== null ? ", LifeOS statusLine" : ""}${sPlan.removeEnv.length ? `, env ${sPlan.removeEnv.join(",")}` : ""}`);
      atomicWriteText(sp, JSON.stringify(next, null, 2) + "\n");
      settingsChanged = true;
    } catch (e) { failures.push(`settings.json: ${e instanceof Error ? e.message : String(e)}`); }
  }

  // LIFEOS/ goes last, and only if the memory copy succeeded — the backup keeps it whole.
  let lifeosMoved = false;
  if (lifeosDirPresent && failures.length === 0) {
    try { ledger.moveToBackup("LIFEOS", "LifeOS runtime + data (work memory copied to WORKOS/MEMORY first)"); lifeosMoved = true; }
    catch (e) { failures.push(`move LIFEOS: ${e instanceof Error ? e.message : String(e)}`); }
  } else if (lifeosDirPresent) {
    failures.push("LIFEOS/ NOT moved because an earlier step failed — fix the failures and re-run Adopt");
  }

  console.log(JSON.stringify({
    ok: failures.length === 0,
    root,
    run: ledger.run,
    backup: ledger.backupRoot,
    moved: moved.length,
    movedPaths: moved,
    memory: memStats,
    settingsChanged,
    settings: plan.settings,
    lifeosMoved,
    kept,
    yours,
    failures,
    note: "kept paths are yours or edited LifeOS files — WorkOS does not install over them. Next: DeployCore.",
  }, null, 2));
  process.exit(failures.length === 0 ? 0 : 1);
}

if (import.meta.main) main();
