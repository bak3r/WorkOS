/**
 * Centralized Path Resolution
 *
 * Two root directories:
 * - WORKOS_DIR (~/.claude/WORKOS) — WorkOS data: MEMORY, Algorithm, Tools, USER
 * - Claude home (~/.claude) — Claude Code: settings, skills, hooks, commands, agents
 *
 * Usage:
 *   import { getWorkosDir, getClaudeDir, paiPath } from '';
 */

import { homedir } from 'os';
import { join } from 'path';

/**
 * Expand shell variables in a path string
 * Supports: $HOME, ${HOME}, ~
 */
export function expandPath(path: string): string {
  const home = homedir();

  return path
    .replace(/^\$HOME(?=\/|$)/, home)
    .replace(/^\$\{HOME\}(?=\/|$)/, home)
    .replace(/^~(?=\/|$)/, home);
}

/**
 * Get the WorkOS data directory (expanded).
 *
 * Priority:
 *   1. CLAUDE_PLUGIN_ROOT (plugin install) → <root>/PAI
 *   2. WORKOS_DIR env var (expanded)
 *   3. ~/.claude/WORKOS  (live default — byte-identical to pre-plugin behavior)
 *
 * The CLAUDE_PLUGIN_ROOT guard MUST precede the WORKOS_DIR check: in a packed
 * plugin, bin/pai exports WORKOS_DIR equal to CLAUDE_PLUGIN_ROOT (the flattened
 * claude-home root), so trusting WORKOS_DIR first would drop the trailing /PAI
 * segment and mis-resolve paiPath() to ROOT/MEMORY instead of ROOT/WORKOS/MEMORY.
 * Resolving via getClaudeDir() + 'WorkOS' keeps the live ~/.claude/WORKOS →
 * plugin ${ROOT}/PAI mapping that the packer's ~/.claude/ → ${WORKOS_DIR} rewrite assumes.
 */
export function getWorkosDir(): string {
  if (process.env.CLAUDE_PLUGIN_ROOT) {
    return join(getClaudeDir(), 'WORKOS');
  }

  const envWorkosDir = process.env.WORKOS_DIR;

  if (envWorkosDir) {
    return expandPath(envWorkosDir);
  }

  return join(homedir(), '.claude', 'WORKOS');
}

/**
 * Get the Claude Code home directory.
 *
 * Plugin install: CLAUDE_PLUGIN_ROOT is the flattened plugin root that plays the
 * live ~/.claude role (skills/ and hooks/ sit directly under it, matching live
 * .claude/skills and .claude/hooks). Live default: ~/.claude — byte-identical to
 * pre-plugin behavior, since CLAUDE_PLUGIN_ROOT is unset on a normal install.
 */
export function getClaudeDir(): string {
  const pluginRoot = process.env.CLAUDE_PLUGIN_ROOT;

  if (pluginRoot) {
    return expandPath(pluginRoot);
  }

  return join(homedir(), '.claude');
}

/**
 * Get the settings.json path (lives in Claude home)
 */
export function getSettingsPath(): string {
  return join(getClaudeDir(), 'settings.json');
}

/**
 * Get the authoritative .env path (~/.claude/.env).
 * All credentials live here; PAI/.env is deprecated.
 */
export function getEnvPath(): string {
  return join(getClaudeDir(), '.env');
}

/**
 * Get a path relative to WORKOS_DIR
 */
export function paiPath(...segments: string[]): string {
  return join(getWorkosDir(), ...segments);
}

/**
 * Get the hooks directory (lives in Claude home)
 */
export function getHooksDir(): string {
  return join(getClaudeDir(), 'hooks');
}

/**
 * Get the skills directory (lives in Claude home)
 */
export function getSkillsDir(): string {
  return join(getClaudeDir(), 'skills');
}

/**
 * Get the MEMORY directory
 */
export function getMemoryDir(): string {
  return paiPath('MEMORY');
}
