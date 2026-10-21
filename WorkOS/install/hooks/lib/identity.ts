/**
 * Central Identity Loader — the one module hooks and tools import for DA
 * (Digital Assistant) and Principal identity.
 *
 * Read order (what the code below actually does): WORKOS_CONFIG.toml FIRST for
 * every field it carries, then the legacy chain for everything else and for
 * installs with no config yet:
 *   - settings.json daidentity/principal runtime mirror
 *   - WORKOS/USER/DIGITAL_ASSISTANT/DA_IDENTITY.md frontmatter
 *   - WORKOS/USER/PRINCIPAL/PRINCIPAL_IDENTITY.md frontmatter
 *
 * The CANONICAL config source is WORKOS/USER/CONFIG/WORKOS_CONFIG.toml (read
 * via WORKOS/TOOLS/WorkosConfig.ts); the settings.json mirror exists so hooks
 * resolve identity without parsing markdown on every event.
 */

import { readFileSync, existsSync } from 'fs';
import { join } from 'path';
// Bun's built-in YAML (bun >= 1.2.21): no npm package, so a deny-all sandbox
// without node_modules still loads this file.
const parseYaml = (s: string): any => Bun.YAML.parse(s);
import {
  loadWorkosConfig,
  type WorkosDa,
  type WorkosPrincipal,
} from '../../WORKOS/TOOLS/WorkosConfig';
import { homedir } from "node:os";

// HOME ?? USERPROFILE: Windows defines only the latter (public issue #1694, @dissembler21-png)
const HOME = process.env.HOME ?? process.env.USERPROFILE ?? homedir();
const SETTINGS_PATH = join(HOME, '.claude/settings.json');

// Identity-file paths derive from WorkosConfig's userDir. On fresh installs where
// WORKOS_CONFIG.toml hasn't been created yet, fall back to the conventional
// WORKOS/USER/ location so identity loading still bootstraps. Lazy try/catch so
// a malformed WorkosConfig never breaks identity bootstrap.
function paiUserDir(): string {
  try {
    return loadWorkosConfig().paths.userDir;
  } catch {
    return join(HOME, '.claude/WORKOS/USER');
  }
}
const DA_IDENTITY_PATH = join(paiUserDir(), 'DIGITAL_ASSISTANT/DA_IDENTITY.md');
const PRINCIPAL_IDENTITY_PATH = join(paiUserDir(), 'PRINCIPAL/PRINCIPAL_IDENTITY.md');

const DEFAULT_IDENTITY = {
  name: 'WorkOS',
  fullName: 'Personal AI',
  displayName: 'WorkOS',
  color: '#3B82F6',
};

const DEFAULT_PRINCIPAL = {
  name: 'User',
  pronunciation: '',
  timezone: 'UTC',
};

export interface Personality {
  enthusiasm: number;
  energy: number;
  expressiveness: number;
  resilience: number;
  composure: number;
  optimism: number;
  warmth: number;
  formality: number;
  directness: number;
  precision: number;
  curiosity: number;
  playfulness: number;
}

export interface Identity {
  name: string;
  fullName: string;
  displayName: string;
  color: string;
  personality?: Personality;
}

export interface Principal {
  name: string;
  pronunciation: string;
  timezone: string;
}

export interface Settings {
  daidentity?: Partial<Identity>;
  principal?: Partial<Principal>;
  env?: Record<string, string>;
  [key: string]: unknown;
}

let cachedSettings: Settings | null = null;
let cachedDaFm: Record<string, any> | null = null;
let cachedPrincipalFm: Record<string, any> | null = null;

function loadFrontmatter(path: string): Record<string, any> | null {
  try {
    if (!existsSync(path)) return null;
    const content = readFileSync(path, 'utf-8');
    const match = content.match(/^---\n([\s\S]*?)\n---/);
    if (!match) return null;
    return parseYaml(match[1]) || null;
  } catch {
    return null;
  }
}

function loadDaFrontmatter(): Record<string, any> {
  if (cachedDaFm) return cachedDaFm;
  cachedDaFm = loadFrontmatter(DA_IDENTITY_PATH) ?? {};
  return cachedDaFm;
}

function loadPrincipalFrontmatter(): Record<string, any> {
  if (cachedPrincipalFm) return cachedPrincipalFm;
  cachedPrincipalFm = loadFrontmatter(PRINCIPAL_IDENTITY_PATH) ?? {};
  return cachedPrincipalFm;
}

function loadSettings(): Settings {
  if (cachedSettings) return cachedSettings;
  try {
    if (!existsSync(SETTINGS_PATH)) {
      cachedSettings = {};
      return cachedSettings;
    }
    const content = readFileSync(SETTINGS_PATH, 'utf-8');
    cachedSettings = JSON.parse(content);
    return cachedSettings!;
  } catch {
    cachedSettings = {};
    return cachedSettings;
  }
}

function mapFrontmatterPersonality(traits: any): Personality | undefined {
  if (!traits) return undefined;
  return {
    enthusiasm: traits.enthusiasm ?? 0,
    energy: traits.energy ?? 0,
    expressiveness: traits.expressiveness ?? 0,
    resilience: traits.resilience ?? 0,
    composure: traits.composure ?? 0,
    optimism: traits.optimism ?? 0,
    warmth: traits.warmth ?? 0,
    formality: traits.formality ?? 0,
    directness: traits.directness ?? 0,
    precision: traits.precision ?? 0,
    curiosity: traits.curiosity ?? 0,
    playfulness: traits.playfulness ?? 0,
  };
}

/**
 * Get DA (Digital Assistant) identity.
 *
 * WORKOS_CONFIG.toml `[da]` wins for every field it carries. It is the typed
 * loader, it is where setup tells the principal to name their DA, and
 * WorkosConfig itself refuses to load without a non-empty `[da].name` — so it
 * is the one source guaranteed to be both present and current.
 *
 * The settings.daidentity → DA_IDENTITY.md frontmatter → DEFAULT_IDENTITY chain
 * below stays the fallback: it covers the fields config does not carry
 * (personality traits), and an install that has no config yet
 * resolves exactly as it did before.
 *
 * public PR #1781, @anikinsasha
 */
export function getIdentity(): Identity {
  const base = legacyIdentity();

  let da: WorkosDa | undefined;
  try {
    da = loadWorkosConfig().da;
  } catch {
    return base; // no config yet (fresh install) — legacy chain governs
  }
  if (!da?.name) return base;

  return {
    ...base,
    name: da.name,
    fullName: da.fullName || da.name,
    displayName: da.displayName || da.name,
    color: da.color || base.color,
  };
}

/**
 * The pre-config resolution chain: settings.daidentity (runtime read point),
 * then DA_IDENTITY.md frontmatter (authoring source), then the placeholder.
 */
function legacyIdentity(): Identity {
  const settings = loadSettings();
  const daidentity = (settings.daidentity || {}) as any;

  if (daidentity.name) {
    const envDA = settings.env?.DA;
    return {
      name: daidentity.name || envDA || DEFAULT_IDENTITY.name,
      fullName: daidentity.fullName || daidentity.name || envDA || DEFAULT_IDENTITY.fullName,
      displayName: daidentity.displayName || daidentity.name || envDA || DEFAULT_IDENTITY.displayName,
      color: daidentity.color || DEFAULT_IDENTITY.color,
      personality: daidentity.personality as Personality | undefined,
    };
  }

  // Fallback: DA_IDENTITY.md frontmatter (authoring source)
  const fm = loadDaFrontmatter();
  const core = fm.core ?? {};
  return {
    name: core.name || DEFAULT_IDENTITY.name,
    fullName: core.full_name || core.name || DEFAULT_IDENTITY.fullName,
    displayName: core.display_name || core.name || DEFAULT_IDENTITY.displayName,
    color: core.color || DEFAULT_IDENTITY.color,
    personality: mapFrontmatterPersonality(fm.personality?.traits),
  };
}

/**
 * Get Principal (human owner) identity.
 *
 * Same contract as getIdentity(): WORKOS_CONFIG.toml `[principal]` wins, and
 * WorkosConfig requires a non-empty name and timezone there. The
 * PRINCIPAL_IDENTITY.md frontmatter → settings.principal chain is the fallback.
 *
 * public PR #1781, @anikinsasha
 */
export function getPrincipal(): Principal {
  const base = legacyPrincipal();

  let p: WorkosPrincipal | undefined;
  try {
    p = loadWorkosConfig().principal;
  } catch {
    return base; // no config yet (fresh install) — legacy chain governs
  }
  if (!p?.name) return base;

  return {
    name: p.name,
    pronunciation: p.pronunciation || base.pronunciation,
    timezone: p.timezone || base.timezone,
  };
}

/** The pre-config chain: PRINCIPAL_IDENTITY.md frontmatter, then settings. */
function legacyPrincipal(): Principal {
  const fm = loadPrincipalFrontmatter();
  const core = fm.core ?? {};

  if (core.name) {
    return {
      name: core.name,
      pronunciation: core.pronunciation || DEFAULT_PRINCIPAL.pronunciation,
      timezone: core.timezone || DEFAULT_PRINCIPAL.timezone,
    };
  }

  // Fallback
  const settings = loadSettings();
  const principal = settings.principal || {};
  const envPrincipal = settings.env?.PRINCIPAL;
  return {
    name: principal.name || envPrincipal || DEFAULT_PRINCIPAL.name,
    pronunciation: principal.pronunciation || DEFAULT_PRINCIPAL.pronunciation,
    timezone: principal.timezone || DEFAULT_PRINCIPAL.timezone,
  };
}

/**
 * Clear cache (useful for testing or when source files change)
 */
export function clearCache(): void {
  cachedSettings = null;
  cachedDaFm = null;
  cachedPrincipalFm = null;
}

export function getDAName(): string {
  return getIdentity().name;
}

/**
 * Startup catchphrase. Reads settings.daidentity.startupCatchphrase first (canonical),
 * falls back to DA_IDENTITY.md frontmatter core.startup_catchphrase (authoring source).
 * Substitutes `{name}` with the DA name.
 */
export function getStartupCatchphrase(): string {
  const settings = loadSettings();
  const fromSettings = (settings.daidentity as any)?.startupCatchphrase as string | undefined;
  const fm = loadDaFrontmatter();
  const fromFm = fm.core?.startup_catchphrase as string | undefined;
  const name = getDAName();
  const template = (fromSettings && fromSettings.trim()) || (fromFm && fromFm.trim()) || '{name} here, ready to go.';
  return template.replace(/\{name\}/gi, name);
}

export function getPrincipalName(): string {
  return getPrincipal().name;
}

export function getSettings(): Settings {
  return loadSettings();
}

export function getDefaultIdentity(): Identity {
  return { ...DEFAULT_IDENTITY };
}

export function getDefaultPrincipal(): Principal {
  return { ...DEFAULT_PRINCIPAL };
}

export function getPersonality(): Personality | undefined {
  return getIdentity().personality;
}

/**
 * Read principal preferences (e.g. temperature_unit) from frontmatter.
 */
export function getPrincipalPreferences(): Record<string, any> {
  return loadPrincipalFrontmatter().preferences ?? {};
}

/**
 * Read principal tech_stack from frontmatter.
 */
export function getTechStack(): Record<string, any> {
  return loadPrincipalFrontmatter().tech_stack ?? {};
}
