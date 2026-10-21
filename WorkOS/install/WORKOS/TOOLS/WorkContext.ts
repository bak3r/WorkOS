#!/usr/bin/env bun
/**
 * WorkContext.ts — READ-ONLY work context from Jira and GitLab.
 *
 *   bun WorkContext.ts refresh               # fetch both sources, write the cache
 *   bun WorkContext.ts show [--json]         # print the cache
 *   bun WorkContext.ts summary               # ≤12 plain-text lines (cache + ledger + branch)
 *   bun WorkContext.ts key-from-branch [b]   # Jira key in <b> (default: current branch)
 *
 * Cache: WORKOS/MEMORY/STATE/work-context.json. LoadContext.hook.ts reads it at
 * SessionStart and spawns `refresh` detached when it is older than
 * `context_ttl_minutes` (USER/WORK/config.yaml, default 15).
 *
 * Jira: GET $JIRA_URL/rest/api/3/search/jql only. GitLab: `glab api --method GET`
 * only. Both guards live in lib/work-context.ts. A source that is not configured
 * is skipped cleanly; `refresh` always exits 0 and records per-source errors.
 */

import { loadWorkConfig } from "../../hooks/lib/work-config";
import { keyFromBranch } from "./lib/jira-keys";
import { readLedger } from "./lib/work-ledger";
import {
  currentBranch, readContextCache, refreshContext, renderSummary, workContextPath, writeContextCache,
  type SpawnFn,
} from "./lib/work-context";

const bunSpawn: SpawnFn = async (args, timeoutMs) => {
  try {
    const proc = Bun.spawn(args, { stdout: "pipe", stderr: "pipe", stdin: "ignore", timeout: timeoutMs });
    const [stdout, stderr] = await Promise.all([new Response(proc.stdout).text(), new Response(proc.stderr).text()]);
    return { code: await proc.exited, stdout, stderr };
  } catch (err) {
    return { code: 127, stdout: "", stderr: String(err) };
  }
};

async function main(argv: string[]): Promise<number> {
  const [cmd, ...rest] = argv;
  const cfg = loadWorkConfig();
  switch (cmd) {
    case "refresh": {
      const cache = await refreshContext(cfg, {
        fetch: (url, init) => fetch(url, init),
        spawn: bunSpawn,
        env: process.env,
        hasGlab: () => Boolean(Bun.which("glab")),
      });
      writeContextCache(cache);
      const s = (n: string, x: { ok: boolean; skipped?: boolean; error?: string }) =>
        `${n}=${x.ok ? "ok" : x.skipped ? "skipped" : "error"}${!x.ok && x.error ? ` (${x.error})` : ""}`;
      console.log(`[WorkContext] refreshed → ${workContextPath()} — ${s("jira", cache.sources.jira)} ${s("gitlab", cache.sources.gitlab)}`);
      return 0;
    }
    case "show": {
      const cache = readContextCache();
      if (!cache) { console.error("[WorkContext] no cache yet — run: bun WorkContext.ts refresh"); return 2; }
      if (rest.includes("--json")) console.log(JSON.stringify(cache, null, 2));
      else {
        console.log(`fetched_at: ${cache.fetched_at}`);
        for (const [name, s] of Object.entries(cache.sources)) {
          console.log(`${name}: ${s.ok ? "ok" : s.skipped ? "skipped" : "error"}${s.error ? ` — ${s.error}` : ""}`);
        }
        for (const i of cache.items.jira) console.log(`  jira ${i.key} [${i.status}] ${i.summary}`);
        for (const m of cache.items.mrs_authored) console.log(`  mr   ${m.ref} ${m.mergeStatus ?? ""} ${m.title}`);
        for (const m of cache.items.mrs_reviewing) console.log(`  rev  ${m.ref} ${m.mergeStatus ?? ""} ${m.title}`);
      }
      return 0;
    }
    case "summary": {
      const branch = currentBranch(process.cwd());
      const lines = renderSummary(readContextCache(), readLedger().items, {
        branch,
        branchKey: branch ? keyFromBranch(branch, cfg.jira.projectKeys) : null,
      });
      console.log(lines.length ? lines.join("\n") : "No work context (no cache, no due or in-progress ledger items).");
      return 0;
    }
    case "key-from-branch": {
      const branch = rest[0] ?? currentBranch(process.cwd());
      if (!branch) { console.error("[WorkContext] not on a git branch"); return 2; }
      const key = keyFromBranch(branch, cfg.jira.projectKeys);
      if (!key) { console.error(`[WorkContext] no Jira key in branch "${branch}"`); return 2; }
      console.log(key);
      return 0;
    }
    default:
      console.log("usage: WorkContext.ts refresh | show [--json] | summary | key-from-branch [branch]");
      return cmd === "--help" || cmd === "-h" ? 0 : 1;
  }
}

if (import.meta.main) {
  main(process.argv.slice(2))
    .then((code) => process.exit(code))
    .catch((err) => {
      console.error(`[WorkContext] ${String(err)}`);
      process.exit(process.argv[2] === "refresh" ? 0 : 1);
    });
}
