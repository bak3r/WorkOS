#!/usr/bin/env bun
/**
 * ScanConflicts — Setup step 2. READ-ONLY conflict report. Surfaces everything
 * the Setup workflow must reconcile before any write: existing settings hooks,
 * a populated user config tree, WorkOS skill-name collisions, LifeOS presence and every
 * Inventory collision (lib/inventory.ts — the same classification Adopt uses), and discoverable
 * API keys (names only — never values). Produces no mutations.
 *
 * Thin entry point over InstallEngine; the branch decision for LinkUser/Install
 * is made by the workflow from this JSON.
 *
 * Usage: bun ScanConflicts.ts [--json]
 */

import { existsSync, readdirSync, realpathSync } from "node:fs";
import { join } from "node:path";
import { inventory } from "./lib/inventory";
import {
  detectEnv,
  detectExistingUserContent,
  scanApiKeys,
  scanSettingsHooks,
} from "./InstallEngine";

interface SkillCollision {
  payload: string;
  existing: string;
  /** true = same exact name (prior install / user skill with identical name); false = case-variant foreign dir. */
  exact: boolean;
  /** Inventory class of the existing dir (collision = yours or edited; lifeos-copy = Adopt replaces it). */
  cls?: string;
}

interface ConflictReport {
  configRoot: string;
  settingsHooks: ReturnType<typeof scanSettingsHooks>;
  existingUserContent: ReturnType<typeof detectExistingUserContent>;
  /** A WorkOS skill dir already present at the target (would be re-installed over). */
  workosSkillPresent: boolean;
  /**
   * Payload skill DIRS whose name collides (case-insensitively) with an existing skills-dir
   * entry (public issue #1506, @mygirleatsmayo). Exact or case-variant, a dir that is not
   * WorkOS's is kept and that WorkOS skill is not installed. Plain files in the payload's
   * skills/ (CLAUDE.md) are not skills and are not listed.
   */
  skillCollisions: SkillCollision[];
  /** LifeOS presence, from Inventory (hash-classified). */
  lifeos: { present: boolean; version: string | null; copies: number; edited: number; data: number; hookRegistrations: number };
  /** Every unit Inventory marks `collision` (yours/edited at a path WorkOS ships). */
  collisions: Array<{ path: string; base?: string; note?: string }>;
  /** Provider names with a discoverable key in shell/config (VALUES never emitted). */
  apiKeyProviders: string[];
  /** True if any conflict needs a human decision before setup writes. */
  needsReconciliation: boolean;
}

/** Case-insensitive intersection of payload skill DIRS vs existing skills-dir entries. */
function scanSkillCollisions(skillsDir: string, cls: Map<string, string>): SkillCollision[] {
  const payloadSkills = join(import.meta.dir, "..", "install", "skills");
  if (!existsSync(payloadSkills) || !existsSync(skillsDir)) return [];
  const existingByLower = new Map<string, string>();
  for (const e of readdirSync(skillsDir)) existingByLower.set(e.toLowerCase(), e);
  const out: SkillCollision[] = [];
  for (const p of readdirSync(payloadSkills, { withFileTypes: true }).filter((d) => d.isDirectory()).map((d) => d.name).sort()) {
    if (p === "WorkOS") continue; // reported separately as workosSkillPresent
    const m = existingByLower.get(p.toLowerCase());
    if (m === undefined) continue;
    const c = cls.get(`skills/${m}`);
    if (c === "workos") continue; // a prior WorkOS install of the same skill is not a conflict
    out.push({ payload: p, existing: m, exact: m === p, cls: c });
  }
  return out;
}

function main(): void {
  const env = detectEnv();
  const configRoot = env.configRoot;
  const skillsDir = env.harness.skillsDir || join(configRoot, "skills");
  const userDir = join(configRoot, "WORKOS", "USER");

  const settingsHooks = scanSettingsHooks(join(configRoot, "settings.json"));
  const existingUserContent = detectExistingUserContent(userDir);
  const workosSkillPresent = existsSync(join(skillsDir, "WorkOS"));
  // The skill running this scan is the one install.sh just placed — that is the
  // normal bootstrap path, not a conflict. Only a DIFFERENT WorkOS skill needs a decision.
  const isSelf = workosSkillPresent &&
    realpathSync(join(skillsDir, "WorkOS")) === realpathSync(join(import.meta.dir, ".."));
  const inv = inventory(configRoot, join(import.meta.dir, ".."));
  const unitCls = new Map(inv.units.map((u) => [u.path, u.cls as string]));
  const skillCollisions = scanSkillCollisions(skillsDir, unitCls);
  const collisions = inv.units.filter((u) => u.cls === "collision").map((u) => ({ path: u.path, base: u.base, note: u.note }));

  // Names only — scanApiKeys returns values, but we surface ONLY the provider keys.
  const apiKeyProviders = Object.keys(scanApiKeys(env.homeDir, join(configRoot, "WORKOS", "USER", "CONFIG")));

  const report: ConflictReport = {
    configRoot,
    settingsHooks,
    existingUserContent,
    workosSkillPresent,
    skillCollisions,
    lifeos: { ...inv.lifeos, hookRegistrations: inv.settings.lifeosRegistrations },
    collisions,
    apiKeyProviders,
    needsReconciliation:
      settingsHooks.hookEntryCount > 0 || existingUserContent.populated || (workosSkillPresent && !isSelf) ||
      skillCollisions.length > 0 || inv.lifeos.present || collisions.length > 0,
  };

  console.log(JSON.stringify(report, null, 2));
  process.exit(0);
}

main();
