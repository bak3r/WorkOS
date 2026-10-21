/**
 * Installer safety tests: Inventory classification, the settings merge, the CLAUDE.md block
 * (insert / update / remove byte-identical, system prompt on→off byte-identical) and the
 * ledger + Rollback replay. Every test builds its own temp root; nothing outside it is read
 * except this skill's own lib code.
 */

import { afterAll, describe, expect, test } from "bun:test";
import { createHash } from "node:crypto";
import { existsSync, mkdirSync, mkdtempSync, readFileSync, readdirSync, rmSync, statSync, symlinkSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { dirname, join, relative } from "node:path";
import { templateLine } from "./data/GenerateManifest";
import { inventory, matchTemplate, loadLifeosManifests } from "./lib/inventory";
import { planSettingsMerge } from "./lib/settings-merge";
import { BLOCK_BEGIN, BLOCK_END, blockState, buildBlock, fixLifeosPaths, removeBlock, unifiedDiff, upsertBlock } from "./lib/claude-md";
import { Ledger, readManifest, startRun } from "./lib/ledger";
import { executeRollback, planRollback } from "./Rollback";
import { applySettingsPlan, planSettings } from "./Adopt";

const tmp: string[] = [];
const mk = (tag: string) => { const d = mkdtempSync(join(tmpdir(), `workos-${tag}-`)); tmp.push(d); return d; };
afterAll(() => { for (const d of tmp) rmSync(d, { recursive: true, force: true }); });
const put = (root: string, rel: string, text: string) => { mkdirSync(dirname(join(root, rel)), { recursive: true }); writeFileSync(join(root, rel), text); };
const sha = (s: string) => createHash("sha256").update(s).digest("hex");

/** Snapshot: relative path → sha (files) or "L:<target>" (symlinks). */
function snap(root: string): Record<string, string> {
  const out: Record<string, string> = {};
  const walk = (d: string) => {
    for (const e of readdirSync(d, { withFileTypes: true })) {
      const p = join(d, e.name);
      if (e.isSymbolicLink()) out[relative(root, p)] = "L";
      else if (e.isDirectory()) walk(p);
      else out[relative(root, p)] = sha(readFileSync(p, "utf8"));
    }
  };
  walk(root);
  return out;
}

// ── a fake LifeOS release + a fake WorkOS skill ───────────────────────
const LIFEOS = {
  "install/hooks/Shared.hook.ts": "// lifeos shared hook\n",
  "install/hooks/OnlyLifeos.hook.ts": "// only in lifeos\n",
  "install/hooks/Named.hook.ts": "say('{{PRINCIPAL_NAME}} meets {{DA_NAME}}'); // {{PRINCIPAL_NAME}}\n",
  "install/skills/Bar/SKILL.md": "---\nname: Bar\n---\n",
  "install/skills/Bar/Workflows/Go.md": "go\n",
  "install/skills/Trim/SKILL.md": "---\nname: Trim\n---\n",
  "install/skills/Trim/Extra.md": "extra\n",
  "install/agents/Max.md": "---\nname: Max\nmodel: fable\n---\n",
  "install/LIFEOS/TOOLS/MergeSettings.ts": "// merge\n",
};
const manifestDir = mk("manifest");
writeFileSync(join(manifestDir, "lifeos-9.9.9.sha256"), [
  "# version 9.9.9",
  ...Object.entries(LIFEOS).map(([p, t]) => `${sha(t)}  ${p}`),
  ...Object.entries(LIFEOS).map(([p, t]) => templateLine(p, Buffer.from(t))).filter(Boolean),
].join("\n") + "\n");
process.env.WORKOS_LIFEOS_MANIFESTS = manifestDir;

const skillRoot = mk("skill");
put(skillRoot, "install/hooks/Shared.hook.ts", "// workos shared hook\n");
put(skillRoot, "install/skills/Bar/SKILL.md", "---\nname: Bar (WorkOS)\n---\n");
put(skillRoot, "install/skills/Mine/SKILL.md", "---\nname: Mine (WorkOS)\n---\n");
put(skillRoot, "install/agents/Max.md", "---\nname: Max\nmodel: fable\n---\nworkos\n");
put(skillRoot, "install/settings.system.json", JSON.stringify({
  env: { WORKOS_DIR: "$HOME/.claude/WORKOS", API_TIMEOUT_MS: "1" },
  permissions: { allow: ["Bash(ls)", "Bash(git status)"], deny: ["Bash(rm -rf /)"], defaultMode: "default" },
  skipDangerousModePermissionPrompt: true, theme: "dark", model: "opus", autoMode: { allow: ["x"], environment: ["y"] }, tui: "full",
}));
put(skillRoot, "install/CLAUDE.template.md", "# WorkOS\n\n@WORKOS/DOCUMENTATION/ARCHITECTURE_SUMMARY.md\n# @WORKOS/WORKOS_SYSTEM_PROMPT.md\n# @WORKOS/USER/PROJECTS.md\n\nrouting table\n");

describe("Inventory classification", () => {
  const root = mk("root");
  put(root, "hooks/Shared.hook.ts", LIFEOS["install/hooks/Shared.hook.ts"]);
  put(root, "hooks/OnlyLifeos.hook.ts", LIFEOS["install/hooks/OnlyLifeos.hook.ts"]);
  put(root, "hooks/Named.hook.ts", "say('Dana meets Nova'); // Dana\n"); // LifeOS-substituted copy
  put(root, "hooks/my-guard.sh", "#!/bin/sh\nexit 0\n");
  put(root, "skills/Bar/SKILL.md", LIFEOS["install/skills/Bar/SKILL.md"]);
  put(root, "skills/Bar/Workflows/Go.md", "go — edited\n");
  put(root, "skills/Trim/SKILL.md", LIFEOS["install/skills/Trim/SKILL.md"]); // Extra.md removed → trimmed
  put(root, "skills/Mine/SKILL.md", "---\nname: Mine (developer)\n---\n");
  put(root, "agents/Max.md", "---\nname: Max\nmodel: opus\n---\n");
  put(root, "LIFEOS/TOOLS/MergeSettings.ts", LIFEOS["install/LIFEOS/TOOLS/MergeSettings.ts"]);
  put(root, "LIFEOS/MEMORY/WORK/a/ISA.md", "isa\n");
  put(root, "projects/x/s.jsonl", "{}\n");
  put(root, ".claude.json", "{}");
  put(root, "settings.json", JSON.stringify({
    model: "opus",
    hooks: {
      PreToolUse: [{ matcher: "Bash", hooks: [{ type: "command", command: "$HOME/.claude/hooks/Shared.hook.ts" }, { type: "command", command: "$HOME/.claude/hooks/my-guard.sh" }] }],
      SessionStart: [{ hooks: [{ type: "command", command: "bun $HOME/.claude/LIFEOS/TOOLS/MergeSettings.ts --output $HOME/.claude/settings.json" }] }],
    },
    env: { LIFEOS_DIR: join(root, "LIFEOS"), LIFEOS_CONFIG_DIR: "/somewhere/custom" },
  }));
  const inv = inventory(root, skillRoot, { home: "/nonexistent-home" });
  const u = (p: string) => inv.units.find((x) => x.path === p);

  test("untouched copies, substituted copies and LifeOS-only files are lifeos-copy", () => {
    expect(u("hooks/Shared.hook.ts")?.cls).toBe("lifeos-copy");
    expect(u("hooks/OnlyLifeos.hook.ts")?.cls).toBe("lifeos-copy");
    expect(u("hooks/Named.hook.ts")?.cls).toBe("lifeos-copy");
  });
  test("a mixed skill dir is edited as a whole; a WorkOS-shipped name makes it a collision", () => {
    expect(u("skills/Bar")?.cls).toBe("collision");
    expect(u("skills/Bar")?.base).toBe("lifeos-edited");
  });
  test("a trimmed copy (release files removed) counts as edited", () => {
    expect(u("skills/Trim")?.cls).toBe("lifeos-edited");
  });
  test("a developer dir at a WorkOS path is a collision with base user; edited single file stays lifeos-edited", () => {
    expect(u("skills/Mine")?.cls).toBe("collision");
    expect(u("skills/Mine")?.base).toBe("user");
    expect(u("agents/Max.md")?.base).toBe("lifeos-edited");
    expect(u("hooks/my-guard.sh")?.cls).toBe("user");
  });
  test("data, claude-owned and presence", () => {
    expect(u("LIFEOS/MEMORY")?.cls).toBe("lifeos-data");
    expect(u("projects")?.cls).toBe("claude-owned");
    expect(u(".claude.json")?.cls).toBe("claude-owned");
    expect(inv.lifeos.present).toBe(true);
  });
  test("settings summary: LifeOS registrations (a settings.json --output ref does not make it yours), env defaults", () => {
    const owners = inv.settings.registrations.map((r) => r.owner).sort();
    expect(owners).toEqual(["lifeos", "lifeos", "user"]);
    expect(inv.settings.lifeosEnv).toEqual([{ key: "LIFEOS_DIR", isDefault: true }, { key: "LIFEOS_CONFIG_DIR", isDefault: false }]);
    const plan = planSettings(inv);
    const next = applySettingsPlan(JSON.parse(readFileSync(join(root, "settings.json"), "utf8")), plan);
    expect(next.hooks.PreToolUse[0].hooks).toEqual([{ type: "command", command: "$HOME/.claude/hooks/my-guard.sh" }]);
    expect(next.hooks.SessionStart).toBeUndefined();
    expect(next.env).toEqual({ LIFEOS_CONFIG_DIR: "/somewhere/custom" });
    expect(next.model).toBe("opus");
  });
  test("template matching needs consistent values", () => {
    const m = loadLifeosManifests(manifestDir);
    const tpl = m.templates.get("install/hooks/Named.hook.ts")![0];
    expect(matchTemplate(Buffer.from("say('A meets B'); // A\n"), tpl)).toBe(true);
    expect(matchTemplate(Buffer.from("say('A meets B'); // C\n"), tpl)).toBe(false);
    expect(matchTemplate(Buffer.from("say('A meets B'); // A\nextra\n"), tpl)).toBe(false);
  });
});

describe("settings merge", () => {
  const tpl = JSON.parse(readFileSync(join(skillRoot, "install/settings.system.json"), "utf8"));
  test("unions permissions, adds only missing env, never touches model/theme, lists security keys", () => {
    const cur = { model: "sonnet", env: { API_TIMEOUT_MS: "9" }, permissions: { allow: ["Bash(git status)", "Bash(make:*)"], deny: [] as string[] }, autoMode: { allow: ["mine"] } };
    const p = planSettingsMerge(cur, tpl);
    expect(p.merged.model).toBe("sonnet");
    expect(p.merged.theme).toBeUndefined();
    expect(p.untouched.sort()).toEqual(["model", "theme"]);
    expect((p.merged.env as any).API_TIMEOUT_MS).toBe("9");
    expect(p.addedEnv).toEqual(["WORKOS_DIR"]);
    expect((p.merged.permissions as any).allow).toEqual(["Bash(git status)", "Bash(make:*)", "Bash(ls)"]);
    expect((p.merged.permissions as any).deny).toEqual(["Bash(rm -rf /)"]);
    expect((p.merged.autoMode as any).allow).toEqual(["mine"]);
    expect(p.security.sort()).toEqual(["autoMode.environment", "permissions.defaultMode", "skipDangerousModePermissionPrompt"]);
    expect(cur.permissions.allow).toEqual(["Bash(git status)", "Bash(make:*)"]); // input not mutated
  });
  test("an existing security key is never changed", () => {
    const p = planSettingsMerge({ skipDangerousModePermissionPrompt: false }, tpl);
    expect(p.merged.skipDangerousModePermissionPrompt).toBe(false);
    expect(p.security).not.toContain("skipDangerousModePermissionPrompt");
  });
});

describe("CLAUDE.md block", () => {
  const template = readFileSync(join(skillRoot, "install/CLAUDE.template.md"), "utf8");
  const dev = "# My rules\n\n- read `~/.claude/LIFEOS/ALGORITHM/LATEST` then `~/.claude/LIFEOS/ALGORITHM/v<V>.md`\n- see LIFEOS/NOPE/x.md\n";
  const none = { active: new Set<string>(), systemPrompt: false };
  test("insert keeps the developer text; remove restores it byte-identical", () => {
    const { block } = buildBlock(template, none, () => false);
    const up = upsertBlock(dev, block);
    expect(up.action).toBe("inserted");
    expect(up.text.startsWith(BLOCK_BEGIN + "\n")).toBe(true);
    expect(up.text.endsWith(dev)).toBe(true);
    expect(removeBlock(up.text)).toBe(dev);
  });
  test("update in place is idempotent and keeps activation state", () => {
    const first = upsertBlock(dev, buildBlock(template, none, (i) => i === "@WORKOS/USER/PROJECTS.md").block).text;
    const state = blockState(first.slice(0, first.indexOf(BLOCK_END)));
    expect(state.active.has("@WORKOS/USER/PROJECTS.md")).toBe(true);
    const again = upsertBlock(first, buildBlock(template, state, () => false).block);
    expect(again.action).toBe("unchanged");
    expect(again.text).toBe(first);
  });
  test("system prompt on then off is byte-identical", () => {
    const base = upsertBlock(dev, buildBlock(template, none, () => false).block).text;
    const on = upsertBlock(base, buildBlock(template, { active: new Set(), systemPrompt: true }, () => false).block).text;
    expect(on).toContain("\n@WORKOS/WORKOS_SYSTEM_PROMPT.md\n");
    const off = upsertBlock(on, buildBlock(template, { active: new Set(), systemPrompt: false }, () => false).block).text;
    expect(off).toBe(base);
  });
  test("path fix rewrites only what exists in WORKOS, outside the block, and diffs", () => {
    const base = upsertBlock(dev, buildBlock(template, none, () => false).block).text;
    const fx = fixLifeosPaths(base, (rel) => ["ALGORITHM", "ALGORITHM/LATEST"].includes(rel));
    expect(fx.fixed.map((f) => f.to)).toEqual(["~/.claude/WORKOS/ALGORITHM/LATEST", "~/.claude/WORKOS/ALGORITHM/v"]);
    expect(fx.unresolved.map((f) => f.from)).toEqual(["LIFEOS/NOPE/x.md"]);
    expect(fx.text).toContain("`~/.claude/WORKOS/ALGORITHM/v<V>.md`");
    expect(fx.text.slice(0, fx.text.indexOf(BLOCK_END))).toBe(base.slice(0, base.indexOf(BLOCK_END)));
    expect(unifiedDiff(base, fx.text)).toContain("+- read `~/.claude/WORKOS/ALGORITHM/LATEST`");
  });
});

describe("ledger + Rollback replay", () => {
  test("add / modify / move-to-backup / outside-root add replay to a byte-identical root", () => {
    const root = mk("rb");
    const outside = mk("rb-out");
    put(root, "settings.json", '{"model":"opus"}\n');
    put(root, "hooks/Old.hook.ts", "// lifeos\n");
    put(root, "LIFEOS/MEMORY/WORK/a/ISA.md", "isa\n");
    symlinkSync(outside, join(root, "LIFEOS", "USER"));
    put(root, "skills/Mine/SKILL.md", "mine\n");
    const before = snap(root);
    const run = startRun(root);
    const l = new Ledger(root, "test");
    expect(l.run).toBe(run);
    l.moveToBackup("hooks/Old.hook.ts");
    l.recordAdd(join(root, "hooks/New.hook.ts")); put(root, "hooks/New.hook.ts", "// workos\n");
    l.beforeWrite(join(root, "settings.json"), "settings-key"); writeFileSync(join(root, "settings.json"), '{"model":"opus","env":{}}\n');
    l.beforeWrite(join(root, "settings.json"), "settings-key"); writeFileSync(join(root, "settings.json"), "{}\n"); // second write: same backup
    l.recordAdd(join(root, "WORKOS/MEMORY/WORK/a/ISA.md")); put(root, "WORKOS/MEMORY/WORK/a/ISA.md", "isa\n");
    l.moveToBackup("LIFEOS");
    const dataHome = join(outside, "WORKOS_DATA", "USER");
    l.recordAdd(dataHome, undefined, "dir"); mkdirSync(dataHome, { recursive: true }); writeFileSync(join(dataHome, "x.md"), "x");
    expect(existsSync(join(root, "LIFEOS"))).toBe(false);
    const entries = readManifest(root);
    expect(entries[0]).toMatchObject({ action: "add", path: "WORKOS" });
    expect(entries.filter((e) => e.action === "settings-key").length).toBe(2);
    const { steps } = planRollback(entries, run);
    expect(steps.filter((s) => s.op === "restore-copy").length).toBe(1);
    const res = executeRollback(root, run, steps);
    expect(res.failures).toEqual([]);
    expect(snap(root)).toEqual(before);
    expect(existsSync(join(outside, "WORKOS_DATA"))).toBe(false);
    expect(statSync(join(root, "LIFEOS", "MEMORY")).isDirectory()).toBe(true);
  });
  test("keepUserData (the default; --remove-user-data turns it off) leaves paths outside the root", () => {
    const root = mk("rb2");
    const outside = mk("rb2-out");
    const run = startRun(root);
    const l = new Ledger(root, "test");
    l.recordAdd(join(outside, "USER"), undefined, "dir");
    const { steps, skipped } = planRollback(readManifest(root), run, { keepUserData: true });
    expect(skipped.map((s) => s.path)).toEqual([join(outside, "USER")]);
    expect(steps.map((s) => s.path)).toEqual(["WORKOS"]);
  });
});
