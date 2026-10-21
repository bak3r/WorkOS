#!/usr/bin/env bun
/**
 * WorkosConfig.ts — typed user-config loader.
 *
 * The INTERFACE between SYSTEM code (this file ships in every WorkOS release) and
 * USER data (the actual values, sourced from WORKOS/USER/CONFIG/WORKOS_CONFIG.toml).
 *
 * Doctrine: system code reads identity, integration settings,
 * and path roots through `loadWorkosConfig()`. No system file directly opens
 * any file under WORKOS/USER/ for these values — the path-rooting happens here.
 *
 * Format decision (ISC-56.1): TOML.
 *   - Zero new dependencies (Bun 1.3+ native TOML via require()).
 *   - Human-editable with sections, comments, multi-line strings.
 *
 * See: WORKOS/DOCUMENTATION/SystemUserBoundary.md § "The four allowed access patterns".
 */

import { existsSync, statSync } from "node:fs";
import { dirname, resolve } from "node:path";
import { homedir } from "node:os";

// Expand leading `~` (and `~/`) to the user's home directory. node:fs APIs do
// not expand tildes, so any path returned from this loader must be absolute.
function expandHome(p: string): string {
  if (!p) return p;
  if (p === "~") return DEFAULT_HOME;
  if (p.startsWith("~/")) return resolve(DEFAULT_HOME, p.slice(2));
  return p;
}

// ─────────── Types ───────────

export interface WorkosPrincipal {
  name: string;
  pronunciation?: string;
  timezone: string;
}

export interface WorkosDa {
  name: string;
  fullName?: string;
  displayName?: string;
  color?: string;
}

export interface WorkosIntegrations {
  [key: string]: unknown;
}

export interface WorkosPaths {
  userDir: string;
  // memoryDir was removed 2026-07-18 (public issue #1526, @christauff): declared
  // since inception but never consumed — the memory root is derived by
  // hooks/lib/paths.ts getMemoryDir(), and a dead config knob that LOOKS live
  // is worse than no knob.
  projectsDir: string;
}

export interface WorkosConfig {
  principal: WorkosPrincipal;
  da: WorkosDa;
  integrations: WorkosIntegrations;
  paths: WorkosPaths;
}

// ─────────── Resolution ───────────

const DEFAULT_HOME = process.env.HOME || homedir();
const DEFAULT_CONFIG_PATH = resolve(DEFAULT_HOME, ".claude/WORKOS/USER/CONFIG/WORKOS_CONFIG.toml");

let cache: { config: WorkosConfig; mtime: number; path: string } | null = null;

export function loadWorkosConfig(opts: { path?: string; force?: boolean } = {}): WorkosConfig {
  const path = opts.path ?? process.env.WORKOS_CONFIG_PATH ?? DEFAULT_CONFIG_PATH;

  if (!existsSync(path)) {
    throw new Error(
      `WorkosConfig: config file not found at ${path}. ` +
        `Create it (see WORKOS/USER/CONFIG/README.md) or set WORKOS_CONFIG_PATH.`,
    );
  }

  const mtime = statSync(path).mtimeMs;
  if (!opts.force && cache && cache.path === path && cache.mtime === mtime) {
    return cache.config;
  }

  // Invalidate Bun's require cache so re-reads pick up mtime changes.
  try {
    const resolved = require.resolve(path);
    delete require.cache[resolved];
  } catch {
    // require.resolve can throw on first read; safe to ignore.
  }

  // Bun 1.3+ parses TOML via require() at any path ending in .toml.
  const raw = require(path) as unknown;
  const validated = validateAndNormalize(raw, path);
  cache = { config: validated, mtime, path };
  return validated;
}

export function clearWorkosConfigCache(): void {
  cache = null;
}

/**
 * Convenience helper for the most common consumer pattern: "give me the user
 * directory, fall back to the conventional location on fresh installs."
 * Used by Banner tools, hooks/lib/identity, and any other
 * system module that needs to compose paths under the user zone.
 */
export function paiUserDir(): string {
  try {
    return loadWorkosConfig().paths.userDir;
  } catch {
    return resolve(DEFAULT_HOME, ".claude/WORKOS/USER");
  }
}

// ─────────── Validation ───────────

/**
 * Where the work repositories live when the TOML does not say. PROJECTS_DIR wins;
 * otherwise the parent of CLAUDE_CONFIG_DIR — in the sandbox that is the mounted
 * workspace (CLAUDE_CONFIG_DIR=<workspace>/.claude); otherwise the home directory.
 */
function defaultProjectsDir(): string {
  if (process.env.PROJECTS_DIR) return process.env.PROJECTS_DIR;
  if (process.env.CLAUDE_CONFIG_DIR) return dirname(resolve(process.env.CLAUDE_CONFIG_DIR));
  return DEFAULT_HOME;
}

function validateAndNormalize(raw: unknown, path: string): WorkosConfig {
  if (!raw || typeof raw !== "object") {
    throw new Error(`WorkosConfig: ${path} did not parse to an object`);
  }
  const root = raw as Record<string, any>;

  const principal = root.principal ?? {};
  if (typeof principal.name !== "string" || !principal.name) {
    throw new Error(`WorkosConfig: [principal] requires a non-empty name — see ${path}`);
  }
  if (typeof principal.timezone !== "string" || !principal.timezone) {
    throw new Error(`WorkosConfig: [principal] requires a non-empty timezone — see ${path}`);
  }

  const da = root.da ?? {};
  if (typeof da.name !== "string" || !da.name) {
    throw new Error(`WorkosConfig: [da] requires a non-empty name — see ${path}`);
  }

  return {
    principal: {
      name: principal.name,
      pronunciation: principal.pronunciation,
      timezone: principal.timezone,
    },
    da: {
      name: da.name,
      fullName: da.full_name ?? da.fullName,
      displayName: da.display_name ?? da.displayName,
      color: da.color,
    },
    integrations: {
      ...root.integrations,
    },
    paths: {
      userDir: expandHome(
        root.paths?.userDir ?? root.paths?.user_dir ?? resolve(DEFAULT_HOME, ".claude/WORKOS/USER"),
      ),
      projectsDir: expandHome(
        root.paths?.projectsDir ?? root.paths?.projects_dir ?? defaultProjectsDir(),
      ),
    },
  };
}

// ─────────── CLI entry ───────────

if (import.meta.main) {
  try {
    const cfg = loadWorkosConfig();
    console.log(JSON.stringify(cfg, null, 2));
  } catch (e) {
    console.error((e as Error).message);
    process.exit(1);
  }
}
