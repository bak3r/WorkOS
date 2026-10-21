#!/usr/bin/env bun
/**
 * ActivateImports — Setup step 8. Turns on the WorkOS `@`-imports in the harness CLAUDE.md,
 * each guarded by existsSync of its resolved target (dormant `# @WORKOS/USER/...` lines are
 * activated only when the target resolves). Refuses on a dev tree unless --allow-dev.
 *
 * Two shapes of CLAUDE.md:
 *   - WorkOS's own (DeployCore placed the template because none existed): edited in place,
 *     exactly as before.
 *   - Someone else's (the developer's, or one LifeOS left): NEVER replaced. A marked block
 *       <!-- WORKOS:BEGIN --> …template: imports + routing table… <!-- WORKOS:END -->
 *     is inserted at the top, the developer's text kept byte-for-byte below it. Re-runs
 *     rebuild the block in place from the template (idempotent). `--fix-lifeos-paths` also
 *     rewrites `~/.claude/LIFEOS/…` / `LIFEOS/…` references in the developer's text to the
 *     WORKOS path — only where that WORKOS path exists; the rest are listed, not touched.
 * Dry-run prints the unified diff (stderr) and writes nothing; --apply backs CLAUDE.md up
 * through the ledger first.
 *
 * The system-prompt import (`@WORKOS/WORKOS_SYSTEM_PROMPT.md`) is never activated by the
 * default pass. `--with-system-prompt` is the explicit opt-in for a sandbox install (the
 * sbx TUI starts plain `claude`, so the launcher's --append-system-prompt-file never runs);
 * `--without-system-prompt` turns it back off and restores byte-identical text.
 *
 * Usage:
 *   bun ActivateImports.ts [--config-root <dir>] [--skill-root <dir>] [--apply] [--allow-dev]
 *                          [--with-system-prompt | --without-system-prompt] [--fix-lifeos-paths]
 */

import { existsSync, readFileSync } from "node:fs";
import { join } from "node:path";
import { homedir } from "node:os";
import { activateImports, detectDevTree, setSystemPromptImport, SYSTEM_PROMPT_IMPORT } from "./InstallEngine";
import { atomicWriteText } from "./lib/atomic-write";
import { blockState, buildBlock, findBlock, fixLifeosPaths, unifiedDiff, upsertBlock } from "./lib/claude-md";
import { Ledger, addedPaths } from "./lib/ledger";

/** WorkOS placed this CLAUDE.md itself (manifest add, or a pre-ledger whole-template file). */
function isWorkosOwned(configRoot: string, text: string): boolean {
  if (addedPaths(configRoot).includes("CLAUDE.md")) return true;
  if (findBlock(text)) return false;
  return text.startsWith("# WorkOS") && text.split("\n").some((l) => l.trim() === "@WORKOS/DOCUMENTATION/ARCHITECTURE_SUMMARY.md");
}

function main(): void {
  const a = process.argv.slice(2);
  const get = (f: string): string | undefined => {
    const i = a.indexOf(f);
    return i >= 0 && a[i + 1] && !a[i + 1].startsWith("--") ? a[i + 1] : undefined;
  };
  const home = process.env.HOME || homedir(); // public issue #1729, @umair-a11y
  const configRoot = get("--config-root") || process.env.CLAUDE_CONFIG_DIR || join(home, ".claude");
  const skillRoot = get("--skill-root") || join(import.meta.dir, "..");
  const apply = a.includes("--apply");
  const allowDev = a.includes("--allow-dev");
  const withSp = a.includes("--with-system-prompt");
  const withoutSp = a.includes("--without-system-prompt");
  const fixPaths = a.includes("--fix-lifeos-paths");
  if (withSp && withoutSp) {
    console.log(JSON.stringify({ ok: false, error: "--with-system-prompt and --without-system-prompt are mutually exclusive" }, null, 2));
    process.exit(2);
  }

  if (detectDevTree(configRoot) && !allowDev) {
    console.log(JSON.stringify({ ok: false, refused: "dev-tree", detail: `${configRoot} is a source tree — refusing to edit CLAUDE.md.` }, null, 2));
    process.exit(2);
  }

  const claudeMd = join(configRoot, "CLAUDE.md");
  // public issue #1728, @rpriven — a missing CLAUDE.md is an error in both modes, never a
  // clean-looking no-op.
  if (!existsSync(claudeMd)) {
    console.log(JSON.stringify({ ok: false, error: `CLAUDE.md not found at ${claudeMd}` }, null, 2));
    process.exit(1);
  }
  const before = readFileSync(claudeMd, "utf-8");

  if (isWorkosOwned(configRoot, before)) {
    // WorkOS's own file: line-level activation in place (the original behaviour).
    const systemPrompt = (doApply: boolean) =>
      withSp || withoutSp ? { systemPrompt: setSystemPromptImport(claudeMd, withSp, doApply) } : {};
    if (!apply) {
      const commented = /^\s*#\s+(@[\w./-]+)\s*$|^\s*<!--\s*(@[\w./-]+)\s*-->\s*$/;
      const wouldActivate: string[] = [];
      const wouldSkip: string[] = [];
      for (const line of before.split("\n")) {
        const m = line.match(commented);
        if (!m) continue;
        const imp = m[1] || m[2];
        if (imp === SYSTEM_PROMPT_IMPORT) continue; // opt-in only (--with-system-prompt)
        (existsSync(join(configRoot, imp.replace(/^@/, ""))) ? wouldActivate : wouldSkip).push(imp);
      }
      console.log(JSON.stringify({ ok: true, dryRun: true, mode: "workos-file", wouldActivate, wouldSkip, ...systemPrompt(false) }, null, 2));
      process.exit(0);
    }
    new Ledger(configRoot, "ActivateImports").beforeWrite(claudeMd, "claude-md-block", "activate imports in WorkOS's CLAUDE.md");
    // `ok` means "ran without error", NOT "work happened" — a re-run over a fully-activated
    // CLAUDE.md is a success with nothing to do.
    const { activated, skipped } = activateImports(claudeMd, configRoot);
    const sp = systemPrompt(true);
    const written = activated.length > 0 || !!sp.systemPrompt?.changed;
    const out: Record<string, unknown> = { ok: true, mode: "workos-file", written, activated, skipped, ...sp };
    if (!written) {
      out.note = skipped.length > 0
        ? `all imports already active; ${skipped.length} still dormant — target not found under ${configRoot}`
        : "all imports already active";
    }
    console.log(JSON.stringify(out, null, 2));
    process.exit(0);
  }

  // Someone else's CLAUDE.md: the marked block.
  const templatePath = join(skillRoot, "install", "CLAUDE.template.md");
  if (!existsSync(templatePath)) {
    console.log(JSON.stringify({ ok: false, error: `CLAUDE.template.md not found at ${templatePath}` }, null, 2));
    process.exit(1);
  }
  const loc = findBlock(before);
  const state = loc ? blockState(loc.inner) : { active: new Set<string>(), systemPrompt: false };
  if (withSp) state.systemPrompt = true;
  if (withoutSp) state.systemPrompt = false;
  const { block, activated, skipped } = buildBlock(readFileSync(templatePath, "utf-8"), state,
    (imp) => existsSync(join(configRoot, imp.replace(/^@/, ""))));
  const up = upsertBlock(before, block);
  const workosHas = (rel: string) => existsSync(join(configRoot, "WORKOS", rel)) || existsSync(join(skillRoot, "install", "WORKOS", rel));
  const fix = fixPaths ? fixLifeosPaths(up.text, workosHas) : null;
  const after = fix ? fix.text : up.text;
  const report = {
    mode: "block",
    block: up.action,
    activated,
    skipped,
    systemPromptActive: state.systemPrompt,
    ...(fix ? { pathsFixed: fix.fixed, pathsLeft: fix.unresolved } : {}),
  };

  if (!apply) {
    const diff = unifiedDiff(before, after, "CLAUDE.md (now)", "CLAUDE.md (after --apply)");
    if (diff) process.stderr.write(diff);
    console.log(JSON.stringify({ ok: true, dryRun: true, ...report, changes: after !== before,
      note: after !== before ? "unified diff printed on stderr — show it, then re-run with --apply" : "no change" }, null, 2));
    process.exit(0);
  }
  if (after !== before) {
    new Ledger(configRoot, "ActivateImports").beforeWrite(claudeMd, "claude-md-block",
      `${up.action} WorkOS block${fix?.fixed.length ? `, ${fix.fixed.length} LIFEOS path(s) → WORKOS` : ""}`);
    atomicWriteText(claudeMd, after);
  }
  console.log(JSON.stringify({ ok: true, written: after !== before, ...report }, null, 2));
  process.exit(0);
}

main();
