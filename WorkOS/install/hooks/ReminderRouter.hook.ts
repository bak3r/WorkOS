#!/usr/bin/env bun
/**
 * @version 2.0.0
 * ReminderRouter.hook.ts — UserPromptSubmit hook
 *
 * Parses the incoming prompt for narrow, precision-biased reminder/research/queue
 * intent. When the prompt clearly says "remind me to X" / "research the Y paper" /
 * "queue this for later", the hook appends one item to the local work ledger
 * (WORKOS/USER/WORK/ledger.jsonl) and re-renders TASKLIST.md. Non-matching
 * prompts incur a single regex test and exit immediately — no measurable added
 * latency on the common path.
 *
 * Design contract:
 *   - PRECISION over recall. We accept false negatives (missed soft hints) before
 *     we accept false positives (a normal coding question turning into an item).
 *   - Idempotent: same prompt text hashed → routed once per session, and the
 *     ledger slug (kind + normalized subject) keeps one open item across sessions.
 *   - Always exit 0; never block the prompt. The reminder is a side effect.
 *   - Skip silently when the ledger or reminder capture is disabled in config.
 *
 * The item body includes the original prompt verbatim; a parsed relative date
 * becomes the item's `due`.
 */

import { existsSync, readFileSync, writeFileSync, mkdirSync } from "fs";
import { createHash } from "crypto";
import { join, dirname } from "path";
import { loadWorkConfig } from "./lib/work-config";
import { addItem, writeTasklist, type NewItem } from "../WORKOS/TOOLS/lib/work-ledger";
import { getWorkosDir } from "./lib/paths";

const STATE_PATH = join(getWorkosDir(), "MEMORY", "STATE", "reminder-router-seen.json");

interface HookInput {
  session_id?: string;
  prompt?: string;
  message?: { content?: string };
}

export interface RouteMatch {
  kind: "reminder" | "research" | "queue";
  imperative: string;       // the raw matched phrase
  remainder: string;        // what comes after the trigger
  dueIso?: string;          // ISO date if a relative time was parsed
}

// ── Precision triggers ──────────────────────────────────────────────────────
// Each entry: a regex that MUST match very explicit imperative shape.
// The patterns require the hook to see one of these at a line boundary
// (start of prompt or after newline) — never mid-sentence.

const TRIGGERS: Array<{ kind: RouteMatch["kind"]; re: RegExp }> = [
  { kind: "reminder", re: /(?:^|\n)\s*(remind me to)\s+(.+)$/im },
  { kind: "reminder", re: /(?:^|\n)\s*(remind me about)\s+(.+)$/im },
  { kind: "reminder", re: /(?:^|\n)\s*(set a reminder (?:to|for|about))\s+(.+)$/im },
  { kind: "reminder", re: /(?:^|\n)\s*(add a reminder to)\s+(.+)$/im },
  { kind: "reminder", re: /(?:^|\n)\s*(remember to)\s+(.+)$/im },
  { kind: "research", re: /(?:^|\n)\s*(research the)\s+(.+)$/im },
  { kind: "research", re: /(?:^|\n)\s*(research this[:,]?)\s+(.+)$/im },
  { kind: "research", re: /(?:^|\n)\s*(we should research)\s+(.+)$/im },
  { kind: "queue",    re: /(?:^|\n)\s*(queue (?:this|that) (?:for|as))\s+(.+)$/im },
  { kind: "queue",    re: /(?:^|\n)\s*(add (?:this|that) to (?:my|the) (?:queue|todo|backlog))\b\s*(.+)?$/im },
  { kind: "queue",    re: /(?:^|\n)\s*(we should do)\s+(.+?)\s+later\.?\s*$/im },
];

export function detectIntent(prompt: string): RouteMatch | null {
  for (const t of TRIGGERS) {
    const m = prompt.match(t.re);
    if (m) {
      return {
        kind: t.kind,
        imperative: m[1].trim(),
        remainder: (m[2] || "").trim(),
      };
    }
  }
  return null;
}

// ── Tiny relative-date parser ───────────────────────────────────────────────
// Returns ISO YYYY-MM-DD when the remainder names a recognizable relative day.

const DAY_NAMES = [
  "sunday", "monday", "tuesday", "wednesday", "thursday", "friday", "saturday",
];

export function parseRelativeDate(text: string, now = new Date()): string | undefined {
  const t = text.toLowerCase();

  if (/\btoday\b/.test(t)) return iso(now);
  if (/\btomorrow\b/.test(t)) return iso(addDays(now, 1));

  const inN = t.match(/\bin (\d+) days?\b/);
  if (inN) return iso(addDays(now, parseInt(inN[1], 10)));

  const inWeeks = t.match(/\bin (\d+) weeks?\b/);
  if (inWeeks) return iso(addDays(now, parseInt(inWeeks[1], 10) * 7));

  // "next Thursday" or just "Thursday"
  const next = t.match(/\bnext\s+(sunday|monday|tuesday|wednesday|thursday|friday|saturday)\b/);
  if (next) return iso(nextWeekday(now, DAY_NAMES.indexOf(next[1]), true));

  for (const d of DAY_NAMES) {
    const re = new RegExp(`\\b${d}\\b`);
    if (re.test(t)) return iso(nextWeekday(now, DAY_NAMES.indexOf(d), false));
  }

  return undefined;
}

function addDays(d: Date, n: number): Date {
  const r = new Date(d);
  r.setDate(r.getDate() + n);
  return r;
}

function nextWeekday(now: Date, target: number, forceNextWeek: boolean): Date {
  let delta = (target - now.getDay() + 7) % 7;
  if (delta === 0 || forceNextWeek) delta = forceNextWeek ? (delta === 0 ? 7 : delta + 7) : 7;
  return addDays(now, delta);
}

function iso(d: Date): string {
  return d.toISOString().slice(0, 10);
}

// ── Session-scoped idempotency ──────────────────────────────────────────────

function alreadyRouted(sessionId: string, promptHash: string): boolean {
  if (!existsSync(STATE_PATH)) return false;
  try {
    const data = JSON.parse(readFileSync(STATE_PATH, "utf-8")) as Record<string, string[]>;
    return (data[sessionId] || []).includes(promptHash);
  } catch {
    return false;
  }
}

function markRouted(sessionId: string, promptHash: string): void {
  let data: Record<string, string[]> = {};
  if (existsSync(STATE_PATH)) {
    try {
      data = JSON.parse(readFileSync(STATE_PATH, "utf-8"));
    } catch {
      data = {};
    }
  }
  if (!data[sessionId]) data[sessionId] = [];
  data[sessionId].push(promptHash);
  // Cap: keep last 64 hashes per session.
  if (data[sessionId].length > 64) data[sessionId] = data[sessionId].slice(-64);
  mkdirSync(dirname(STATE_PATH), { recursive: true });
  writeFileSync(STATE_PATH, JSON.stringify(data));
}

// ── Ledger item ─────────────────────────────────────────────────────────────

/**
 * Pure: the ledger item a matched prompt becomes. The slug hashes the
 * normalized subject, so the same request typed twice (any session) maps to
 * the one open item instead of a second copy.
 */
export function buildLedgerItem(match: RouteMatch, prompt: string): NewItem {
  const subjectRaw = match.remainder || prompt.slice(0, 80);
  const subject = subjectRaw.replace(/\s+/g, " ").trim().slice(0, 96);
  const norm = subject.toLowerCase().replace(/[^a-z0-9 ]/g, "").replace(/\s+/g, " ").trim();
  const slug = `${match.kind}:${createHash("sha1").update(norm).digest("hex").slice(0, 16)}`;
  const body = [
    `Trigger: \`${match.imperative}\``,
    "",
    "Original prompt:",
    "",
    "```",
    prompt.trim(),
    "```",
  ].join("\n");
  return {
    type: match.kind,
    title: subject,
    body,
    status: "queued",
    priority: "P3",
    source: "reminder-router",
    slug,
    ...(match.dueIso ? { due: match.dueIso } : {}),
  };
}

// ── Main ────────────────────────────────────────────────────────────────────

async function main(): Promise<void> {
  const cfg = loadWorkConfig();
  if (!cfg.enabled || !cfg.captureReminders) process.exit(0);

  let input: HookInput;
  try {
    input = JSON.parse(readFileSync("/dev/stdin", "utf-8"));
  } catch {
    process.exit(0);
  }

  const prompt = (input.prompt || input.message?.content || "").trim();
  if (!prompt) process.exit(0);

  const match = detectIntent(prompt);
  if (!match) process.exit(0);

  match.dueIso = parseRelativeDate(match.remainder);

  const sessionId = input.session_id || "no-session";
  const promptHash = createHash("sha1").update(prompt).digest("hex").slice(0, 16);
  if (alreadyRouted(sessionId, promptHash)) {
    process.exit(0);
  }
  markRouted(sessionId, promptHash);

  const { item, created } = addItem(buildLedgerItem(match, prompt));
  if (created) writeTasklist(cfg.kanbanStatuses);

  console.error(`[ReminderRouter] ${created ? "routed" : "already open"} ${match.kind} → ledger ${item.id}: ${item.title}`);
  process.exit(0);
}

if (import.meta.main) {
  main().catch((err) => {
    console.error(`[ReminderRouter] Fatal: ${err}`);
    process.exit(0);
  });
}
