/**
 * settings-merge — the pure merge InstallSettings applies to an EXISTING settings.json.
 *
 *   - permissions: union of allow / deny / ask (order kept, duplicates dropped); the
 *     developer's rules are never removed. Other permission keys (defaultMode,
 *     additionalDirectories) are added only when absent.
 *   - env: missing keys only; an existing value always wins.
 *   - security-relevant keys are added only when absent, and every one that WOULD be added
 *     is listed (`security`) so the dry-run can show it before anyone says yes.
 *   - model / availableModels / theme / plugin keys are the developer's: never added,
 *     never changed on a merge (`untouched`).
 *   - any other top-level key: added only when absent.
 * Pure: no I/O. `merged` is a deep copy.
 */

export const SECURITY_KEYS = [
  "skipDangerousModePermissionPrompt", "skipAutoPermissionPrompt", "autoMode", "defaultMode",
  "allowedHttpHookUrls", "includeGitInstructions", "autoMemoryEnabled", "cleanupPeriodDays",
] as const;

export const UNTOUCHED_KEYS = ["model", "availableModels", "theme", "enabledPlugins", "extraKnownMarketplaces"] as const;

type Obj = Record<string, unknown>;

export interface SettingsMergePlan {
  merged: Obj;
  addedKeys: string[];
  addedEnv: string[];
  permissions: { allow: string[]; deny: string[]; ask: string[]; otherKeys: string[] };
  /** Security-relevant settings this merge adds (dotted paths). */
  security: string[];
  /** Template keys deliberately left to the developer. */
  untouched: string[];
  changed: boolean;
}

const isObj = (v: unknown): v is Obj => !!v && typeof v === "object" && !Array.isArray(v);
const clone = <T>(v: T): T => JSON.parse(JSON.stringify(v));

export function planSettingsMerge(current: Obj, template: Obj): SettingsMergePlan {
  const merged = clone(current);
  const plan: SettingsMergePlan = {
    merged, addedKeys: [], addedEnv: [], permissions: { allow: [], deny: [], ask: [], otherKeys: [] },
    security: [], untouched: [], changed: false,
  };
  const sec = new Set<string>(SECURITY_KEYS);

  for (const [k, v] of Object.entries(template)) {
    if ((UNTOUCHED_KEYS as readonly string[]).includes(k)) { plan.untouched.push(k); continue; }
    if (k === "env" || k === "permissions") continue;
    if (k === "autoMode" && isObj(v) && isObj(merged.autoMode)) {
      // Present already: add only absent sub-keys, never extend the developer's lists.
      const cur = merged.autoMode as Obj;
      for (const [sk, sv] of Object.entries(v)) {
        if (!(sk in cur)) { cur[sk] = clone(sv); plan.security.push(`autoMode.${sk}`); plan.addedKeys.push(`autoMode.${sk}`); }
      }
      continue;
    }
    if (!(k in merged)) {
      merged[k] = clone(v);
      plan.addedKeys.push(k);
      if (sec.has(k)) plan.security.push(k);
    }
  }

  const tplEnv = isObj(template.env) ? template.env : {};
  if (Object.keys(tplEnv).length) {
    if (!isObj(merged.env)) merged.env = {};
    const env = merged.env as Obj;
    for (const [k, v] of Object.entries(tplEnv)) {
      if (!(k in env)) { env[k] = v; plan.addedEnv.push(k); }
    }
  }

  if (isObj(template.permissions)) {
    if (!isObj(merged.permissions)) merged.permissions = {};
    const cur = merged.permissions as Obj;
    for (const [k, v] of Object.entries(template.permissions)) {
      if (k === "allow" || k === "deny" || k === "ask") {
        const have = Array.isArray(cur[k]) ? (cur[k] as unknown[]) : [];
        const seen = new Set(have.map((x) => JSON.stringify(x)));
        const add = (Array.isArray(v) ? v : []).filter((x) => !seen.has(JSON.stringify(x)));
        if (add.length) {
          cur[k] = [...have, ...add];
          (plan.permissions[k] as unknown[]).push(...add);
        }
      } else if (!(k in cur)) {
        cur[k] = clone(v);
        plan.permissions.otherKeys.push(k);
        if (sec.has(k)) plan.security.push(`permissions.${k}`);
      }
    }
  }

  plan.changed = plan.addedKeys.length > 0 || plan.addedEnv.length > 0 || plan.permissions.otherKeys.length > 0 ||
    plan.permissions.allow.length + plan.permissions.deny.length + plan.permissions.ask.length > 0;
  return plan;
}

/** Security-relevant keys a CREATE (no settings.json yet) writes — listed the same way. */
export function securityKeysIn(template: Obj): string[] {
  const out = SECURITY_KEYS.filter((k) => k in template) as string[];
  if (isObj(template.permissions) && "defaultMode" in template.permissions) out.push("permissions.defaultMode");
  return out;
}
