#!/usr/bin/env bun
/**
 * DeployComponents — Setup step 7.5 (opt-in). Deploys the AI-wide runtime
 * components that the bare skill SHIPS but does not auto-activate: the
 * statusline, settings enhancements, agents/commands, and the optional
 * background jobs (worksweep, derivedsync, commitmentsweep).
 * Each component is OPT-IN — the Setup workflow asks which the user wants, then
 * calls this with `--components <csv>` (or `--all`).
 *
 * Thin orchestrator: it does not reimplement unit substitution for the jobs
 * that already own a standalone installer — it delegates to them through
 * Services.ts (InstallWorkSweep.ts, InstallDerivedSync.ts, ...), which install
 * systemd --user units (Linux only).
 *
 * Self-staging: every component reads from the live runtime tree
 * `<configRoot>/WORKOS`, falling back to the shipped payload `install/WorkOS/`
 * when the runtime tree isn't laid down yet — uniform across every component
 * (partial staging was an inconsistent contract).
 *
 * Safety: dry-run by default (`--apply` to mutate); REFUSES on the author's live
 * source tree (`--allow-dev` to override); idempotent per component (a loaded,
 * unchanged service is left running — no restart, no backup churn); never
 * overwrites a populated file without a ledger backup (.workos-backup/<run>/, undone by
 * Rollback.ts); an existing statusLine that is not WorkOS's is KEPT unless
 * `--replace-statusline`; an existing agent/command file is never written into (kept,
 * reported); on Bedrock/Vertex without Fable in availableModels, agents/Max.md is
 * installed with `model: opus` (the max rung resolves to opus there); a component whose
 * prerequisites are absent reports a LOUD blocker and fails the run (no silent
 * no-op success).
 *
 * Usage:
 *   bun DeployComponents.ts [--components statusline,worksweep,derivedsync | --all]
 *                           [--config-root <dir>] [--skill-root <dir>]
 *                           [--apply] [--allow-dev] [--replace-statusline]
 *   (dry-run by default — reports the plan per component without writing)
 */

import { execFileSync } from "node:child_process";
import { chmodSync, cpSync, existsSync, mkdirSync, readdirSync, readFileSync, statSync } from "node:fs";
import { atomicWriteText } from "./lib/atomic-write";
import { dirname, join, relative } from "node:path";
import { homedir } from "node:os";
import { detectDevTree, fableUnavailable, isTestFile } from "./InstallEngine";
import { Ledger } from "./lib/ledger";

// Enhancement components are the à-la-carte half of setup. The "WorkOS Core"
// (skills + system prompt + base settings + CLAUDE.md) is installed by Setup's
// core steps; these are the opt-in extras the user (or their AI) picks some/all/none of.
//
// Two kinds:
// - Non-service: statusline, tooltips, spinnerverbs, agents, commands — settings.json merges + file copies
// - Background services: delegated to Services.ts (single source of truth for the background services)
//
// Component names for background services are their short labels (worksweep, derivedsync, etc.)
// or the full label (com.workos.worksweep). Services.ts handles the mapping.
const NON_SERVICE_COMPONENTS = ["statusline", "tooltips", "spinnerverbs", "agents", "commands"] as const;
type NonServiceComponent = (typeof NON_SERVICE_COMPONENTS)[number];

// Background-service components — kept in sync with Services.ts (only services whose
// Install*.ts ships in WORKOS/TOOLS). The install for these is delegated to Services.ts.
// Short labels (without com.workos. prefix) for convenience; Services.ts accepts both forms.
const SERVICE_COMPONENTS = [
  "worksweep", "derivedsync", "commitmentsweep"
] as const;
type ServiceComponent = (typeof SERVICE_COMPONENTS)[number];

const KNOWN_COMPONENTS = [...NON_SERVICE_COMPONENTS, ...SERVICE_COMPONENTS] as const;
type Component = (typeof KNOWN_COMPONENTS)[number];

interface Ctx {
  configRoot: string;
  workosDir: string; // <configRoot>/WORKOS — the live runtime root
  payloadRoot: string; // <skillRoot>/install/WORKOS — the shipped runtime tree
  installRoot: string; // <skillRoot>/install — settings.enhancements.json + agents/ live here
  home: string;
  bun: string; // resolved bun binary path — substituted for __BUN_PATH__ in systemd units
  apply: boolean;
  replaceStatusline: boolean;
  /** Created on first write — dry-runs never touch the manifest. */
  ledger: () => Ledger;
}

interface ComponentResult {
  component: Component;
  ready: boolean; // can be deployed (present in live tree OR payload)
  actions: string[]; // what apply will / did do
  blockers: string[]; // why it can't run — a non-empty list FAILS the run
  applied?: boolean;
  probe?: { name: string; passed: boolean; detail: string };
  error?: string;
}

// ── helpers ──────────────────────────────────────────────────────────

function arg(a: string[], flag: string): string | undefined {
  const i = a.indexOf(flag);
  return i >= 0 && a[i + 1] && !a[i + 1].startsWith("--") ? a[i + 1] : undefined;
}

/**
 * Resolve the live runtime dir robustly. The runtime references all-caps
 * `WORKOS` (statusline, units), but the sibling install tools use mixed-case
 * `WorkOS` (only harmless on a case-insensitive FS, latent on Linux). Pick
 * whichever actually exists; default to the all-caps runtime name.
 */
function resolveWorkosDir(configRoot: string): string {
  for (const name of ["WORKOS", "WorkOS"]) {
    if (existsSync(join(configRoot, name))) return join(configRoot, name);
  }
  return join(configRoot, "WORKOS");
}

/** Back up (first time this run) and record a file before it is rewritten. */
function backup(path: string, ctx: Ctx, detail: string): string {
  ctx.ledger().beforeWrite(path, "settings-key", detail);
  return ctx.ledger().backupRoot;
}

/** Where a component's path can be sourced from. */
function availability(rel: string, ctx: Ctx): { inLive: boolean; inPayload: boolean } {
  return { inLive: existsSync(join(ctx.workosDir, rel)), inPayload: existsSync(join(ctx.payloadRoot, rel)) };
}

/**
 * Ensure a component path exists in the live tree, copying from the shipped
 * payload only when ABSENT (never overwrites a populated target — idempotent).
 * Returns whether the path is present after the call.
 */
function ensurePresent(rel: string, ctx: Ctx): boolean {
  const dst = join(ctx.workosDir, rel);
  if (existsSync(dst)) return true;
  const src = join(ctx.payloadRoot, rel);
  if (!existsSync(src)) return false;
  ctx.ledger().recordAdd(dst);
  mkdirSync(dirname(dst), { recursive: true });
  cpSync(src, dst, { recursive: true, filter: (p) => !isTestFile(p) });
  return true;
}

/** Is the service's job registered? systemd --user (timer, path or service unit); Linux only. */
/** Background jobs are systemd --user units; without a user session (the usual sbx case) they cannot load. */
function systemdUserAvailable(): boolean {
  if (process.platform !== "linux") return false;
  try {
    execFileSync("systemctl", ["--user", "show-environment"], { stdio: ["pipe", "pipe", "pipe"], timeout: 15000 });
    return true;
  } catch { return false; }
}

function serviceLoaded(label: string): boolean {
  if (process.platform !== "linux") return false;
  for (const unit of [`${label}.timer`, `${label}.path`, `${label}.service`]) {
    try {
      execFileSync("systemctl", ["--user", "is-enabled", unit], { stdio: ["pipe", "pipe", "pipe"], timeout: 15000 });
      return true;
    } catch { /* try the next unit kind */ }
  }
  return false;
}

// ── component deployers ──────────────────────────────────────────────

/** Statusline: place the script, chmod +x, wire settings.json statusLine. */
function deployStatusline(ctx: Ctx): ComponentResult {
  const r: ComponentResult = { component: "statusline", ready: false, actions: [], blockers: [] };
  const av = availability("WORKOS_StatusLine.sh", ctx);
  const scriptPath = join(ctx.workosDir, "WORKOS_StatusLine.sh");
  const settingsPath = join(ctx.configRoot, "settings.json");
  // Build the settings.json command from the ACTUAL install root (ctx.workosDir),
  // not a hardcoded ~/.claude — a custom --config-root (e.g. ~/.claude-fable) places
  // the script under its own WORKOS/, and the old literal pointed at the wrong tree.
  const command = scriptPath.startsWith(`${ctx.home}/`)
    ? `$HOME/${scriptPath.slice(ctx.home.length + 1)}`
    : scriptPath;

  if (!av.inLive && !av.inPayload) {
    r.blockers.push(`WORKOS_StatusLine.sh not in live tree (${scriptPath}) or payload`);
    return r;
  }
  r.ready = true;
  // An existing statusLine that is not WorkOS's is the developer's: keep it unless asked.
  let existing: Record<string, unknown> | undefined;
  try { existing = existsSync(settingsPath) ? JSON.parse(readFileSync(settingsPath, "utf-8")).statusLine : undefined; } catch { /* reported below */ }
  const foreign = !!existing && existing.command !== command;
  if (foreign && !ctx.replaceStatusline) {
    r.actions.push(`kept (yours): settings.json statusLine → ${String(existing!.command ?? JSON.stringify(existing))} — pass --replace-statusline to swap in WorkOS's`);
    r.applied = false;
    if (ctx.apply) r.probe = { name: "statusline-kept", passed: true, detail: "existing non-WorkOS statusLine kept" };
    return r;
  }
  if (!ctx.apply) {
    if (!av.inLive) r.actions.push(`copy WORKOS_StatusLine.sh from payload → ${scriptPath}`);
    r.actions.push(`chmod +x ${scriptPath}`, `wire settings.json statusLine → ${command}${foreign ? " (replacing yours — --replace-statusline)" : ""}`);
    return r;
  }

  try {
    ensurePresent("WORKOS_StatusLine.sh", ctx);
    chmodSync(scriptPath, 0o755);

    // A populated-but-unparseable settings.json must NOT be rewritten from {} —
    // that would silently drop the user's whole config. Abort with a blocker.
    let settings: Record<string, unknown> = {};
    if (existsSync(settingsPath)) {
      try {
        settings = JSON.parse(readFileSync(settingsPath, "utf-8"));
      } catch {
        r.blockers.push(`settings.json exists but is not valid JSON — refusing to rewrite (would drop your config). Fix it, then re-run.`);
        return r;
      }
    }
    const current = settings.statusLine as Record<string, unknown> | undefined;
    const alreadyWired = current?.command === command;
    if (!alreadyWired) {
      backup(settingsPath, ctx, "statusLine → WorkOS");
      // ported from public PR #1772, @asdf8675309; value adapted to 5 — a 1s
      // refresh re-runs the statusline script every second for no visible gain.
      settings.statusLine = { type: "command", command, refreshInterval: 5 };
      // Atomic — never leave a half-written settings.json (public PR #1643, @elhoim)
      atomicWriteText(settingsPath, JSON.stringify(settings, null, 2) + "\n");
    }
    r.applied = !alreadyWired;
    const reread = JSON.parse(readFileSync(settingsPath, "utf-8"));
    const wired = (reread.statusLine as Record<string, unknown> | undefined)?.command === command;
    let executable = false;
    try { execFileSync("test", ["-x", scriptPath]); executable = true; } catch { executable = false; }
    r.probe = { name: "statusline-wired", passed: wired && executable, detail: `wired=${wired} executable=${executable}${alreadyWired ? " (idempotent)" : ""}` };
  } catch (err) {
    r.error = err instanceof Error ? err.message : String(err);
  }
  return r;
}

/**
 * Merge a single Claude-Code enhancement key (spinnerTipsOverride / spinnerVerbs)
 * from the shipped `install/settings.enhancements.json` into the user's
 * settings.json — set-the-key semantics (these are whole-object settings, like
 * statusLine). Idempotent (deep-equal → skip), backup-before-write, parse-abort.
 */
function deploySettingsKey(component: Component, key: string, ctx: Ctx): ComponentResult {
  const r: ComponentResult = { component, ready: false, actions: [], blockers: [] };
  const enhPath = join(ctx.installRoot, "settings.enhancements.json");
  if (!existsSync(enhPath)) {
    r.blockers.push(`settings.enhancements.json not in payload (${enhPath}) — runtime not staged`);
    return r;
  }
  let enh: Record<string, unknown>;
  try { enh = JSON.parse(readFileSync(enhPath, "utf-8")); } catch { r.blockers.push(`${enhPath} is not valid JSON`); return r; }
  if (!(key in enh)) {
    r.blockers.push(`${key} not present in settings.enhancements.json`);
    return r;
  }
  r.ready = true;
  const settingsPath = join(ctx.configRoot, "settings.json");
  if (!ctx.apply) {
    r.actions.push(`merge settings.${key} into ${settingsPath} (backup-first, idempotent)`);
    return r;
  }
  try {
    let settings: Record<string, unknown> = {};
    if (existsSync(settingsPath)) {
      try { settings = JSON.parse(readFileSync(settingsPath, "utf-8")); }
      catch { r.blockers.push(`settings.json exists but is not valid JSON — refusing to rewrite (would drop your config).`); return r; }
    }
    const already = JSON.stringify(settings[key]) === JSON.stringify(enh[key]);
    if (!already) {
      backup(settingsPath, ctx, `${key} → WorkOS`);
      settings[key] = enh[key];
      // Atomic — never leave a half-written settings.json (public PR #1643, @elhoim)
      atomicWriteText(settingsPath, JSON.stringify(settings, null, 2) + "\n");
    }
    r.applied = !already;
    const reread = existsSync(settingsPath) ? JSON.parse(readFileSync(settingsPath, "utf-8")) : {};
    const passed = JSON.stringify(reread[key]) === JSON.stringify(enh[key]);
    r.probe = { name: `${component}-merged`, passed, detail: `settings.${key} set${already ? " (idempotent)" : ""}` };
  } catch (err) {
    r.error = err instanceof Error ? err.message : String(err);
  }
  return r;
}

/**
 * Copy a shipped file tree (agents/ or commands/) file by file: a file that already exists
 * is the developer's (or an edited LifeOS copy) and is never written into — kept, reported.
 * `transform` may rewrite a file's text on the way in (Max.md on Bedrock).
 */
function copyFilesKeepingYours(src: string, dst: string, ctx: Ctx, transform?: (rel: string, text: string) => string): { copied: number; kept: string[]; failures: string[] } {
  const out = { copied: 0, kept: [] as string[], failures: [] as string[] };
  const walk = (d: string): void => {
    for (const e of readdirSync(d).sort()) {
      const sp = join(d, e);
      if (statSync(sp).isDirectory()) { walk(sp); continue; }
      if (isTestFile(e)) continue;
      const rel = relative(src, sp);
      const dp = join(dst, rel);
      if (existsSync(dp)) { out.kept.push(rel); continue; }
      try {
        ctx.ledger().recordAdd(dp);
        mkdirSync(dirname(dp), { recursive: true });
        const text = transform ? transform(rel, readFileSync(sp, "utf-8")) : null;
        if (text !== null) atomicWriteText(dp, text);
        else cpSync(sp, dp, { preserveTimestamps: true });
        out.copied++;
      } catch (err) {
        out.failures.push(`${sp} → ${dp}: ${err instanceof Error ? err.message : String(err)}`);
      }
    }
  };
  walk(src);
  return out;
}

/** Max.md pins `model: fable`; where Fable is not offered (Bedrock/Vertex list) it must be opus. */
export function maxModelTransform(fableOff: boolean): ((rel: string, text: string) => string) | undefined {
  if (!fableOff) return undefined;
  return (rel, text) => (rel === "Max.md" ? text.replace(/^model:\s*fable\s*$/m, "model: opus") : text);
}

function deployFileTree(component: "agents" | "commands", ctx: Ctx): ComponentResult {
  const r: ComponentResult = { component, ready: false, actions: [], blockers: [] };
  const src = join(ctx.installRoot, component);
  const dst = join(ctx.configRoot, component);
  if (!existsSync(src) && !existsSync(dst)) {
    r.blockers.push(`${component} not in payload (${src}) and not already installed (${dst})`);
    return r;
  }
  r.ready = true;
  const fableOff = component === "agents" && fableUnavailable(ctx.configRoot);
  if (!ctx.apply) {
    if (!existsSync(src)) { r.actions.push(`${component} already present at ${dst} — no-op`); return r; }
    const existing = existsSync(dst) ? readdirSync(src).filter((e) => existsSync(join(dst, e))) : [];
    r.actions.push(`copy missing ${component} → ${dst} (never writes into an existing file)`);
    if (existing.length) r.actions.push(`kept (yours): ${existing.map((e) => `${component}/${e}`).join(", ")}`);
    if (fableOff) r.actions.push("Bedrock/Vertex without Fable in availableModels — agents/Max.md installs with model: opus");
    return r;
  }
  try {
    if (!existsSync(src)) {
      r.applied = false;
      r.probe = { name: `${component}-present`, passed: true, detail: `already present at ${dst} (no payload to copy)` };
      return r;
    }
    const { copied, kept, failures } = copyFilesKeepingYours(src, dst, ctx, maxModelTransform(fableOff));
    r.applied = copied > 0;
    if (kept.length) r.actions.push(`kept (yours): ${kept.map((k) => `${component}/${k}`).join(", ")}`);
    if (fableOff && !kept.includes("Max.md")) r.actions.push("agents/Max.md installed with model: opus (no Fable on this provider)");
    r.probe = { name: `${component}-copied`, passed: failures.length === 0 && existsSync(dst), detail: `${copied} file(s) copied, ${kept.length} kept (yours)${failures.length ? `, ${failures.length} failed` : ""}` };
  } catch (err) {
    r.error = err instanceof Error ? err.message : String(err);
  }
  return r;
}

/**
 * Delegate background-service install to Services.ts — single source of truth for the services.
 * This keeps DeployComponents focused on non-service components (settings merges, file copies)
 * while Services.ts owns the systemd unit machinery.
 */
function deployViaServices(component: ServiceComponent, ctx: Ctx): ComponentResult {
  const r: ComponentResult = { component, ready: false, actions: [], blockers: [] };
  const servicesTs = join(ctx.workosDir, "TOOLS", "Services.ts");

  // Services.ts must be present (either in live tree or staged from payload)
  const av = availability("TOOLS", ctx);
  if (!av.inLive && !av.inPayload) {
    r.blockers.push(`TOOLS not in live tree (${join(ctx.workosDir, "TOOLS")}) or payload`);
    return r;
  }
  if (!systemdUserAvailable()) {
    r.blockers.push(`no systemd --user session (systemctl --user unavailable) — skip ${component}; with hooks installed the MaintenanceJobs SessionStart hook runs WorkSweep/CommitmentSweep instead`);
    return r;
  }
  r.ready = true;

  // Build the label — Services.ts accepts short form (worksweep) or full (com.workos.worksweep)
  const label = component.startsWith("com.workos.") ? component : `com.workos.${component}`;

  if (!ctx.apply) {
    if (!av.inLive) r.actions.push(`stage TOOLS from payload → ${join(ctx.workosDir, "TOOLS")}`);
    r.actions.push(`bun ${servicesTs.replace(ctx.home, "~")} install --only ${component} --yes`);
    return r;
  }

  try {
    ensurePresent("TOOLS", ctx);
    if (!existsSync(servicesTs)) {
      r.blockers.push(`Services.ts still missing after staging: ${servicesTs}`);
      return r;
    }
    // Delegate to Services.ts
    const out = execFileSync("bun", [servicesTs, "install", "--only", component, "--yes"], {
      stdio: ["pipe", "pipe", "pipe"],
      timeout: 120000, // some service installers take a while
      cwd: dirname(servicesTs),
    }).toString();
    r.applied = true;
    // Confirm the job actually loaded
    const loaded = serviceLoaded(label);
    r.probe = { name: `${component}-loaded`, passed: loaded, detail: loaded ? `${label} loaded via Services.ts` : `Services.ts exit 0 but ${label} not loaded: ${out.trim().split("\n").slice(-1)[0]}` };
  } catch (err) {
    r.error = err instanceof Error ? err.message : String(err);
  }
  return r;
}

function isServiceComponent(c: Component): c is ServiceComponent {
  return (SERVICE_COMPONENTS as readonly string[]).includes(c);
}

function deploy(component: Component, ctx: Ctx): ComponentResult {
  // Non-service components: handled directly
  switch (component) {
    case "statusline": return deployStatusline(ctx);
    case "tooltips": return deploySettingsKey("tooltips", "spinnerTipsOverride", ctx);
    case "spinnerverbs": return deploySettingsKey("spinnerverbs", "spinnerVerbs", ctx);
    case "agents": return deployFileTree("agents", ctx);
    case "commands": return deployFileTree("commands", ctx);
  }
  // Background-service components: delegate to Services.ts
  if (isServiceComponent(component)) {
    return deployViaServices(component, ctx);
  }
  // Fallback (shouldn't reach here with proper types, but TypeScript wants exhaustiveness)
  return { component, ready: false, actions: [], blockers: [`unknown component: ${component}`] };
}

// ── main ─────────────────────────────────────────────────────────────

function main(): void {
  const a = process.argv.slice(2);
  const home = process.env.HOME || homedir(); // public issue #1729, @umair-a11y
  const configRoot = arg(a, "--config-root") || process.env.CLAUDE_CONFIG_DIR || join(home, ".claude");
  const skillRoot = arg(a, "--skill-root") || join(import.meta.dir, "..");
  const apply = a.includes("--apply");
  const allowDev = a.includes("--allow-dev");

  if (detectDevTree(configRoot) && !allowDev) {
    console.log(JSON.stringify({ ok: false, refused: "dev-tree", detail: `${configRoot} is a WorkOS source tree (dev-tree marker present) — refusing to deploy components. Use --allow-dev only in a sandbox.` }, null, 2));
    process.exit(2);
  }

  // Selection: --all, or --components csv. Dry-run with no selection plans all.
  const csv = arg(a, "--components");
  const selectAll = a.includes("--all");
  let selected: Component[];
  if (selectAll) {
    selected = [...KNOWN_COMPONENTS];
  } else if (csv) {
    const requested = csv.split(",").map((s) => s.trim()).filter(Boolean);
    const unknown = requested.filter((c) => !KNOWN_COMPONENTS.includes(c as Component));
    if (unknown.length) {
      console.log(JSON.stringify({ ok: false, error: `unknown component(s): ${unknown.join(", ")}`, known: KNOWN_COMPONENTS }, null, 2));
      process.exit(1);
    }
    selected = requested as Component[];
  } else if (apply) {
    console.log(JSON.stringify({ ok: false, error: "--apply needs --components <csv> or --all (opt-in: nothing deploys implicitly)", known: KNOWN_COMPONENTS }, null, 2));
    process.exit(1);
  } else {
    selected = [...KNOWN_COMPONENTS]; // dry-run planning view
  }

  const ctx: Ctx = {
    configRoot,
    workosDir: resolveWorkosDir(configRoot),
    payloadRoot: existsSync(join(skillRoot, "install", "WORKOS"))
      ? join(skillRoot, "install", "WORKOS")
      : join(skillRoot, "install", "WorkOS"),
    installRoot: join(skillRoot, "install"),
    home,
    // systemd runs the unit with a minimal PATH, so ExecStart must name an
    // absolute bun path. Prefer the interpreter running this installer; fall back to
    // the standard bun install location.
    bun: /\/bun$/.test(process.execPath) ? process.execPath : join(home, ".bun", "bin", "bun"),
    apply,
    replaceStatusline: a.includes("--replace-statusline"),
    ledger: (() => { let l: Ledger | null = null; return () => (l ??= new Ledger(configRoot, "DeployComponents")); })(),
  };

  const results = selected.map((c) => deploy(c, ctx));
  // A blocked component (prereq absent, nothing written) is a FAILURE, not a
  // silent success — `ok` factors in blockers, error, AND probe in both modes.
  const ok = results.every((r) => r.blockers.length === 0 && !r.error && (!r.probe || r.probe.passed));

  console.log(JSON.stringify({
    ok,
    dryRun: !apply,
    configRoot,
    workosDir: ctx.workosDir,
    payloadRoot: ctx.payloadRoot,
    selected,
    results,
    note: apply ? undefined : "dry-run — re-run with --apply --components <csv> after the user opts in",
  }, null, 2));
  process.exit(ok ? 0 : 1);
}

main();
