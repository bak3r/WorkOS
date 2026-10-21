import { describe, expect, test, beforeEach } from "bun:test";
import { appendFileSync, mkdtempSync, readFileSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import {
  addItem, closeItem, filterItems, foldLedger, parseLedger, readLedger, renderTasklist, updateItem, writeTasklist,
  type LedgerEvent,
} from "./work-ledger";

let dir: string;
let ledger: string;
let tasklist: string;
beforeEach(() => {
  dir = mkdtempSync(join(tmpdir(), "ledger-test-"));
  ledger = join(dir, "ledger.jsonl");
  tasklist = join(dir, "TASKLIST.md");
});

const T0 = new Date("2026-10-21T10:00:00Z");

describe("fold", () => {
  test("create → update → close folds in file order", () => {
    const evs: LedgerEvent[] = [
      { v: 1, ts: "2026-10-21T10:00:00Z", op: "create", id: "W-1", item: { type: "task", title: "a", body: "", status: "queued", labels: ["x"], source: "manual", links: { jira: [], mr: [] } } },
      { v: 1, ts: "2026-10-21T11:00:00Z", op: "update", id: "W-1", set: { status: "in-progress", due: "2026-10-30" }, labels_add: ["y"], labels_remove: ["x"], jira_add: ["ABC-1", "ABC-1"] },
      { v: 1, ts: "2026-10-21T12:00:00Z", op: "close", id: "W-1", status: "done", note: "shipped" },
    ];
    const { items, corrupt } = foldLedger(evs);
    expect(corrupt).toBe(0);
    expect(items).toHaveLength(1);
    const it = items[0];
    expect(it.status).toBe("done");
    expect(it.labels).toEqual(["y"]);
    expect(it.links.jira).toEqual(["ABC-1"]);
    expect(it.due).toBe("2026-10-30");
    expect(it.created).toBe("2026-10-21T10:00:00Z");
    expect(it.closed).toBe("2026-10-21T12:00:00Z");
    expect(it.body).toContain("shipped");
  });

  test("duplicate create and orphan update are ignored and counted", () => {
    const create: LedgerEvent = { v: 1, ts: "t", op: "create", id: "W-1", item: { type: "task", title: "a", body: "", status: "queued", labels: [], source: "manual", links: { jira: [], mr: [] } } };
    const { items, corrupt } = foldLedger([create, { ...create, item: { ...create.item, title: "b" } }, { v: 1, ts: "t", op: "update", id: "W-9", set: { title: "z" } }]);
    expect(items.map((i) => i.title)).toEqual(["a"]);
    expect(corrupt).toBe(2);
  });

  test("fold is pure: same events, same state", () => {
    addItem({ type: "task", title: "one" }, ledger, T0);
    addItem({ type: "idea", title: "two" }, ledger, T0);
    const raw = readFileSync(ledger, "utf-8");
    expect(foldLedger(parseLedger(raw).events)).toEqual(foldLedger(parseLedger(raw).events));
  });
});

describe("corrupt-line tolerance", () => {
  test("bad lines are skipped and counted, never thrown", () => {
    addItem({ type: "task", title: "good" }, ledger, T0);
    appendFileSync(ledger, "{not json\n[1,2]\n{\"op\":\"create\"}\n");
    addItem({ type: "task", title: "also good" }, ledger, T0);
    appendFileSync(ledger, "{\"torn\": "); // torn tail, no newline
    const { items, corrupt } = readLedger(ledger);
    expect(items.map((i) => i.title)).toEqual(["good", "also good"]);
    expect(corrupt).toBe(4);
  });

  test("an append after a torn tail is not swallowed by it", () => {
    addItem({ type: "task", title: "before" }, ledger, T0);
    appendFileSync(ledger, "{\"torn\": ");
    addItem({ type: "task", title: "after" }, ledger, T0);
    const { items, corrupt } = readLedger(ledger);
    expect(items.map((i) => i.title)).toEqual(["before", "after"]);
    expect(corrupt).toBe(1);
  });

  test("missing file reads as empty", () => {
    expect(readLedger(join(dir, "nope.jsonl"))).toEqual({ items: [], corrupt: 0 });
  });
});

describe("idempotency", () => {
  test("same slug while open returns the existing item", () => {
    const a = addItem({ type: "reminder", title: "renew cert", slug: "reminder:abc" }, ledger, T0);
    const b = addItem({ type: "reminder", title: "renew cert again", slug: "reminder:abc" }, ledger, T0);
    expect(a.created).toBe(true);
    expect(b.created).toBe(false);
    expect(b.item.id).toBe(a.item.id);
    expect(readLedger(ledger).items).toHaveLength(1);
  });

  test("slug is reusable once the holder is closed", () => {
    const a = addItem({ type: "task", title: "x", slug: "s" }, ledger, T0);
    closeItem(a.item.id, {}, ledger, T0);
    const b = addItem({ type: "task", title: "x", slug: "s" }, ledger, T0);
    expect(b.created).toBe(true);
    expect(b.item.id).not.toBe(a.item.id);
  });

  test("ids have the W-yyMMdd-xxxx shape", () => {
    const { item } = addItem({ type: "task", title: "x" }, ledger, new Date(2026, 9, 21));
    expect(item.id).toMatch(/^W-261021-[0-9a-f]{4}$/);
  });

  test("invalid input throws before writing", () => {
    expect(() => addItem({ type: "nope" as any, title: "x" }, ledger)).toThrow();
    expect(() => addItem({ type: "task", title: "x", due: "next week" }, ledger)).toThrow();
    expect(readLedger(ledger).items).toHaveLength(0);
  });

  test("update/close of an unknown id returns null", () => {
    expect(updateItem("W-000000-0000", { set: { title: "x" } }, ledger)).toBeNull();
    expect(closeItem("W-000000-0000", {}, ledger)).toBeNull();
  });
});

describe("filter", () => {
  test("closed hidden by default, visible with includeClosed or explicit status", () => {
    const a = addItem({ type: "task", title: "a", labels: ["l"] }, ledger, T0);
    addItem({ type: "idea", title: "b" }, ledger, T0);
    closeItem(a.item.id, {}, ledger, T0);
    const items = readLedger(ledger).items;
    expect(filterItems(items).map((i) => i.title)).toEqual(["b"]);
    expect(filterItems(items, { includeClosed: true })).toHaveLength(2);
    expect(filterItems(items, { status: "done" }).map((i) => i.title)).toEqual(["a"]);
    expect(filterItems(items, { type: "idea" }).map((i) => i.title)).toEqual(["b"]);
    expect(filterItems(items, { label: "l", includeClosed: true }).map((i) => i.title)).toEqual(["a"]);
  });
});

describe("render", () => {
  test("sections by status, deterministic, no-op when unchanged", () => {
    const a = addItem({ type: "task", title: "doing", priority: "P1" }, ledger, T0);
    updateItem(a.item.id, { set: { status: "in-progress" }, jira_add: ["ABC-12"] }, ledger, T0);
    addItem({ type: "reminder", title: "later", due: "2026-11-01" }, ledger, T0);
    const md = renderTasklist(readLedger(ledger).items);
    expect(md).toContain("## in-progress (1)");
    expect(md).toContain("## queued (1)");
    expect(md).toContain("ABC-12");
    expect(md.indexOf("## in-progress")).toBeLessThan(md.indexOf("## queued"));
    expect(renderTasklist(readLedger(ledger).items)).toBe(md);

    expect(writeTasklist(undefined, ledger, tasklist).changed).toBe(true);
    expect(writeTasklist(undefined, ledger, tasklist).changed).toBe(false);
    addItem({ type: "task", title: "new" }, ledger, T0);
    expect(writeTasklist(undefined, ledger, tasklist).changed).toBe(true);
  });

  test("configured order wins; omitted open statuses still render", () => {
    addItem({ type: "task", title: "q" }, ledger, T0);
    addItem({ type: "task", title: "b", status: "blocked" }, ledger, T0);
    const md = renderTasklist(readLedger(ledger).items, ["queued"]);
    expect(md.indexOf("## queued")).toBeLessThan(md.indexOf("## blocked"));
  });
});
