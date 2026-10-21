#!/usr/bin/env bun
/**
 * InstallSettings — Setup step 4's settings placement, as a deterministic tool.
 * Places the payload's `install/settings.system.json` into the harness
 * `settings.json` with the one transform the copy-by-hand step kept getting
 * wrong: **`env` values are expanded at write time** (`$HOME`/`${HOME}`/`~` →
 * the real home). The harness injects env values verbatim with NO shell
 * expansion (WorkOS#1404/#1451) — a literal `"$HOME/..."` value creates a real
 * `$HOME/` directory on disk that silently captures runtime state. Command
 * strings (hooks, statusLine) are shell-evaluated and ship untouched.
 *
 * Semantics match the sibling installers (DeployCore/InstallHooks):
 *   - settings.json absent → write the expanded template whole.
 *   - settings.json present → merge (lib/settings-merge.ts): permissions allow/deny/ask
 *     are UNIONED (the developer's rules are never removed), env keys and other top-level
 *     keys are added only when absent, model / availableModels / theme / plugin keys are
 *     never added or changed, and security-relevant keys (skip*PermissionPrompt, autoMode,
 *     defaultMode, allowedHttpHookUrls, includeGitInstructions, autoMemoryEnabled,
 *     cleanupPeriodDays) are added only when absent and LISTED in the dry-run as
 *     `securityRelevantSettingsToAdd` so the human sees them before saying yes.
 *   - Dry-run by default; `--apply` mutates; the ledger backs settings.json up first.
 *   - REFUSES the author's live source tree (`--allow-dev` to override).
 *
 * Usage:
 *   bun InstallSettings.ts [--config-root <dir>] [--skill-root <dir>] [--apply] [--allow-dev]
 */

import { existsSync, readFileSync } from "node:fs";
import { atomicWriteText } from "./lib/atomic-write";
import { Ledger } from "./lib/ledger";
import { planSettingsMerge, securityKeysIn } from "./lib/settings-merge";
import { join } from "node:path";
import { homedir } from "node:os";
import { detectDevTree } from "./InstallEngine";

interface Args { configRoot: string; skillRoot: string; apply: boolean; allowDev: boolean; }

function parseArgs(): Args {
  const a = process.argv.slice(2);
  const get = (flag: string): string | undefined => {
    const i = a.indexOf(flag);
    return i >= 0 && a[i + 1] && !a[i + 1].startsWith("--") ? a[i + 1] : undefined;
  };
  const home = process.env.HOME || homedir(); // public issue #1729, @umair-a11y
  return {
    configRoot: get("--config-root") || process.env.CLAUDE_CONFIG_DIR || join(home, ".claude"),
    skillRoot: get("--skill-root") || join(import.meta.dir, ".."),
    apply: a.includes("--apply"),
    allowDev: a.includes("--allow-dev"),
  };
}

/** Expand a LEADING $HOME / ${HOME} / ~ path segment. Mid-string refs are left alone. */
export function expandLeadingHome(value: string, home: string): string {
  if (!home) return value;
  if (value === "$HOME" || value === "${HOME}" || value === "~") return home;
  if (value.startsWith("$HOME/")) return home + value.slice("$HOME".length);
  if (value.startsWith("${HOME}/")) return home + value.slice("${HOME}".length);
  if (value.startsWith("~/")) return home + value.slice(1);
  return value;
}

function expandEnvBlock(settings: Record<string, unknown>, home: string): number {
  const env = settings.env;
  if (!env || typeof env !== "object") return 0;
  let n = 0;
  for (const [k, v] of Object.entries(env as Record<string, unknown>)) {
    if (typeof v === "string") {
      const expanded = expandLeadingHome(v, home);
      if (expanded !== v) { (env as Record<string, unknown>)[k] = expanded; n++; }
    }
  }
  return n;
}

const args = parseArgs();
const home = process.env.HOME || homedir(); // public issue #1729, @umair-a11y
const templatePath = join(args.skillRoot, "install", "settings.system.json");
const targetPath = join(args.configRoot, "settings.json");

if (detectDevTree(args.configRoot) && !args.allowDev) {
  console.log(JSON.stringify({ ok: false, error: "dev tree detected — refusing to touch the author's live settings (--allow-dev to override)" }, null, 2));
  process.exit(2);
}
if (!existsSync(templatePath)) {
  console.log(JSON.stringify({ ok: false, error: `payload settings.system.json not found at ${templatePath}` }, null, 2));
  process.exit(1);
}

const template = JSON.parse(readFileSync(templatePath, "utf8")) as Record<string, unknown>;
const expandedCount = expandEnvBlock(template, home);
// The runtime roots follow the install, not a hardcoded ~: an explicit config root
// (sbx: CLAUDE_CONFIG_DIR=<workspace>/.claude) and an explicit WORKOS_CONFIG_DIR
// (the persisted USER home, Setup.md sbx notes) must win over the template defaults.
const tplEnvRoots = template.env as Record<string, unknown> | undefined;
if (tplEnvRoots && "WORKOS_DIR" in tplEnvRoots) tplEnvRoots.WORKOS_DIR = join(args.configRoot, "WORKOS");
if (tplEnvRoots && "WORKOS_CONFIG_DIR" in tplEnvRoots && process.env.WORKOS_CONFIG_DIR) tplEnvRoots.WORKOS_CONFIG_DIR = process.env.WORKOS_CONFIG_DIR;

const report: Record<string, unknown> = { ok: true, apply: args.apply, target: targetPath, envValuesExpanded: expandedCount };

if (!existsSync(targetPath)) {
  report.mode = "create";
  report.topLevelKeys = Object.keys(template).length;
  report.securityRelevantSettingsToAdd = securityKeysIn(template);
  if (args.apply) {
    new Ledger(args.configRoot, "InstallSettings").beforeWrite(targetPath, "settings-key", "settings.json created from the template");
    // Atomic — never leave a half-written settings.json (public PR #1643, @elhoim)
    atomicWriteText(targetPath, JSON.stringify(template, null, 2) + "\n");
  }
} else {
  let current: Record<string, unknown>;
  try {
    current = JSON.parse(readFileSync(targetPath, "utf8")) as Record<string, unknown>;
  } catch (e) {
    console.log(JSON.stringify({ ok: false, error: `settings.json is not valid JSON (${e instanceof Error ? e.message : String(e)}) — fix it and re-run; nothing was written.` }, null, 2));
    process.exit(1);
  }
  const plan = planSettingsMerge(current, template);
  report.mode = "merge";
  report.addedKeys = plan.addedKeys;
  report.addedEnv = plan.addedEnv;
  report.permissionsAdded = {
    allow: plan.permissions.allow.length, deny: plan.permissions.deny.length, ask: plan.permissions.ask.length,
    otherKeys: plan.permissions.otherKeys,
  };
  report.securityRelevantSettingsToAdd = plan.security;
  report.leftToYou = plan.untouched;
  if (!args.apply && plan.permissions.allow.length + plan.permissions.deny.length + plan.permissions.ask.length > 0) {
    report.permissionRulesToAdd = plan.permissions;
  }
  if (args.apply && plan.changed) {
    new Ledger(args.configRoot, "InstallSettings").beforeWrite(targetPath, "settings-key",
      `merged: keys ${plan.addedKeys.join(",") || "-"}; env ${plan.addedEnv.join(",") || "-"}; permissions +${plan.permissions.allow.length}/${plan.permissions.deny.length}/${plan.permissions.ask.length}`);
    atomicWriteText(targetPath, JSON.stringify(plan.merged, null, 2) + "\n");
  } else if (args.apply) {
    report.note = "nothing to add — no write, no backup";
  }
}

console.log(JSON.stringify(report, null, 2));
process.exit(0);
