import { afterAll, describe, expect, test } from "bun:test";
import { mkdirSync, mkdtempSync, realpathSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { isaBody, parseIsaClaimsText } from "./lib/IsaClaims";

// Smoke: each ported ISA tool starts under bun, resolves its imports and answers its no-op / read-only command
// against a temp config root (CLAUDE_CONFIG_DIR), never the real ~/.claude.
const ROOT = realpathSync(mkdtempSync(join(tmpdir(), "isa-tools-smoke-")));
const CONFIG = join(ROOT, "config");
mkdirSync(CONFIG, { recursive: true });
afterAll(() => rmSync(ROOT, { recursive: true, force: true }));

mkdirSync(join(ROOT, "fixture"), { recursive: true });
const ISA = join(ROOT, "fixture", "ISA.md");
writeFileSync(
  ISA,
  [
    "---", "slug: smoke", "phase: climbing", "progress: 0/2", "---", "",
    "## Ideal State", "", "### L3 · One sentence", "", "A tool that does one thing well.", "",
    "## Criteria", "- [ ] ISC-1: it starts (probe: bun run)", "- [ ] ISC-2: Anti: it does not crash", "",
  ].join("\n"),
);
const RESULT = join(ROOT, "result.json");
writeFileSync(RESULT, JSON.stringify({ isa: ISA, criteria: { "ISC-1": "pass" } }));

function cli(tool: string, ...args: string[]) {
  const r = Bun.spawnSync(["bun", join(import.meta.dir, tool), ...args], {
    env: { ...process.env, CLAUDE_CONFIG_DIR: CONFIG, HOME: ROOT },
    stdout: "pipe",
    stderr: "pipe",
  });
  return { code: r.exitCode, out: r.stdout.toString(), err: r.stderr.toString() };
}

/** The failures a broken import or a crash would show; a clean refusal or usage text must not contain them. */
const CRASH = /Cannot find module|Could not resolve|is not a function|TypeError|ReferenceError|SyntaxError|at <anonymous>/;

describe("ported ISA tools start and answer", () => {
  test("IsaGoverning <path> prints the governing ISA and the code flag", () => {
    const r = cli("IsaGoverning.ts", join(ROOT, "elsewhere", "x.ts"));
    expect(r.code).toBe(0);
    expect(JSON.parse(r.out)).toEqual({ isa: null, code: true });
    expect(cli("IsaGoverning.ts").out + cli("IsaGoverning.ts").err).toContain("usage");
  });

  test("IsaLadder with no command prints its header; check reads an ISA with a valid L3", () => {
    const help = cli("IsaLadder.ts");
    expect(help.code).toBe(0);
    expect(help.out).toContain("IsaLadder");
    expect(help.out).toContain("verify-invariants");
    const check = cli("IsaLadder.ts", "check", ISA);
    expect(check.err).not.toMatch(CRASH);
    expect(check.out).toContain("ISAs carry a valid Ideal State ladder");
  });

  test("IsaLadder drift says plainly that Assay is not shipped (exit 2, no stack trace)", () => {
    const r = cli("IsaLadder.ts", "drift", ISA);
    expect(r.code).toBe(2);
    expect(r.err + r.out).toContain("does not ship");
    expect(r.err + r.out).not.toMatch(/Cannot find module/);
  });

  test("IsaAsks prints usage with no command and lists an ISA with no asks", () => {
    const usage = cli("IsaAsks.ts");
    expect(usage.out + usage.err).toContain("usage: IsaAsks.ts");
    const list = cli("IsaAsks.ts", "list", ISA, "--json");
    expect(list.code).toBe(0);
    expect(JSON.parse(list.out)).toMatchObject({ count: 0, asks: [] });
  });

  test("IsaAlign prints usage with no command and reports a verdict for an ISA", () => {
    const usage = cli("IsaAlign.ts");
    expect(usage.out + usage.err).toContain("usage: IsaAlign.ts");
    const status = cli("IsaAlign.ts", "status", ISA, "--json");
    expect(status.err).not.toMatch(CRASH);
    expect(JSON.parse(status.out)).toHaveProperty("verdict");
  });

  test("IsaFold prints usage with no command and a dry run ticks nothing on disk", () => {
    const usage = cli("IsaFold.ts");
    expect(usage.out + usage.err).toContain("usage: IsaFold.ts");
    const dry = cli("IsaFold.ts", "apply", ISA, RESULT, "--dry-run", "--json");
    expect(dry.code).toBe(0);
    expect(JSON.parse(dry.out)).toMatchObject({ ok: true, dryRun: true, ticked: ["ISC-1"], wrote: false });
  });

  test("IsaClaims (library) parses the claims of an ISA body", () => {
    const text = Bun.file(ISA).text();
    return text.then((t) => {
      const { claims } = parseIsaClaimsText(isaBody(t));
      expect(claims.map((c) => c.id)).toEqual(expect.arrayContaining(["ISC-1", "ISC-2"]));
    });
  });
});
