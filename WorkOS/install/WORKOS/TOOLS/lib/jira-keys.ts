/**
 * jira-keys.ts — the ONE place that decides what counts as a Jira issue key.
 *
 * Keys differ per team (ABC-12, XY9-401, ...), so nothing here names a project.
 * The pattern is generic: an uppercase prefix of 2-10 chars, a dash, digits.
 *
 * Filtering:
 *   - `projectKeys` non-empty (config `jira.project_keys`) → only those prefixes.
 *   - `projectKeys` empty → every match EXCEPT the known false positives below,
 *     which are standards and algorithm names that share the key shape
 *     (UTF-8, SHA-256, RFC-7231, TLS-1, CVE-2024-...).
 *   - `ISC` is excluded ALWAYS, filter or not: `ISC-12` is this system's own
 *     criteria ID format, and an ISA is full of them.
 *
 * Keep the false-positive list short. Every entry is a prefix some real team
 * could in principle use; the explicit filter is the escape hatch for them.
 */

// `\b[A-Z][A-Z0-9]{1,9}-\d+\b`, except `_` counts as a separator: `\b` treats it
// as a word character, so `ABC-12_fix` (a common branch shape) would never match.
export const JIRA_KEY_PATTERN = /(?<![A-Za-z0-9])[A-Z][A-Z0-9]{1,9}-\d+(?![A-Za-z0-9])/g;

/** Excluded even when an explicit project filter is configured. */
export const ALWAYS_EXCLUDED_PREFIXES = ["ISC"];

/** Excluded only when no project filter is configured. */
export const FALSE_POSITIVE_PREFIXES = [
  "UTF", "SHA", "ISO", "RFC", "TLS", "HTTP", "SSL", "ES", "AES", "RSA", "CVE", "GPT",
];

/** P0-1, P3-2 … priority-shaped tokens are never tickets. */
const PRIORITY_PREFIX = /^P\d$/;

/** All distinct Jira-shaped keys in `text`, in order of first appearance. */
export function extractJiraKeys(text: string, projectKeys: string[] = []): string[] {
  if (!text) return [];
  const allow = new Set(projectKeys.map((k) => k.trim().toUpperCase()).filter(Boolean));
  const out: string[] = [];
  for (const m of text.matchAll(JIRA_KEY_PATTERN)) {
    const key = m[0];
    const prefix = key.slice(0, key.lastIndexOf("-"));
    if (ALWAYS_EXCLUDED_PREFIXES.includes(prefix)) continue;
    if (allow.size > 0) {
      if (!allow.has(prefix)) continue;
    } else if (FALSE_POSITIVE_PREFIXES.includes(prefix) || PRIORITY_PREFIX.test(prefix)) {
      continue;
    }
    if (!out.includes(key)) out.push(key);
  }
  return out;
}

/** The first key in a branch name (`dev-ABC-123-foo` → `ABC-123`), or null. */
export function keyFromBranch(branch: string, projectKeys: string[] = []): string | null {
  return extractJiraKeys(branch, projectKeys)[0] ?? null;
}
