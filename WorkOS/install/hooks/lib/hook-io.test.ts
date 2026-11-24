import { afterAll, describe, expect, test } from "bun:test";
import { spawnSync } from "node:child_process";
import { existsSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";

// Each case runs readHookInputResult in a child process with real stdin, the way a hook does.
const dir = mkdtempSync(join(tmpdir(), "workos-hook-io-test-"));
afterAll(() => rmSync(dir, { recursive: true, force: true }));
const probe = join(dir, "probe.ts");
writeFileSync(probe, `import { readHookInputResult } from ${JSON.stringify(join(import.meta.dir, "hook-io.ts"))};\nconsole.log(JSON.stringify(await readHookInputResult()));\n`);

function read(stdin: string, ledger: string) {
  const r = spawnSync("bun", [probe], { input: stdin, encoding: "utf8", env: { ...process.env, WORKOS_HOOK_IO_FALLBACK: ledger } });
  return JSON.parse(r.stdout.trim().split("\n").pop()!);
}
const rows = (ledger: string) => existsSync(ledger) ? readFileSync(ledger, "utf8").trim().split("\n").map((l) => JSON.parse(l)) : [];

describe("hook-io readHookInputResult", () => {
  test("a usable payload comes back as ok and records nothing", () => {
    const ledger = join(dir, "ok.jsonl");
    const r = read(JSON.stringify({ session_id: "s", transcript_path: "/t.jsonl", hook_event_name: "Stop" }), ledger);
    expect(r.ok).toBe(true);
    expect(r.input.transcript_path).toBe("/t.jsonl");
    expect(rows(ledger)).toEqual([]);
  });

  test("empty stdin is 'empty' and is not recorded", () => {
    const ledger = join(dir, "empty.jsonl");
    expect(read("", ledger)).toEqual({ ok: false, reason: "empty", event: "unknown-event" });
    expect(rows(ledger)).toEqual([]);
  });

  test("malformed stdin and a missing transcript_path are typed failures with a ledger row", () => {
    const ledger = join(dir, "bad.jsonl");
    expect(read("not json", ledger)).toMatchObject({ ok: false, reason: "boundary_rejected" });
    expect(read(JSON.stringify({ session_id: "s", hook_event_name: "Stop" }), ledger)).toEqual({ ok: false, reason: "missing_transcript_path", event: "Stop" });
    expect(rows(ledger).map((r) => r.reason)).toEqual(["boundary_rejected", "missing_transcript_path"]);
    expect(rows(ledger)[1].event).toBe("Stop");
  });
});
