/**
 * ledger — the backup + install-manifest helper EVERY writing installer tool goes through.
 *
 * Contract (one per install run):
 *   - Before a path is modified, replaced or moved, its pre-run bytes are copied to
 *     `<root>/.workos-backup/<run>/<same relative path>` (paths outside the root, e.g. the
 *     USER data home, go under `<run>/__abs__/<absolute path>`). The FIRST backup of a path
 *     in a run wins, so the backup is always the pre-install state no matter how many tools
 *     touch the same file afterwards.
 *   - Every mutation appends one JSON line to `<root>/WORKOS/install-manifest.jsonl`:
 *     {ts, run, tool, action, path, backup?, detail?, kind?}. Lines are written BEFORE the
 *     mutation (write-ahead), so a crash mid-write still leaves a replayable record.
 *   - An `add` records the TOPMOST path that did not exist before (a whole new skill dir is
 *     one line, not hundreds). Rollback removes adds and restores everything else.
 *   - `.workos-backup` is never inside anything the installer copies or scans; callers
 *     exclude it via BACKUP_DIRNAME.
 *
 * The run id is `WORKOS_INSTALL_RUN` when set, else `<root>/.workos-backup/current-run`,
 * else a new UTC timestamp (written to current-run so every later tool joins the same run).
 * `InstallRun.ts finish` clears current-run; Rollback clears it for the run it undoes.
 */

import {
  appendFileSync, cpSync, existsSync, lstatSync, mkdirSync, readFileSync, renameSync, writeFileSync,
} from "node:fs";
import { dirname, isAbsolute, join, relative, resolve, sep } from "node:path";

export const BACKUP_DIRNAME = ".workos-backup";
export const MANIFEST_REL = join("WORKOS", "install-manifest.jsonl");
export const CURRENT_RUN_FILE = "current-run";

export type LedgerAction =
  | "add" | "replace" | "modify" | "move-to-backup" | "settings-key" | "claude-md-block" | "rolled-back";

export interface LedgerEntry {
  ts: string;
  run: string;
  tool: string;
  action: LedgerAction;
  /** Root-relative path, or absolute when the path is outside the config root. */
  path: string;
  /** Root-relative path of the pre-run copy under .workos-backup/<run>/. */
  backup?: string;
  kind?: "file" | "dir" | "symlink";
  detail?: string;
}

const RUN_ID_RE = /^[0-9A-Za-z][0-9A-Za-z._-]{0,63}$/;

export function newRunId(): string {
  return new Date().toISOString().replace(/[:.]/g, "-");
}

/** The current run id, starting one (and persisting it) when none is active. */
export function currentRun(root: string, create = true): string | null {
  const env = process.env.WORKOS_INSTALL_RUN;
  if (env && RUN_ID_RE.test(env)) return env;
  const f = join(root, BACKUP_DIRNAME, CURRENT_RUN_FILE);
  if (existsSync(f)) {
    const id = readFileSync(f, "utf8").trim();
    if (RUN_ID_RE.test(id)) return id;
  }
  if (!create) return null;
  const id = newRunId();
  mkdirSync(dirname(f), { recursive: true });
  writeFileSync(f, id + "\n");
  return id;
}

export function startRun(root: string): string {
  const id = newRunId();
  const f = join(root, BACKUP_DIRNAME, CURRENT_RUN_FILE);
  mkdirSync(dirname(f), { recursive: true });
  writeFileSync(f, id + "\n");
  return id;
}

export function readManifest(root: string): LedgerEntry[] {
  const p = join(root, MANIFEST_REL);
  if (!existsSync(p)) return [];
  const out: LedgerEntry[] = [];
  for (const line of readFileSync(p, "utf8").split("\n")) {
    if (!line.trim()) continue;
    try { out.push(JSON.parse(line)); } catch { /* a torn last line is skipped, never fatal */ }
  }
  return out;
}

function kindOf(p: string): LedgerEntry["kind"] | undefined {
  const st = lstatSync(p, { throwIfNoEntry: false });
  if (!st) return undefined;
  return st.isSymbolicLink() ? "symlink" : st.isDirectory() ? "dir" : "file";
}

function isUnder(child: string, parent: string): boolean {
  return child === parent || child.startsWith(parent.endsWith(sep) ? parent : parent + sep);
}

/**
 * Paths WorkOS added in any run that has not been rolled back — the ownership record
 * the other tools consult before writing into an existing dir.
 */
export function addedPaths(root: string, entries = readManifest(root)): string[] {
  const rolledBack = new Set(entries.filter((e) => e.action === "rolled-back").map((e) => e.run));
  return entries.filter((e) => e.action === "add" && !rolledBack.has(e.run)).map((e) => e.path);
}

export class Ledger {
  readonly root: string;
  readonly run: string;
  readonly tool: string;
  readonly backupRoot: string;
  private entries: LedgerEntry[];

  constructor(root: string, tool: string) {
    this.root = resolve(root);
    this.tool = tool;
    this.run = currentRun(this.root)!;
    this.backupRoot = join(this.root, BACKUP_DIRNAME, this.run);
    this.entries = readManifest(this.root);
    // The manifest lives in WORKOS/. If WORKOS/ does not exist yet, creating it is this
    // run's first add — so rollback removes it (and the manifest with it).
    if (!existsSync(join(this.root, "WORKOS"))) {
      mkdirSync(join(this.root, "WORKOS"), { recursive: true });
      this.append({ action: "add", path: "WORKOS", kind: "dir", detail: "runtime dir (created to hold the install manifest)" });
    }
  }

  /** Root-relative when inside the root, absolute otherwise. */
  rel(p: string): string {
    const abs = isAbsolute(p) ? resolve(p) : join(this.root, p);
    const r = relative(this.root, abs);
    return r.startsWith("..") || isAbsolute(r) ? abs : r;
  }

  abs(p: string): string {
    return isAbsolute(p) ? resolve(p) : join(this.root, p);
  }

  private append(e: Omit<LedgerEntry, "ts" | "run" | "tool">): LedgerEntry {
    const full: LedgerEntry = { ts: new Date().toISOString(), run: this.run, tool: this.tool, ...e };
    const mp = join(this.root, MANIFEST_REL);
    mkdirSync(dirname(mp), { recursive: true });
    appendFileSync(mp, JSON.stringify(full) + "\n");
    this.entries.push(full);
    return full;
  }

  /** Is this path (or an ancestor) something WorkOS added in a live run? */
  isAdded(p: string): boolean {
    const a = this.abs(p);
    return addedPaths(this.root, this.entries).some((x) => isUnder(a, this.abs(x)));
  }

  /** Already backed up (or added) in THIS run — no further copy needed before writing. */
  private coveredThisRun(p: string): boolean {
    const a = this.abs(p);
    return this.entries.some((e) => e.run === this.run && e.action !== "rolled-back" &&
      (e.action === "add" ? isUnder(a, this.abs(e.path)) : !!e.backup && this.abs(e.path) === a));
  }

  backupPathFor(p: string): string {
    const r = this.rel(p);
    return isAbsolute(r) ? join(this.backupRoot, "__abs__", r) : join(this.backupRoot, r);
  }

  /** Copy the current bytes aside (first copy in a run wins). Returns the backup's root-relative path. */
  backupCopy(p: string): string {
    const src = this.abs(p);
    const dst = this.backupPathFor(p);
    if (!existsSync(dst) && lstatSync(src, { throwIfNoEntry: false })) {
      mkdirSync(dirname(dst), { recursive: true });
      cpSync(src, dst, { recursive: true, verbatimSymlinks: true, preserveTimestamps: true });
    }
    return relative(this.root, dst);
  }

  /** Record a new path: walks up to the topmost ancestor that does not exist yet. */
  recordAdd(p: string, detail?: string, kind?: LedgerEntry["kind"]): void {
    let a = this.abs(p);
    if (lstatSync(a, { throwIfNoEntry: false })) return; // not new — callers use beforeWrite
    const stop = isUnder(a, this.root) ? this.root : "/";
    let top = a;
    for (let d = dirname(a); d !== stop && d !== dirname(d) && !existsSync(d); d = dirname(d)) top = d;
    if (top !== a) kind = "dir";
    if (this.isAdded(top)) return;
    a = top;
    this.append({ action: "add", path: this.rel(a), kind: kind ?? "file", ...(detail ? { detail } : {}) });
  }

  /**
   * Call immediately BEFORE writing `p`. New path → `add`; an existing path not yet
   * covered in this run → backup copy + `modify` (or the given action).
   */
  beforeWrite(p: string, action: Exclude<LedgerAction, "add" | "move-to-backup" | "rolled-back"> = "modify", detail?: string): void {
    const a = this.abs(p);
    if (!lstatSync(a, { throwIfNoEntry: false })) { this.recordAdd(a, detail); return; }
    if (this.coveredThisRun(a)) {
      // Still log the semantic action (settings-key / claude-md-block) for the report,
      // pointing at the run's existing backup.
      if (action === "settings-key" || action === "claude-md-block") {
        const prior = this.entries.find((e) => e.run === this.run && e.backup && this.abs(e.path) === a);
        this.append({ action, path: this.rel(a), ...(prior?.backup ? { backup: prior.backup } : {}), ...(detail ? { detail } : {}) });
      }
      return;
    }
    const backup = this.backupCopy(a);
    this.append({ action, path: this.rel(a), backup, kind: kindOf(a), ...(detail ? { detail } : {}) });
  }

  /** Move a path wholesale into the backup (same filesystem → rename). */
  moveToBackup(p: string, detail?: string): string {
    const src = this.abs(p);
    const dst = this.backupPathFor(p);
    if (existsSync(dst)) throw new Error(`backup slot already taken for ${this.rel(p)} in run ${this.run}`);
    mkdirSync(dirname(dst), { recursive: true });
    const kind = kindOf(src);
    const backup = relative(this.root, dst);
    this.append({ action: "move-to-backup", path: this.rel(src), backup, kind, ...(detail ? { detail } : {}) });
    renameSync(src, dst);
    return backup;
  }

  /** Entries of this run so far (for reports). */
  runEntries(): LedgerEntry[] {
    return this.entries.filter((e) => e.run === this.run);
  }
}
