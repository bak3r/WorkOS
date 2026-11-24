#!/usr/bin/env bun
/**
 * LearningLog.ts — the learning record behind the Explain skill. One JSONL row per
 * fundamentals explanation or graded quiz answer, at WORKOS/USER/LEARNING/learning.jsonl.
 * (Upstream keeps this as the STATVS `learning` stream; WorkOS has no STATVS.)
 *
 *   bun ~/.claude/WORKOS/TOOLS/LearningLog.ts append --kind explain|quiz --area <slug> \
 *     --title "<text>" --data '<json object>'
 *   bun ~/.claude/WORKOS/TOOLS/LearningLog.ts tail [--area <slug>] [--n 500]
 *
 * Append-only: no command edits or removes a row. `tail` prints rows as JSONL, oldest first.
 * Exits 1 on a usage error, 2 when the record cannot be read or written.
 */

import { appendFileSync, existsSync, mkdirSync, readFileSync } from "fs";
import { dirname } from "path";
import { workosPath } from "./Paths";

export const KINDS = ["explain", "quiz"] as const;
export type Kind = (typeof KINDS)[number];

export interface LearningRow {
  ts: string;
  kind: Kind;
  area: string;
  title: string;
  data: Record<string, unknown>;
}

export function learningPath(): string {
  return process.env.WORKOS_LEARNING_FILE || workosPath("USER", "LEARNING", "learning.jsonl");
}

const SLUG = /^[a-z0-9]+(?:-[a-z0-9]+)*$/;

export function buildRow(kind: string, area: string, title: string, dataJson: string, now = new Date()): LearningRow {
  if (!(KINDS as readonly string[]).includes(kind)) throw new Error(`--kind must be one of ${KINDS.join("|")}, got "${kind}"`);
  if (!SLUG.test(area)) throw new Error(`--area must be a lowercase-hyphen slug, got "${area}"`);
  if (!title.trim()) throw new Error("--title is required");
  let data: unknown;
  try {
    data = JSON.parse(dataJson || "{}");
  } catch {
    throw new Error("--data must be valid JSON");
  }
  if (!data || typeof data !== "object" || Array.isArray(data)) throw new Error("--data must be a JSON object");
  return { ts: now.toISOString(), kind: kind as Kind, area, title, data: data as Record<string, unknown> };
}

export function appendRow(row: LearningRow, path = learningPath()): void {
  mkdirSync(dirname(path), { recursive: true });
  appendFileSync(path, JSON.stringify(row) + "\n", { mode: 0o600 });
}

export function readRows(path = learningPath()): LearningRow[] {
  if (!existsSync(path)) return [];
  const rows: LearningRow[] = [];
  for (const line of readFileSync(path, "utf8").split("\n")) {
    if (!line.trim()) continue;
    try {
      rows.push(JSON.parse(line));
    } catch {
      // A torn last line from a crashed append; skip it rather than fail the whole read.
    }
  }
  return rows;
}

export function tailRows(rows: LearningRow[], area: string | undefined, n: number): LearningRow[] {
  const picked = area ? rows.filter((r) => r.area === area) : rows;
  return picked.slice(-n);
}

function main(): void {
  const [cmd, ...argv] = process.argv.slice(2);
  const get = (flag: string, fallback = ""): string => {
    const idx = argv.indexOf(flag);
    return idx >= 0 && argv[idx + 1] !== undefined ? argv[idx + 1] : fallback;
  };
  const usage = "usage: LearningLog.ts append --kind explain|quiz --area <slug> --title <text> --data <json> | tail [--area <slug>] [--n N]";

  if (cmd === "append") {
    let row: LearningRow;
    try {
      row = buildRow(get("--kind"), get("--area"), get("--title"), get("--data", "{}"));
    } catch (e) {
      console.error(`LearningLog: ${(e as Error).message}\n${usage}`);
      process.exit(1);
    }
    try {
      appendRow(row);
    } catch (e) {
      console.error(`LearningLog: cannot write ${learningPath()}: ${(e as Error).message}`);
      process.exit(2);
    }
    console.log(JSON.stringify(row));
    return;
  }

  if (cmd === "tail") {
    const n = Number(get("--n", "500"));
    if (!Number.isInteger(n) || n < 1) {
      console.error(`LearningLog: --n must be a positive integer\n${usage}`);
      process.exit(1);
    }
    let rows: LearningRow[];
    try {
      rows = readRows();
    } catch (e) {
      console.error(`LearningLog: cannot read ${learningPath()}: ${(e as Error).message}`);
      process.exit(2);
    }
    for (const r of tailRows(rows, get("--area") || undefined, n)) console.log(JSON.stringify(r));
    return;
  }

  console.error(usage);
  process.exit(1);
}

if (import.meta.main) main();
