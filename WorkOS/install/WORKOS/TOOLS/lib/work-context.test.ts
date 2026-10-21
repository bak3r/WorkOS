import { describe, expect, test } from "bun:test";
import { mkdirSync, mkdtempSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import type { WorkConfig } from "../../../hooks/lib/work-config";
import {
  buildJiraSearchUrl, currentBranch, glabGetArgs, isCacheStale, readOnlyFetch, refreshContext, renderSummary,
  DEFAULT_JQL, type FetchFn, type SpawnFn,
} from "./work-context";

const cfg = (over: Partial<WorkConfig> = {}): WorkConfig => ({
  enabled: true,
  kanbanStatuses: [],
  captureNative: true,
  captureSweep: true,
  captureReminders: true,
  projectProperty: (p) => p,
  jira: { enabled: true, reason: "test", projectKeys: [], jql: null },
  gitlab: { enabled: true, reason: "test" },
  contextTtlMinutes: 15,
  ...over,
});
const ENV = { JIRA_URL: "https://api.example.test/ex/jira/cloud-1/", JIRA_USERNAME: "u", JIRA_API_TOKEN: "t" };

function recordingFetch(body: unknown = { issues: [] }) {
  const calls: Array<{ url: string; init: RequestInit }> = [];
  const fn: FetchFn = async (url, init = {}) => {
    calls.push({ url, init });
    return new Response(JSON.stringify(body), { status: 200 });
  };
  return { fn, calls };
}

function recordingSpawn(responses: Record<string, unknown>) {
  const calls: string[][] = [];
  const fn: SpawnFn = async (args) => {
    calls.push(args);
    const path = args[args.length - 1];
    const key = Object.keys(responses).find((k) => path.startsWith(k));
    return key ? { code: 0, stdout: JSON.stringify(responses[key]), stderr: "" } : { code: 1, stdout: "", stderr: "404" };
  };
  return { fn, calls };
}

describe("GET-only guarantee", () => {
  test("readOnlyFetch refuses every non-GET method before calling fetch", async () => {
    const { fn, calls } = recordingFetch();
    const ro = readOnlyFetch(fn);
    for (const method of ["POST", "PUT", "PATCH", "DELETE", "post", "HEAD", "OPTIONS"]) {
      await expect(ro("https://x.test/rest/api/3/issue/A-1", { method })).rejects.toThrow(/read-only/);
    }
    await expect(ro("https://x.test/a", { method: "GET", body: "{}" })).rejects.toThrow(/read-only/);
    expect(calls).toHaveLength(0);
    await ro("https://x.test/a");
    expect(calls).toHaveLength(1);
    expect(calls[0].init.method).toBe("GET");
  });

  test("glab argv is always `glab api --method GET <path>`; flag-shaped paths are refused", () => {
    expect(glabGetArgs("user")).toEqual(["glab", "api", "--method", "GET", "user"]);
    for (const bad of ["-X POST", "--method", "projects/1 -f a=b", "", "--input=x"]) {
      expect(() => glabGetArgs(bad)).toThrow(/read-only/);
    }
  });

  test("a full refresh issues only GET requests", async () => {
    const f = recordingFetch({
      issues: [{ key: "ABC-7", fields: { summary: "Do it", status: { name: "In Progress", statusCategory: { name: "In Progress" } }, issuetype: { name: "Story" }, priority: { name: "High" }, parent: { key: "ABC-1" } } }],
    });
    const s = recordingSpawn({
      user: { username: "me" },
      "merge_requests?scope=created_by_me": [{ iid: 3, title: "Mine", web_url: "https://gl.test/g/p/-/merge_requests/3", references: { full: "g/p!3" }, draft: false, detailed_merge_status: "not_approved", source_branch: "dev-ABC-7-x" }],
      "merge_requests?scope=all": [{ iid: 9, title: "Theirs", web_url: "u", references: { full: "g/q!9" }, draft: true }],
    });
    const cache = await refreshContext(cfg(), { fetch: f.fn, spawn: s.fn, env: ENV, hasGlab: () => true, now: () => new Date("2026-10-21T10:00:00Z") });

    expect(f.calls.every((c) => (c.init.method ?? "GET") === "GET" && c.init.body == null)).toBe(true);
    expect(s.calls.every((a) => a[0] === "glab" && a[1] === "api" && a[2] === "--method" && a[3] === "GET" && a.length === 5)).toBe(true);
    expect(s.calls).toHaveLength(3);

    expect(cache.sources.jira).toEqual({ ok: true });
    expect(cache.sources.gitlab).toEqual({ ok: true });
    expect(cache.items.jira[0]).toEqual({ key: "ABC-7", summary: "Do it", status: "In Progress", statusCategory: "In Progress", type: "Story", priority: "High", parent: "ABC-1" });
    expect(cache.items.gitlab_user).toBe("me");
    expect(cache.items.mrs_authored[0]).toMatchObject({ ref: "g/p!3", mergeStatus: "not_approved" });
    expect(cache.items.mrs_reviewing[0]).toMatchObject({ ref: "g/q!9", draft: true });
    expect(s.calls[2][4]).toContain("reviewer_username=me");
  });
});

describe("request building", () => {
  test("Jira search URL: /rest/api/3/search/jql appended to the gateway base, default JQL", () => {
    const u = new URL(buildJiraSearchUrl(ENV.JIRA_URL, null));
    expect(u.origin + u.pathname).toBe("https://api.example.test/ex/jira/cloud-1/rest/api/3/search/jql");
    expect(u.searchParams.get("jql")).toBe(DEFAULT_JQL);
    expect(u.searchParams.get("fields")).toBe("summary,status,issuetype,priority,parent");
    expect(new URL(buildJiraSearchUrl(ENV.JIRA_URL, "project = X")).searchParams.get("jql")).toBe("project = X");
  });

  test("basic auth header from env", async () => {
    const f = recordingFetch();
    await refreshContext(cfg({ gitlab: { enabled: false, reason: "off" } }), { fetch: f.fn, spawn: recordingSpawn({}).fn, env: ENV, hasGlab: () => false });
    const h = f.calls[0].init.headers as Record<string, string>;
    expect(h.Authorization).toBe("Basic " + Buffer.from("u:t").toString("base64"));
  });
});

describe("skips cleanly", () => {
  test("no env, no glab → both skipped, no requests, no throw", async () => {
    const f = recordingFetch();
    const s = recordingSpawn({});
    const cache = await refreshContext(cfg(), { fetch: f.fn, spawn: s.fn, env: {}, hasGlab: () => false });
    expect(cache.sources.jira.skipped).toBe(true);
    expect(cache.sources.gitlab.skipped).toBe(true);
    expect(f.calls.length + s.calls.length).toBe(0);
  });

  test("a failing source records its error and the other still succeeds", async () => {
    const failing: FetchFn = async () => new Response("no", { status: 401 });
    const s = recordingSpawn({ user: { username: "me" }, merge_requests: [] });
    const cache = await refreshContext(cfg(), { fetch: failing, spawn: s.fn, env: ENV, hasGlab: () => true });
    expect(cache.sources.jira).toEqual({ ok: false, error: "Jira HTTP 401" });
    expect(cache.sources.gitlab.ok).toBe(true);
  });
});

describe("cache + summary", () => {
  test("staleness by TTL", () => {
    const now = new Date("2026-10-21T10:20:00Z");
    expect(isCacheStale(null, 15, now)).toBe(true);
    const c = { fetched_at: "2026-10-21T10:10:00Z" } as any;
    expect(isCacheStale(c, 15, now)).toBe(false);
    expect(isCacheStale(c, 5, now)).toBe(true);
  });

  test("summary never exceeds 12 lines", () => {
    const many = Array.from({ length: 20 }, (_, i) => ({ key: `ABC-${i}`, summary: "s", status: "To Do" }));
    const mrs = Array.from({ length: 10 }, (_, i) => ({ ref: `g/p!${i}`, title: "t", url: "", draft: false }));
    const cache = { fetched_at: new Date().toISOString(), sources: { jira: { ok: true }, gitlab: { ok: true } }, items: { jira: many, gitlab_user: "me", mrs_authored: mrs, mrs_reviewing: mrs } };
    const items = Array.from({ length: 5 }, (_, i) => ({ id: `W-${i}`, type: "task", title: "t", body: "", status: "in-progress", labels: [], source: "manual", links: { jira: [], mr: [] }, due: "2020-01-01", created: "", updated: "" })) as any;
    const lines = renderSummary(cache as any, items, { branch: "dev-ABC-1-x", branchKey: "ABC-1" });
    expect(lines.length).toBeLessThanOrEqual(12);
    expect(lines[0]).toBe("Branch: dev-ABC-1-x → ABC-1");
  });

  test("currentBranch reads .git/HEAD walking up, and follows a worktree .git file", () => {
    const root = mkdtempSync(join(tmpdir(), "branch-test-"));
    mkdirSync(join(root, ".git"));
    writeFileSync(join(root, ".git", "HEAD"), "ref: refs/heads/dev-ABC-5-y\n");
    mkdirSync(join(root, "a", "b"), { recursive: true });
    expect(currentBranch(join(root, "a", "b"))).toBe("dev-ABC-5-y");
    const wt = mkdtempSync(join(tmpdir(), "wt-test-"));
    mkdirSync(join(root, "wtgit"));
    writeFileSync(join(root, "wtgit", "HEAD"), "ref: refs/heads/feature/ABC-6\n");
    writeFileSync(join(wt, ".git"), `gitdir: ${join(root, "wtgit")}\n`);
    expect(currentBranch(wt)).toBe("feature/ABC-6");
  });
});
