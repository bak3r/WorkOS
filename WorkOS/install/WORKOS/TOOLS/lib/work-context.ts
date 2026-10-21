/**
 * work-context.ts — READ-ONLY work context from Jira and GitLab, cached locally.
 *
 * Never-write rule: WorkOS must never create, edit, transition or comment on
 * anything in Jira or GitLab. That is enforced here, structurally, not by
 * convention:
 *   - every Jira request goes through readOnlyFetch(), which refuses any method
 *     but GET (and any request body) BEFORE the underlying fetch is called;
 *   - every GitLab request goes through glabGet(), which only ever builds
 *     `glab api --method GET <path>` and refuses a path carrying flags.
 * fetch and spawn are injected so tests can prove both with mocks.
 *
 * Cache: WORKOS/MEMORY/STATE/work-context.json
 *   { fetched_at, sources: { jira: {ok, error?, skipped?}, gitlab: {...} }, items: {...} }
 *
 * Environment (Docker Sandboxes: placeholders are swapped by the egress proxy):
 *   JIRA_URL        base incl. the api.atlassian.com gateway prefix; /rest/api/3/... is appended
 *   JIRA_USERNAME   basic-auth user
 *   JIRA_API_TOKEN  basic-auth token
 *   GITLAB_HOST     full URL of the GitLab instance; glab reads it itself
 */

import { existsSync, readFileSync, statSync } from "node:fs";
import { dirname, join } from "node:path";
import { getWorkosDir } from "../../../hooks/lib/paths";
import { atomicWriteJSON } from "./atomic-write";
import type { WorkConfig } from "../../../hooks/lib/work-config";
import { daysUntil, isClosed, type WorkItem } from "./work-ledger";

export const REQUEST_TIMEOUT_MS = 5_000;
export const DEFAULT_JQL =
  "assignee = currentUser() AND sprint in openSprints() AND statusCategory != Done ORDER BY updated DESC";
export const JIRA_FIELDS = "summary,status,issuetype,priority,parent";

export type FetchFn = (url: string, init?: RequestInit) => Promise<Response>;
export type SpawnFn = (args: string[], timeoutMs: number) => Promise<{ code: number; stdout: string; stderr: string }>;

export interface SourceStatus {
  ok: boolean;
  /** True when the source was not configured — not an error. */
  skipped?: boolean;
  error?: string;
}

export interface JiraIssue {
  key: string;
  summary: string;
  status: string;
  statusCategory?: string;
  type?: string;
  priority?: string;
  parent?: string;
}

export interface MergeRequest {
  ref: string;          // group/project!iid
  title: string;
  url: string;
  draft: boolean;
  mergeStatus?: string; // GitLab detailed_merge_status, e.g. mergeable, not_approved, ci_still_running
  sourceBranch?: string;
}

export interface WorkContextCache {
  fetched_at: string;
  sources: { jira: SourceStatus; gitlab: SourceStatus };
  items: {
    jira: JiraIssue[];
    gitlab_user: string | null;
    mrs_authored: MergeRequest[];
    mrs_reviewing: MergeRequest[];
  };
}

export function workContextPath(): string {
  return join(getWorkosDir(), "MEMORY", "STATE", "work-context.json");
}

// ── Read-only guards ─────────────────────────────────────────────────────────

/** Wrap a fetch so that only body-less GET requests can ever reach it. */
export function readOnlyFetch(inner: FetchFn): FetchFn {
  return (url, init = {}) => {
    const method = (init.method ?? "GET").toUpperCase();
    if (method !== "GET") return Promise.reject(new Error(`read-only: refused ${method} ${url}`));
    if (init.body !== undefined && init.body !== null) return Promise.reject(new Error(`read-only: refused request body for ${url}`));
    return inner(url, { ...init, method: "GET" });
  };
}

/** The only argv WorkOS ever hands to glab. Throws on anything flag-shaped in the path. */
export function glabGetArgs(path: string): string[] {
  if (!path || /\s/.test(path) || path.startsWith("-")) throw new Error(`read-only: refused glab path "${path}"`);
  return ["glab", "api", "--method", "GET", path];
}

async function glabGet(spawn: SpawnFn, path: string): Promise<unknown> {
  const r = await spawn(glabGetArgs(path), REQUEST_TIMEOUT_MS);
  if (r.code !== 0) throw new Error(`glab api ${path} exited ${r.code}: ${r.stderr.trim().slice(0, 200)}`);
  return JSON.parse(r.stdout);
}

// ── Jira ─────────────────────────────────────────────────────────────────────

export function buildJiraSearchUrl(baseUrl: string, jql: string | null): string {
  const base = baseUrl.replace(/\/+$/, "");
  const q = new URLSearchParams({ jql: jql || DEFAULT_JQL, fields: JIRA_FIELDS, maxResults: "50" });
  return `${base}/rest/api/3/search/jql?${q.toString()}`;
}

export function jiraAuthHeader(user: string, token: string): string {
  return "Basic " + Buffer.from(`${user}:${token}`).toString("base64");
}

/** Shared by WorkContext and Doctor: a GET against the Jira REST API, read-only, 5s timeout. */
export async function jiraGet(fetchImpl: FetchFn, env: NodeJS.ProcessEnv, path: string): Promise<unknown> {
  const user = env.JIRA_USERNAME;
  const token = env.JIRA_API_TOKEN;
  if (!env.JIRA_URL || !user || !token) throw new Error("JIRA_URL / JIRA_USERNAME / JIRA_API_TOKEN not all set");
  const url = path.startsWith("http") ? path : `${env.JIRA_URL.replace(/\/+$/, "")}${path}`;
  const res = await readOnlyFetch(fetchImpl)(url, {
    method: "GET",
    headers: { Authorization: jiraAuthHeader(user, token), Accept: "application/json" },
    signal: AbortSignal.timeout(REQUEST_TIMEOUT_MS),
  });
  if (!res.ok) throw new Error(`Jira HTTP ${res.status}`);
  return res.json();
}

export function mapJiraIssues(data: any): JiraIssue[] {
  const issues = Array.isArray(data?.issues) ? data.issues : [];
  return issues
    .filter((i: any) => typeof i?.key === "string")
    .map((i: any) => ({
      key: i.key,
      summary: String(i.fields?.summary ?? ""),
      status: String(i.fields?.status?.name ?? "?"),
      ...(i.fields?.status?.statusCategory?.name ? { statusCategory: i.fields.status.statusCategory.name } : {}),
      ...(i.fields?.issuetype?.name ? { type: i.fields.issuetype.name } : {}),
      ...(i.fields?.priority?.name ? { priority: i.fields.priority.name } : {}),
      ...(i.fields?.parent?.key ? { parent: i.fields.parent.key } : {}),
    }));
}

// ── GitLab ───────────────────────────────────────────────────────────────────

export function mapMergeRequests(data: any): MergeRequest[] {
  return (Array.isArray(data) ? data : []).map((m: any) => ({
    ref: String(m?.references?.full ?? `!${m?.iid ?? "?"}`),
    title: String(m?.title ?? ""),
    url: String(m?.web_url ?? ""),
    draft: Boolean(m?.draft ?? m?.work_in_progress),
    ...(m?.detailed_merge_status ? { mergeStatus: String(m.detailed_merge_status) } : {}),
    ...(m?.source_branch ? { sourceBranch: String(m.source_branch) } : {}),
  }));
}

// ── Refresh ──────────────────────────────────────────────────────────────────

export interface RefreshDeps {
  fetch: FetchFn;
  spawn: SpawnFn;
  env: NodeJS.ProcessEnv;
  /** Is the glab binary available? */
  hasGlab: () => boolean;
  now?: () => Date;
}

/** Fetch both sources. Never throws: each source's failure lands in its status. */
export async function refreshContext(cfg: WorkConfig, deps: RefreshDeps): Promise<WorkContextCache> {
  const cache: WorkContextCache = {
    fetched_at: (deps.now?.() ?? new Date()).toISOString(),
    sources: { jira: { ok: false, skipped: true }, gitlab: { ok: false, skipped: true } },
    items: { jira: [], gitlab_user: null, mrs_authored: [], mrs_reviewing: [] },
  };

  const jiraTask = (async () => {
    if (!cfg.jira.enabled) { cache.sources.jira = { ok: false, skipped: true, error: cfg.jira.reason }; return; }
    if (!deps.env.JIRA_URL || !deps.env.JIRA_USERNAME || !deps.env.JIRA_API_TOKEN) {
      cache.sources.jira = { ok: false, skipped: true, error: "JIRA_URL / JIRA_USERNAME / JIRA_API_TOKEN not all set" };
      return;
    }
    try {
      const data = await jiraGet(deps.fetch, deps.env, buildJiraSearchUrl(deps.env.JIRA_URL, cfg.jira.jql));
      cache.items.jira = mapJiraIssues(data);
      cache.sources.jira = { ok: true };
    } catch (err) {
      cache.sources.jira = { ok: false, error: String((err as Error)?.message ?? err) };
    }
  })();

  const gitlabTask = (async () => {
    if (!cfg.gitlab.enabled) { cache.sources.gitlab = { ok: false, skipped: true, error: cfg.gitlab.reason }; return; }
    if (!deps.hasGlab()) { cache.sources.gitlab = { ok: false, skipped: true, error: "glab not on PATH" }; return; }
    try {
      const user = (await glabGet(deps.spawn, "user")) as { username?: string };
      const username = typeof user?.username === "string" ? user.username : null;
      cache.items.gitlab_user = username;
      const [authored, reviewing] = await Promise.all([
        glabGet(deps.spawn, "merge_requests?scope=created_by_me&state=opened&per_page=50"),
        username
          ? glabGet(deps.spawn, `merge_requests?scope=all&state=opened&reviewer_username=${encodeURIComponent(username)}&per_page=50`)
          : Promise.resolve([]),
      ]);
      cache.items.mrs_authored = mapMergeRequests(authored);
      cache.items.mrs_reviewing = mapMergeRequests(reviewing);
      cache.sources.gitlab = { ok: true };
    } catch (err) {
      cache.sources.gitlab = { ok: false, error: String((err as Error)?.message ?? err) };
    }
  })();

  await Promise.all([jiraTask, gitlabTask]);
  return cache;
}

export function readContextCache(path = workContextPath()): WorkContextCache | null {
  try {
    if (!existsSync(path)) return null;
    const c = JSON.parse(readFileSync(path, "utf-8"));
    return c && typeof c.fetched_at === "string" && c.items ? (c as WorkContextCache) : null;
  } catch {
    return null;
  }
}

export function writeContextCache(cache: WorkContextCache, path = workContextPath()): void {
  atomicWriteJSON(path, cache);
}

export function isCacheStale(cache: WorkContextCache | null, ttlMinutes: number, now = new Date()): boolean {
  if (!cache) return true;
  const t = Date.parse(cache.fetched_at);
  return !Number.isFinite(t) || now.getTime() - t >= ttlMinutes * 60_000;
}

// ── Branch ───────────────────────────────────────────────────────────────────

/**
 * Current branch from .git/HEAD, walking up from `cwd` — no git spawn, so the
 * SessionStart path stays ~0ms. Handles worktrees (`.git` file → gitdir).
 */
export function currentBranch(cwd: string): string | null {
  let dir = cwd;
  for (let i = 0; i < 40; i++) {
    const dotGit = join(dir, ".git");
    try {
      const st = statSync(dotGit);
      if (st.isDirectory()) return readHead(join(dotGit, "HEAD"));
      // `.git` is a file (worktree / submodule): follow its gitdir pointer.
      const m = readFileSync(dotGit, "utf-8").match(/^gitdir:\s*(.+)$/m);
      if (!m) return null;
      const gitdir = m[1].trim();
      return readHead(join(gitdir.startsWith("/") ? gitdir : join(dir, gitdir), "HEAD"));
    } catch {
      // no .git here — keep walking up
    }
    const parent = dirname(dir);
    if (parent === dir) return null;
    dir = parent;
  }
  return null;
}

function readHead(headPath: string): string | null {
  try {
    const m = readFileSync(headPath, "utf-8").match(/^ref:\s*refs\/heads\/(.+)$/m);
    return m ? m[1].trim() : null;
  } catch {
    return null;
  }
}

// ── Summary ──────────────────────────────────────────────────────────────────

export const SUMMARY_MAX_LINES = 12;

function ago(iso: string, now: Date): string {
  const m = Math.max(0, Math.round((now.getTime() - Date.parse(iso)) / 60_000));
  return m < 60 ? `${m}m ago` : m < 2880 ? `${Math.round(m / 60)}h ago` : `${Math.round(m / 1440)}d ago`;
}

const clip = (s: string, n = 70): string => (s.length > n ? s.slice(0, n - 1) + "…" : s);

/**
 * Plain-text summary, at most SUMMARY_MAX_LINES lines. Pure.
 * `branch` / `branchKey` come from the caller's cwd; `items` from the ledger.
 */
export function renderSummary(
  cache: WorkContextCache | null,
  items: WorkItem[],
  opts: { branch?: string | null; branchKey?: string | null; now?: Date } = {},
): string[] {
  const now = opts.now ?? new Date();
  const lines: string[] = [];
  if (opts.branch) lines.push(`Branch: ${opts.branch}${opts.branchKey ? ` → ${opts.branchKey}` : ""}`);

  if (cache) {
    const src = (name: string, s: SourceStatus) => (s.ok ? null : s.skipped ? null : `${name} error: ${clip(s.error ?? "unknown", 60)}`);
    const errs = [src("jira", cache.sources.jira), src("gitlab", cache.sources.gitlab)].filter(Boolean);
    const anyLive = cache.sources.jira.ok || cache.sources.gitlab.ok || errs.length > 0;
    if (anyLive) lines.push(`Context fetched ${ago(cache.fetched_at, now)}${errs.length ? ` (${errs.join("; ")})` : ""}`);
    if (cache.sources.jira.ok) {
      const j = cache.items.jira;
      lines.push(`Sprint tickets (${j.length}):${j.length ? "" : " none"}`);
      for (const i of j.slice(0, 3)) lines.push(`  ${i.key} [${i.status}] ${clip(i.summary)}`);
      if (j.length > 3) lines.push(`  … +${j.length - 3} more`);
    }
    if (cache.sources.gitlab.ok) {
      const fmt = (m: MergeRequest) => `  ${m.ref}${m.draft ? " (draft)" : ""}${m.mergeStatus ? ` [${m.mergeStatus}]` : ""} ${clip(m.title, 60)}`;
      const a = cache.items.mrs_authored;
      const r = cache.items.mrs_reviewing;
      lines.push(`My MRs (${a.length})${r.length ? `, review requested (${r.length})` : ""}:${a.length + r.length ? "" : " none"}`);
      for (const m of a.slice(0, 2)) lines.push(fmt(m));
      for (const m of r.slice(0, 2)) lines.push(fmt(m).replace(/^ {2}/, "  review: "));
    }
  }

  const open = items.filter((i) => !isClosed(i));
  const overdue = open.filter((i) => i.due && daysUntil(i.due, now) < 0);
  const dueSoon = open.filter((i) => i.due && daysUntil(i.due, now) >= 0 && daysUntil(i.due, now) <= 7);
  const inProgress = open.filter((i) => i.status === "in-progress");
  if (overdue.length || dueSoon.length || inProgress.length) {
    lines.push(`Ledger: ${inProgress.length} in progress, ${overdue.length} overdue, ${dueSoon.length} due within 7d`);
    for (const i of [...overdue, ...dueSoon].slice(0, 2)) lines.push(`  ${i.id} due ${i.due} ${clip(i.title, 60)}`);
  }

  if (lines.length > SUMMARY_MAX_LINES) return [...lines.slice(0, SUMMARY_MAX_LINES - 1), "  …"];
  return lines;
}
