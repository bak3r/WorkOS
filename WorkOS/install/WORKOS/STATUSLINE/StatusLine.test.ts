/**
 * The Bun statusline, offline: each case builds a scratch install (WORKOS_DIR, CLAUDE_CONFIG_DIR, HOME and
 * XDG_CACHE_HOME all under one temp dir) and renders it in a subprocess, so the model registry reads the fixture's
 * settings and no frame touches a live cache.
 *   bun test ./WORKOS/STATUSLINE
 */
import { describe, expect, test } from "bun:test";
import { mkdirSync, mkdtempSync, readFileSync, utimesSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { addItem, updateItem } from "../TOOLS/lib/work-ledger";
import { summarize } from "./producers/WorkQueue";
import { ultracodeFromRows } from "./sections/Ultracode";

const SHIM = join(import.meta.dir, "..", "WORKOS_StatusLine.sh");
const ANSI = /\x1b\[[0-9;?]*[A-Za-z]/g;
const SID = "11111111-2222-3333-4444-555555555555";

interface Tree { root: string; workos: string; claude: string; home: string; transcript: string }

function tree(opts: { bedrock?: boolean; fable?: boolean; work?: boolean; health?: string; ultracode?: boolean; email?: string } = {}): Tree {
  const root = mkdtempSync(join(tmpdir(), "workos-sl-"));
  const workos = join(root, "claude", "WORKOS"), claude = join(root, "claude"), home = join(root, "home");
  for (const d of [join(workos, "ALGORITHM"), join(workos, "MEMORY", "STATE"), join(workos, "MEMORY", "OBSERVABILITY"), join(workos, "USER", "WORK"), join(claude, "projects", "p"), home]) mkdirSync(d, { recursive: true });
  writeFileSync(join(workos, "VERSION"), "2.0.0\n");
  writeFileSync(join(workos, "ALGORITHM", "LATEST"), "8.45.0\n");
  const settings: Record<string, unknown> = { daidentity: { name: "Kai" } };
  if (opts.bedrock) {
    settings.env = { CLAUDE_CODE_USE_BEDROCK: "1", AWS_REGION: "eu-central-1" };
    settings.availableModels = opts.fable ? ["opus", "sonnet", "haiku", "fable"] : ["opus", "sonnet", "haiku"];
  }
  writeFileSync(join(claude, "settings.json"), JSON.stringify(settings));
  writeFileSync(join(claude, "CLAUDE.md"), "# WorkOS\n");
  writeFileSync(join(workos, "MEMORY", "STATE", "session-names.json"), JSON.stringify({ [SID]: "Fix the parser" }));
  if (opts.email) writeFileSync(join(home, ".claude.json"), JSON.stringify({ oauthAccount: { emailAddress: opts.email } }));
  const rows = [
    { type: "user", message: { role: "user", content: "hi" } },
    ...(opts.ultracode ? [{ type: "attachment", attachment: { type: "ultra_effort_enter" } }] : []),
    { type: "assistant", message: { role: "assistant", model: "claude-opus-4-5", id: "m1", usage: { output_tokens: 300 } } },
    { type: "assistant", message: { role: "assistant", model: "claude-haiku-4-5", id: "m2", usage: { output_tokens: 100 } } },
  ];
  const transcript = join(claude, "projects", "p", `${SID}.jsonl`);
  writeFileSync(transcript, rows.map((r) => JSON.stringify(r)).join("\n") + "\n");
  // Older than any frame, so admission does not replay a cached frame on the first render.
  utimesSync(transcript, new Date(Date.now() - 120_000), new Date(Date.now() - 120_000));
  if (opts.work) {
    const ledger = join(workos, "USER", "WORK", "ledger.jsonl");
    const a = addItem({ type: "task", title: "Ship the retry fix", priority: "P1", status: "in-progress" }, ledger).item;
    addItem({ type: "task", title: "Write the MR description", due: "2020-01-01" }, ledger);
    addItem({ type: "idea", title: "An idea, never counted" }, ledger);
    const done = addItem({ type: "task", title: "Closed work" }, ledger).item;
    updateItem(done.id, { set: { status: "done" } }, ledger);
    expect(a.status).toBe("in-progress");
    writeFileSync(join(workos, "MEMORY", "STATE", "work-context.json"), JSON.stringify({
      fetched_at: new Date().toISOString(), sources: { jira: { ok: true }, gitlab: { ok: true } },
      items: { jira: [{ key: "ABC-1" }, { key: "ABC-2" }, { key: "ABC-3" }], gitlab_user: "dev", mrs_authored: [{ ref: "g/p!1" }], mrs_reviewing: [{ ref: "g/p!2" }, { ref: "g/p!3" }] },
    }));
  }
  if (opts.health) writeFileSync(join(workos, "MEMORY", "OBSERVABILITY", "memory-health.jsonl"), `{"actions":[]}\n${opts.health}\n`);
  return { root, workos, claude, home, transcript };
}

function render(t: Tree, extra: Record<string, string> = {}, input: Record<string, unknown> = {}): { code: number; out: string; plain: string; err: string } {
  const env: Record<string, string> = {
    PATH: process.env.PATH ?? "", HOME: t.home, CLAUDE_CONFIG_DIR: t.claude, WORKOS_DIR: t.workos, XDG_CACHE_HOME: join(t.root, "cache"),
    COLUMNS: "120", LINES: "50", TZ: "UTC", ...extra,
  };
  const stdin = JSON.stringify({
    session_id: SID, transcript_path: t.transcript, model: { display_name: "Opus 4.5" }, workspace: { current_dir: "/work/payments-api" },
    context_window: { used_percentage: 23, context_window_size: 200000, total_input_tokens: 46000 }, version: "2.1.0", ...input,
  });
  const r = Bun.spawnSync(["bash", SHIM], { env, stdin: Buffer.from(stdin), stdout: "pipe", stderr: "pipe" });
  const out = r.stdout.toString();
  return { code: r.exitCode ?? -1, out, plain: out.replace(ANSI, ""), err: r.stderr.toString() };
}

const lines = (plain: string): string[] => plain.split("\n").filter((l) => l.length > 0);

describe("frame", () => {
  test("a plain install draws the header, session, ladder, context and account rows", () => {
    const r = render(tree({ email: "dev@example.com" }));
    expect(r.code).toBe(0);
    expect(r.err).toBe("");
    expect(r.plain).toContain("WorkOS 2.0.0");
    expect(r.plain).toContain("payments-api");
    expect(r.plain).toContain("FIX THE PARSER");
    expect(r.plain).toMatch(/MODELS: HAIKU \d+% SONNET OPUS \d+% FABLE/);
    expect(r.plain).toContain("CONTEXT:");
    expect(r.plain).toContain("23.0%");
    expect(r.plain).toContain("CC: dev@example.com");
    expect(r.plain).not.toContain("WORK ");
    expect(r.plain).not.toMatch(/LifeOS|LIFEOS/);
  });

  test("no line is wider than the pane, at any width", () => {
    const t = tree({ work: true, health: `{"actions":[{"severity":"warning","text":"Run the reviewer: 3 days since the last pass, which is longer than the window allows"}]}`, ultracode: true });
    for (const cols of [200, 120, 100, 80, 70, 61]) {
      const r = render(t, { COLUMNS: String(cols), XDG_CACHE_HOME: join(t.root, `cache-${cols}`) });
      for (const line of lines(r.plain)) expect(Bun.stringWidth(line)).toBeLessThanOrEqual(cols - 4);
    }
  });

  test("the work row counts open ledger work and the GitLab and Jira cache, ideas and closed items left out", () => {
    const r = render(tree({ work: true }));
    const row = lines(r.plain).find((l) => l.includes("WORK"))!;
    expect(row).toContain("1 Active");
    expect(row).toContain("1 Urgent");
    expect(row).toContain("1 Due");
    expect(row).toContain("2 Open");
    expect(row).toContain("1 MRs");
    expect(row).toContain("2 Review");
    expect(row).toContain("3 Jira");
    expect(row).toContain("→ Ship the retry fix");
  });

  test("the memory row shows a critical action ahead of a warning, and nothing when there is no action", () => {
    const crit = render(tree({ health: `{"actions":[{"severity":"warning","text":"warn first"},{"severity":"critical","text":"Ledger chain broken"}]}` }));
    expect(crit.plain).toContain("MEMORY: → Ledger chain broken");
    expect(crit.plain).not.toContain("warn first");
    const none = render(tree({ health: `{"actions":[]}` }));
    expect(none.plain).not.toContain("MEMORY:");
  });

  test("ultracode from the transcript and fast mode from stdin draw as chips on the session line", () => {
    const r = render(tree({ ultracode: true }), {}, { fast_mode: true });
    const session = lines(r.plain).find((l) => l.includes("FIX THE PARSER"))!;
    expect(session).toContain("ULTRACODE");
    expect(session).toContain("FAST");
  });

  test("on Bedrock the account row names the provider and region, and a lineup without Fable folds max into Opus", () => {
    const r = render(tree({ bedrock: true, email: "dev@example.com" }));
    expect(r.plain).toContain("PROVIDER: AMAZON BEDROCK │ eu-central-1");
    expect(r.plain).not.toContain("dev@example.com");
    const ladder = lines(r.plain).find((l) => l.includes("MODELS"))!;
    expect(ladder).not.toContain("FABLE");
    expect(ladder.match(/OPUS/g)?.length).toBe(1);
    const withFable = render(tree({ bedrock: true, fable: true }));
    expect(withFable.plain).toContain("FABLE");
  });

  test("a phone-sized pane draws the compact layout", () => {
    const r = render(tree({ work: true }), { COLUMNS: "44" });
    expect(r.plain).toContain("WorkOS");
    expect(r.plain).toContain("FIX THE PARSER");
    expect(r.plain).not.toContain("CONTEXT");
    expect(r.plain).not.toContain("WORK");
    expect(lines(r.plain).length).toBeLessThanOrEqual(3);
  });

  test("an unchanged transcript replays the cached frame; the frame stays in the isolated cache", () => {
    const t = tree();
    const first = render(t);
    const cached = readFileSync(join(t.root, "cache", "workos-statusline", `render-${SID}.out`), "utf8");
    expect(cached).toBe(first.out);
    writeFileSync(join(t.workos, "VERSION"), "9.9.9\n");
    expect(render(t).out).toBe(first.out);
  });

  test("a relative WORKOS_DIR fails closed with the bare name", () => {
    const r = render(tree(), { WORKOS_DIR: "relative/WORKOS" });
    expect(r.out).toBe("WorkOS\n");
  });
});

describe("pieces", () => {
  test("ultracode: the last decisive row wins", () => {
    const on = JSON.stringify({ attachment: { type: "ultra_effort_enter" } });
    const off = JSON.stringify({ type: "user", message: { content: "<local-command-stdout>Ultracode off" } });
    expect(ultracodeFromRows(`${on}\n`)).toBe(true);
    expect(ultracodeFromRows(`${on}\n${off}\n`)).toBe(false);
    expect(ultracodeFromRows(`{torn\n`)).toBe(false);
  });

  test("summarize: P0 before P1 for the next item, and no GitLab or Jira counts without a cache", () => {
    const base = { body: "", labels: [], source: "manual" as const, links: { jira: [], mr: [] }, created: "2026-10-01T00:00:00Z", updated: "2026-10-01T00:00:00Z" };
    const q = summarize([
      { ...base, id: "a", type: "task", title: "P1 older", status: "queued", priority: "P1" },
      { ...base, id: "b", type: "task", title: "P0 newer", status: "queued", priority: "P0", created: "2026-10-05T00:00:00Z" },
    ], null, new Date("2026-10-10T12:00:00Z"));
    expect(q.next?.title).toBe("P0 newer");
    expect([q.mrs, q.reviews, q.tickets, q.contextAge]).toEqual([null, null, null, null]);
  });

  test("the refresher runs and reports in the shape MaintenanceJobs logs", () => {
    const t = tree();
    const r = Bun.spawnSync(["bun", join(import.meta.dir, "Refresh.ts")], {
      env: { PATH: process.env.PATH ?? "", HOME: t.home, CLAUDE_CONFIG_DIR: t.claude, WORKOS_DIR: t.workos, XDG_CACHE_HOME: join(t.root, "cache") },
      stdout: "pipe", stderr: "pipe",
    });
    expect(r.exitCode).toBe(0);
    const report = JSON.parse(r.stdout.toString());
    expect(Array.isArray(report.planned)).toBe(true);
    expect(report.failed).toEqual([]);
  });
});
