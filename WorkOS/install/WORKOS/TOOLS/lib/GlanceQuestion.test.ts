/**
 * GlanceQuestion is a parse-only stand-in (see its header): it does not judge whether a producer is safe
 * to run. These tests keep it that way honestly: it says so, it still rejects malformed questions, and no
 * WorkOS code but the parser imports it, so a runner cannot be built on it without porting upstream's
 * safety check first.
 */
import { describe, expect, test } from "bun:test";
import { readdirSync, readFileSync, statSync } from "node:fs";
import { join, relative } from "node:path";
import { PRODUCER_SAFETY_CHECKED, validateGlanceQuestion } from "./GlanceQuestion.ts";

const PAYLOAD = join(import.meta.dir, "..", "..", "..");

function tsFiles(dir: string, out: string[] = []): string[] {
  for (const name of readdirSync(dir)) {
    if (name === "node_modules" || name.startsWith(".")) continue;
    const p = join(dir, name);
    if (statSync(p).isDirectory()) tsFiles(p, out);
    else if (name.endsWith(".ts")) out.push(p);
  }
  return out;
}

describe("GlanceQuestion stand-in", () => {
  test("declares that producer safety is not checked", () => {
    expect(PRODUCER_SAFETY_CHECKED).toBe(false);
  });

  test("still rejects malformed questions", () => {
    const ok = { id: "q", claim: "c", kind: "noul", instructions: "i", caller: "x", state: { producer: "README.md" } };
    expect(validateGlanceQuestion(ok).id).toBe("q");
    expect(() => validateGlanceQuestion({ ...ok, kind: "maybe" })).toThrow(/kind/);
    expect(() => validateGlanceQuestion({ ...ok, state: {} })).toThrow(/producer/);
    expect(() => validateGlanceQuestion({ ...ok, kind: "score" })).toThrow(/criteria/);
  });

  test("only the ISA test-strategy parser imports it", () => {
    const importers = tsFiles(PAYLOAD)
      .filter((f) => !f.endsWith("GlanceQuestion.ts") && !f.endsWith("GlanceQuestion.test.ts"))
      .filter((f) => /from\s+["'][^"']*GlanceQuestion(\.ts)?["']/.test(readFileSync(f, "utf8")))
      .map((f) => relative(PAYLOAD, f));
    expect(importers).toEqual(["WORKOS/TOOLS/lib/IsaTestStrategy.ts"]);
  });
});
