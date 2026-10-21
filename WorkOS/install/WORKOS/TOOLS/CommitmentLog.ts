#!/usr/bin/env bun
/**
 * CommitmentLog.ts — Manual capture CLI. Adds a `commitment` item with a due date to the
 * local work ledger (WORKOS/USER/WORK/ledger.jsonl).
 *
 *   bun ~/.claude/WORKOS/TOOLS/CommitmentLog.ts \
 *     --beneficiary "Alex" \
 *     --subject "send Surface threat-model brief" \
 *     --due 2026-05-30 \
 *     [--channel imessage|email|inperson|other] \
 *     [--source-link <url-or-quote>] \
 *     [--priority P0|P1|P2|P3]
 *
 * Idempotent: the slug is beneficiary + subject + due, so re-running the same
 * command returns the open item instead of creating a second one.
 *
 * Prints the item as JSON on success. Exits non-zero on failure.
 */

import { createHash } from "crypto";
import { loadWorkConfig } from "../../hooks/lib/work-config";
import { addItem, writeTasklist } from "./lib/work-ledger";

interface Args {
  beneficiary: string;
  subject: string;
  due: string; // YYYY-MM-DD
  channel: string;
  sourceLink: string;
  priority: "P0" | "P1" | "P2" | "P3";
}

function parseArgs(): Args {
  const argv = process.argv.slice(2);
  const get = (flag: string, fallback = ""): string => {
    const idx = argv.indexOf(flag);
    return idx >= 0 && argv[idx + 1] ? argv[idx + 1] : fallback;
  };
  const beneficiary = get("--beneficiary");
  const subject = get("--subject");
  const due = get("--due");
  const channel = get("--channel", "manual");
  const sourceLink = get("--source-link", "");
  const priority = (get("--priority", "P2") as Args["priority"]);

  if (!beneficiary || !subject || !due) {
    console.error("usage: CommitmentLog.ts --beneficiary <name> --subject <what> --due YYYY-MM-DD [--channel x] [--source-link x] [--priority Pn]");
    process.exit(1);
  }
  if (!/^\d{4}-\d{2}-\d{2}$/.test(due)) {
    console.error(`CommitmentLog: --due must be YYYY-MM-DD, got "${due}"`);
    process.exit(1);
  }
  if (!["P0", "P1", "P2", "P3"].includes(priority)) {
    console.error(`CommitmentLog: --priority must be P0..P3, got "${priority}"`);
    process.exit(1);
  }
  return { beneficiary, subject, due, channel, sourceLink, priority };
}

function main() {
  const args = parseArgs();
  const cfg = loadWorkConfig();

  const norm = `${args.beneficiary}|${args.subject}|${args.due}`.toLowerCase().replace(/\s+/g, " ").trim();
  const slug = `commitment:${createHash("sha1").update(norm).digest("hex").slice(0, 16)}`;
  const body = [
    `To: ${args.beneficiary}`,
    `Promise: ${args.subject}`,
    `Due: ${args.due}`,
    `Channel: ${args.channel}`,
    ...(args.sourceLink ? [`Source: ${args.sourceLink}`] : []),
  ].join("\n");

  // Title is "<beneficiary>: <promise>" — CommitmentSweep reads the beneficiary back from it.
  const { item, created } = addItem({
    type: "commitment",
    title: `${args.beneficiary}: ${args.subject}`.slice(0, 240),
    body,
    status: "ready",
    priority: args.priority,
    labels: [`channel:${args.channel}`],
    source: "commitment",
    slug,
    due: args.due,
  });
  try {
    writeTasklist(cfg.kanbanStatuses);
  } catch (err) {
    console.error(`CommitmentLog: TASKLIST render failed — ${String(err)}`);
  }
  console.log(JSON.stringify({ ok: true, created, id: item.id, due: args.due, beneficiary: args.beneficiary }));
}

if (import.meta.main) {
  try {
    main();
  } catch (err) {
    console.error(`CommitmentLog: fatal — ${String(err)}`);
    process.exit(4);
  }
}
