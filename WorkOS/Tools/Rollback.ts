#!/usr/bin/env bun
/**
 * Rollback — undo one install run by replaying `WORKOS/install-manifest.jsonl` in reverse:
 * paths WorkOS added are removed, paths it replaced / modified / moved aside are restored
 * from `.workos-backup/<run>/` (settings.json and CLAUDE.md included). The goal is a root
 * byte-identical to the moment before the run started. Claude Code's own paths are never
 * touched — the installer never writes them, so nothing for them is in the manifest.
 *
 * After a successful --apply the run's lines are dropped from the manifest (when WORKOS/
 * pre-existed), the run's backup dir is deleted (keep it with --keep-backup) and
 * `.workos-backup/` itself goes if it is empty.
 *
 * Usage: bun Rollback.ts [--config-root <dir>] [--run <timestamp>] [--apply]
 *                        [--keep-backup] [--remove-user-data] [--list]
 *   --run             which run (default: the current run, else the newest in the manifest)
 *   --remove-user-data  also remove paths created OUTSIDE the config root (the USER data
 *                     home). Kept by default: it holds what the principal typed after install.
 *   --list            print the runs the manifest knows and exit
 * Dry-run by default. Exit: 0 ok · 1 failure / nothing to roll back · 2 dev tree
 */

import { cpSync, existsSync, lstatSync, mkdirSync, readdirSync, renameSync, rmSync, writeFileSync, readFileSync, rmdirSync } from "node:fs";
import { homedir } from "node:os";
import { dirname, isAbsolute, join } from "node:path";
import { detectDevTree } from "./InstallEngine";
import { BACKUP_DIRNAME, CURRENT_RUN_FILE, MANIFEST_REL, currentRun, readManifest, type LedgerEntry } from "./lib/ledger";

function arg(a: string[], flag: string): string | undefined {
  const i = a.indexOf(flag);
  return i >= 0 && a[i + 1] && !a[i + 1].startsWith("--") ? a[i + 1] : undefined;
}

export interface Step { op: "remove" | "restore-move" | "restore-copy"; path: string; backup?: string; from: LedgerEntry }

/** Reverse replay plan for one run (pure). Backups restore once, from the run's first copy. */
export function planRollback(entries: LedgerEntry[], run: string, opts: { keepUserData?: boolean } = {}): { steps: Step[]; skipped: Step[] } {
  const steps: Step[] = [];
  const skipped: Step[] = [];
  const restored = new Set<string>();
  for (const e of [...entries].filter((x) => x.run === run && x.action !== "rolled-back").reverse()) {
    let s: Step | null = null;
    if (e.action === "add") s = { op: "remove", path: e.path, from: e };
    else if (e.action === "move-to-backup" && e.backup) s = { op: "restore-move", path: e.path, backup: e.backup, from: e };
    else if (e.backup) {
      // Several tools may modify one file in a run; they all point at the same first backup.
      if (restored.has(e.path)) continue;
      restored.add(e.path);
      s = { op: "restore-copy", path: e.path, backup: e.backup, from: e };
    }
    if (!s) continue;
    if (opts.keepUserData && isAbsolute(s.path)) skipped.push(s);
    else steps.push(s);
  }
  return { steps, skipped };
}

const show = (s: Step) => `${s.op} ${s.path}${s.backup ? ` ← ${s.backup}` : ""}`;

/** Carry out a plan: restores, manifest cleanup, backup removal. Returns what happened. */
export function executeRollback(root: string, run: string, steps: Step[], opts: { keepBackup?: boolean } = {}): { done: string[]; failures: string[] } {
  const abs = (p: string) => (isAbsolute(p) ? p : join(root, p));
  const failures: string[] = [];
  const done: string[] = [];
  for (const s of steps) {
    const p = abs(s.path);
    try {
      if (s.op === "remove") {
        if (lstatSync(p, { throwIfNoEntry: false })) rmSync(p, { recursive: true, force: true });
      } else {
        const b = join(root, s.backup!);
        if (!lstatSync(b, { throwIfNoEntry: false })) { failures.push(`${show(s)}: backup missing`); continue; }
        if (lstatSync(p, { throwIfNoEntry: false })) rmSync(p, { recursive: true, force: true });
        mkdirSync(dirname(p), { recursive: true });
        if (s.op === "restore-move") renameSync(b, p);
        else cpSync(b, p, { recursive: true, verbatimSymlinks: true, preserveTimestamps: true });
      }
      done.push(show(s));
    } catch (e) {
      failures.push(`${show(s)}: ${e instanceof Error ? e.message : String(e)}`);
    }
  }

  // WORKOS/ pre-existed (a re-install): drop this run's lines so the manifest is as before.
  const mp = join(root, MANIFEST_REL);
  if (existsSync(mp)) {
    const kept = readFileSync(mp, "utf8").split("\n").filter((l) => {
      if (!l.trim()) return false;
      try { return JSON.parse(l).run !== run; } catch { return true; }
    });
    // On a partial failure the manifest stays as it was, so a re-run can finish the job.
    if (failures.length === 0) {
      if (kept.length) writeFileSync(mp, kept.join("\n") + "\n");
      else rmSync(mp);
    }
  }

  const bdir = join(root, BACKUP_DIRNAME);
  if (failures.length === 0) {
    if (!opts.keepBackup) rmSync(join(bdir, run), { recursive: true, force: true });
    const cur = join(bdir, CURRENT_RUN_FILE);
    if (existsSync(cur) && readFileSync(cur, "utf8").trim() === run) rmSync(cur);
    try { if (existsSync(bdir) && readdirSync(bdir).length === 0) rmdirSync(bdir); } catch { /* not empty — fine */ }
  }

  return { done, failures };
}

function main(): void {
  const a = process.argv.slice(2);
  const home = process.env.HOME || homedir();
  const root = arg(a, "--config-root") || process.env.CLAUDE_CONFIG_DIR || join(home, ".claude");
  const apply = a.includes("--apply");
  if (detectDevTree(root) && !a.includes("--allow-dev")) {
    console.log(JSON.stringify({ ok: false, refused: "dev-tree", detail: `${root} is a WorkOS source tree — refusing to roll back.` }, null, 2));
    process.exit(2);
  }
  const entries = readManifest(root);
  const runs = [...new Set(entries.map((e) => e.run))];
  if (a.includes("--list")) {
    const done = new Set(entries.filter((e) => e.action === "rolled-back").map((e) => e.run));
    console.log(JSON.stringify({ ok: true, runs: runs.map((r) => ({ run: r, entries: entries.filter((e) => e.run === r).length, rolledBack: done.has(r) })) }, null, 2));
    process.exit(0);
  }
  const run = arg(a, "--run") || currentRun(root, false) || runs[runs.length - 1];
  if (!run || !entries.some((e) => e.run === run)) {
    console.log(JSON.stringify({ ok: false, error: `no install run ${run ?? ""} in ${join(root, MANIFEST_REL)} — nothing to roll back`, runs }, null, 2));
    process.exit(1);
  }
  const { steps, skipped } = planRollback(entries, run, { keepUserData: !a.includes("--remove-user-data") });
  if (!apply) {
    console.log(JSON.stringify({ ok: true, dryRun: true, root, run, steps: steps.map(show), skipped: skipped.map(show), note: "dry-run — re-run with --apply to restore the pre-install state" }, null, 2));
    process.exit(0);
  }

  const { done, failures } = executeRollback(root, run, steps, { keepBackup: a.includes("--keep-backup") });
  console.log(JSON.stringify({ ok: failures.length === 0, root, run, restored: done.length, skipped: skipped.map(show), failures,
    note: failures.length ? "some steps failed — the backup was kept; fix and re-run" : "root restored to its pre-install state for this run" }, null, 2));
  process.exit(failures.length === 0 ? 0 : 1);
}

if (import.meta.main) main();
