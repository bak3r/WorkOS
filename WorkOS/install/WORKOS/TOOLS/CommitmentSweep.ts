#!/usr/bin/env bun
// Normalize env path vars Claude Code may inject unexpanded — literal $HOME/${HOME}
// in WORKOS_DIR/WORKOS_CONFIG_DIR/PROJECTS_DIR resolves to a shadow dir (#1404 / PR #1451, author jbmml).
for (const __k of ["WORKOS_DIR", "WORKOS_CONFIG_DIR", "PROJECTS_DIR"]) {
  const __v = process.env[__k];
  if (__v && /^\$\{?HOME\}?(\/|$)/.test(__v)) process.env[__k] = __v.replace(/^\$\{?HOME\}?/, process.env.HOME ?? "~");
}

/**
 * CommitmentSweep.ts — Daily sweep over open `commitment` items in the local work ledger.
 *
 * Scheduled by hooks/MaintenanceJobs.hook.ts (every 20h, from SessionStart); the
 * com.workos.commitmentsweep systemd timer (InstallCommitmentSweep.ts) is an optional extra.
 * Also runnable on-demand:
 *
 *   bun ~/.claude/WORKOS/TOOLS/CommitmentSweep.ts             # apply
 *   bun ~/.claude/WORKOS/TOOLS/CommitmentSweep.ts --dry-run   # print digest, do not append to the digest log
 *
 * What it does:
 *   1. Reads open `commitment` items from WORKOS/USER/WORK/ledger.jsonl
 *   2. Buckets each by its `due` date: overdue / due_today / due_this_week / future
 *   3. Prints a digest line on overdue OR due_today
 *   4. Appends one digest line to MEMORY/OBSERVABILITY/commitment-digest.jsonl
 *
 * Read-only over the ledger. Always exits 0; failures log but never propagate.
 */

import { existsSync, mkdirSync, appendFileSync } from "fs";
import { join } from "path";
import { loadWorkConfig } from "../../hooks/lib/work-config";
import { daysUntil, filterItems, ledgerPath, readLedger, type WorkItem } from "./lib/work-ledger";
import { homedir } from "node:os";

// Normalize env path vars that Claude Code injects without shell expansion (WorkOS#1404)
for (const k of ["WORKOS_DIR", "WORKOS_CONFIG_DIR", "PROJECTS_DIR"]) {
  const v = process.env[k];
  if (v && /^\$\{?HOME\}?(\/|$)/.test(v)) process.env[k] = v.replace(/^\$\{?HOME\}?/, process.env.HOME ?? "~");
}


const HOME = process.env.HOME ?? process.env.USERPROFILE ?? homedir();
const WORKOS_DIR = process.env.WORKOS_DIR || join(HOME, ".claude", "WORKOS");
const OBS_DIR = join(WORKOS_DIR, "MEMORY", "OBSERVABILITY");
const OBS_LOG = join(OBS_DIR, "commitment-digest.jsonl");

interface Commitment {
  id: string;
  title: string;
  due: string;            // YYYY-MM-DD
  beneficiary: string;
  daysUntilDue: number;   // negative if overdue
  bucket: "overdue" | "due_today" | "due_this_week" | "future";
}

interface Digest {
  ts: string;
  ledger: string;
  total_open: number;
  overdue: Commitment[];
  due_today: Commitment[];
  due_this_week: Commitment[];
  future: Commitment[];
  errors: string[];
}

/** CommitmentLog titles items "<beneficiary>: <promise>". */
function beneficiaryOf(item: WorkItem): string {
  const i = item.title.indexOf(": ");
  return i > 0 ? item.title.slice(0, i) : "(unknown)";
}

function bucket(daysUntilDue: number): Commitment["bucket"] {
  if (daysUntilDue < 0) return "overdue";
  if (daysUntilDue === 0) return "due_today";
  if (daysUntilDue <= 7) return "due_this_week";
  return "future";
}

/** Pure: bucket open commitment items against `now`. */
export function bucketCommitments(items: WorkItem[], now: Date, errors: string[] = []): Omit<Digest, "ts" | "ledger" | "total_open" | "errors"> {
  const out = { overdue: [] as Commitment[], due_today: [] as Commitment[], due_this_week: [] as Commitment[], future: [] as Commitment[] };
  for (const item of items) {
    if (!item.due) {
      errors.push(`${item.id}: no due date`);
      continue;
    }
    const daysUntilDue = daysUntil(item.due, now);
    const c: Commitment = {
      id: item.id,
      title: item.title,
      due: item.due,
      beneficiary: beneficiaryOf(item),
      daysUntilDue,
      bucket: bucket(daysUntilDue),
    };
    out[c.bucket].push(c);
  }
  out.overdue.sort((a, b) => a.daysUntilDue - b.daysUntilDue);
  out.due_this_week.sort((a, b) => a.daysUntilDue - b.daysUntilDue);
  return out;
}

function renderDigestLine(digest: Digest): string {
  const od = digest.overdue.length;
  const dt = digest.due_today.length;
  if (od === 0 && dt === 0) return "";

  const parts: string[] = [];
  if (od > 0) {
    parts.push(`${od} ${od === 1 ? "commitment is" : "commitments are"} overdue`);
  }
  if (dt > 0) {
    parts.push(`${dt} ${dt === 1 ? "commitment" : "commitments"} due today`);
  }
  const head = parts.join(", and ");

  const named = [...digest.overdue, ...digest.due_today].slice(0, 3)
    .map((c) => `${c.beneficiary} — ${c.title.replace(/^[^:]+:\s*/, "")}`)
    .join("; ");
  const tail = named ? `. Top items: ${named}.` : ".";
  return `Commitments digest: ${head}${tail}`;
}

async function main() {
  const args = process.argv.slice(2);
  const dryRun = args.includes("--dry-run");

  mkdirSync(OBS_DIR, { recursive: true });

  const cfg = loadWorkConfig();
  const ts = new Date().toISOString();
  const digest: Digest = {
    ts,
    ledger: ledgerPath(),
    total_open: 0,
    overdue: [],
    due_today: [],
    due_this_week: [],
    future: [],
    errors: [],
  };

  if (!cfg.enabled) {
    digest.errors.push(`work_config_disabled: ${cfg.reason || "unknown"}`);
    appendFileSync(OBS_LOG, JSON.stringify(digest) + "\n");
    console.error(`[CommitmentSweep] disabled: ${cfg.reason}`);
    process.exit(0);
  }

  const { items, corrupt } = readLedger();
  if (corrupt) digest.errors.push(`ledger: skipped ${corrupt} corrupt line(s)`);
  const open = filterItems(items, { type: "commitment" });
  digest.total_open = open.length;
  Object.assign(digest, bucketCommitments(open, new Date(), digest.errors));

  const digestLine = renderDigestLine(digest);

  if (!dryRun) appendFileSync(OBS_LOG, JSON.stringify(digest) + "\n");

  // Human-readable stdout
  console.log(
    `[CommitmentSweep] total=${digest.total_open} ` +
    `overdue=${digest.overdue.length} today=${digest.due_today.length} ` +
    `week=${digest.due_this_week.length} future=${digest.future.length} ` +
    `errors=${digest.errors.length}`,
  );
  if (digestLine) console.log(`[CommitmentSweep] ${digestLine}`);
  process.exit(0);
}

if (import.meta.main) {
  main().catch((err) => {
    console.error(`[CommitmentSweep] Fatal: ${String(err)}`);
    process.exit(0);
  });
}
