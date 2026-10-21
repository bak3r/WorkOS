/**
 * work-context-block.ts — the "Work context" block LoadContext injects at SessionStart.
 *
 * Reads only local state: the cached Jira/GitLab context
 * (MEMORY/STATE/work-context.json), the work ledger, and .git/HEAD. It never
 * calls Jira or GitLab itself; when the cache is stale and an integration is
 * enabled it spawns `WorkContext.ts refresh` detached and moves on, so the
 * fresh data lands for the next session. With no integrations and no
 * due/in-progress ledger items it returns null after a few existsSync calls.
 *
 * Never throws (callers still wrap it) and never blocks.
 */

import { spawn } from "node:child_process";
import { mkdirSync, statSync, writeFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { loadWorkConfig } from "./work-config";
import { resolveBun } from "./resolve-bin";
import { keyFromBranch } from "../../WORKOS/TOOLS/lib/jira-keys";
import { readLedger } from "../../WORKOS/TOOLS/lib/work-ledger";
import {
  currentBranch, isCacheStale, readContextCache, renderSummary, workContextPath,
} from "../../WORKOS/TOOLS/lib/work-context";

const REFRESH_TOOL = join(import.meta.dir, "..", "..", "WORKOS", "TOOLS", "WorkContext.ts");
/** Concurrent session starts spawn at most one refresh per window. */
const REFRESH_DEBOUNCE_MS = 2 * 60_000;

function spawnRefreshDetached(): boolean {
  const stamp = workContextPath() + ".refresh";
  try {
    if (Date.now() - statSync(stamp).mtimeMs < REFRESH_DEBOUNCE_MS) return false;
  } catch {}
  try {
    mkdirSync(dirname(stamp), { recursive: true });
    writeFileSync(stamp, String(Date.now()));
    const proc = spawn(resolveBun(), [REFRESH_TOOL, "refresh"], { stdio: "ignore", detached: true });
    proc.on("error", () => {});
    proc.unref();
    return true;
  } catch {
    return false;
  }
}

export interface WorkContextBlockOptions {
  cwd?: string;
  /** Injected for tests; default spawns WorkContext.ts refresh detached. */
  refresh?: () => boolean;
  now?: Date;
}

export function buildWorkContextBlock(opts: WorkContextBlockOptions = {}): string | null {
  try {
    const cfg = loadWorkConfig();
    const integrations = cfg.jira.enabled || cfg.gitlab.enabled;
    const cache = integrations ? readContextCache() : null;
    let refreshing = false;
    if (integrations && isCacheStale(cache, cfg.contextTtlMinutes, opts.now)) {
      refreshing = (opts.refresh ?? spawnRefreshDetached)();
    }
    const items = readLedger().items;
    const branch = currentBranch(opts.cwd ?? process.cwd());
    const branchKey = branch ? keyFromBranch(branch, cfg.jira.projectKeys) : null;
    const lines = renderSummary(cache, items, {
      // A bare branch name is noise unless it names a ticket or Jira is wired up.
      branch: branchKey || integrations ? branch : null,
      branchKey,
      now: opts.now,
    });
    if (lines.length === 0) return null;
    const note = refreshing ? "\n(refreshing Jira/GitLab context in the background — read-only)" : "";
    return `## Work context\n\n${lines.join("\n")}${note}\n`;
  } catch {
    return null;
  }
}
