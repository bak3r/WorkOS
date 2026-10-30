/**
 * Installer safety tests: Inventory classification, the settings merge, the CLAUDE.md block
 * (insert / update / remove byte-identical, system prompt on→off byte-identical) and the
 * ledger + Rollback replay. Every test builds its own temp root; nothing outside it is read
 * except this skill's own lib code.
 */

import { afterAll, describe, expect, test } from "bun:test";
import { createHash } from "node:crypto";
import { chmodSync, existsSync, mkdirSync, mkdtempSync, readFileSync, readdirSync, rmSync, statSync, symlinkSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { dirname, join, relative } from "node:path";
import { templateLine } from "./data/GenerateManifest";
import { inventory, matchTemplate, loadLifeosManifests } from "./lib/inventory";
import { planSettingsMerge, retirePermissions } from "./lib/settings-merge";
import { BLOCK_BEGIN, BLOCK_END, blockState, buildBlock, fixLifeosPaths, removeBlock, unifiedDiff, upsertBlock } from "./lib/claude-md";
import { Ledger, readManifest, startRun } from "./lib/ledger";
import { executeRollback, planRollback } from "./Rollback";
import { applySettingsPlan, planSettings } from "./Adopt";
import { retireHooks } from "./InstallEngine";

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

describe("hook retirement", () => {
  const cmd = (c: string) => ({ type: "command", command: c });
  const settings = () => ({
    PreToolUse: [
      { matcher: "Bash", hooks: [cmd("$HOME/.claude/hooks/ContextReduction.hook.sh"), cmd("$HOME/.claude/hooks/DestructiveGuard.hook.ts")] },
      { matcher: "Bash|Write|Edit|MultiEdit", hooks: [cmd("$HOME/.claude/hooks/PreToolGuard.hook.ts")] },
      { matcher: "Bash", hooks: [cmd("/home/dev/my-hooks/PreToolGuard.hook.ts")] },
    ],
    PostToolUse: [{ matcher: "Read", hooks: [cmd("~/.claude/hooks/ISAStaleWriteGuard.hook.ts")] }],
    Stop: [{ matcher: "", hooks: [cmd("bun /cfg/hooks/ConfigEvalFire.hook.ts --x"), cmd("$HOME/.claude/hooks/StopGates.hook.ts")] }],
  });
  const retired = ["PreToolGuard.hook.ts", "ContextReduction.hook.sh", "ISAStaleWriteGuard.hook.ts", "ConfigEvalFire.hook.ts"];

  test("removes only config-root registrations of retired files and drops emptied groups and events", () => {
    const { merged, removed } = retireHooks(settings() as never, retired, "/cfg");
    expect(removed).toHaveLength(4);
    expect(merged.PreToolUse).toEqual([
      { matcher: "Bash", hooks: [cmd("$HOME/.claude/hooks/DestructiveGuard.hook.ts")] },
      { matcher: "Bash", hooks: [cmd("/home/dev/my-hooks/PreToolGuard.hook.ts")] }, // not under the config root: kept
    ]);
    expect(merged.PostToolUse).toBeUndefined();
    expect(merged.Stop).toEqual([{ matcher: "", hooks: [cmd("$HOME/.claude/hooks/StopGates.hook.ts")] }]);
  });

  test("an entry with events retires only those registrations", () => {
    const both = {
      PostToolUse: [{ matcher: "*", hooks: [cmd("$HOME/.claude/hooks/LoopDetector.hook.ts"), cmd("$HOME/.claude/hooks/PostToolObserver.hook.ts")] }],
      PostToolUseFailure: [{ matcher: "", hooks: [cmd("$HOME/.claude/hooks/LoopDetector.hook.ts")] }],
    };
    const { merged, removed } = retireHooks(both as never, [{ file: "LoopDetector.hook.ts", events: ["PostToolUse"] }], "/cfg");
    expect(merged.PostToolUse).toEqual([{ matcher: "*", hooks: [cmd("$HOME/.claude/hooks/PostToolObserver.hook.ts")] }]);
    expect(merged.PostToolUseFailure).toEqual(both.PostToolUseFailure);
    expect(removed).toEqual(["PostToolUse[*]: $HOME/.claude/hooks/LoopDetector.hook.ts"]);
  });

  test("is a no-op with nothing retired, and never matches a longer file name", () => {
    expect(retireHooks(settings() as never, [], "/cfg").merged).toEqual(settings() as never);
    const near = { PreToolUse: [{ matcher: "Bash", hooks: [cmd("$HOME/.claude/hooks/PreToolGuard.hook.ts.bak"), cmd("$HOME/.claude/hooks/XPreToolGuard.hook.ts")] }] };
    expect(retireHooks(near as never, ["PreToolGuard.hook.ts"], "/cfg").removed).toEqual([]);
  });
});

describe("permission retirement", () => {
  test("removes exact retired rules only, from the listed kinds, and reports them", () => {
    const current = { permissions: { allow: ["Bash(env)", "Bash(env:*)", "Bash(envsubst:*)", "Bash(ls:*)", "Bash(git push:*)"], deny: ["Bash(env)"] }, model: "opus" };
    const { merged, removed } = retirePermissions(current, { allow: ["Bash(env)", "Bash(env:*)", "Bash(git push:*)"] });
    expect((merged.permissions as { allow: string[] }).allow).toEqual(["Bash(envsubst:*)", "Bash(ls:*)"]);
    expect((merged.permissions as { deny: string[] }).deny).toEqual(["Bash(env)"]); // deny not listed: untouched
    expect(removed).toEqual({ allow: ["Bash(env)", "Bash(env:*)", "Bash(git push:*)"], deny: [], ask: [] });
    expect(current.permissions.allow).toHaveLength(5); // pure
    expect(merged.model).toBe("opus");
  });

  test("is a no-op without a permissions object", () => {
    expect(retirePermissions({ model: "x" }, { allow: ["Bash(env)"] }).removed.allow).toEqual([]);
  });
});

describe("OverlaySystem upgrade", () => {
  const OLD: Record<string, string> = {
    "install/hooks/Plain.hook.ts": "// v1 plain\n",
    "install/hooks/Edited.hook.ts": "// v1 edited\n",
    "install/hooks/Named.hook.ts": "say('{{PRINCIPAL_NAME}}'); // v1\n",
    "install/skills/Gone/SKILL.md": "---\nname: Gone\n---\n",
    "install/skills/Gone/Tools/Run.ts": "// gone\n",
    "install/skills/GoneEdited/SKILL.md": "---\nname: GoneEdited\n---\n",
    "install/skills/Kept/SKILL.md": "---\nname: Kept\n---\nv1\n",
    "install/WORKOS/TOOLS/Tool.ts": "// tool v1\n",
    "install/WORKOS/WORKOS_SYSTEM_PROMPT.md": "prompt v1 for {{DA_NAME}}\n",
  };
  const NEW: Record<string, string> = {
    "hooks/Plain.hook.ts": "// v2 plain\n",
    "hooks/Edited.hook.ts": "// v2 edited\n",
    "hooks/Named.hook.ts": "say('{{PRINCIPAL_NAME}}'); // v2 {{WORKOS_VERSION}}\n",
    "skills/Kept/SKILL.md": "---\nname: Kept\n---\nv2\n",
    "skills/WorkOS/SKILL.md": "mirror\n",
    "agents/Engineer.md": "agent\n",
    "commands/statusline.md": "cmd\n",
    "WORKOS/TOOLS/Tool.ts": "// tool v2\n",
    "WORKOS/DOCUMENTATION/A.md": "doc\n",
    "WORKOS/ALGORITHM/LATEST": "v1\n",
    "WORKOS/RULES/R.md": "rule\n",
    "WORKOS/STATUSLINE/Render.ts": "// render\n",
    "WORKOS/WORKOS_StatusLine.sh": "#!/bin/sh\n",
    "WORKOS/WORKOS_SYSTEM_PROMPT.md": "prompt v2 for {{DA_NAME}}\n",
    "WORKOS/VERSION": "2.0.0",
    "WORKOS/USER/TEMPLATE.md": "never overlaid\n",
  };
  const fill = (t: string) => t.split("{{PRINCIPAL_NAME}}").join("Dana").split("{{DA_NAME}}").join("Kai");

  function setup() {
    const releases = mk("releases");
    const { WORKOS_TOKENS } = require("./data/GenerateManifest");
    writeFileSync(join(releases, "workos-1.0.0.sha256"), [
      "# version 1.0.0",
      ...Object.entries(OLD).map(([p, t]) => `${sha(t)}  ${p}`),
      ...Object.entries(OLD).map(([p, t]) => templateLine(p, Buffer.from(t), WORKOS_TOKENS)).filter(Boolean),
    ].join("\n") + "\n");
    const skill = mk("skill");
    for (const [p, t] of Object.entries(NEW)) put(skill, `install/${p}`, t);
    for (const p of ["hooks/Plain.hook.ts", "WORKOS/WORKOS_StatusLine.sh"]) chmodSync(join(skill, "install", p), 0o755);
    const root = mk("root");
    for (const [p, t] of Object.entries(OLD)) put(root, p.slice("install/".length), fill(t));
    put(root, "hooks/Edited.hook.ts", "// v1 edited, by me\n");
    put(root, "skills/GoneEdited/SKILL.md", "---\nname: GoneEdited\n---\nmy notes\n");
    put(root, "hooks/Mine.hook.ts", "// mine\n");
    put(root, "skills/WorkOS/SKILL.md", "installed by install.sh\n");
    put(root, "WORKOS/VERSION", "1.0.0");
    put(root, "WORKOS/MEMORY/STATE/x.json", "{}");
    return { releases, skill, root };
  }
  const run = (s: ReturnType<typeof setup>, apply: boolean) => {
    const p = Bun.spawnSync(["bun", join(import.meta.dir, "OverlaySystem.ts"), "--config-root", s.root, "--skill-root", s.skill, ...(apply ? ["--apply"] : [])], {
      env: { ...process.env, WORKOS_RELEASE_MANIFESTS: s.releases, WORKOS_LIFEOS_MANIFESTS: manifestDir, CLAUDE_CONFIG_DIR: s.root },
    });
    return JSON.parse(p.stdout.toString());
  };
  const read = (root: string, rel: string) => readFileSync(join(root, rel), "utf8");

  test("dry run plans every case and writes nothing", () => {
    const s = setup();
    const before = snap(s.root);
    const out = run(s, false);
    expect(out.ok).toBe(true);
    expect(out.edited).toEqual(["hooks/Edited.hook.ts"]);
    expect(out.retired).toEqual(["skills/Gone/SKILL.md", "skills/Gone/Tools/Run.ts"]);
    expect(out.retiredKept).toEqual(["skills/GoneEdited/SKILL.md"]);
    expect(snap(s.root)).toEqual(before);
  });

  test("apply updates untouched files, keeps edited ones with a .new, retires, and rolls back", () => {
    const s = setup();
    const before = snap(s.root);
    const out = run(s, true);
    expect(out.ok).toBe(true);
    expect(read(s.root, "hooks/Plain.hook.ts")).toBe("// v2 plain\n");
    expect(statSync(join(s.root, "WORKOS/WORKOS_StatusLine.sh")).mode & 0o111).not.toBe(0); // created: executable bit kept
    expect(statSync(join(s.root, "hooks/Plain.hook.ts")).mode & 0o111).not.toBe(0); // updated: executable bit kept
    expect(read(s.root, "hooks/Edited.hook.ts")).toBe("// v1 edited, by me\n");
    expect(read(s.root, "hooks/Edited.hook.ts.new")).toBe("// v2 edited\n");
    expect(read(s.root, "hooks/Named.hook.ts")).toBe("say('Dana'); // v2 2.0.0\n"); // name learned from the old copy
    expect(read(s.root, "WORKOS/WORKOS_SYSTEM_PROMPT.md")).toBe("prompt v2 for Kai\n");
    expect(read(s.root, "skills/Kept/SKILL.md")).toContain("v2");
    expect(existsSync(join(s.root, "skills/Gone"))).toBe(false);
    expect(read(s.root, "skills/GoneEdited/SKILL.md")).toContain("my notes");
    expect(read(s.root, "WORKOS/STATUSLINE/Render.ts")).toBe("// render\n");
    expect(read(s.root, "WORKOS/WORKOS_StatusLine.sh")).toBe("#!/bin/sh\n");
    expect(read(s.root, "commands/statusline.md")).toBe("cmd\n");
    expect(read(s.root, "hooks/Mine.hook.ts")).toBe("// mine\n");
    expect(read(s.root, "skills/WorkOS/SKILL.md")).toBe("installed by install.sh\n");
    expect(existsSync(join(s.root, "WORKOS/USER"))).toBe(false);
    expect(read(s.root, "WORKOS/VERSION")).toBe("2.0.0");
    expect(out.unfilled).toEqual([]);

    // a second run changes nothing
    const again = run(s, true);
    expect([again.updated, again.created, again.retired.length]).toEqual([0, 0, 0]);
    expect(again.edited).toEqual(["hooks/Edited.hook.ts"]);

    const entries = readManifest(s.root);
    for (const r of [...new Set(entries.filter((e) => e.tool === "OverlaySystem").map((e) => e.run))].reverse()) {
      const { steps } = planRollback(readManifest(s.root), r);
      expect(executeRollback(s.root, r, steps).failures).toEqual([]);
    }
    const after = snap(s.root);
    for (const k of Object.keys(after)) if (k.startsWith("WORKOS/install-manifest") || k.startsWith(".workos-backup") || k.startsWith("WORKOS/.")) delete after[k];
    const want = { ...before };
    expect(Object.fromEntries(Object.entries(after).filter(([k]) => !k.includes("manifest")))).toEqual(Object.fromEntries(Object.entries(want).filter(([k]) => !k.includes("manifest"))));
  });
});
