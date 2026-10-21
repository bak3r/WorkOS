/**
 * Secrets collector — credentials as first-class assets, and which assets hold them.
 *
 * This is the join that makes incident response answerable. The credential registry knows
 * what each secret is and how bad losing it would be; the asset graph knows what exists.
 * Neither alone answers "the Mac Mini is compromised — what's exposed?" A HOLDS edge from
 * holder → credential answers it in both directions:
 *
 *   atlas exposed <asset>       outbound HOLDS — what that asset would leak
 *   atlas blast credential:X    inbound  HOLDS — what breaks when you rotate X
 *
 * Values are never read. The registry tool emits names + classification only, and
 * credential attrs are stripped from the exported snapshot (Store.exportSnapshot).
 *
 * This collector owns two holder edges: this machine (the env file lives here, so the machine
 * holds every credential in it) and the config repo (the env file is tracked, so a repo
 * compromise IS an env compromise).
 *
 * Known gap, deliberately not faked: credentials living only at a vendor (OAuth grants,
 * dashboard-issued tokens never written anywhere local) are invisible to every collector.
 * Those need the vendor's own audit surface.
 */

import { existsSync, readFileSync } from "node:fs";
import { join } from "node:path";
import { homedir, hostname } from "node:os";
import type { AssetObs, CollectResult, Collector, EdgeObs } from "../Store";
import { gitlabHost } from "./Gitlab";

const HOME = homedir();
const REGISTRY_TOOL = join(HOME, ".claude/skills/_INCIDENT_RESPONSE/Tools/GenerateRegistry.ts");
const DETECT_TOOL = join(HOME, ".claude/skills/_INCIDENT_RESPONSE/Tools/DetectCriticalKeys.ts");
const CONFIG_REPO_DIR = join(HOME, ".claude");

interface RegistryKey {
  name: string;
  priority: string;
  cadence: string;
  vendor: string;
  classification: string;
  dependencies: string;
}

/** The registry tool ships only with the private incident-response skill. Absent on
 *  every public install, which is a skip, not a fault — see collect(). */
function registryToolPresent(): boolean {
  return existsSync(REGISTRY_TOOL);
}

interface OverlayRule {
  pattern: string;
  priority: string;
  cadence: string;
  dependencies: string;
  isGlob: boolean;
}

async function readRegistry(): Promise<{ keys: RegistryKey[]; orphans: string[]; rules: OverlayRule[] } | null> {
  if (!existsSync(REGISTRY_TOOL)) return null;
  const proc = Bun.spawn(["bun", REGISTRY_TOOL, "--json"], { stdout: "pipe", stderr: "pipe" });
  const out = await new Response(proc.stdout).text();
  if ((await proc.exited) !== 0) return null;
  try {
    return JSON.parse(out);
  } catch {
    return null;
  }
}

/**
 * Compromise-tier membership for credentials the registry has never classified — the ones
 * that exist only in deployed infrastructure. Without this they'd carry no priority and an
 * exposure report would rank the most dangerous credentials LAST, which is worse than not
 * ranking at all. The tier shapes live in exactly one place (the detector); this asks it
 * rather than restating them.
 */
async function tierMembership(): Promise<Map<string, string>> {
  const out = new Map<string, string>();
  if (!existsSync(DETECT_TOOL)) return out;
  const proc = Bun.spawn(["bun", DETECT_TOOL, "--format", "json"], { stdout: "pipe", stderr: "pipe" });
  const raw = await new Response(proc.stdout).text();
  await proc.exited; // exit 1 just means "nothing matched" — stdout is still valid
  try {
    for (const c of (JSON.parse(raw).critical ?? []) as Array<{ name: string; tier: string }>) {
      out.set(c.name, c.tier);
    }
  } catch {
    /* detector unavailable — registry classification only */
  }
  return out;
}

function configRepoKey(): string | null {
  try {
    const cfg = readFileSync(join(CONFIG_REPO_DIR, ".git", "config"), "utf8");
    // The repo name can legitimately start with a dot (this one does), so the owner/name
    // capture must allow dots and strip a trailing .git rather than excluding dots outright.
    // Same key shape as the gitlab collector (gitlab:repo:<path_with_namespace>); the
    // instance comes from GITLAB_HOST, so no host is hardcoded here.
    const host = gitlabHost();
    if (!host) return null;
    const esc = host.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
    const m = cfg.match(new RegExp(`url\\s*=\\s*\\S*${esc}[:/](\\S+?)(?:\\.git)?\\s*$`, "m"));
    return m ? `gitlab:repo:${m[1]}` : null;
  } catch {
    return null;
  }
}

/** True when the env file is tracked in the config repo — i.e. a repo compromise is an env compromise. */
function envIsTracked(): boolean {
  const proc = Bun.spawnSync(["git", "-C", CONFIG_REPO_DIR, "ls-files", "--error-unmatch", ".env"], {
    stdout: "pipe",
    stderr: "pipe",
  });
  return proc.exitCode === 0;
}

export const secrets: Collector = {
  name: "secrets",
  async collect(): Promise<CollectResult> {
    // Two different "no registry" cases, and conflating them broke every public
    // install (Forge cross-vendor audit, RC 7.15.0). The registry tool lives in a
    // PRIVATE skill that release tooling strips, so on a public install it is simply
    // absent — that is a SKIP, exactly how IntegrityCheck's credential-registry check
    // handles its own stripped dependency. Throwing there made
    // `atlas sync` exit non-zero forever for anyone who installed WorkOS.
    if (!registryToolPresent()) {
      return { complete: false, assets: [], edges: [] };
    }
    const registry = await readRegistry();
    if (!registry) {
      // Tool IS present but failed or returned garbage: that is a real fault. Emit
      // nothing rather than a half-graph — an incomplete credential list read as
      // complete is worse than no list.
      throw new Error("registry unavailable (GenerateRegistry.ts --json failed) — refusing partial credential graph");
    }

    const assets: AssetObs[] = [];
    const edges: EdgeObs[] = [];
    const tiers = await tierMembership();
    const classified = new Set(registry.keys.map((k) => k.name));

    // Deployed-only credentials — secrets pushed straight to a deploy target — never
    // touch the env file, so the registry's derived key list misses them entirely. The
    // curated overlay still has an opinion about them, and applying it here is what keeps an
    // exposure report ranked instead of alphabetical. Only EXPLICIT overlay rows are used: a
    // glob like `*_URL` exists to catch env-file config and must not silently classify a
    // deployed secret nobody has looked at. Emitted first so the tier and env passes below
    // overwrite anything they also know about.
    const rules = registry.rules ?? [];
    for (const rule of rules) {
      if (rule.isGlob || classified.has(rule.pattern)) continue;
      assets.push({
        kind: "credential",
        key: `credential:${rule.pattern}`,
        name: rule.pattern,
        attrs: {
          priority: rule.priority,
          cadence: rule.cadence,
          vendor: "—",
          classification: "deployed secret (not in the env file)",
          dependencies: rule.dependencies,
        },
      });
    }

    // Graph-only credentials the tier shapes flag as critical. Without this they'd carry no
    // priority and an exposure report would rank the most dangerous credentials LAST.
    for (const [name, tier] of tiers) {
      if (classified.has(name)) continue;
      assets.push({
        kind: "credential",
        key: `credential:${name}`,
        name,
        attrs: {
          priority: "CRITICAL",
          tier,
          vendor: "—",
          classification: "compromise-tier by shape",
          dependencies: "not in the env file — classify in RegistryOverlay.md",
        },
      });
    }

    for (const k of registry.keys) {
      // Identifiers are not credentials, but another collector may already have put
      // them in the graph. Stamp them as identifiers rather than skipping: an unstamped stub reads as "unclassified secret"
      // and pulls attention that belongs on real credentials.
      if (k.classification === "identifier") {
        assets.push({
          kind: "credential",
          key: `credential:${k.name}`,
          name: k.name,
          attrs: { vendor: k.vendor, classification: "identifier (not a secret)", priority: "LOW" },
        });
        continue;
      }
      assets.push({
        kind: "credential",
        key: `credential:${k.name}`,
        name: k.name,
        attrs: {
          priority: k.priority,
          cadence: k.cadence,
          vendor: k.vendor,
          classification: k.classification,
          dependencies: k.dependencies,
        },
      });
    }
    // Only env-file credentials are held by this machine and the config repo.
    const credentialKeys = assets.filter((a) => classified.has(String(a.name))).map((a) => a.key);

    // 1. This machine holds the env file, therefore every credential in it.
    const machineKey = `machine:${hostname()}`;
    assets.push({ kind: "machine", key: machineKey, name: hostname() });
    for (const key of credentialKeys) {
      edges.push({ kind: "HOLDS", srcKey: machineKey, dstKey: key, srcKind: "machine", dstKind: "credential" });
    }

    // 2. The config repo, when the env file is tracked in it.
    const repoKey = configRepoKey();
    if (repoKey && envIsTracked()) {
      for (const key of credentialKeys) {
        edges.push({ kind: "HOLDS", srcKey: repoKey, dstKey: key, srcKind: "repo", dstKind: "credential" });
      }
    }

    // Orphans: names in env history no longer present. Tracked so a compromise triage can
    // still name them — they may be live at the vendor with nothing watching them.
    for (const name of registry.orphans) {
      assets.push({
        kind: "credential",
        key: `credential:${name}`,
        name,
        attrs: { priority: "ORPHAN", status: "not in current env — verify revoked at vendor" },
      });
    }

    return { complete: true, assets, edges };
  },
};
