/**
 * Errata-lite, offline: a scratch ledger, a scratch execution log and an injected model.
 *   bun test ./WORKOS/ERRATA
 */
import { beforeAll, describe, expect, test } from "bun:test";
import { mkdtempSync, writeFileSync, readFileSync, readdirSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";

const tmp = mkdtempSync(join(tmpdir(), "errata-test-"));
process.env.ERRATA_DIR = join(tmp, "ledger");
process.env.ERRATA_STATE_DIR = join(tmp, "state");
process.env.ERRATA_EXECUTION_FILE = join(tmp, "execution.jsonl");
process.env.WORKOS_PROOF_DIR = join(tmp, "receipts");

const { main, skillRows, impact, loadCalls } = await import("./Errata.ts");
const { ErrataStore } = await import("./Store.ts");
const { enrichPending } = await import("./Enrich.ts");
const { runProof } = await import("../../skills/Assay/Tools/Proof.ts");

const store = () => new ErrataStore(process.env.ERRATA_DIR!, join(tmp, "state", "tenants"));
async function run(...argv: string[]): Promise<{ code: number; out: string }> {
  const lines: string[] = [];
  const log = console.log, err = console.error;
  console.log = (...a: unknown[]) => lines.push(a.join(" "));
  console.error = (...a: unknown[]) => lines.push(a.join(" "));
  try { return { code: await main(argv, store()), out: lines.join("\n") }; }
  finally { console.log = log; console.error = err; }
}
const iso = (d: string) => `${d}T12:00:00.000Z`;

describe("record", () => {
  test("writes one verbatim line and reads it back", async () => {
    const r = await run("record", "--text", "The MR description invented a ticket number.", "--skill", "MergeRequestDescription", "--json");
    expect(r.code).toBe(0);
    const e = JSON.parse(r.out);
    expect(e).toMatchObject({ system: "workos", source: "principal", channel: "er-command", kind: "complaint", rating: null, complaint: "The MR description invented a ticket number." });
    expect(e.tags).toContain("skill:MergeRequestDescription");
    const files = readdirSync(process.env.ERRATA_DIR!);
    expect(files.some((f) => /^errata-\d{4}-\d{2}\.jsonl$/.test(f))).toBe(true);
    expect((await run("list", "--skill", "MergeRequestDescription")).out).toContain("invented a ticket number");
  });

  test("a leading tag sets the kind and is the only text removed", async () => {
    const e = JSON.parse((await run("record", "--text", "  bug: Doctor crashes on a fresh install  ", "--json")).out);
    expect(e.kind).toBe("bug");
    expect(e.complaint).toBe("Doctor crashes on a fresh install");
    const f = JSON.parse((await run("record", "--text", "feature: a /er undo", "--json")).out);
    expect(f.kind).toBe("feature-request");
    const plain = JSON.parse((await run("record", "--text", "debug: is not a tag", "--json")).out);
    expect([plain.kind, plain.complaint]).toEqual(["complaint", "debug: is not a tag"]);
  });

  test("refuses machine text, a bad rating, a bad kind and no text", async () => {
    expect((await run("record", "--text", "Base directory for this skill: /x")).code).toBe(1);
    expect((await run("record", "--text", "fine", "--rating", "11")).code).toBe(2);
    expect((await run("record", "--text", "fine", "--kind", "rant")).code).toBe(2);
    expect((await run("record")).code).toBe(2);
  });

  test("a complaint against an artifact with a presentable Proof receipt is a false pass", async () => {
    const art = join(tmp, "desc.md");
    writeFileSync(art, "A good short description.");
    const intent = join(tmp, "I.md");
    writeFileSync(intent, "# I\n\n## Ideal State\n\n- The text is good\n\n## Anti-criteria\n\n- Never invents a ticket\n");
    const judge = async (_o: string, a: { type: string; weight?: number }) => ({ type: a.type, passed: true, score: 1, reason: "ok", weight: a.weight ?? 1 });
    const receipt = await runProof({ artifact: art, intent, judge: judge as never });
    expect(receipt.verdict).toBe("pass");
    const r = await run("record", "--text", "This description is wrong about the endpoint.", "--skill", "MergeRequestDescription", "--artifact", art, "--json");
    const e = JSON.parse(r.out);
    expect(e.tags).toContain("false-pass");
    expect(e.attachments).toEqual([art]);
    const misses = JSON.parse((await run("misses", "--json")).out);
    expect(misses.false_passes.map((f: { id: string }) => f.id)).toContain(e.id);
    expect(misses.retire_candidates).toEqual([]);
  });
});

describe("rates", () => {
  beforeAll(() => {
    const calls = [
      ...Array.from({ length: 10 }, (_, i) => ({ ts: iso(`2026-10-0${(i % 9) + 1}`), skill: "QaTestNotes" })),
      ...Array.from({ length: 10 }, (_, i) => ({ ts: iso(`2026-10-${11 + (i % 9)}`), skill: "QaTestNotes" })),
      { ts: iso("2026-10-05"), skill: "plugin:Other" },
    ];
    writeFileSync(process.env.ERRATA_EXECUTION_FILE!, calls.map((c) => JSON.stringify(c)).join("\n") + "\n{torn");
  });

  test("calls are read, torn lines skipped, plugin prefixes dropped", () => {
    const calls = loadCalls();
    expect(calls.length).toBe(21);
    expect(calls.some((c) => c.skill === "Other")).toBe(true);
  });

  const row = (d: string, kind = "complaint", skill = "QaTestNotes") => ({
    schema: 1, id: `ERR-${d.replace(/-/g, "")}-120000-ab${Math.random().toString(36).slice(2, 4)}`, ts: iso(d), system: "workos", instance: "x", target: "instance",
    source: "principal", channel: "er-command", kind, rating: null, frustration: null, complaint: "c", context: {}, reporter: { id: "principal", role: "principal" },
    attachments: [], enrichment: null, status: "new", links: {}, tags: [`skill:${skill}`],
  }) as never;

  test("skill rate is complaints over calls; praise does not count", () => {
    const rows = [row("2026-10-02"), row("2026-10-03"), row("2026-10-04", "praise")];
    const r = skillRows(rows, loadCalls()).find((x) => x.skill === "QaTestNotes")!;
    expect(r).toMatchObject({ outputs: 20, complaints: 2, rate: 0.1 });
  });

  test("impact: fewer complaints per call after the change reads lower; no calls reads insufficient-data", () => {
    const rows = [row("2026-10-02"), row("2026-10-03"), row("2026-10-04"), row("2026-10-15")];
    const r = impact(rows, loadCalls(), "QaTestNotes", new Date("2026-10-10T00:00:00Z"), 10, new Date("2026-10-28T00:00:00Z"));
    expect(r.before).toMatchObject({ outputs: 10, complaints: 3 });
    expect(r.after).toMatchObject({ outputs: 10, complaints: 1 });
    expect(r.verdict).toBe("lower");
    expect(impact(rows, loadCalls(), "Nobody", new Date("2026-10-10T00:00:00Z"), 10).verdict).toBe("insufficient-data");
  });

  test("the CLI impact output is the shape HillClimb verify reads", async () => {
    const j = JSON.parse((await run("impact", "--skill", "QaTestNotes", "--since", "2026-10-10", "--days", "10", "--json")).out);
    expect(typeof j.verdict).toBe("string");
    expect(j.before).toHaveProperty("rate");
    expect(j.after).toHaveProperty("rate");
  });
});

describe("enrich", () => {
  const good = { how_upset: 2, which_part: "the description", what_upset: "a made-up ticket", reporter_right: true, reporter_right_reason: "no such ticket", root_cause_hypothesis: "guessing", class: "invented_fact", proposed_fix: "read the branch name", confidence: 0.8 };

  test("a valid reply patches enrichment; a malformed one leaves the entry null", async () => {
    const s = store();
    let n = 0;
    const r = await enrichPending(s, {
      infer: async () => (n++ === 0
        ? { success: true, output: "", parsed: good, latencyMs: 1, level: "low", executedModel: "haiku-test" }
        : { success: true, output: "", parsed: { ...good, class: "Not Snake" }, latencyMs: 1, level: "low" }) as never,
    });
    expect(r.enriched).toBe(1);
    expect(r.failed).toBeGreaterThanOrEqual(1);
    const enriched = s.all().filter((e) => e.enrichment);
    expect(enriched.length).toBe(1);
    expect(enriched[0].enrichment!.model).toBe("haiku-test");
    expect(enriched[0].status).toBe("enriched");
  });

  test("the kill switch refuses before touching the store", async () => {
    process.env.WORKOS_INFERENCE_DISABLED = "test";
    try { await expect(enrichPending(store(), { infer: async () => { throw new Error("must not run"); } })).rejects.toThrow(/WORKOS_INFERENCE_DISABLED/); }
    finally { delete process.env.WORKOS_INFERENCE_DISABLED; }
  });

  test("nothing is rewritten in place: every month file only grows", () => {
    const files = readdirSync(process.env.ERRATA_DIR!).filter((f) => f.endsWith(".jsonl"));
    const lines = files.flatMap((f) => readFileSync(join(process.env.ERRATA_DIR!, f), "utf8").trim().split("\n"));
    expect(lines.some((l) => l.includes('"op":"patch"'))).toBe(true);
  });
});
