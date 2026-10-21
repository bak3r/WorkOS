import { describe, expect, test } from "bun:test";
import { mkdtempSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { buildLedgerItem, detectIntent, parseRelativeDate } from "./ReminderRouter.hook";
import { addItem, readLedger } from "../WORKOS/TOOLS/lib/work-ledger";

describe("ReminderRouter → ledger item (pure part)", () => {
  test("precision: only explicit imperatives at a line start match", () => {
    expect(detectIntent("remind me to renew the TLS cert next week")?.kind).toBe("reminder");
    expect(detectIntent("research the vector clock paper")?.kind).toBe("research");
    expect(detectIntent("queue this for after the release")?.kind).toBe("queue");
    expect(detectIntent("can you explain how reminders work? remind me to is a phrase")).toBeNull();
    expect(detectIntent("fix the failing build")).toBeNull();
  });

  test("builds a typed, slugged ledger item with due date and the prompt verbatim", () => {
    const prompt = "remind me to renew the TLS cert tomorrow";
    const m = detectIntent(prompt)!;
    m.dueIso = parseRelativeDate(m.remainder, new Date("2026-10-21T12:00:00Z"));
    const item = buildLedgerItem(m, prompt);
    expect(item).toMatchObject({ type: "reminder", title: "renew the TLS cert tomorrow", status: "queued", source: "reminder-router", due: "2026-10-22" });
    expect(item.slug).toMatch(/^reminder:[0-9a-f]{16}$/);
    expect(item.body).toContain(prompt);
  });

  test("same request (case/spacing aside) → same slug → one ledger item", () => {
    const a = buildLedgerItem(detectIntent("remind me to call Sam")!, "remind me to call Sam");
    const b = buildLedgerItem(detectIntent("Remind me to   call sam")!, "Remind me to   call sam");
    expect(a.slug).toBe(b.slug);
    const ledger = join(mkdtempSync(join(tmpdir(), "rr-test-")), "ledger.jsonl");
    expect(addItem(a, ledger).created).toBe(true);
    expect(addItem(b, ledger).created).toBe(false);
    expect(readLedger(ledger).items).toHaveLength(1);
  });
});
