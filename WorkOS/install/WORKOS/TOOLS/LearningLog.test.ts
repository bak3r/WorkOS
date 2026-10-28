import { describe, expect, test } from "bun:test";
import { mkdtempSync, writeFileSync } from "fs";
import { tmpdir } from "os";
import { join } from "path";
import { appendRow, buildRow, readRows, tailRows } from "./LearningLog";

const tmp = () => join(mkdtempSync(join(tmpdir(), "learninglog-")), "learning.jsonl");

describe("LearningLog", () => {
  test("rejects a bad kind, a bad slug, and non-object data", () => {
    expect(() => buildRow("note", "billing", "t", "{}")).toThrow("--kind");
    expect(() => buildRow("quiz", "Billing Service", "t", "{}")).toThrow("--area");
    expect(() => buildRow("quiz", "billing", "t", "[1]")).toThrow("JSON object");
    expect(() => buildRow("quiz", "billing", "t", "{oops")).toThrow("valid JSON");
  });

  test("append then tail filters by area and keeps the newest N, oldest first", () => {
    const path = tmp();
    for (const [area, i] of [["a", 1], ["b", 2], ["a", 3], ["a", 4]] as const) {
      appendRow(buildRow("quiz", area, `q${i}`, JSON.stringify({ i })), path);
    }
    const got = tailRows(readRows(path), "a", 2).map((r) => r.title);
    expect(got).toEqual(["q3", "q4"]);
  });

  test("a torn last line is skipped, not fatal", () => {
    const path = tmp();
    appendRow(buildRow("explain", "a", "ok", "{}"), path);
    writeFileSync(path, '{"ts":"x","kind":"quiz"', { flag: "a" });
    expect(readRows(path).map((r) => r.title)).toEqual(["ok"]);
  });
});
