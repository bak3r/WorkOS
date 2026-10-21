#!/usr/bin/env bun
// Normalize env path vars Claude Code may inject unexpanded — literal $HOME/${HOME}
// in WORKOS_DIR/WORKOS_CONFIG_DIR/PROJECTS_DIR resolves to a shadow dir (#1404 / PR #1451, author jbmml).
for (const __k of ["WORKOS_DIR", "WORKOS_CONFIG_DIR", "PROJECTS_DIR"]) {
  const __v = process.env[__k];
  if (__v && /^\$\{?HOME\}?(\/|$)/.test(__v)) process.env[__k] = __v.replace(/^\$\{?HOME\}?/, process.env.HOME ?? "~");
}

/**
 * WorkSweep.ts — Periodic sweep that catches what event-driven hooks miss.
 *
 * Scheduled by hooks/MaintenanceJobs.hook.ts (hourly, from SessionStart — no
 * systemd needed); the com.workos.worksweep systemd timer is an optional extra.
 * Also runnable on-demand:
 *
 *   bun ~/.claude/WORKOS/TOOLS/WorkSweep.ts            # apply
 *   bun ~/.claude/WORKOS/TOOLS/WorkSweep.ts --dry-run  # show what would change, write nothing
 *   bun ~/.claude/WORKOS/TOOLS/WorkSweep.ts --since 48h  # widen the scan window
 *
 * What it does (all against the local work ledger, WORKOS/USER/WORK/ledger.jsonl):
 *   1. Scans MEMORY/WORK/*\/ISA.md for sessions modified in the last 24h and adds
 *      a `session` item for each meaningful one not already in the ledger
 *      (Jira keys from the ISA's `jira:` field, else its branch/name, are linked)
 *   2. Adds the `stale` label to in-progress items untouched for 7d
 *   3. Adds a `project-check` item for tracked projects with no commit in 14d
 *   4. Adds a `goal` item for active TELOS goals with no open goal item
 *   5. Re-renders WORKOS/USER/WORK/TASKLIST.md
 *   6. Appends one JSON line to MEMORY/OBSERVABILITY/worksweep.jsonl
 *
 * Never contacts Jira or GitLab. Always exits 0; failures log but never propagate.
 */

import { existsSync, readFileSync, writeFileSync, readdirSync, statSync, mkdirSync, appendFileSync } from "fs";
import { basename, join } from "path";
import { loadWorkConfig } from "../../hooks/lib/work-config";
import { extractJiraKeys } from "./lib/jira-keys";
import {
  addItem, findOpenBySlug, readLedger, renderTasklist, tasklistPath, updateItem, writeTasklist,
  type NewItem, type WorkItem,
} from "./lib/work-ledger";
import { phaseHasWorkStarted } from "./ascent";
import { homedir } from "node:os";

// Normalize env path vars that Claude Code injects without shell expansion (WorkOS#1404)
for (const k of ["WORKOS_DIR", "WORKOS_CONFIG_DIR", "PROJECTS_DIR"]) {
  const v = process.env[k];
  if (v && /^\$\{?HOME\}?(\/|$)/.test(v)) process.env[k] = v.replace(/^\$\{?HOME\}?/, process.env.HOME ?? "~");
}


declare const Bun: { spawn: (cmd: string[], opts?: any) => any };

const HOME = process.env.HOME ?? process.env.USERPROFILE ?? homedir();
const WORKOS_DIR = process.env.WORKOS_DIR || join(HOME, ".claude", "WORKOS");
const WORK_DIR = join(WORKOS_DIR, "MEMORY", "WORK");
const OBS_DIR = join(WORKOS_DIR, "MEMORY", "OBSERVABILITY");
const OBS_LOG = join(OBS_DIR, "worksweep.jsonl");
const PROJECTS_MD = join(WORKOS_DIR, "USER", "PROJECTS.md");
const PRINCIPAL_TELOS = join(WORKOS_DIR, "USER", "TELOS", "PRINCIPAL_TELOS.md");
const STATE_DIR = join(WORKOS_DIR, "MEMORY", "STATE");
const BPE_AUDIT_STATE = join(STATE_DIR, "bpe-last-audit.json");
// Institutionalized subtraction: the system accretes scaffolding faster than it prunes,
// so a BPE pass fires on a cadence instead of depending on someone remembering. Tune here.
const BPE_CADENCE_DAYS = 30;
const BPE_AUDIT_TARGETS = "force-loaded + doctrine surface: CLAUDE.md, WORKOS_SYSTEM_PROMPT.md, current ALGORITHM/v*.md";

interface ISAFm {
  task: string;
  slug: string;
  effort: string;
  phase: string;
  mode: string;
  started: string;
  updated: string;
  project?: string;
  principal_stated_goal?: string;
  jira?: string;
  branch?: string;
}

interface SweepStats {
  ts: string;
  dry_run: boolean;
  sessions_scanned: number;
  items_created: number;
  items_stale_labeled: number;
  project_checks_created: number;
  goal_items_created: number;
  bpe_reminder_created: number;
  tasklist_changed: boolean;
  ledger_corrupt_lines: number;
  duration_ms: number;
  errors: string[];
}

/** Sweep context: the ledger snapshot read once at start, plus the write switch. */
interface Sweep {
  items: WorkItem[];
  dryRun: boolean;
  stats: SweepStats;
}

/** Create unless an open item already holds the slug; dry-run only reports. */
function create(sw: Sweep, input: NewItem): WorkItem | null {
  if (input.slug && findOpenBySlug(sw.items, input.slug)) return null;
  if (sw.dryRun) {
    console.log(`+ would create ${input.type}: ${input.title}`);
    return { id: "(dry-run)" } as WorkItem;
  }
  try {
    const { item, created } = addItem({ source: "worksweep", ...input });
    if (!created) return null;
    sw.items.push(item);
    console.log(`+ created ${item.id} ${input.type}: ${item.title}`);
    return item;
  } catch (err) {
    sw.stats.errors.push(`create failed (${input.slug ?? input.title}): ${String(err)}`);
    return null;
  }
}

function parseFrontmatter(content: string): ISAFm | null {
  const m = content.match(/^---\n([\s\S]*?)\n---/);
  if (!m) return null;
  const fm: Record<string, string | number> = {};
  for (const line of m[1].split("\n")) {
    const kv = line.match(/^(\w+):\s*(.*)$/);
    if (kv) {
      const v = kv[2].replace(/^["']|["']$/g, "");
      fm[kv[1]] = /^\d+$/.test(v) ? parseInt(v, 10) : v;
    }
  }
  return fm as unknown as ISAFm;
}

function listSessionDirs(): string[] {
  if (!existsSync(WORK_DIR)) return [];
  return readdirSync(WORK_DIR)
    .map((n) => join(WORK_DIR, n))
    .filter((p) => statSync(p).isDirectory() && existsSync(join(p, "ISA.md")));
}

function isMeaningfulWork(fm: ISAFm, isaPath: string): boolean {
  // Skip empty/abandoned scaffolds — no progress, no phase advance.
  // ALGORITHM sessions: the run must have left articulation. Resolved through
  // ascent.ts, never a local phase list — the list that was here held the
  // RETIRED 8-station vocabulary, so a modern `climbing` run counted as an
  // abandoned scaffold and never got an issue (2026-07-30 phase-lane sweep).
  if (fm.mode !== "native") {
    return phaseHasWorkStarted(fm.phase);
  }
  // NATIVE sessions: require ≥2 artifacts beyond ISA.md in the dir (signals real work,
  // not a placeholder native row with only the scaffold).
  try {
    const dir = isaPath.replace(/\/ISA\.md$/, "");
    const contents = readdirSync(dir).filter((n) => n !== "ISA.md" && !n.startsWith("."));
    return contents.length >= 2;
  } catch {
    return false;
  }
}

function taskOrSlug(fm: ISAFm): string {
  // Fallback when older ISAs don't have a task field — use slug as readable approximation.
  if (fm.task && fm.task !== "undefined") return fm.task;
  return fm.slug.replace(/^\d+-?\d*_?/, "").replace(/-/g, " ");
}

// Classify a session's work into a canonical Type:* kind from its task text, so
// swept items say what they actually are (research / feature / problem /
// project / decision) and the ledger is filterable by label instead of being
// hundreds of undifferentiated "captured idea" rows. Order is most-specific-first;
// genuinely ambiguous text falls back to Type:queue. The session sweep stores it
// as a `kind:<name>` label (the ledger's own `type` stays `session`).
export function classifyType(text: string): string {
  const t = (text || "").toLowerCase();
  const has = (...kw: string[]) => kw.some((k) => t.includes(k));
  // Structural prefixes win — WorkSweep's own sub-sweeps mint these and the type
  // is unambiguous from the marker (a TELOS goal is a multi-month project; a
  // stalled-project nudge is friction to resolve).
  if (t.includes("[goal:") || t.startsWith("[goal]")) return "Type:project";
  if (t.includes("[project-check]")) return "Type:decision"; // "is this paused/done?" — a status decision
  if (has("fix ", "fixed", "broken", "bug", "regression", "troubleshoot", "debug", "repair", "outage", "failing", "wedge", "secure", "harden", "patch", "permanently fix", "stalled")) return "Type:problem";
  if (has("research", "investigate", "analyze", "analysis", "audit", "explore", "figure out", "deep dive", "deep research", "understand", "evaluate", "comparison", "explain", "mine ", "recommend", "assess", "review", "study", "feasibility", "options")) return "Type:research";
  if (has("decide", "decision", "should i", "choose", "pick between", "keep-or-delete", "keep or delete")) return "Type:decision";
  if (has("remind me", "reminder", "deadline", "due date")) return "Type:reminder";
  if (has("platform", "multi-week", "major application", "new major", "pipeline", "subsystem", "migrate", "migration", "end-to-end", "convert", "scale ", "rollout", "rework", "release ")) return "Type:project";
  if (has("build", "implement", "ship", "create", "add ", "upgrade", "redesign", "rewrite", "wire", "make ", "design", "generate", "integrate", "refactor", "deploy", "fix-up", "set up", "stand up", "lock ", "get ", "operational", "show ", "propagate", "draft", "statusline", "roster", "webhook", "csv", "enable", "support", "example section", "clean up", "unify", "extract", "replace", "dedupe", "install", "skill")) return "Type:feature";
  return "Type:queue"; // genuinely uncategorizable → stays a triage item
}

/** Jira keys an ISA names: its `jira:` field first, else its branch / slug / dir name. */
export function isaJiraKeys(fm: Partial<ISAFm>, dirName: string, projectKeys: string[]): string[] {
  const explicit = extractJiraKeys(String(fm.jira ?? ""), projectKeys);
  if (explicit.length) return explicit;
  return extractJiraKeys([fm.branch, fm.slug, dirName].filter(Boolean).join(" "), projectKeys);
}

async function sweepSessions(
  sw: Sweep,
  sinceMs: number,
  projectProperty: (p: string | undefined) => string | undefined,
  captureNative: boolean,
  projectKeys: string[],
  maxCreate: number,
): Promise<void> {
  const cutoff = Date.now() - sinceMs;
  const dirs = listSessionDirs();
  for (const dir of dirs) {
    const isaPath = join(dir, "ISA.md");
    const mtime = statSync(isaPath).mtimeMs;
    if (mtime < cutoff) continue;
    sw.stats.sessions_scanned++;

    const content = readFileSync(isaPath, "utf-8");
    const fm = parseFrontmatter(content);
    if (!fm || !fm.slug) continue;

    // A session is captured once, ever: a closed session item is not refiled.
    const slug = `session:${fm.slug}`;
    if (sw.items.some((i) => i.slug === slug)) continue;

    const isNative = fm.mode === "native";
    if (isNative && !captureNative) continue;
    if (!isMeaningfulWork(fm, isaPath)) continue;

    if (sw.stats.items_created >= maxCreate) {
      console.error(`[WorkSweep] hit --max-create ${maxCreate}, stopping session sweep`);
      sw.stats.errors.push(`max-create cap hit at ${maxCreate}`);
      break;
    }
    const goalLine = fm.principal_stated_goal ? `Principal stated goal: ${fm.principal_stated_goal}\n\n` : "";
    const body = [
      `${goalLine}Captured by WorkSweep (${isNative ? "NATIVE-mode session with artifacts" : "untracked Algorithm session"}).`,
      "",
      `- Effort: ${fm.effort}`,
      `- Mode: ${fm.mode}`,
      `- Phase: ${fm.phase}`,
      `- Project: ${fm.project ?? "—"}`,
      `- Updated: ${fm.updated}`,
    ].join("\n");
    const created = create(sw, {
      type: "session",
      title: taskOrSlug(fm),
      body,
      status: "queued",
      priority: "P3",
      labels: [isNative ? "auto-native" : "auto-sweep", "kind:" + classifyType(taskOrSlug(fm)).replace(/^Type:/, "")],
      slug,
      links: {
        jira: isaJiraKeys(fm, basename(dir), projectKeys),
        isa: isaPath.replace(HOME, "~"),
        ...(fm.branch ? { branch: fm.branch } : {}),
        ...(projectProperty(fm.project) ? { project: projectProperty(fm.project) } : {}),
      },
    });
    if (created) sw.stats.items_created++;
  }
}

function sweepStaleItems(sw: Sweep): void {
  const sevenDaysAgo = Date.now() - 7 * 24 * 3600 * 1000;
  for (const item of sw.items) {
    if (item.status !== "in-progress" || item.labels.includes("stale")) continue;
    if (Date.parse(item.updated) > sevenDaysAgo) continue;
    if (sw.dryRun) {
      console.log(`~ would label ${item.id} stale (in-progress >7d)`);
      sw.stats.items_stale_labeled++;
      continue;
    }
    try {
      if (updateItem(item.id, { labels_add: ["stale"] })) {
        console.log(`~ labeled ${item.id} stale`);
        sw.stats.items_stale_labeled++;
      }
    } catch (err) {
      sw.stats.errors.push(`stale label failed (${item.id}): ${String(err)}`);
    }
  }
}

interface ProjectRow { name: string; pathLocal: string; }

function parseProjectsMd(): ProjectRow[] {
  if (!existsSync(PROJECTS_MD)) return [];
  const content = readFileSync(PROJECTS_MD, "utf-8");
  const rows: ProjectRow[] = [];
  // Match: | **Name** | `path` | ...
  const re = /^\|\s*\*\*([^*]+)\*\*[^|]*\|\s*`([^`]+)`/gm;
  let m: RegExpExecArray | null;
  while ((m = re.exec(content)) !== null) {
    const name = m[1].trim().replace(/[🎯🚨_]/g, "").trim();
    const pathStr = m[2].trim().replace(/^~/, HOME);
    rows.push({ name, pathLocal: pathStr });
  }
  return rows;
}

async function lastCommitAgeDays(repoPath: string): Promise<number | null> {
  if (!existsSync(join(repoPath, ".git"))) return null;
  const proc = Bun.spawn(
    ["git", "-C", repoPath, "log", "-1", "--format=%ct"],
    { stdout: "pipe", stderr: "ignore", timeout: 5000 },
  );
  const out = await new Response(proc.stdout).text();
  const exit = await proc.exited;
  if (exit !== 0) return null;
  const ts = parseInt(out.trim(), 10);
  if (!ts) return null;
  return Math.round((Date.now() / 1000 - ts) / 86400);
}

async function sweepProjectChecks(
  sw: Sweep,
  projectProperty: (p: string | undefined) => string | undefined,
): Promise<void> {
  const rows = parseProjectsMd();
  for (const row of rows) {
    const age = await lastCommitAgeDays(row.pathLocal);
    if (age === null) continue; // not a git repo or path missing
    if (age < 14) continue;
    // Slug on the STABLE project name, never the day-count, so one open check
    // per project survives every run instead of a fresh duplicate daily.
    const body = [
      `Project: ${row.name}`,
      `Path: ${row.pathLocal.replace(HOME, "~")}`,
      `Last commit: ${age} days ago`,
      "",
      "Is this project paused, complete, or just slow? If active, push a commit and close this. If paused, set status blocked with the reason. If done, close.",
    ].join("\n");
    const created = create(sw, {
      type: "project-check",
      title: `${row.name} — no commits in ${age} days`,
      body,
      status: "queued",
      priority: "P3",
      labels: ["auto-sweep", "stale"],
      slug: `project-check:${row.name.toLowerCase()}`,
      links: { project: projectProperty(row.name) ?? row.name },
    });
    if (created) sw.stats.project_checks_created++;
  }
}

interface TelosGoal { id: string; text: string; }

function parseActiveGoals(): TelosGoal[] {
  if (!existsSync(PRINCIPAL_TELOS)) return [];
  const content = readFileSync(PRINCIPAL_TELOS, "utf-8");
  // Find "## Active Goals" section, extract "- **GN**: text"
  const sectionM = content.match(/## Active Goals[\s\S]*?(?=\n## |\Z)/);
  if (!sectionM) return [];
  const out: TelosGoal[] = [];
  const re = /^- \*\*(G\d+)\*\*:\s*(.+)$/gm;
  let m: RegExpExecArray | null;
  while ((m = re.exec(sectionM[0])) !== null) {
    out.push({ id: m[1], text: m[2].trim() });
  }
  return out;
}

function sweepGoals(sw: Sweep): void {
  for (const g of parseActiveGoals()) {
    const created = create(sw, {
      type: "goal",
      title: `${g.id}: ${g.text}`,
      body: [
        `TELOS goal ${g.id} — ${g.text}`,
        "",
        "This goal is active in TELOS but has no open goal item. Pick a concrete next action, break it down, or close this if the goal is deferred.",
        "",
        "Source: WORKOS/USER/TELOS/PRINCIPAL_TELOS.md → ## Active Goals",
      ].join("\n"),
      status: "queued",
      priority: "P2",
      labels: ["auto-sweep"],
      slug: `goal:${g.id}`,
    });
    if (created) sw.stats.goal_items_created++;
  }
}

function daysSince(iso: unknown): number | null {
  const then = typeof iso === "string" ? new Date(iso).getTime() : NaN;
  return Number.isNaN(then) ? null : Math.floor((Date.now() - then) / 86400000);
}

// Days since the last BPE audit, or null if never audited. A never-audited install
// is only due once BPE_CADENCE_DAYS have passed since its BASELINE: the first sweep
// that finds no state file records today as `baseline` (MaintenanceJobs runs the
// sweep at session start, so that is effectively the install day). Without this a
// fresh install opened with "BPE subtraction pass due — never run" on day one.
// Returns "not-due" while a never-audited install is still inside its first cadence.
function bpeAuditAge(sw: Sweep): number | null | "not-due" {
  let state: { date?: unknown; baseline?: unknown } = {};
  if (existsSync(BPE_AUDIT_STATE)) {
    try { state = JSON.parse(readFileSync(BPE_AUDIT_STATE, "utf8")); } catch { state = {}; }
  } else if (!sw.dryRun) {
    if (!existsSync(STATE_DIR)) mkdirSync(STATE_DIR, { recursive: true });
    const baseline = new Date().toISOString().slice(0, 10);
    writeFileSync(BPE_AUDIT_STATE, JSON.stringify({ date: null, baseline, stamped_by: "WorkSweep baseline (first sweep, no audit yet)" }, null, 2) + "\n");
    return "not-due";
  } else {
    return "not-due";
  }
  const days = daysSince(state.date);
  if (days !== null) return days;
  const sinceBaseline = daysSince(state.baseline);
  return sinceBaseline !== null && sinceBaseline < BPE_CADENCE_DAYS ? "not-due" : null;
}

// Resets the cadence clock — run after completing a BPE audit.
function stampBpeAudit(): void {
  if (!existsSync(STATE_DIR)) mkdirSync(STATE_DIR, { recursive: true });
  const date = new Date().toISOString().slice(0, 10);
  writeFileSync(BPE_AUDIT_STATE, JSON.stringify({ date, stamped_by: "WorkSweep --stamp-bpe" }, null, 2) + "\n");
  console.log(`[WorkSweep] BPE audit stamped: ${date}`);
}

// Institutionalized subtraction. When a BPE pass is overdue and no reminder is already
// open, surface ONE propose-only reminder — never auto-cuts (a cut needs ratification).
function sweepBpeCadence(sw: Sweep): void {
  const days = bpeAuditAge(sw);
  if (days === "not-due" || (days !== null && days < BPE_CADENCE_DAYS)) return; // not due yet
  const overdue = days === null ? "never run" : `${days}d since last (cadence ${BPE_CADENCE_DAYS}d)`;
  const body = [
    "As model capability rises, the healthy line (right amount of scaffolding) DROPS — but the actual line keeps climbing, because adding feels productive and pruning feels like nothing. The gap widens unless subtraction is scheduled. This is that schedule.",
    "",
    `Run: Skill("BitterPillEngineering", "audit") over the ${BPE_AUDIT_TARGETS}.`,
    `Cadence: every ${BPE_CADENCE_DAYS} days. Last audit: ${days === null ? "never" : days + " days ago"}.`,
    "Then stamp it: bun ~/.claude/WORKOS/TOOLS/WorkSweep.ts --stamp-bpe to reset the clock.",
    "",
    "Propose-only — never auto-cut. A cut needs judgment + ratification.",
  ].join("\n");
  const created = create(sw, {
    type: "reminder",
    title: `BPE subtraction pass due — ${overdue}`,
    body,
    status: "queued",
    priority: "P3",
    labels: ["auto-sweep"],
    slug: "bpe-audit-due",
  });
  if (created) sw.stats.bpe_reminder_created++;
}

function writeLogLine(stats: SweepStats): void {
  if (!existsSync(OBS_DIR)) mkdirSync(OBS_DIR, { recursive: true });
  appendFileSync(OBS_LOG, JSON.stringify(stats) + "\n");
}

async function main(): Promise<void> {
  const args = process.argv.slice(2);
  if (args.includes("--stamp-bpe")) { stampBpeAudit(); process.exit(0); }
  const dryRun = args.includes("--dry-run");
  const sinceIdx = args.indexOf("--since");
  const sinceHours = sinceIdx >= 0 ? parseInt(args[sinceIdx + 1].replace(/h$/, ""), 10) : 24;
  const sinceMs = sinceHours * 3600 * 1000;
  const maxCreateIdx = args.indexOf("--max-create");
  const maxCreate = maxCreateIdx >= 0 ? parseInt(args[maxCreateIdx + 1], 10) : 50;

  const t0 = Date.now();
  const stats: SweepStats = {
    ts: new Date().toISOString(),
    dry_run: dryRun,
    sessions_scanned: 0,
    items_created: 0,
    items_stale_labeled: 0,
    project_checks_created: 0,
    goal_items_created: 0,
    bpe_reminder_created: 0,
    tasklist_changed: false,
    ledger_corrupt_lines: 0,
    duration_ms: 0,
    errors: [],
  };

  const cfg = loadWorkConfig();
  if (!cfg.enabled) {
    console.error(`[WorkSweep] disabled: ${cfg.reason}`);
    stats.errors.push(`disabled: ${cfg.reason}`);
    stats.duration_ms = Date.now() - t0;
    writeLogLine(stats);
    process.exit(0);
  }
  if (!cfg.captureSweep) {
    console.error("[WorkSweep] capture_sweep=false in config — skipping");
    stats.duration_ms = Date.now() - t0;
    writeLogLine(stats);
    process.exit(0);
  }

  console.error(`[WorkSweep] ledger since=${sinceHours}h max-create=${maxCreate} ${dryRun ? "DRY RUN" : "APPLY"}`);

  const ledger = readLedger();
  stats.ledger_corrupt_lines = ledger.corrupt;
  const sw: Sweep = { items: ledger.items, dryRun, stats };

  const step = async (name: string, fn: () => void | Promise<void>) => {
    try { await fn(); } catch (err) { stats.errors.push(`${name}: ${String(err)}`); }
  };
  await step("sessions", () => sweepSessions(sw, sinceMs, cfg.projectProperty, cfg.captureNative, cfg.jira.projectKeys, maxCreate));
  await step("stale", () => sweepStaleItems(sw));
  await step("project-checks", () => sweepProjectChecks(sw, cfg.projectProperty));
  await step("goals", () => sweepGoals(sw));
  await step("bpe", () => sweepBpeCadence(sw));

  // Final step: re-render TASKLIST.md (a no-op when nothing changed). A dry run
  // only reports whether the render WOULD change the file.
  await step("render", () => {
    if (dryRun) {
      const next = renderTasklist(readLedger().items, cfg.kanbanStatuses);
      let prev = "";
      try { prev = readFileSync(tasklistPath(), "utf-8"); } catch {}
      stats.tasklist_changed = prev !== next;
      console.log(`~ TASKLIST.md ${stats.tasklist_changed ? "would be re-rendered" : "unchanged"} (${tasklistPath().replace(HOME, "~")})`);
    } else {
      stats.tasklist_changed = writeTasklist(cfg.kanbanStatuses).changed;
    }
  });

  stats.duration_ms = Date.now() - t0;
  writeLogLine(stats);
  console.error(`[WorkSweep] done in ${stats.duration_ms}ms — sessions=${stats.sessions_scanned} new=${stats.items_created} stale=${stats.items_stale_labeled} project-checks=${stats.project_checks_created} goals=${stats.goal_items_created} bpe=${stats.bpe_reminder_created} tasklist=${stats.tasklist_changed ? "changed" : "unchanged"}`);
  process.exit(0);
}

if (import.meta.main) {
  main().catch((err) => { console.error(`[WorkSweep] Fatal: ${err}`); process.exit(0); });
}
