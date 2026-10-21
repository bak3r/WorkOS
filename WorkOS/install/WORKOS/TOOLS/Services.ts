#!/usr/bin/env bun
/**
 * Services — the one-shot control surface for every WorkOS background service.
 *
 * Single source of truth (SERVICES below) + live discovery/parse of the actual
 * systemd --user units, so `status` reports reality, not a hand-maintained guess.
 *
 *   bun Services.ts status              # what's running vs installed vs available
 *   bun Services.ts install [--all|--only a,b] [--yes]
 *   bun Services.ts uninstall --only a,b
 *   bun Services.ts doc                 # emit the canonical markdown table (for the doc)
 *
 * Linux only (systemd --user). `install` runs each service's `install:` command
 * (an Install*.ts that materializes a systemd unit pair); `uninstall` defaults to
 * disabling and removing the service/timer/path units. `install`/`uninstall` are
 * the privileged steps; `status`/`doc` are read-only.
 *
 * ported from public PR #1705, @takanorinishida
 */
import { existsSync, readFileSync } from "node:fs";
import { homedir } from "node:os";
import { join } from "node:path";

const HOME = homedir();
const CLAUDE = join(HOME, ".claude");
const WORKOS = join(CLAUDE, "WORKOS");
const TOOLS = join(WORKOS, "TOOLS");
const SYSTEMD_USER = join(HOME, ".config", "systemd", "user");

export type Cat = "capture" | "sync" | "sweep" | "maintenance";
export interface Svc {
  /** `com.workos.<x>` for services WorkOS installs. */
  label: string;
  title: string;
  purpose: string;
  category: Cat;
  optIn: boolean;           // opt-in at install (vs default-on core)
  install: string;          // shell command that installs+loads it ("#"-prefixed = note, not runnable
  uninstall?: string;
  /** True for entries loaded from the USER-tree config — per-instance private
   *  machinery. `doc` renders these with a containment marker instead of the
   *  raw install command, so the shipped generated table never carries a
   *  private path even when regenerated (Max audit, 7.31.3: the hand-edited
   *  table row was reverted by its own generator — third occurrence of the
   *  self-referential-redaction blind spot). */
  perInstance?: boolean;
}

// Canonical registry: the human-meaningful metadata. Mechanical facts (cadence,
// runner) are read live from the systemd units in status()/doc().
export const SERVICES: Svc[] = [
  { label: "com.workos.distill", title: "Cortex distill (weekly digest)", category: "maintenance", optIn: true,
    purpose: "Weekly harvest of the Knowledge Archive into a routed digest — upgrades, archive health.",
    install: `# scheduled by the Cortex skill's distill workflow — bun ${join(TOOLS, "KnowledgeDistill.ts")} run --headless` },
  { label: "com.workos.worksweep", title: "Work sweep", category: "sweep", optIn: true,
    purpose: "Hourly work capture into the local ledger — untracked sessions, stale items, project checks, TELOS work-goal derivation. Optional: the MaintenanceJobs hook already runs it hourly.",
    install: `bun ${join(TOOLS, "InstallWorkSweep.ts")}` },
  { label: "com.workos.atlas", title: "Atlas asset-graph sync", category: "sync", optIn: true,
    purpose: "Reconciles the Atlas asset graph — 15-min tick (hourly full sync) + event-hint targeted syncs.",
    install: `bun ${join(WORKOS, "ATLAS", "InstallAtlas.ts")}` },
  { label: "com.workos.derivedsync", title: "Derived-file sync", category: "sync", optIn: true,
    purpose: "Watches USER source files; regenerates PRINCIPAL_TELOS and the deny-hash corpus on hand-edits.",
    install: `bun ${join(TOOLS, "InstallDerivedSync.ts")}` },
  { label: "com.workos.commitmentsweep", title: "Commitment sweep", category: "sweep", optIn: true,
    purpose: "Daily 07:00 digest of open commitment ledger items (overdue / due today / this week). Optional: the MaintenanceJobs hook already runs it every 20h.",
    install: `bun ${join(TOOLS, "InstallCommitmentSweep.ts")}` },
];

// Per-instance services live OUTSIDE this file, in the USER tree — an entry
// whose install command points into private infrastructure (a private repo) must never sit in shipped system code. This file
// ships; `WORKOS/USER/CONFIG/services.json` does not. Absent or malformed
// config → empty list, silently: a fresh public install simply has no
// per-instance services yet.
const USER_SERVICES_PATH = join(WORKOS, "USER/CONFIG/services.json");
export function loadUserServices(): Svc[] {
  try {
    const raw = JSON.parse(readFileSync(USER_SERVICES_PATH, "utf8"));
    if (!Array.isArray(raw)) return [];
    return raw
      .filter((s) => s && typeof s.label === "string" && typeof s.install === "string")
      .map((s) => ({ ...s, perInstance: true } as Svc));
  } catch { return []; }
}

/** The full registry: shipped system services + this install's per-instance ones. */
export function allServices(): Svc[] {
  return [...SERVICES, ...loadUserServices()];
}

function sh(cmd: string): { code: number; out: string } {
  const p = Bun.spawnSync(["bash", "-c", cmd], { stdout: "pipe", stderr: "pipe" });
  return { code: p.exitCode ?? 1, out: (p.stdout.toString() + p.stderr.toString()).trim() };
}

/**
 * Every unit systemd --user currently knows. Membership is tested by exact label,
 * so there is nothing to gain by pre-filtering the list. The unit-type suffix is stripped so membership is tested against the
 * same bare label the registry stores.
 */
function loadedLabelsLinux(): Set<string> {
  const r = sh(
    "systemctl --user list-units --all --type=service,timer,path --plain --no-legend 2>/dev/null | awk '{print $1}'",
  );
  return new Set(
    r.out
      .split("\n")
      .map((s) => s.trim().replace(/\.(service|timer|path)$/, ""))
      .filter(Boolean),
  );
}

export function loadedLabels(): Set<string> {
  return loadedLabelsLinux();
}

/**
 * Find the most cadence-informative systemd unit for a label: a `.timer`
 * (OnCalendar/OnUnitActiveSec) or `.path` (PathModified — the file-watch
 * case, e.g. derivedsync) wins over the bare `.service`, since that's where
 * the scheduling lives. Falls back to the `.service` alone for persistent
 * daemons with no timer/path pairing. Searches beside the installers, so a unit
 * template shipped there is found.
 */
function findPlistLinux(label: string): { path: string; installed: boolean } | null {
  for (const ext of ["timer", "path", "service"]) {
    const installed = join(SYSTEMD_USER, `${label}.${ext}`);
    if (existsSync(installed)) return { path: installed, installed: true };
  }
  // Not-yet-installed source: Install*.ts may ship a `.template` (placeholders
  // substituted at install time) or a bare unit file.
  for (const ext of ["timer", "path", "service"]) {
    for (const base of [TOOLS, join(WORKOS, "ATLAS")]) {
      for (const cand of [`${label}.${ext}.template`, `${label}.${ext}`]) {
        const p = join(base, cand);
        if (existsSync(p)) return { path: p, installed: false };
      }
    }
  }
  return null;
}

export function findPlist(label: string): { path: string; installed: boolean } | null {
  return findPlistLinux(label);
}

function cadenceOfLinux(unitPath: string): string {
  try {
    const x = readFileSync(unitPath, "utf8");
    if (/^PathModified=/m.test(x)) return "on file-change";
    if (/^OnCalendar=/m.test(x)) return "daily/scheduled";
    // Our generated timers emit bare seconds (`900s` / `900`); accept the
    // min/h suffixes too, since a hand-written unit may use them.
    const oa = x.match(/^OnUnitActiveSec=(\d+)(s|min|h)?/m);
    if (oa) {
      const n = +oa[1];
      const s = oa[2] === "h" ? n * 3600 : oa[2] === "min" ? n * 60 : n;
      return s % 3600 === 0 ? `every ${s / 3600}h` : `every ${Math.round(s / 60)}m`;
    }
    if (/^\[Timer\]/m.test(x)) return "daily/scheduled"; // timer file with neither pattern matched above
    if (/^Type=simple/m.test(x)) return "at load"; // persistent daemon, no timer/path pairing
    return "—";
  } catch { return "?"; }
}

export function cadenceOf(unitPath: string): string {
  return cadenceOfLinux(unitPath);
}

// CLI dispatch runs only when invoked directly, so importing SERVICES never
// executes a command or exits the importing process.
if (import.meta.main) {

const cmd = process.argv[2] || "status";
const onlyArg = (() => { const i = process.argv.indexOf("--only"); return i >= 0 ? process.argv[i + 1].split(",") : null; })();
const all = process.argv.includes("--all");
const yes = process.argv.includes("--yes");
const pick = (s: Svc) => (onlyArg ? onlyArg.includes(s.label) || onlyArg.includes(s.label.replace(/^com\.workos\./, "")) : true);

const REGISTRY = allServices();

if (cmd === "status" || cmd === "list") {
  const loaded = loadedLabels();
  console.log(`WorkOS background services (${REGISTRY.length})\n`);
  console.log("  " + "STATE".padEnd(13) + "CADENCE".padEnd(16) + "SERVICE");
  for (const cat of ["capture", "sync", "sweep", "maintenance"] as Cat[]) {
    const rows = REGISTRY.filter((s) => s.category === cat);
    if (!rows.length) continue;
    console.log(`\n  ── ${cat} ──`);
    for (const s of rows) {
      const pl = findPlist(s.label);
      const state = loaded.has(s.label) ? "● running" : pl?.installed ? "○ installed" : pl ? "· available" : "✗ missing";
      const cad = pl ? cadenceOf(pl.path) : "—";
      console.log("  " + state.padEnd(13) + cad.padEnd(16) + `${s.title}  (${s.label})`);
    }
  }
  const missingCore = REGISTRY.filter((s) => !s.optIn && !loaded.has(s.label));
  if (missingCore.length) console.log(`\n  ⚠️ core not running: ${missingCore.map((s) => s.label).join(", ")}`);
} else if (cmd === "doc") {
  console.log("| Service | Category | Cadence | Opt-in | Purpose | Install |");
  console.log("|---------|----------|---------|--------|---------|---------|");
  for (const s of REGISTRY) {
    const pl = findPlist(s.label);
    const cad = pl ? cadenceOf(pl.path) : "—";
    // Per-instance entries render a containment marker, never their install
    // command: this table lands in shipped DOCUMENTATION, and a private path
    // that survives regeneration is exactly the leak the 7.31.3 audit caught.
    const inst = s.perInstance
      ? "per-install private infrastructure — defined in `WORKOS/USER/CONFIG/services.json`, NOT in the public release payload"
      : s.install.startsWith("#") ? s.install.slice(1).trim().replace(HOME, "~") : `\`${s.install.replace(HOME, "~")}\``;
    console.log(`| **${s.title}** \`${s.label}\` | ${s.category} | ${cad} | ${s.optIn ? "yes" : "core"} | ${s.purpose} | ${inst} |`);
  }
} else if (cmd === "install") {
  const targets = REGISTRY.filter(pick).filter((s) => (all || onlyArg ? true : !s.optIn) && !s.install.startsWith("#"));
  console.log(`Installing ${targets.length} service(s):`);
  if (!yes) { console.log("  (dry preview — re-run with --yes to execute)"); for (const s of targets) console.log(`  ${s.label}: ${s.install.replace(HOME, "~")}`); process.exit(0); }
  // Some services install from a script that lives in a private, release-stripped
  // skill, so on a public install the script simply is not there. Skipping those
  // explicitly beats running them: the bare failure was an opaque exit 1 that read
  // like a broken release rather than "this service belongs to a component you did
  // not install". Caught by the 2026-07-27 cross-vendor audit, which found the inbox
  // sweep always exiting 1 and an Amber installer advertised but never shipped.
  const scriptOf = (cmd: string): string | null => {
    const m = cmd.match(/(\S+\.(?:ts|sh))/);
    return m ? m[1] : null;
  };
  let failed = 0, skipped = 0;
  for (const s of targets) {
    const script = scriptOf(s.install);
    if (script && script.startsWith("/") && !existsSync(script)) {
      console.log(`  ${s.label} … ⏭  skipped (installer not present in this install: ${script.replace(HOME, "~")})`);
      skipped++;
      continue;
    }
    process.stdout.write(`  ${s.label} … `);
    const r = sh(s.install);
    if (r.code === 0) console.log("✅");
    else { console.log(`⚠️ (${r.out.split("\n").pop()})`); failed++; }
  }
  console.log(`\nRun \`bun Services.ts status\` to confirm.${skipped ? ` ${skipped} skipped.` : ""}`);
  // Exit non-zero when something actually failed. The old loop printed a warning
  // glyph and still exited 0, so any caller or install script treating the exit
  // code as truth recorded a false success.
  if (failed > 0) { console.error(`${failed} service install(s) FAILED.`); process.exit(1); }
} else if (cmd === "uninstall") {
  if (!onlyArg) { console.error("uninstall requires --only <labels> (refusing to remove everything at once)"); process.exit(1); }
  for (const s of REGISTRY.filter(pick)) {
    // The DEFAULT uninstall is written here; most registry entries define no
    // explicit `uninstall:`. `.path` is in the set because file-watch services
    // (derivedsync) materialize a path unit, and omitting it left an enabled
    // orphan firing into a deleted service (Max audit, 7.31.6).
    const un = s.uninstall ||
      `systemctl --user disable --now ${s.label}.path ${s.label}.timer ${s.label}.service 2>/dev/null; rm -f ${join(SYSTEMD_USER, s.label + ".service")} ${join(SYSTEMD_USER, s.label + ".timer")} ${join(SYSTEMD_USER, s.label + ".path")}; systemctl --user daemon-reload`;
    process.stdout.write(`  ${s.label} … `);
    const r = sh(un);
    console.log(r.code === 0 ? "🧹" : `⚠️ (${r.out.split("\n").pop()})`);
  }
} else {
  console.log("usage: bun Services.ts <status|install|uninstall|doc> [--all] [--only a,b] [--yes]");
  process.exit(1);
}

} // end import.meta.main
