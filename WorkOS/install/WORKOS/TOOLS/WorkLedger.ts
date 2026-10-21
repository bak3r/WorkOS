#!/usr/bin/env bun
/**
 * WorkLedger.ts — CLI over the local work ledger (the Work System's system of record).
 *
 *   bun WorkLedger.ts add --title <t> [--type task] [--body <b>] [--status queued]
 *                         [--priority P0..P3] [--label <l>]... [--slug <s>] [--due YYYY-MM-DD]
 *                         [--jira <KEY>]... [--mr <url>]... [--isa <path>] [--branch <b>] [--project <p>]
 *   bun WorkLedger.ts list [--status <s>] [--type <t>] [--label <l>] [--all] [--json]
 *   bun WorkLedger.ts show <id>
 *   bun WorkLedger.ts update <id> [--status <s>] [--title <t>] [--priority Pn] [--due YYYY-MM-DD]
 *                         [--add-label <l>]... [--remove-label <l>]... [--link-jira <KEY>]... [--link-mr <url>]...
 *   bun WorkLedger.ts close <id> [--note <text>] [--dropped]
 *   bun WorkLedger.ts find --slug <s>
 *   bun WorkLedger.ts render
 *
 * add/show/update/close/find print the item as JSON. Every mutation re-renders
 * TASKLIST.md (a no-op when nothing changed). Exit codes: 0 ok, 1 bad input,
 * 2 item not found.
 *
 * This tool records Jira keys and MR links as references only — it never
 * contacts Jira or GitLab.
 */

import { loadWorkConfig } from "../../hooks/lib/work-config";
import {
  ITEM_STATUSES, ITEM_TYPES, addItem, closeItem, filterItems, isItemStatus, isItemType,
  readLedger, updateItem, writeTasklist, type NewItem, type Priority, type WorkItem,
} from "./lib/work-ledger";

const HELP = `WorkLedger — local work ledger (system of record)

Commands:
  add --title <t> [--type <type>] [--body <b>] [--status <s>] [--priority P0..P3]
      [--label <l>]... [--slug <s>] [--due YYYY-MM-DD] [--jira <KEY>]... [--mr <url>]...
      [--isa <path>] [--branch <b>] [--project <p>]
  list [--status <s>] [--type <t>] [--label <l>] [--all] [--json]
  show <id>
  update <id> [--status <s>] [--title <t>] [--priority Pn] [--due YYYY-MM-DD]
      [--add-label <l>]... [--remove-label <l>]... [--link-jira <KEY>]... [--link-mr <url>]...
  close <id> [--note <text>] [--dropped]
  find --slug <s>
  render

types:    ${ITEM_TYPES.join(", ")}
statuses: ${ITEM_STATUSES.join(", ")}
`;

class UsageError extends Error {}

/** Flags that repeat collect into arrays; boolean flags take no value. */
const REPEATABLE = new Set(["--label", "--jira", "--mr", "--add-label", "--remove-label", "--link-jira", "--link-mr"]);
const BOOLEAN = new Set(["--json", "--all", "--dropped", "--help", "-h"]);

function parseFlags(argv: string[]): { positional: string[]; flags: Map<string, string[]> } {
  const positional: string[] = [];
  const flags = new Map<string, string[]>();
  for (let i = 0; i < argv.length; i++) {
    const a = argv[i];
    if (!a.startsWith("-")) { positional.push(a); continue; }
    if (BOOLEAN.has(a)) { flags.set(a, ["true"]); continue; }
    const v = argv[i + 1];
    if (v === undefined || (v.startsWith("--") && v.length > 2)) throw new UsageError(`${a} needs a value`);
    i++;
    if (REPEATABLE.has(a)) flags.set(a, [...(flags.get(a) ?? []), v]);
    else flags.set(a, [v]);
  }
  return { positional, flags };
}

const one = (f: Map<string, string[]>, k: string): string | undefined => f.get(k)?.[0];
const many = (f: Map<string, string[]>, k: string): string[] => f.get(k) ?? [];

function render(): void {
  try {
    writeTasklist(loadWorkConfig().kanbanStatuses);
  } catch (err) {
    console.error(`[WorkLedger] TASKLIST render failed: ${String(err)}`);
  }
}

function printItem(item: WorkItem, extra: Record<string, unknown> = {}): void {
  console.log(JSON.stringify({ ...extra, item }, null, 2));
}

function knownFlags(f: Map<string, string[]>, allowed: string[]): void {
  for (const k of f.keys()) if (!allowed.includes(k)) throw new UsageError(`unknown flag ${k}`);
}

function main(argv: string[]): number {
  const [cmd, ...rest] = argv;
  if (!cmd || cmd === "--help" || cmd === "-h" || cmd === "help") {
    console.log(HELP);
    return cmd ? 0 : 1;
  }
  const { positional, flags } = parseFlags(rest);
  if (flags.has("--help") || flags.has("-h")) { console.log(HELP); return 0; }

  switch (cmd) {
    case "add": {
      knownFlags(flags, ["--title", "--type", "--body", "--status", "--priority", "--label", "--slug", "--due",
        "--jira", "--mr", "--isa", "--branch", "--project", "--source", "--json"]);
      const type = one(flags, "--type") ?? "task";
      if (!isItemType(type)) throw new UsageError(`--type must be one of: ${ITEM_TYPES.join(", ")}`);
      const input: NewItem = {
        type,
        title: one(flags, "--title") ?? "",
        body: one(flags, "--body"),
        status: one(flags, "--status") as NewItem["status"],
        priority: one(flags, "--priority") as Priority | undefined,
        labels: many(flags, "--label"),
        slug: one(flags, "--slug"),
        due: one(flags, "--due"),
        source: (one(flags, "--source") as NewItem["source"]) ?? "manual",
        links: {
          jira: many(flags, "--jira"),
          mr: many(flags, "--mr"),
          isa: one(flags, "--isa"),
          branch: one(flags, "--branch"),
          project: one(flags, "--project"),
        },
      };
      if (!input.title.trim()) throw new UsageError("--title is required");
      const r = addItem(input);
      render();
      printItem(r.item, { created: r.created });
      return 0;
    }
    case "list": {
      knownFlags(flags, ["--status", "--type", "--label", "--all", "--json"]);
      const status = one(flags, "--status");
      const type = one(flags, "--type");
      if (status && !isItemStatus(status)) throw new UsageError(`--status must be one of: ${ITEM_STATUSES.join(", ")}`);
      if (type && !isItemType(type)) throw new UsageError(`--type must be one of: ${ITEM_TYPES.join(", ")}`);
      const { items, corrupt } = readLedger();
      const rows = filterItems(items, { status, type, label: one(flags, "--label"), includeClosed: flags.has("--all") });
      if (flags.has("--json")) {
        console.log(JSON.stringify({ count: rows.length, corrupt_lines: corrupt, items: rows }, null, 2));
      } else {
        for (const it of rows) {
          console.log(`${it.id}  ${it.status.padEnd(11)} ${(it.priority ?? "--").padEnd(3)} ${it.type.padEnd(13)} ${it.title}${it.due ? `  (due ${it.due})` : ""}`);
        }
        if (corrupt) console.error(`[WorkLedger] skipped ${corrupt} corrupt ledger line(s)`);
      }
      return 0;
    }
    case "show": {
      knownFlags(flags, []);
      const id = positional[0];
      if (!id) throw new UsageError("show needs <id>");
      const item = readLedger().items.find((i) => i.id === id);
      if (!item) { console.error(`[WorkLedger] no item ${id}`); return 2; }
      printItem(item);
      return 0;
    }
    case "update": {
      knownFlags(flags, ["--status", "--title", "--priority", "--due", "--add-label", "--remove-label", "--link-jira", "--link-mr"]);
      const id = positional[0];
      if (!id) throw new UsageError("update needs <id>");
      if (flags.size === 0) throw new UsageError("update needs at least one change flag");
      const statusArg = one(flags, "--status");
      if (statusArg && !isItemStatus(statusArg)) throw new UsageError(`--status must be one of: ${ITEM_STATUSES.join(", ")}`);
      const status = statusArg && isItemStatus(statusArg) ? statusArg : undefined;
      const priorityArg = one(flags, "--priority");
      if (priorityArg && !/^P[0-3]$/.test(priorityArg)) throw new UsageError("--priority must be one of: P0, P1, P2, P3");
      const item = updateItem(id, {
        set: {
          ...(status ? { status } : {}),
          ...(one(flags, "--title") ? { title: one(flags, "--title") } : {}),
          ...(priorityArg ? { priority: priorityArg as Priority } : {}),
          ...(one(flags, "--due") ? { due: one(flags, "--due") } : {}),
        },
        labels_add: many(flags, "--add-label"),
        labels_remove: many(flags, "--remove-label"),
        jira_add: many(flags, "--link-jira"),
        mr_add: many(flags, "--link-mr"),
      });
      if (!item) { console.error(`[WorkLedger] no item ${id}`); return 2; }
      render();
      printItem(item);
      return 0;
    }
    case "close": {
      knownFlags(flags, ["--note", "--dropped"]);
      const id = positional[0];
      if (!id) throw new UsageError("close needs <id>");
      const item = closeItem(id, { status: flags.has("--dropped") ? "dropped" : "done", note: one(flags, "--note") });
      if (!item) { console.error(`[WorkLedger] no item ${id}`); return 2; }
      render();
      printItem(item);
      return 0;
    }
    case "find": {
      knownFlags(flags, ["--slug"]);
      const slug = one(flags, "--slug");
      if (!slug) throw new UsageError("find needs --slug <s>");
      const matches = readLedger().items.filter((i) => i.slug === slug);
      // Prefer the open holder of the slug; fall back to the newest closed one.
      const item = matches.find((i) => !i.closed) ?? matches.sort((a, b) => b.created.localeCompare(a.created))[0];
      if (!item) { console.error(`[WorkLedger] no item with slug ${slug}`); return 2; }
      printItem(item);
      return 0;
    }
    case "render": {
      knownFlags(flags, []);
      const r = writeTasklist(loadWorkConfig().kanbanStatuses);
      console.log(JSON.stringify(r));
      return 0;
    }
    default:
      throw new UsageError(`unknown command "${cmd}"`);
  }
}

if (import.meta.main) {
  try {
    process.exit(main(process.argv.slice(2)));
  } catch (err) {
    console.error(`[WorkLedger] ${err instanceof Error ? err.message : String(err)}`);
    if (err instanceof UsageError) console.error("run with --help for usage");
    process.exit(1);
  }
}
