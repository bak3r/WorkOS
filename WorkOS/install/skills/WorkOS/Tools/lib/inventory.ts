/**
 * inventory — READ-ONLY classification of an existing Claude Code config root, so the
 * installer knows what it may replace, what it must keep, and where it would collide.
 *
 * Classes (per file, then aggregated per unit — a skill dir, an agent/command/hook file,
 * a LIFEOS/ child, or any other top-level entry):
 *   claude-owned   Claude Code / sandbox state (.claude.json, projects/, plugins/, …). Never
 *                  walked, never touched by any tool.
 *   lifeos-copy    byte-identical to a known LifeOS release file (Tools/data/lifeos-*.sha256),
 *                  including a copy whose only differences are LifeOS's own identity
 *                  placeholders being filled in ({{PRINCIPAL_NAME}} → a name).
 *   lifeos-edited  a path LifeOS ships whose bytes differ — the developer changed it. A skill
 *                  dir that mixes copies with edited/own/missing files is edited as a whole.
 *   lifeos-data    LIFEOS/MEMORY/**, LIFEOS/USER/** (the LifeOS data home lives outside).
 *   workos         already WorkOS: matches the payload, or the install manifest says
 *                  WorkOS added it.
 *   user           everything else — the developer's own.
 *   collision      a user / lifeos-edited unit at a path WorkOS wants to write.
 * `.workos-backup/` is excluded from every walk.
 */

import { createHash } from "node:crypto";
import { existsSync, lstatSync, readdirSync, readFileSync, readlinkSync } from "node:fs";
import { homedir } from "node:os";
import { join, relative, resolve, sep } from "node:path";
import { BACKUP_DIRNAME, addedPaths, readManifest } from "./ledger";
import { findBlock, lifeosRefs } from "./claude-md";
import { planSettingsMerge, securityKeysIn } from "./settings-merge";

export type InvClass =
  | "claude-owned" | "lifeos-copy" | "lifeos-edited" | "lifeos-data" | "workos" | "user" | "collision";

/** Claude Code / sbx owned top-level names. Never walked, never written. */
const CLAUDE_OWNED = new Set([
  ".claude.json", "plugins", "plans", "daemon", "jobs", "state", "cache", "backups", "projects", "sessions",
  "session-env", "shell-snapshots", "file-history", "paste-cache", "telemetry", "todos", "history.jsonl",
  ".credentials.json", ".last-cleanup", "claudebox-managed-mcp", "statsig", "ide", "debug", "logs", "local",
  "downloads", "chrome", "usage-data", "teams", "tasks", "image-cache",
]);
const CLAUDE_OWNED_RE = [/^\.claude\.json\..+/, /^\.aws_auth_refresh-.*\.json$/, /^\.credentials/];

export function isClaudeOwned(topName: string): boolean {
  return CLAUDE_OWNED.has(topName) || CLAUDE_OWNED_RE.some((r) => r.test(topName));
}

/** OS junk and install-time generated files never decide a unit's class. */
const JUNK = new Set([".DS_Store", "Thumbs.db", "desktop.ini"]);
const isGenerated = (relInUnit: string) =>
  relInUnit.split("/").some((s) => s === "node_modules") || /(^|\/)bun\.lockb?$/.test(relInUnit);
const isTestFile = (name: string) => /\.(test|spec)\.[cm]?[jt]sx?$/.test(name);

function sha(b: Uint8Array): string {
  return createHash("sha256").update(b).digest("hex");
}

// ── LifeOS manifest ───────────────────────────────────────────────────

interface Seg { len: number; hash: string; prefix: Buffer }
interface Tpl { toks: string[]; segs: Seg[] }
export interface LifeosManifest { versions: string[]; byPath: Map<string, Set<string>>; templates: Map<string, Tpl[]> }

const manifestCache = new Map<string, LifeosManifest>();

/** All `lifeos-*.sha256` manifests in Tools/data (WORKOS_LIFEOS_MANIFESTS overrides, for tests). */
export function loadLifeosManifests(dir = process.env.WORKOS_LIFEOS_MANIFESTS || join(import.meta.dir, "..", "data")): LifeosManifest {
  const hit = manifestCache.get(dir);
  if (hit) return hit;
  const m: LifeosManifest = { versions: [], byPath: new Map(), templates: new Map() };
  if (existsSync(dir)) {
    for (const f of readdirSync(dir).filter((n) => /^lifeos-.*\.sha256$/.test(n)).sort()) {
      for (const line of readFileSync(join(dir, f), "utf8").split("\n")) {
        if (!line || line.startsWith("#")) {
          const v = line.match(/^# version (\S+)/);
          if (v) m.versions.push(v[1]);
          continue;
        }
        if (line.startsWith("T\t")) {
          const [, p, toks, segs] = line.split("\t");
          const tpl: Tpl = {
            toks: toks.split(","),
            segs: segs.split(",").map((s) => {
              const [len, hash, prefix] = s.split(":");
              return { len: Number(len), hash, prefix: Buffer.from(prefix ?? "", "hex") };
            }),
          };
          (m.templates.get(p) ?? m.templates.set(p, []).get(p)!).push(tpl);
          continue;
        }
        const i = line.indexOf("  ");
        if (i !== 64) continue;
        const p = line.slice(66);
        (m.byPath.get(p) ?? m.byPath.set(p, new Set()).get(p)!).add(line.slice(0, 64));
      }
    }
  }
  manifestCache.set(dir, m);
  return m;
}

/** Root-relative path → the LifeOS payload paths it could be a copy of. */
export function lifeosPayloadPaths(rel: string): string[] {
  if (rel.startsWith("skills/LifeOS/install/")) return [rel.slice("skills/LifeOS/".length)];
  if (rel.startsWith("skills/LifeOS/")) return [`LifeOS/${rel.slice("skills/LifeOS/".length)}`, `install/${rel}`];
  return [`install/${rel}`];
}

/**
 * Does `buf` equal the template with each placeholder filled consistently? Works from the
 * segment hashes alone (no template text ships): walk the literal segments, inferring each
 * token's value from where the next segment's hash lines up.
 */
export function matchTemplate(buf: Buffer, tpl: Tpl): boolean {
  const { toks, segs } = tpl;
  const segOk = (i: number, at: number): boolean => {
    const s = segs[i];
    if (at + s.len > buf.length) return false;
    for (let k = 0; k < s.prefix.length; k++) if (buf[at + k] !== s.prefix[k]) return false;
    return sha(buf.subarray(at, at + s.len)).slice(0, 16) === s.hash;
  };
  if (!segOk(0, 0)) return false;
  const vals = new Map<string, Buffer>();
  const dfs = (i: number, pos: number): boolean => {
    if (i === toks.length) return pos === buf.length;
    const known = vals.get(toks[i]);
    if (known) {
      if (!buf.subarray(pos, pos + known.length).equals(known)) return false;
      const np = pos + known.length;
      return segOk(i + 1, np) && dfs(i + 1, np + segs[i + 1].len);
    }
    for (let L = 0; L <= 256 && pos + L <= buf.length; L++) {
      if (L > 0 && buf[pos + L - 1] === 0x0a) break; // values never span lines
      if (!segOk(i + 1, pos + L)) continue;
      vals.set(toks[i], buf.subarray(pos, pos + L));
      if (dfs(i + 1, pos + L + segs[i + 1].len)) return true;
      vals.delete(toks[i]);
    }
    return false;
  };
  return dfs(0, segs[0].len);
}

export function lifeosMatch(rel: string, buf: Buffer, m = loadLifeosManifests()): { known: boolean; equal: boolean } {
  const h = sha(buf);
  let known = false;
  for (const p of lifeosPayloadPaths(rel)) {
    const set = m.byPath.get(p);
    if (!set) continue;
    known = true;
    if (set.has(h)) return { known, equal: true };
    for (const t of m.templates.get(p) ?? []) if (matchTemplate(buf, t)) return { known, equal: true };
  }
  return { known, equal: false };
}

// ── WorkOS payload ────────────────────────────────────────────────────

export const WORKOS_TOKENS = ["{{PRINCIPAL_NAME}}", "{{PRINCIPAL_FULL_NAME}}", "{{DA_NAME}}", "{{DA_FULL_NAME}}", "{{WORKOS_VERSION}}"];

/** Root-relative path → the payload file WorkOS installs there (null = WorkOS never writes it). */
export function workosPayloadFile(rel: string, skillRoot: string): string | null {
  const parts = rel.split("/");
  let p: string | null = null;
  if (parts[0] === "skills" && parts[1] === "WorkOS") p = join(skillRoot, ...parts.slice(2));
  else if (["skills", "hooks", "agents", "commands"].includes(parts[0]) || rel === "package.json") p = join(skillRoot, "install", rel);
  else if (parts[0] === "WORKOS" && parts.length > 1 && !["USER", "MEMORY"].includes(parts[1])) p = join(skillRoot, "install", rel);
  return p && existsSync(p) && lstatSync(p).isFile() ? p : null;
}

const tplCache = new Map<string, RegExp | null>();

/** Same bytes as the payload, or the payload with WorkOS's identity placeholders filled in. */
export function workosContentMatches(payloadFile: string, buf: Buffer): boolean {
  const src = readFileSync(payloadFile);
  if (src.equals(buf)) return true;
  let re = tplCache.get(payloadFile);
  if (re === undefined) {
    const text = src.toString("latin1");
    const tokRe = new RegExp(WORKOS_TOKENS.map((t) => t.replace(/[{}]/g, "\\$&")).join("|"), "g");
    if (!tokRe.test(text)) re = null;
    else {
      const seen = new Map<string, string>();
      let n = 0;
      const esc = (s: string) => s.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
      const body = text.split(/(\{\{(?:PRINCIPAL_NAME|PRINCIPAL_FULL_NAME|DA_NAME|DA_FULL_NAME|WORKOS_VERSION)\}\})/).map((part, i) => {
        if (i % 2 === 0) return esc(part);
        const g = seen.get(part);
        if (g) return `\\k<${g}>`;
        const name = `t${n++}`;
        seen.set(part, name);
        return `(?<${name}>[^\\n]{0,256}?)`;
      }).join("");
      re = new RegExp(`^${body}$`, "s");
    }
    tplCache.set(payloadFile, re);
  }
  return !!re && re.test(buf.toString("latin1"));
}

// ── classification ────────────────────────────────────────────────────

export interface FileClass { path: string; cls: Exclude<InvClass, "collision" | "claude-owned">; reason: string }

export interface Unit {
  path: string;
  kind: "dir" | "file" | "symlink";
  cls: InvClass;
  /** For a collision: what the unit is underneath (user or lifeos-edited). */
  base?: InvClass;
  files: number;
  counts: Partial<Record<InvClass, number>>;
  /** WorkOS ships something at this path. */
  workosWants: boolean;
  note?: string;
}

export interface Inventory {
  root: string;
  skillRoot: string;
  manifestVersions: string[];
  lifeos: { present: boolean; version: string | null; copies: number; edited: number; data: number };
  workos: { present: boolean; version: string | null };
  units: Unit[];
  files: FileClass[];
  settings: SettingsSummary;
  claudeMd: ClaudeMdSummary;
}

export interface Registration { event: string; matcher: string; command: string; owner: "lifeos" | "workos" | "user"; refs: string[] }

export interface SettingsSummary {
  exists: boolean;
  parseError?: string;
  registrations: Registration[];
  lifeosRegistrations: number;
  statusLine: { present: boolean; owner: "workos" | "lifeos" | "user" | "none"; command?: string };
  permissionsPresent: boolean;
  lifeosEnv: Array<{ key: string; isDefault: boolean }>;
  wouldAdd: { keys: string[]; env: string[]; permissions: { allow: number; deny: number; ask: number; other: string[] }; security: string[]; untouched: string[] } | null;
}

export interface ClaudeMdSummary { exists: boolean; hasWorkosBlock: boolean; workosOwned: boolean; lifeosRefs: Array<{ line: number; path: string }> }

export class Classifier {
  readonly root: string;
  readonly skillRoot: string;
  private added: string[];
  private cache = new Map<string, FileClass>();
  private m = loadLifeosManifests();

  constructor(root: string, skillRoot: string) {
    this.root = resolve(root);
    this.skillRoot = resolve(skillRoot);
    this.added = addedPaths(this.root).map((p) => (p.startsWith("/") ? p : join(this.root, p)));
  }

  /** Recorded in the install manifest as added by WorkOS (any live run). */
  isRecorded(rel: string): boolean {
    const a = join(this.root, rel);
    return this.added.some((x) => a === x || a.startsWith(x + sep));
  }

  file(rel: string): FileClass {
    const hit = this.cache.get(rel);
    if (hit) return hit;
    const fc = this.compute(rel);
    this.cache.set(rel, fc);
    return fc;
  }

  private compute(rel: string): FileClass {
    if (/^LIFEOS\/(MEMORY|USER)(\/|$)/.test(rel)) return { path: rel, cls: "lifeos-data", reason: "LifeOS data tree" };
    if (rel.startsWith("WORKOS/")) return { path: rel, cls: "workos", reason: "WorkOS runtime tree" };
    const abs = join(this.root, rel);
    const st = lstatSync(abs, { throwIfNoEntry: false });
    if (!st || !st.isFile()) return { path: rel, cls: "user", reason: st?.isSymbolicLink() ? "symlink" : "not a regular file" };
    if (this.isRecorded(rel)) return { path: rel, cls: "workos", reason: "added by WorkOS (install manifest)" };
    const buf = readFileSync(abs);
    const wp = workosPayloadFile(rel, this.skillRoot);
    const wEq = !!wp && workosContentMatches(wp, buf);
    const l = lifeosMatch(rel, buf, this.m);
    if (wEq && !l.equal) return { path: rel, cls: "workos", reason: "matches the WorkOS payload" };
    if (l.equal) return { path: rel, cls: "lifeos-copy", reason: "matches the LifeOS release" };
    if (l.known) return { path: rel, cls: "lifeos-edited", reason: "LifeOS path, bytes differ" };
    return { path: rel, cls: "user", reason: "not a known release file" };
  }

  /** Files under a dir (root-relative), skipping .workos-backup and never following symlinks. */
  walk(rel: string, out: string[] = []): string[] {
    const abs = join(this.root, rel);
    const st = lstatSync(abs, { throwIfNoEntry: false });
    if (!st) return out;
    if (!st.isDirectory() || st.isSymbolicLink()) { out.push(rel); return out; }
    for (const e of readdirSync(abs).sort()) {
      if (e === BACKUP_DIRNAME) continue;
      walkInto(this, rel ? `${rel}/${e}` : e, out);
    }
    return out;
  }
}

function walkInto(c: Classifier, rel: string, out: string[]): void {
  const st = lstatSync(join(c.root, rel), { throwIfNoEntry: false });
  if (!st) return;
  if (st.isDirectory() && !st.isSymbolicLink()) c.walk(rel, out);
  else out.push(rel);
}

/** All LifeOS payload files expected under a skill dir (for the "complete copy" test). */
function lifeosSkillFiles(m: LifeosManifest, skill: string): string[] {
  const out: string[] = [];
  for (const p of m.byPath.keys()) {
    if (isTestFile(p.slice(p.lastIndexOf("/") + 1)) || p.includes("/MEMORY/")) continue;
    if (skill === "LifeOS") {
      if (p.startsWith("LifeOS/")) out.push(`skills/LifeOS/${p.slice(7)}`);
      else if (p.startsWith("install/") && !p.startsWith("install/skills/LifeOS/")) out.push(`skills/LifeOS/${p}`);
    } else if (p.startsWith(`install/skills/${skill}/`)) out.push(p.slice("install/".length));
  }
  return out;
}

function aggregate(c: Classifier, unitRel: string, files: string[], m: LifeosManifest, isDir: boolean): { cls: InvClass; counts: Unit["counts"]; note?: string } {
  const counts: Unit["counts"] = {};
  const decisive: FileClass[] = [];
  for (const f of files) {
    const fc = c.file(f);
    counts[fc.cls] = (counts[fc.cls] ?? 0) + 1;
    const inUnit = f.slice(unitRel.length + 1);
    if (JUNK.has(f.slice(f.lastIndexOf("/") + 1)) || isGenerated(inUnit)) continue;
    decisive.push(fc);
  }
  const kinds = new Set(decisive.map((d) => d.cls));
  if (decisive.length === 0) return { cls: "user", counts, note: files.length ? "OS junk / generated only" : "empty" };
  // A DIR with no LifeOS copy inside is not a LifeOS skill the developer edited — it is
  // their own that shares a path (a same-named skill with its own SKILL.md). A single file
  // at a LifeOS path (agents/Max.md) stays lifeos-edited.
  if (isDir && !kinds.has("lifeos-copy") && kinds.has("lifeos-edited")) {
    return { cls: "user", counts, note: "your own (shares a LifeOS path, no LifeOS copy inside)" };
  }
  if (kinds.size === 1) {
    const only = [...kinds][0];
    if (only === "lifeos-copy" && unitRel.startsWith("skills/")) {
      const skill = unitRel.split("/")[1];
      const have = new Set(files);
      const missing = lifeosSkillFiles(m, skill).filter((p) => !have.has(p));
      if (missing.length) return { cls: "lifeos-edited", counts, note: `trimmed LifeOS copy — ${missing.length} release file(s) removed` };
    }
    return { cls: only, counts };
  }
  if (kinds.has("lifeos-copy") || kinds.has("lifeos-edited")) {
    if ([...kinds].every((k) => k === "lifeos-copy" || k === "lifeos-data")) return { cls: "lifeos-copy", counts };
    return { cls: "lifeos-edited", counts, note: "mixes LifeOS copies with edited or own files" };
  }
  if (kinds.has("user")) return { cls: "user", counts };
  return { cls: [...kinds][0], counts };
}

function payloadSkillDirs(skillRoot: string): Map<string, string> {
  const d = join(skillRoot, "install", "skills");
  const out = new Map<string, string>();
  if (!existsSync(d)) return out;
  for (const e of readdirSync(d, { withFileTypes: true })) if (e.isDirectory()) out.set(e.name.toLowerCase(), e.name);
  out.set("workos", "WorkOS");
  return out;
}

const HOOK_PREFIX = (root: string, home: string) => {
  const esc = (s: string) => s.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
  const alts = ["\\$HOME\\/\\.claude", "\\$\\{HOME\\}\\/\\.claude", "~\\/\\.claude", "\\$\\{?CLAUDE_CONFIG_DIR\\}?", esc(root), esc(join(home, ".claude"))];
  return new RegExp(`(?:${alts.join("|")})\\/([^\\s"';|&)]+)`, "g");
};

/** Root-relative paths a settings command references. */
export function commandRefs(command: string, root: string, home = process.env.HOME || homedir()): string[] {
  return [...command.matchAll(HOOK_PREFIX(root, home))].map((m) => m[1].replace(/\/+$/, ""));
}

function summarizeSettings(c: Classifier, home: string, skillRoot: string): SettingsSummary {
  const p = join(c.root, "settings.json");
  const s: SettingsSummary = {
    exists: existsSync(p), registrations: [], lifeosRegistrations: 0,
    statusLine: { present: false, owner: "none" }, permissionsPresent: false, lifeosEnv: [], wouldAdd: null,
  };
  if (!s.exists) return s;
  let j: Record<string, any>;
  try { j = JSON.parse(readFileSync(p, "utf8")); } catch (e) { s.parseError = String(e); return s; }
  const ownerOf = (command: string): { owner: Registration["owner"]; refs: string[] } => {
    const refs = commandRefs(command, c.root, home);
    // settings files a command reads/writes (MergeSettings --output settings.json) say
    // nothing about who owns the command; only the scripts it runs do.
    const classes = refs.filter((r) => !/^settings(\.[\w-]+)?\.json$/.test(r))
      .map((r) => (existsSync(join(c.root, r)) ? c.file(r).cls : "missing"));
    if (classes.includes("workos")) return { owner: "workos", refs };
    if (classes.includes("lifeos-copy") && !classes.includes("user") && !classes.includes("lifeos-edited")) return { owner: "lifeos", refs };
    return { owner: "user", refs };
  };
  for (const [event, groups] of Object.entries(j.hooks ?? {})) {
    if (!Array.isArray(groups)) continue;
    for (const g of groups as any[]) for (const h of g?.hooks ?? []) {
      if (typeof h?.command !== "string") continue;
      const { owner, refs } = ownerOf(h.command);
      s.registrations.push({ event, matcher: g.matcher ?? "", command: h.command, owner, refs });
    }
  }
  s.lifeosRegistrations = s.registrations.filter((r) => r.owner === "lifeos").length;
  if (j.statusLine?.command) {
    s.statusLine = { present: true, command: j.statusLine.command, owner: ownerOf(j.statusLine.command).owner };
  } else if (j.statusLine) s.statusLine = { present: true, owner: "user" };
  s.permissionsPresent = !!j.permissions;
  for (const [k, v] of Object.entries(j.env ?? {})) {
    if (!k.startsWith("LIFEOS_")) continue;
    s.lifeosEnv.push({ key: k, isDefault: isLifeosDefaultEnv(k, String(v), c.root, home) });
  }
  const tplPath = join(skillRoot, "install", "settings.system.json");
  if (existsSync(tplPath)) {
    const plan = planSettingsMerge(j, JSON.parse(readFileSync(tplPath, "utf8")));
    s.wouldAdd = {
      keys: plan.addedKeys, env: plan.addedEnv,
      permissions: { allow: plan.permissions.allow.length, deny: plan.permissions.deny.length, ask: plan.permissions.ask.length, other: plan.permissions.otherKeys },
      security: plan.security, untouched: plan.untouched,
    };
  }
  return s;
}

/** LifeOS's own default for a LIFEOS_* env key (what its InstallSettings writes). */
export function isLifeosDefaultEnv(key: string, value: string, root: string, home: string): boolean {
  const candidates: Record<string, string[]> = {
    LIFEOS_DIR: ["$HOME/.claude/LIFEOS", join(home, ".claude", "LIFEOS"), join(root, "LIFEOS")],
    LIFEOS_CONFIG_DIR: ["$HOME/.config/LIFEOS", join(home, ".config", "LIFEOS"), ...(process.env.LIFEOS_CONFIG_DIR ? [process.env.LIFEOS_CONFIG_DIR] : [])],
  };
  return (candidates[key] ?? []).includes(value);
}

function summarizeClaudeMd(c: Classifier): ClaudeMdSummary {
  const p = join(c.root, "CLAUDE.md");
  if (!existsSync(p)) return { exists: false, hasWorkosBlock: false, workosOwned: false, lifeosRefs: [] };
  const text = readFileSync(p, "utf8");
  return { exists: true, hasWorkosBlock: !!findBlock(text), workosOwned: c.isRecorded("CLAUDE.md"), lifeosRefs: lifeosRefs(text) };
}

/** Classify the whole config root. Read-only. */
export function inventory(root: string, skillRoot: string, opts: { home?: string } = {}): Inventory {
  const home = opts.home ?? (process.env.HOME || homedir());
  const c = new Classifier(root, skillRoot);
  const m = loadLifeosManifests();
  const wantedSkills = payloadSkillDirs(c.skillRoot);
  const units: Unit[] = [];
  const allFiles: string[] = [];
  const kindOf = (rel: string): Unit["kind"] => {
    const st = lstatSync(join(c.root, rel));
    return st.isSymbolicLink() ? "symlink" : st.isDirectory() ? "dir" : "file";
  };
  const push = (rel: string, workosWants: boolean, note?: string) => {
    const kind = kindOf(rel);
    if (kind === "symlink") {
      const target = (() => { try { return readlinkSync(join(c.root, rel)); } catch { return "?"; } })();
      const cls: InvClass = rel.startsWith("LIFEOS/") ? "lifeos-data" : "user";
      units.push({ path: rel, kind, cls, files: 0, counts: {}, workosWants, note: `symlink → ${target}` });
      return;
    }
    const files = c.walk(rel);
    allFiles.push(...files);
    const agg = aggregate(c, rel, files, m, kind === "dir");
    const u: Unit = { path: rel, kind, cls: agg.cls, files: files.length, counts: agg.counts, workosWants, note: note ?? agg.note };
    if (workosWants && (u.cls === "user" || u.cls === "lifeos-edited")) { u.base = u.cls; u.cls = "collision"; }
    units.push(u);
  };
  const exists = (rel: string) => existsSync(join(c.skillRoot, "install", rel));

  for (const top of readdirSync(c.root).sort()) {
    if (top === BACKUP_DIRNAME) continue;
    if (isClaudeOwned(top)) {
      units.push({ path: top, kind: kindOf(top), cls: "claude-owned", files: 0, counts: {}, workosWants: false });
      continue;
    }
    const kind = kindOf(top);
    if (top === "node_modules") {
      units.push({ path: top, kind, cls: "user", files: 0, counts: {}, workosWants: false, note: "installed/vendored dependencies — never touched" });
      continue;
    }
    if (kind === "dir" && ["skills", "agents", "commands"].includes(top)) {
      for (const e of readdirSync(join(c.root, top)).sort()) {
        const rel = `${top}/${e}`;
        const isDir = kindOf(rel) === "dir";
        const wanted = top === "skills" && isDir ? wantedSkills.has(e.toLowerCase()) : exists(rel);
        const w = top === "skills" && isDir ? wantedSkills.get(e.toLowerCase()) : undefined;
        push(rel, wanted, w && w !== e ? `case-variant of WorkOS skill '${w}'` : undefined);
      }
      continue;
    }
    if (kind === "dir" && top === "hooks") {
      for (const f of c.walk("hooks")) {
        push(f, exists(f));
      }
      continue;
    }
    if (kind === "dir" && top === "LIFEOS") {
      for (const e of readdirSync(join(c.root, top)).sort()) push(`LIFEOS/${e}`, false);
      continue;
    }
    if (top === "WORKOS") { push(top, true); continue; }
    push(top, top === "package.json" && exists(top));
  }

  const files = [...new Set(allFiles)].map((f) => c.file(f));
  const lifeosVersionFile = join(c.root, "LIFEOS", "VERSION");
  const workosVersionFile = join(c.root, "WORKOS", "VERSION");
  const copies = files.filter((f) => f.cls === "lifeos-copy").length;
  const edited = files.filter((f) => f.cls === "lifeos-edited").length;
  const data = files.filter((f) => f.cls === "lifeos-data").length;
  const settings = summarizeSettings(c, home, c.skillRoot);
  return {
    root: c.root,
    skillRoot: c.skillRoot,
    manifestVersions: m.versions,
    lifeos: {
      // Present = something Adopt would act on: a replaceable copy, LifeOS data, the LIFEOS/
      // tree or a LifeOS hook registration. Copies inside a KEPT (edited) skill and edited
      // files alone do not count — after Adopt, what is left is the developer's.
      present: units.some((u) => u.cls === "lifeos-copy" || u.cls === "lifeos-data") ||
        existsSync(join(c.root, "LIFEOS")) || settings.lifeosRegistrations > 0 || settings.statusLine.owner === "lifeos",
      version: existsSync(lifeosVersionFile) ? readFileSync(lifeosVersionFile, "utf8").trim() : null,
      copies, edited, data,
    },
    workos: {
      present: existsSync(workosVersionFile) || readManifest(c.root).length > 0,
      version: existsSync(workosVersionFile) ? readFileSync(workosVersionFile, "utf8").trim() : null,
    },
    units,
    files,
    settings,
    claudeMd: summarizeClaudeMd(c),
  };
}

/** Root-relative form of any path under the root (helper for the CLIs). */
export function relTo(root: string, p: string): string {
  return relative(resolve(root), resolve(p));
}

/** Template files whose identity placeholders WorkOS fills: skip anything not WorkOS's. */
export function isWorkosOwnedFile(c: Classifier, rel: string): boolean {
  return c.file(rel).cls === "workos";
}

export { securityKeysIn };
