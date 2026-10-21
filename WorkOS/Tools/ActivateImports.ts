#!/usr/bin/env bun
/**
 * ActivateImports — Setup step 8. Uncomments the identity `@`-imports in the
 * harness CLAUDE.md, each guarded by existsSync of its resolved target. The
 * template ships imports commented (`<!-- @WORKOS/USER/... -->`) so they don't
 * error before USER is scaffolded; this activates only the ones whose target
 * now resolves. Refuses on a dev tree unless --allow-dev.
 *
 * The system-prompt import (`@WORKOS/WORKOS_SYSTEM_PROMPT.md`) is never
 * activated by the default pass. `--with-system-prompt` is the explicit opt-in
 * for a sandbox install (the sbx TUI starts plain `claude`, so the launcher's
 * --append-system-prompt-file never runs); `--without-system-prompt` comments it
 * back out. Both are idempotent and, like everything here, dry-run without --apply.
 *
 * Usage:
 *   bun ActivateImports.ts [--config-root <dir>] [--apply] [--allow-dev]
 *                          [--with-system-prompt | --without-system-prompt]
 */

import { existsSync, readFileSync } from "node:fs";
import { join } from "node:path";
import { homedir } from "node:os";
import { activateImports, detectDevTree, setSystemPromptImport, SYSTEM_PROMPT_IMPORT } from "./InstallEngine";

function main(): void {
  const a = process.argv.slice(2);
  const get = (f: string): string | undefined => {
    const i = a.indexOf(f);
    return i >= 0 && a[i + 1] && !a[i + 1].startsWith("--") ? a[i + 1] : undefined;
  };
  const home = process.env.HOME || homedir(); // public issue #1729, @umair-a11y
  const configRoot = get("--config-root") || process.env.CLAUDE_CONFIG_DIR || join(home, ".claude");
  const apply = a.includes("--apply");
  const allowDev = a.includes("--allow-dev");
  const withSp = a.includes("--with-system-prompt");
  const withoutSp = a.includes("--without-system-prompt");
  if (withSp && withoutSp) {
    console.log(JSON.stringify({ ok: false, error: "--with-system-prompt and --without-system-prompt are mutually exclusive" }, null, 2));
    process.exit(2);
  }
  // Present only when a system-prompt flag was passed: { action, changed, active }.
  const systemPrompt = (apply: boolean) =>
    withSp || withoutSp ? { systemPrompt: setSystemPromptImport(join(configRoot, "CLAUDE.md"), withSp, apply) } : {};

  if (detectDevTree(configRoot) && !allowDev) {
    console.log(JSON.stringify({ ok: false, refused: "dev-tree", detail: `${configRoot} is a source tree — refusing to edit CLAUDE.md.` }, null, 2));
    process.exit(2);
  }

  const claudeMd = join(configRoot, "CLAUDE.md");

  if (!apply) {
    // Dry-run: report which commented imports WOULD activate without writing.
    // activateImports only writes when activated.length>0, but to stay non-mutating
    // in dry-run we read + classify against a copy by pointing at a temp scan.
    if (!existsSync(claudeMd)) {
      console.log(JSON.stringify({ ok: false, error: `CLAUDE.md not found at ${claudeMd}` }, null, 2));
      process.exit(1);
    }
    const lines = readFileSync(claudeMd, "utf-8").split("\n");
    const commented = /^\s*#\s+(@[\w./-]+)\s*$|^\s*<!--\s*(@[\w./-]+)\s*-->\s*$/;
    const wouldActivate: string[] = [];
    const wouldSkip: string[] = [];
    for (const line of lines) {
      const m = line.match(commented);
      if (!m) continue;
      const imp = m[1] || m[2];
      if (imp === SYSTEM_PROMPT_IMPORT) continue; // opt-in only (--with-system-prompt)
      const rel = imp.replace(/^@/, "");
      (existsSync(join(configRoot, rel)) ? wouldActivate : wouldSkip).push(imp);
    }
    console.log(JSON.stringify({ ok: true, dryRun: true, wouldActivate, wouldSkip, ...systemPrompt(false) }, null, 2));
    process.exit(0);
  }

  // public issue #1728, @rpriven — the --apply path reported ok:true even when
  // CLAUDE.md was absent: activateImports() returns empty rather than throwing,
  // so a missing file looked like a clean no-op. Mirror the dry-run guard.
  if (!existsSync(claudeMd)) {
    console.log(JSON.stringify({ ok: false, error: `CLAUDE.md not found at ${claudeMd}` }, null, 2));
    process.exit(1);
  }

  // `ok` means "ran without error", NOT "work happened" — a re-run over a
  // fully-activated CLAUDE.md is a success with nothing to do. `activated` and
  // `written` are the work signals; the note keeps a re-running agent from
  // reading an empty activation as failure.
  const { activated, skipped } = activateImports(claudeMd, configRoot);
  const sp = systemPrompt(true);
  const written = activated.length > 0 || !!sp.systemPrompt?.changed;
  const out: Record<string, unknown> = { ok: true, written, activated, skipped, ...sp };
  if (!written) {
    // Two different no-op causes: nothing left to do (success), or dormant
    // imports whose targets don't resolve yet (success too, but not "done").
    out.note = skipped.length > 0
      ? `all imports already active; ${skipped.length} still dormant — target not found under ${configRoot}`
      : "all imports already active";
  }
  console.log(JSON.stringify(out, null, 2));
  process.exit(0);
}

main();
