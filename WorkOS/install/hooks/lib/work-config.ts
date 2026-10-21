// Normalize env path vars Claude Code may inject unexpanded — literal $HOME/${HOME}
// in WORKOS_DIR/WORKOS_CONFIG_DIR/PROJECTS_DIR resolves to a shadow dir (#1404 / PR #1451, author jbmml).
for (const __k of ["WORKOS_DIR", "WORKOS_CONFIG_DIR", "PROJECTS_DIR"]) {
  const __v = process.env[__k];
  if (__v && /^\$\{?HOME\}?(\/|$)/.test(__v)) process.env[__k] = __v.replace(/^\$\{?HOME\}?/, process.env.HOME ?? "~");
}

/**
 * work-config.ts — Single-source loader for the Work System configuration.
 *
 * The system of record is the local ledger (WORKOS/USER/WORK/ledger.jsonl,
 * see WORKOS/TOOLS/lib/work-ledger.ts). Jira and GitLab are READ-ONLY context
 * sources; nothing configured here can make WorkOS write to either.
 *
 * Config: `WORKOS/USER/WORK/config.yaml` (optional). Missing file = defaults:
 * ledger enabled, integrations auto-detected from env (JIRA_URL / GITLAB_HOST).
 *
 *   enabled: true
 *   kanban_statuses: [in-progress, blocked, in-review, ready, queued]
 *   capture_native: true
 *   capture_sweep: true
 *   capture_reminders: true
 *   project_property:
 *     some-repo: Some Product
 *   jira:
 *     enabled: auto            # auto | true | false
 *     project_keys: []         # empty = any key shape minus known false positives
 *     jql: ""                  # empty = my open-sprint tickets
 *   gitlab:
 *     enabled: auto
 *   context_ttl_minutes: 15
 *
 * Consumers: ReminderRouter.hook.ts, LoadContext (work-context block),
 * WorkSweep.ts, CommitmentLog.ts, CommitmentSweep.ts, WorkContext.ts.
 *
 * Zero deps, zero throws — config breakage degrades to defaults with a reason.
 */
import { existsSync, readFileSync } from "fs";
import { join } from "path";
import { homedir } from "node:os";

const HOME = process.env.HOME ?? process.env.USERPROFILE ?? homedir();
const workosDir = (): string => process.env.WORKOS_DIR || join(HOME, ".claude", "WORKOS");
export const workConfigPath = (): string => join(workosDir(), "USER", "WORK", "config.yaml");

const DEFAULT_STATUSES = ["in-progress", "blocked", "in-review", "ready", "queued"];
const DEFAULT_TTL_MINUTES = 15;

export type DisabledReason =
  | "disabled_by_config"
  | "read_failed";

export interface IntegrationConfig {
  enabled: boolean;
  /** Why it is off (or why it is on, when auto-detected). */
  reason: string;
}

export interface WorkConfig {
  /** Ledger capture on/off. Manual WorkLedger.ts commands work either way. */
  enabled: boolean;
  /** TASKLIST section order (ledger statuses). */
  kanbanStatuses: string[];
  captureNative: boolean;
  captureSweep: boolean;
  captureReminders: boolean;
  /** Maps an ISA `project:` value to the configured project name (else the raw value). */
  projectProperty: (project: string | undefined) => string | undefined;
  jira: IntegrationConfig & { projectKeys: string[]; jql: string | null };
  gitlab: IntegrationConfig;
  contextTtlMinutes: number;
  /** Set when the config file was present but unusable, or disabled the ledger. */
  reason?: string;
  reasonCode?: DisabledReason;
}

type Scalar = string;
type Node = Scalar | Scalar[] | { [k: string]: Scalar | Scalar[] };

/**
 * Parse the small YAML subset this config uses: top-level scalars, flow
 * (`[a, b]`) and block (`- a`) lists, and one level of nested maps whose
 * values are scalars or lists. Anything else is ignored, never fatal.
 */
export function parseWorkYaml(text: string): Record<string, Node> {
  const out: Record<string, Node> = {};
  const lines = text.split("\n").map((l) => l.replace(/\s+#.*$/, "").replace(/^#.*$/, "")).filter((l) => l.trim());
  const scalarOrList = (v: string): Scalar | Scalar[] => {
    const t = v.trim();
    if (t.startsWith("[") && t.endsWith("]")) {
      return t.slice(1, -1).split(",").map((x) => unquote(x)).filter(Boolean);
    }
    return unquote(t);
  };
  let top: string | null = null;
  let sub: string | null = null;
  for (const line of lines) {
    const indent = line.match(/^(\s*)/)![1].length;
    const t = line.trim();
    if (indent === 0) {
      sub = null;
      const m = t.match(/^([A-Za-z0-9_-]+):\s*(.*)$/);
      if (!m) { top = null; continue; }
      top = m[1];
      if (m[2] !== "") { out[top] = scalarOrList(m[2]); top = null; }
      continue;
    }
    if (!top) continue;
    const item = t.match(/^-\s+(.*)$/);
    const kv = t.match(/^([^:#\s][^:#]*?):\s*(.*)$/);
    const cur = out[top];
    if (item) {
      if (sub && cur && typeof cur === "object" && !Array.isArray(cur)) {
        const list = Array.isArray(cur[sub]) ? (cur[sub] as Scalar[]) : [];
        list.push(unquote(item[1]));
        cur[sub] = list;
      } else {
        out[top] = [...(Array.isArray(cur) ? cur : []), unquote(item[1])];
      }
    } else if (kv) {
      const map = cur && typeof cur === "object" && !Array.isArray(cur) ? cur : {};
      out[top] = map;
      if (kv[2] === "") { sub = kv[1].toLowerCase(); map[sub] = []; }
      else { sub = null; map[kv[1].toLowerCase()] = scalarOrList(kv[2]); }
    }
  }
  return out;
}

function unquote(v: string): string {
  return v.trim().replace(/^["']|["']$/g, "").trim();
}

function bool(v: Node | undefined, def: boolean): boolean {
  if (typeof v !== "string") return def;
  const s = v.toLowerCase();
  if (["true", "yes", "on", "1"].includes(s)) return true;
  if (["false", "no", "off", "0"].includes(s)) return false;
  return def;
}

function list(v: Node | undefined): string[] {
  if (Array.isArray(v)) return v.filter(Boolean);
  if (typeof v === "string" && v) return [v];
  return [];
}

function map(v: Node | undefined): Record<string, Scalar | Scalar[]> {
  return v && typeof v === "object" && !Array.isArray(v) ? v : {};
}

/** `auto` (or unset) → on when the env says the source exists. */
function integration(setting: Node | undefined, envVar: string, env: NodeJS.ProcessEnv): IntegrationConfig {
  const s = typeof setting === "string" ? setting.toLowerCase() : "auto";
  if (s !== "auto" && s !== "") {
    return bool(setting, false)
      ? { enabled: true, reason: "enabled in config" }
      : { enabled: false, reason: "disabled in config" };
  }
  return env[envVar]
    ? { enabled: true, reason: `auto: ${envVar} set` }
    : { enabled: false, reason: `auto: ${envVar} unset` };
}

export function loadWorkConfig(env: NodeJS.ProcessEnv = process.env, path = workConfigPath()): WorkConfig {
  let doc: Record<string, Node> = {};
  let reason: string | undefined;
  let reasonCode: DisabledReason | undefined;
  if (existsSync(path)) {
    try {
      doc = parseWorkYaml(readFileSync(path, "utf-8"));
    } catch (err) {
      reason = `config.yaml unreadable (${String(err)}) — using defaults`;
      reasonCode = "read_failed";
    }
  }

  const statuses = list(doc.kanban_statuses);
  const kanbanStatuses = statuses.length ? statuses : DEFAULT_STATUSES;
  const projectMap: Record<string, string> = {};
  for (const [k, v] of Object.entries(map(doc.project_property))) {
    if (typeof v === "string" && v) projectMap[k.toLowerCase().replace(/\s+/g, "")] = v;
  }
  const projectProperty = (project: string | undefined): string | undefined => {
    if (!project) return undefined;
    return projectMap[project.toLowerCase().replace(/\s+/g, "")] ?? project;
  };

  const jiraDoc = map(doc.jira);
  const jql = typeof jiraDoc.jql === "string" && jiraDoc.jql ? jiraDoc.jql : null;
  const ttlRaw = typeof doc.context_ttl_minutes === "string" ? parseInt(doc.context_ttl_minutes, 10) : NaN;

  const enabled = bool(doc.enabled, true);
  if (!enabled && !reasonCode) {
    reason = "enabled: false in USER/WORK/config.yaml";
    reasonCode = "disabled_by_config";
  }

  return {
    enabled,
    kanbanStatuses,
    captureNative: bool(doc.capture_native, true),
    captureSweep: bool(doc.capture_sweep, true),
    captureReminders: bool(doc.capture_reminders, true),
    projectProperty,
    jira: { ...integration(jiraDoc.enabled, "JIRA_URL", env), projectKeys: list(jiraDoc.project_keys), jql },
    gitlab: integration(map(doc.gitlab).enabled, "GITLAB_HOST", env),
    contextTtlMinutes: Number.isFinite(ttlRaw) && ttlRaw > 0 ? ttlRaw : DEFAULT_TTL_MINUTES,
    ...(reason ? { reason, reasonCode } : {}),
  };
}

// ── CLI smoke ────────────────────────────────────────────────────────────────

if (import.meta.main) {
  const cfg = loadWorkConfig();
  console.log(JSON.stringify(cfg, null, 2));
  process.exit(0);
}
