#!/usr/bin/env bun
/**
 * InstallHooks — Setup step 7 (trust-gated). Additively merges the payload's
 * `install/hooks/hooks.json` into the harness `settings.json`: per matcher
 * bucket, idempotent by normalized command (and url for http entries), never
 * touching foreign entries. Backs up settings.json (through the ledger) before
 * writing. REFUSES on a dev tree (the author's live source) unless --allow-dev.
 *
 * Same-named hook files: WorkOS never registers its commands onto a file that is not
 * its own. If `<configRoot>/hooks/<name>` exists and is not WorkOS's (a LifeOS copy
 * Adopt has not moved, an edited LifeOS hook, or the developer's own file), the tool
 * STOPS before writing anything and names the files — run Adopt.ts first, or rename
 * them. (Before this, 92 of 95 WorkOS registrations deduped onto LifeOS's files.)
 *
 * The skill's Setup workflow shows the user the exact change (from the dry-run
 * counts) and gets explicit permission BEFORE calling this with --apply.
 *
 * Usage:
 *   bun InstallHooks.ts [--config-root <dir>] [--skill-root <dir>] [--apply] [--allow-dev]
 *   (dry-run by default — reports added/skipped without writing)
 */

import { cpSync, existsSync, mkdirSync, readdirSync, readFileSync, statSync } from "node:fs";
import { execFileSync } from "node:child_process";
import { dirname, join, relative } from "node:path";
import { homedir } from "node:os";
import { detectDevTree, isTestFile, mergeHooks } from "./InstallEngine";
import { atomicWriteText } from "./lib/atomic-write";
import { Classifier } from "./lib/inventory";
import { Ledger } from "./lib/ledger";

/** Payload hook files (root-relative `hooks/...`), tests excluded. */
function payloadHookFiles(dir: string, base = dir, out: string[] = []): string[] {
  if (!existsSync(dir)) return out;
  for (const entry of readdirSync(dir).sort()) {
    const p = join(dir, entry);
    if (statSync(p).isDirectory()) payloadHookFiles(p, base, out);
    else if (!isTestFile(entry)) out.push(join("hooks", relative(base, p)));
  }
  return out;
}

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

function countFilesRec(dir: string): number {
  if (!existsSync(dir)) return 0;
  let n = 0;
  for (const entry of readdirSync(dir)) {
    const p = join(dir, entry);
    if (statSync(p).isDirectory()) n += countFilesRec(p);
    else if (!isTestFile(entry)) n += 1;
  }
  return n;
}

function main(): void {
  const { configRoot, skillRoot, apply, allowDev } = parseArgs();

  if (detectDevTree(configRoot) && !allowDev) {
    console.log(JSON.stringify({ ok: false, refused: "dev-tree", detail: `${configRoot} is a WorkOS source tree (dev-tree marker present) — refusing to mutate. Use --allow-dev only in a sandbox.` }, null, 2));
    process.exit(2);
  }

  const hooksJsonPath = join(skillRoot, "install", "hooks", "hooks.json");
  if (!existsSync(hooksJsonPath)) {
    console.log(JSON.stringify({ ok: false, error: `payload hooks.json not found at ${hooksJsonPath}` }, null, 2));
    process.exit(1);
  }
  const incoming = JSON.parse(readFileSync(hooksJsonPath, "utf-8"))?.hooks ?? {};

  // The hook SCRIPTS (*.hook.ts|sh + lib/**) live beside hooks.json in the payload.
  // Merging hooks.json into settings.json wires commands that point at these files,
  // so they MUST be copied onto disk too — else every hook resolves to a nonexistent
  // file (audit 20260702, RC2). Kept atomic with the settings merge (same opt-in +
  // trust-gate): decline hooks → neither scripts nor settings entries land.
  const hooksPayloadDir = join(skillRoot, "install", "hooks");
  const hooksDestDir = join(configRoot, "hooks");
  const hookFiles = countFilesRec(hooksPayloadDir);

  const settingsPath = join(configRoot, "settings.json");
  let settings: Record<string, unknown> = {};
  if (existsSync(settingsPath)) {
    try {
      settings = JSON.parse(readFileSync(settingsPath, "utf-8"));
    } catch (e) {
      // ABORT on an unparseable EXISTING settings.json — never reset to {}.
      // The prior `catch { settings = {} }` silently dropped model / permissions /
      // env / statusLine and wrote a file containing ONLY "hooks", destroying the
      // user's Claude Code config on the most common hand-edit error (a trailing
      // comma). Fresh-install data loss. (Forge cross-vendor audit 2026-08-11)
      console.log(JSON.stringify({
        ok: false, apply, settingsPath,
        error: `settings.json exists but is not valid JSON: ${e instanceof Error ? e.message : String(e)}. Refusing to write — fix the file (a trailing comma or a comment is the usual cause) and re-run. Your settings were NOT modified.`,
      }, null, 2));
      process.exit(1);
    }
  }
  const existingHooks = (settings.hooks && typeof settings.hooks === "object" ? settings.hooks : {}) as Record<string, never>;

  const { merged, added, skipped } = mergeHooks(existingHooks as never, incoming);

  // A same-named hook file that is not WorkOS's blocks the whole step (nothing written).
  const classifier = new Classifier(configRoot, skillRoot);
  const foreign = payloadHookFiles(hooksPayloadDir)
    .filter((rel) => existsSync(join(configRoot, rel)))
    .map((rel) => ({ path: rel, cls: classifier.file(rel).cls }))
    .filter((f) => f.cls !== "workos");
  if (foreign.length > 0) {
    console.log(JSON.stringify({
      ok: false, apply, settingsPath, blocked: "foreign-hook-files", foreign,
      error: `${foreign.length} file(s) under hooks/ share a name with a WorkOS hook but are not WorkOS's — refusing to register WorkOS commands onto them. ` +
        "LifeOS copies: run `bun Tools/Adopt.ts --apply` first. Edited or your own: rename or move them, then re-run. Nothing was written.",
    }, null, 2));
    process.exit(1);
  }

  const report = { ok: true, apply, settingsPath, added, skipped, events: Object.keys(merged).length, hooksDestDir, hookFiles };

  if (!apply) {
    console.log(JSON.stringify({ ...report, dryRun: true, note: "no changes written; re-run with --apply after permission" }, null, 2));
    process.exit(0);
  }

  const ledger = new Ledger(configRoot, "InstallHooks");
  // Deploy the hook scripts FIRST, THEN wire settings — the install is not
  // transactional across the two mutations, so ordering is the guard: a copy
  // failure must never leave settings.json pointing at hooks that aren't on
  // disk. The settings write below is the last mutation and is itself atomic
  // (temp+rename), so a kill leaves settings either fully-old or fully-new,
  // never wired-to-absent. (Forge cross-vendor audit 2026-08-11, [D])
  //
  // Copy the payload hooks/ tree (*.hook.ts|sh + lib/**) into <configRoot>/hooks/.
  // ADDITIVE, never clobbering (public issue #1491, @donovan-sec): an existing file is
  // only ever WorkOS's own here (foreign ones stopped the run above), so it is skipped.
  // Every new file is recorded in the ledger before it is written. Test files stay in
  // the payload — never deployed into the live hooks tree.
  let hookFilesCopied = 0;
  let skippedExisting = 0;
  for (const rel of payloadHookFiles(hooksPayloadDir)) {
    const dst = join(configRoot, rel);
    if (existsSync(dst)) { skippedExisting++; continue; }
    ledger.recordAdd(dst);
    mkdirSync(dirname(dst), { recursive: true });
    cpSync(join(skillRoot, "install", rel), dst, { preserveTimestamps: true });
    hookFilesCopied++;
  }

  ledger.beforeWrite(settingsPath, "settings-key", `hooks: +${added} WorkOS registration(s)`);
  settings.hooks = merged;
  // Atomic — a kill mid-write would leave the user with no settings.json at all
  // (public PR #1643, @elhoim)
  atomicWriteText(settingsPath, JSON.stringify(settings, null, 2) + "\n");

  // Copying hook scripts and merging the manifest are two independent operations;
  // a hook can land on disk without any settings entry naming it. Ask the shipped
  // reconciler whether every copied hook is actually reachable, so an unwired hook
  // is loud at install time rather than silent until someone runs Doctor by hand.
  // (public PR #1540 + issue #1539, @tzioup)
  const doctorPath = join(configRoot, "WORKOS", "TOOLS", "Doctor.ts");
  let unwired: string[] | undefined;
  let reconcile: string | undefined;
  if (existsSync(doctorPath)) {
    try {
      const out = execFileSync("bun", [doctorPath, "--reconcile"], {
        encoding: "utf-8",
        env: { ...process.env, CLAUDE_CONFIG_DIR: configRoot },
      });
      unwired = JSON.parse(out).unwired ?? [];
    } catch (err) {
      reconcile = `reconciler failed: ${err instanceof Error ? err.message : String(err)}`;
    }
  } else {
    reconcile = `Doctor.ts not found at ${doctorPath} — hooks copied but not reconciled`;
  }

  console.log(JSON.stringify({ ...report, written: true, backup: ledger.backupRoot, hookFilesCopied, skippedExisting, unwired, reconcile }, null, 2));
  process.exit(0);
}

main();
