/**
 * @version 1.0.0
 * Centralized Path Resolution — canonical home is WORKOS/TOOLS.
 *
 * Ported from upstream LifeOS 8.761.0 LIFEOS/TOOLS/Paths.ts (v1.6.3) in WorkOS 2.0.0.
 * Before this, hooks/lib/paths.ts ignored CLAUDE_CONFIG_DIR, so every hook and tool
 * resolved ~/.claude no matter where the config root was. In a Docker sandbox that
 * only worked because the claude-home-link kit symlinks ~/.claude to the workspace.
 *
 * WORKOS/TOOLS lands at install step 4.5 (DeployCore) while hooks/lib lands at step 7
 * (InstallHooks), so TOOLS never imports from the hooks tree; hooks/lib/paths.ts
 * re-exports this file instead.
 *
 * Two root directories:
 * - WORKOS_DIR (<config root>/WORKOS) — WorkOS data: MEMORY, Algorithm, Tools, USER
 * - Claude home (<config root>, default ~/.claude) — settings, skills, hooks, commands, agents
 *
 * Precedence for the Claude home: CLAUDE_PLUGIN_ROOT, then CLAUDE_CONFIG_DIR, then
 * dirname(WORKOS_SKILLS_DIR) (install.sh's root marker), then ~/.claude.
 * Precedence for WORKOS_DIR: CLAUDE_PLUGIN_ROOT/WORKOS, then WORKOS_DIR — but only when
 * neither CLAUDE_CONFIG_DIR nor WORKOS_SKILLS_DIR is set, since those isolate a profile
 * and a shell-wide WORKOS_DIR must not pull an isolated install back into ~/.claude —
 * then <Claude home>/WORKOS.
 *
 * Usage:
 *   import { getWorkosDir, getClaudeDir, workosPath } from "../../WORKOS/TOOLS/Paths";  // or "./Paths" inside WORKOS/TOOLS
 */

import { existsSync, mkdtempSync, realpathSync } from 'fs';
import { homedir, tmpdir, userInfo } from 'os';
import { dirname, join, sep } from 'path';

/** expandPath against an explicit home directory, for callers that must not read the process's own. */
export function expandPathFrom(path: string, home: string): string {
  return path
    .replace(/^\$HOME(?=\/|$)/, () => home)
    .replace(/^\$\{HOME\}(?=\/|$)/, () => home)
    .replace(/^~(?=\/|$)/, () => home);
}

/**
 * Expand shell variables in a path string
 * Supports: $HOME, ${HOME}, ~
 */
export function expandPath(path: string): string {
  return expandPathFrom(path, homedir());
}

/** The WorkOS data directory (expanded). See the precedence rules in the header. */
export function getWorkosDir(): string {
  return workosDirFor(process.env, homedir());
}

/** getWorkosDir against an explicit environment and home, for callers (and tests) that must not read process.env. */
export function workosDirFor(env: Record<string, string | undefined>, home: string): string {
  if (env.CLAUDE_PLUGIN_ROOT) {
    return join(claudeDirFor(env, home), 'WORKOS');
  }

  // CLAUDE_CONFIG_DIR and WORKOS_SKILLS_DIR isolate a profile; WORKOS_DIR only relocates
  // WORKOS within an install. A shell that exports WORKOS_DIR (the settings template sets
  // it to $HOME/.claude/WORKOS) must not send an isolated install's writes back into
  // ~/.claude. (upstream issues #1665, #1968; discussion #1900)
  const envWorkosDir = env.WORKOS_DIR;
  if (envWorkosDir && !env.CLAUDE_CONFIG_DIR && !env.WORKOS_SKILLS_DIR) {
    return expandPathFrom(envWorkosDir, home);
  }

  return join(claudeDirFor(env, home), 'WORKOS');
}

/** The Claude Code home directory (the config root). */
export function getClaudeDir(): string {
  return claudeDirFor(process.env, homedir());
}

/** The default Claude home under a given home directory, before any override. */
export function defaultClaudeDir(home: string): string {
  return join(home, '.claude');
}

/** getClaudeDir against an explicit environment and home, for callers (and tests) that must not read process.env. */
export function claudeDirFor(env: Record<string, string | undefined>, home: string): string {
  // Plugin install: the flattened plugin root plays the ~/.claude role.
  const pluginRoot = env.CLAUDE_PLUGIN_ROOT;
  if (pluginRoot) {
    return expandPathFrom(pluginRoot, home);
  }

  // Isolated or project-scoped installs set CLAUDE_CONFIG_DIR (the Docker sandbox does).
  const configDir = env.CLAUDE_CONFIG_DIR;
  if (configDir) {
    return expandPathFrom(configDir, home);
  }

  // install.sh derives the config root as dirname(WORKOS_SKILLS_DIR) and never exports
  // CLAUDE_CONFIG_DIR, so an install placed that way must resolve there too.
  const skillsDir = env.WORKOS_SKILLS_DIR;
  if (skillsDir) {
    return dirname(expandPathFrom(skillsDir, home));
  }

  return defaultClaudeDir(home);
}

/** The settings.json path (lives in the Claude home). */
export function getSettingsPath(): string {
  return join(getClaudeDir(), 'settings.json');
}

/** The authoritative .env path (<config root>/.env). */
export function getEnvPath(): string {
  return join(getClaudeDir(), '.env');
}

/** A path relative to WORKOS_DIR. */
export function workosPath(...segments: string[]): string {
  const rel = join(...segments);
  if (rel === OBSERVABILITY_REL || rel.startsWith(OBSERVABILITY_REL + sep)) {
    const testDir = testObservabilityDir();
    if (testDir) return join(testDir, rel.slice(OBSERVABILITY_REL.length));
  }
  return join(getWorkosDir(), ...segments);
}

/** Former name of workosPath, kept so existing callers keep working. */
export const paiPath = workosPath;

const OBSERVABILITY_REL = join('MEMORY', 'OBSERVABILITY');

/**
 * Under `bun test`, an OBSERVABILITY path that resolves into the live install goes to one
 * temp dir for the whole test run instead, so tests never write rows into the live logs.
 * A test that isolated its root keeps that root. The dir is shared through
 * WORKOS_TEST_OBSERVABILITY_DIR so hooks a test spawns write beside it.
 */
function testObservabilityDir(): string | null {
  if (process.env.NODE_ENV !== 'test') return null;
  if (realOr(getWorkosDir()) !== realOr(join(userInfo().homedir, '.claude', 'WORKOS'))) return null;
  return process.env.WORKOS_TEST_OBSERVABILITY_DIR ??= mkdtempSync(join(tmpdir(), 'workos-obs-test-'));
}

function realOr(p: string): string {
  try { return realpathSync(p); } catch { return p; }
}

/** The hooks directory (lives in the Claude home). */
export function getHooksDir(): string {
  return join(getClaudeDir(), 'hooks');
}

/** The skills directory (lives in the Claude home). */
export function getSkillsDir(): string {
  return join(getClaudeDir(), 'skills');
}

/** The MEMORY directory. */
export function getMemoryDir(): string {
  return workosPath('MEMORY');
}

/**
 * The Assay skill's USER customization directory. Falls back to the legacy
 * `Evals` directory while only that one exists, so suites written before the
 * Evals → Assay rename keep resolving.
 */
export function assayUserDir(workosDir: string = getWorkosDir()): string {
  const skills = join(workosDir, 'USER', 'CUSTOMIZATIONS', 'SKILLS');
  const current = join(skills, 'Assay');
  const legacy = join(skills, 'Evals');
  return !existsSync(current) && existsSync(legacy) ? legacy : current;
}
