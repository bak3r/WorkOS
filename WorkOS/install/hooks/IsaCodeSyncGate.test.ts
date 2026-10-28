import { afterAll, afterEach, beforeEach, describe, expect, test } from "bun:test";
import { mkdirSync, mkdtempSync, realpathSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { run, unsyncedIsas } from "./IsaCodeSyncGate.hook";
import type { ToolCall } from "./ISAFoldGate.hook";
import { resetLinkedIsaCache } from "../WORKOS/TOOLS/IsaGoverning";

// Temp dirs only. CLAUDE_CONFIG_DIR sends WORKOS_DIR (and its MEMORY/WORK) into the temp root, so the real
// ~/.claude is never read.
const ROOT = realpathSync(mkdtempSync(join(tmpdir(), "isa-codesync-")));
const CONFIG = join(ROOT, "config");
const WORK = join(CONFIG, "WORKOS", "MEMORY", "WORK");

const ENV_KEYS = ["CLAUDE_CONFIG_DIR", "CLAUDE_PLUGIN_ROOT", "WORKOS_DIR", "WORKOS_SKILLS_DIR"] as const;
const saved: Record<string, string | undefined> = {};
let n = 0;

beforeEach(() => {
  for (const k of ENV_KEYS) { saved[k] = process.env[k]; delete process.env[k]; }
  process.env.CLAUDE_CONFIG_DIR = CONFIG;
  rmSync(join(CONFIG, "WORKOS"), { recursive: true, force: true });
  mkdirSync(WORK, { recursive: true });
  resetLinkedIsaCache();
});
afterEach(() => {
  for (const k of ENV_KEYS) { if (saved[k] === undefined) delete process.env[k]; else process.env[k] = saved[k]; }
  resetLinkedIsaCache();
});
afterAll(() => rmSync(ROOT, { recursive: true, force: true }));

/** An employer-style repo (no ISA inside) plus a WorkOS ISA linked to it by `repo:` and `branch:`. */
function fixture(branch = "feature/ABC-1-thing") {
  const repo = join(ROOT, `repo-${++n}`);
  mkdirSync(join(repo, ".git"), { recursive: true });
  writeFileSync(join(repo, ".git", "HEAD"), `ref: refs/heads/${branch}\n`);
  mkdirSync(join(repo, "src"), { recursive: true });
  const code = join(repo, "src", "service.ts");
  writeFileSync(code, "export {};\n");
  const isaDir = join(WORK, `isa-${n}`);
  mkdirSync(isaDir, { recursive: true });
  const isa = join(isaDir, "ISA.md");
  writeFileSync(isa, `---\nphase: climbing\nprogress: 0/1\nrepo: ${repo}\nbranch: ${branch}\nticket: ABC-1\n---\n\n## Criteria\n- [ ] C1: it works\n`);
  return { repo, code, isa: realpathSync(isa) };
}

let id = 0;
/** An answered tool call, successful unless said otherwise. */
function call(name: string, input: Record<string, unknown>, over: Partial<ToolCall> = {}): ToolCall {
  return { id: `t${++id}`, name, input, answered: true, ok: true, resultText: "", sidechain: false, ts: null, resultOrder: id, resultTs: null, ...over };
}

describe("unsyncedIsas with a linked ISA", () => {
  test("code changed and the ISA not written: the ISA is owed, with the file", () => {
    const f = fixture();
    const owed = unsyncedIsas([call("Edit", { file_path: f.code })]);
    expect([...owed.keys()]).toEqual([f.isa]);
    expect(owed.get(f.isa)).toEqual([f.code]);
  });

  test("the linked ISA written in the same turn clears it (Edit, Write and MultiEdit all count)", () => {
    const f = fixture();
    for (const tool of ["Edit", "Write", "MultiEdit"]) {
      const owed = unsyncedIsas([call("Write", { file_path: f.code }), call(tool, { file_path: f.isa })]);
      expect(owed.size).toBe(0);
    }
  });

  test("an unanswered or failed ISA write does not clear it", () => {
    const f = fixture();
    expect(unsyncedIsas([call("Edit", { file_path: f.code }), call("Edit", { file_path: f.isa }, { answered: false, ok: false })]).size).toBe(1);
    expect(unsyncedIsas([call("Edit", { file_path: f.code }), call("Edit", { file_path: f.isa }, { ok: false })]).size).toBe(1);
  });

  test("a failed code edit owes nothing; reads and Bash are ignored", () => {
    const f = fixture();
    expect(unsyncedIsas([call("Edit", { file_path: f.code }, { ok: false })]).size).toBe(0);
    expect(unsyncedIsas([call("Read", { file_path: f.code }), call("Bash", { command: `echo x > ${f.code}` })]).size).toBe(0);
  });

  test("non-code files owe nothing", () => {
    const f = fixture();
    const md = join(f.repo, "README.md");
    writeFileSync(md, "x");
    expect(unsyncedIsas([call("Edit", { file_path: md })]).size).toBe(0);
  });

  test("several files share one owed entry; two repos owe two ISAs", () => {
    const a = fixture();
    const b = fixture("main");
    const a2 = join(a.repo, "src", "other.ts");
    writeFileSync(a2, "");
    const owed = unsyncedIsas([call("Edit", { file_path: a.code }), call("Edit", { file_path: a2 }), call("Edit", { file_path: b.code })]);
    expect(owed.get(a.isa)).toEqual([a.code, a2]);
    expect(owed.get(b.isa)).toEqual([b.code]);
    // writing only a's ISA clears a and leaves b
    const left = unsyncedIsas([call("Edit", { file_path: a.code }), call("Edit", { file_path: b.code }), call("Edit", { file_path: a.isa })]);
    expect([...left.keys()]).toEqual([b.isa]);
  });

  test("a repo with no linked ISA owes nothing", () => {
    const f = fixture();
    rmSync(f.isa);
    resetLinkedIsaCache();
    expect(unsyncedIsas([call("Edit", { file_path: f.code })]).size).toBe(0);
  });
});

/** A transcript JSONL: one user prompt, then an assistant turn of (call, result) pairs. */
function transcript(calls: Array<{ name: string; input: Record<string, unknown>; ok?: boolean }>): string {
  const rows: object[] = [{ type: "user", message: { role: "user", content: "please change the service" } }];
  calls.forEach((c, i) => {
    const toolId = `toolu_${i}`;
    rows.push({ type: "assistant", message: { role: "assistant", content: [{ type: "tool_use", id: toolId, name: c.name, input: c.input }] } });
    rows.push({ type: "user", message: { role: "user", content: [{ type: "tool_result", tool_use_id: toolId, content: "ok", is_error: c.ok === false }] } });
  });
  rows.push({ type: "assistant", message: { role: "assistant", content: [{ type: "text", text: "done" }] } });
  const path = join(ROOT, `transcript-${++n}.jsonl`);
  writeFileSync(path, rows.map((r) => JSON.stringify(r)).join("\n") + "\n");
  return path;
}

describe("run (the Stop gate) with a linked ISA", () => {
  test("code changed, ISA not written: blocks and names the ISA and the file", async () => {
    const f = fixture();
    const out = (await run({ session_id: "s", transcript_path: transcript([{ name: "Edit", input: { file_path: f.code } }]) } as never)) as { decision: string; reason: string };
    expect(out.decision).toBe("block");
    expect(out.reason).toContain(f.isa);
    expect(out.reason).toContain(f.code);
  });

  test("code changed and the ISA written in the same turn: no block", async () => {
    const f = fixture();
    const path = transcript([{ name: "Edit", input: { file_path: f.code } }, { name: "Edit", input: { file_path: f.isa } }]);
    expect(await run({ session_id: "s", transcript_path: path } as never)).toBeNull();
  });

  test("the stop-hook recovery pass is never blocked again", async () => {
    const f = fixture();
    const path = transcript([{ name: "Edit", input: { file_path: f.code } }]);
    expect(await run({ session_id: "s", transcript_path: path, stop_hook_active: true } as never)).toBeNull();
  });

  test("an unreadable transcript fails open", async () => {
    expect(await run({ session_id: "s", transcript_path: join(ROOT, "missing.jsonl") } as never)).toBeNull();
  });
});
