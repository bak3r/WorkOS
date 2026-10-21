#!/usr/bin/env bun
/**
 * Inventory — Setup step 0. READ-ONLY classification of the config root before anything
 * is written: what is Claude Code's, what is an untouched LifeOS copy (safe to replace,
 * after a backup), what the developer edited or owns (kept), what is LifeOS data, what is
 * already WorkOS, and where WorkOS would collide. Also summarises settings.json (LifeOS
 * hook registrations, statusLine owner, permissions, the keys InstallSettings would add,
 * security-relevant ones called out) and CLAUDE.md (WorkOS block present? LIFEOS/ path
 * references with line numbers).
 *
 * Usage: bun Inventory.ts [--config-root <dir>] [--skill-root <dir>] [--json] [--files]
 *   --json   machine-readable (Adopt/ScanConflicts/DetectEnv consume the same lib)
 *   --files  include the per-file classification in --json output
 * Exit 0 always — the workflow decides on the data.
 */

import { join } from "node:path";
import { homedir } from "node:os";
import { inventory, type InvClass } from "./lib/inventory";

function arg(a: string[], flag: string): string | undefined {
  const i = a.indexOf(flag);
  return i >= 0 && a[i + 1] && !a[i + 1].startsWith("--") ? a[i + 1] : undefined;
}

const ORDER: InvClass[] = ["collision", "lifeos-edited", "lifeos-copy", "lifeos-data", "workos", "user", "claude-owned"];
const WHAT: Record<InvClass, string> = {
  "collision": "yours or edited, at a path WorkOS ships — KEPT, the WorkOS version is not installed",
  "lifeos-edited": "LifeOS file/skill you changed — KEPT",
  "lifeos-copy": "untouched LifeOS copy — Adopt moves it to the backup, WorkOS replaces it",
  "lifeos-data": "LifeOS data — work memory is copied into WORKOS/MEMORY, then LIFEOS/ goes to the backup",
  "workos": "already WorkOS",
  "user": "yours — never touched",
  "claude-owned": "Claude Code / sandbox state — never touched",
};

function main(): void {
  const a = process.argv.slice(2);
  const home = process.env.HOME || homedir();
  const root = arg(a, "--config-root") || process.env.CLAUDE_CONFIG_DIR || join(home, ".claude");
  const skillRoot = arg(a, "--skill-root") || join(import.meta.dir, "..");
  const inv = inventory(root, skillRoot);

  if (a.includes("--json")) {
    const { files, ...rest } = inv;
    console.log(JSON.stringify(a.includes("--files") ? inv : { ...rest, fileCount: files.length }, null, 2));
    process.exit(0);
  }

  const out: string[] = [];
  out.push(`Inventory of ${inv.root}`);
  out.push(`  LifeOS: ${inv.lifeos.present ? `present${inv.lifeos.version ? ` (${inv.lifeos.version})` : ""} — ${inv.lifeos.copies} untouched copies, ${inv.lifeos.edited} edited, ${inv.lifeos.data} data files` : "not found"}   (manifests: ${inv.manifestVersions.join(", ") || "none"})`);
  out.push(`  WorkOS: ${inv.workos.present ? `present${inv.workos.version ? ` (${inv.workos.version})` : ""}` : "not installed"}`);
  out.push("");
  for (const cls of ORDER) {
    const us = inv.units.filter((u) => u.cls === cls);
    if (!us.length) continue;
    out.push(`${cls.toUpperCase()} (${us.length}) — ${WHAT[cls]}`);
    // Hook files are many and uniform: summarise copies, list the rest.
    const hookCopies = us.filter((u) => u.path.startsWith("hooks/") && cls === "lifeos-copy");
    if (hookCopies.length > 3) out.push(`  hooks/… ${hookCopies.length} files`);
    for (const u of us) {
      if (hookCopies.length > 3 && hookCopies.includes(u)) continue;
      const extra = [u.base ? `base: ${u.base}` : "", u.files > 1 ? `${u.files} files` : "", u.note ?? ""].filter(Boolean).join(", ");
      out.push(`  ${u.path}${u.kind === "dir" ? "/" : ""}${extra ? `  (${extra})` : ""}`);
    }
    out.push("");
  }
  const s = inv.settings;
  out.push("settings.json");
  if (!s.exists) out.push("  absent — InstallSettings will create it from the template");
  else if (s.parseError) out.push(`  NOT VALID JSON — fix it first (${s.parseError})`);
  else {
    const by = (o: string) => s.registrations.filter((r) => r.owner === o).length;
    out.push(`  hook registrations: ${s.registrations.length} (LifeOS ${by("lifeos")}, WorkOS ${by("workos")}, yours ${by("user")})`);
    out.push(`  statusLine: ${s.statusLine.present ? `${s.statusLine.owner}${s.statusLine.command ? ` — ${s.statusLine.command}` : ""}` : "none"}`);
    out.push(`  permissions: ${s.permissionsPresent ? "present (WorkOS rules are unioned in, yours never removed)" : "absent"}`);
    if (s.lifeosEnv.length) out.push(`  LIFEOS_* env: ${s.lifeosEnv.map((e) => `${e.key}${e.isDefault ? " (LifeOS default)" : " (custom — kept)"}`).join(", ")}`);
    if (s.wouldAdd) {
      const w = s.wouldAdd;
      out.push(`  InstallSettings would add: keys [${w.keys.join(", ")}], env [${w.env.join(", ")}], permissions +${w.permissions.allow} allow / +${w.permissions.deny} deny / +${w.permissions.ask} ask${w.permissions.other.length ? ` + ${w.permissions.other.join(", ")}` : ""}`);
      if (w.security.length) out.push(`  security-relevant settings this will add: ${w.security.join(", ")}`);
      if (w.untouched.length) out.push(`  left to you (never added or changed): ${w.untouched.join(", ")}`);
    }
  }
  out.push("");
  const c = inv.claudeMd;
  out.push("CLAUDE.md");
  if (!c.exists) out.push("  absent — DeployCore places the WorkOS template");
  else {
    out.push(`  WorkOS block: ${c.hasWorkosBlock ? "present (updated in place on re-run)" : c.workosOwned ? "whole file is WorkOS's" : "absent — ActivateImports inserts one at the top, your text kept"}`);
    if (c.lifeosRefs.length) out.push(`  LIFEOS/ references: ${c.lifeosRefs.map((r) => `L${r.line} ${r.path}`).join("; ")}  (ActivateImports --fix-lifeos-paths rewrites the ones WORKOS has)`);
  }
  console.log(out.join("\n"));
  process.exit(0);
}

main();
