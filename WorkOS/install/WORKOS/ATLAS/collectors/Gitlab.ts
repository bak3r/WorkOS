/**
 * GitLab collector — projects the user is a member of, via `glab api --method GET`
 * (glab is preinstalled and authenticated; GITLAB_HOST names the instance).
 * Read-only: the only request it can build is a paginated GET of /projects.
 */

import type { CollectResult, Collector } from "../Store";

/** Hostname of the GitLab instance from GITLAB_HOST (a full URL, as glab expects), or null. */
export function gitlabHost(): string | null {
  const raw = process.env.GITLAB_HOST || process.env.GITLAB_URI || "";
  if (!raw) return null;
  try {
    return new URL(raw.includes("://") ? raw : `https://${raw}`).hostname.toLowerCase();
  } catch {
    return null;
  }
}

const PER_PAGE = 100;
/** 20 pages = 2000 projects; hitting the cap marks the run incomplete. */
const MAX_PAGES = 20;

export const gitlab: Collector = {
  name: "gitlab",
  async collect(): Promise<CollectResult> {
    // Absent source ⇒ degrade, never throw (ratchet gate 3, from the v7.15.0
    // Forge finding on the `secrets` collector). `atlas sync` runs every
    // collector and turns the failure count into its exit code, so throwing
    // because `glab` is missing or unauthenticated makes sync exit non-zero
    // forever on any machine without it. `complete: false` keeps the sweeper
    // from deleting real assets on an empty read.
    const DEGRADED: CollectResult = { complete: false, assets: [], edges: [] };
    const projects: Array<{ path_with_namespace: string; web_url: string; archived?: boolean; last_activity_at?: string }> = [];
    let page = 1;
    for (; page <= MAX_PAGES; page++) {
      let out: string;
      try {
        const proc = Bun.spawn(
          ["glab", "api", "--method", "GET", `projects?membership=true&simple=true&per_page=${PER_PAGE}&page=${page}`],
          { stdout: "pipe", stderr: "pipe" },
        );
        out = await new Response(proc.stdout).text();
        const code = await proc.exited;
        if (code !== 0) return DEGRADED; // glab present but unusable: not logged in, API down
      } catch {
        return DEGRADED; // ENOENT — glab not installed
      }
      if (out.trim() === "") return DEGRADED;
      // Zero exit with unparseable output is a contract regression, not an absent
      // source: degrading would silently stop tracking repos forever. Throw.
      let batch: typeof projects;
      try {
        batch = JSON.parse(out);
        if (!Array.isArray(batch)) throw new Error("expected a JSON array");
      } catch (error) {
        throw new Error(`glab api projects exited 0 but returned unparseable output (contract regression?): ${(error as Error).message}`);
      }
      projects.push(...batch);
      if (batch.length < PER_PAGE) break;
    }
    return {
      complete: page <= MAX_PAGES, // ran out of pages before the cap → full enumeration
      assets: projects.map((p) => ({
        kind: "repo",
        key: `gitlab:repo:${p.path_with_namespace}`,
        name: p.path_with_namespace,
        attrs: { url: p.web_url, archived: Boolean(p.archived), last_activity_at: p.last_activity_at ?? null },
      })),
      edges: [],
    };
  },
};
