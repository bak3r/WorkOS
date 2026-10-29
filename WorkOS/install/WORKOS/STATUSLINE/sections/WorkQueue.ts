import { join } from "node:path";
import { GLYPHS, icon } from "../Glyphs";
import { BAND, C, RESET, band, rgb } from "../Ansi";
import { readLastLine } from "../Cache";
import { object, string, type State } from "../State";
import { cellWidth, ellipsize, fit, pack, type Segment } from "../Width";
import { workQueue } from "../producers/WorkQueue";

const NUM = rgb(219, 234, 254), WORD = C.slate400, AMBER = rgb(251, 191, 36), RED = rgb(239, 68, 68), SEP = ` ${C.slate600}│${RESET} `;
/** A WorkContext cache older than this is marked stale; LoadContext refreshes it at session start after 15 minutes. */
const CONTEXT_STALE_S = 4 * 3600;

/** "2h" or "45m". */
const ago = (seconds: number): string => seconds >= 3600 ? `${Math.floor(seconds / 3600)}h` : `${Math.floor(seconds / 60)}m`;

/** A coloured glyph, a count, and its word; the second form drops the word. */
function count(name: keyof typeof GLYPHS | null, value: number, word: string, group: number, rank: number, color = NUM): Segment {
  const g = name ? `${GLYPHS[name].color}${GLYPHS[name].glyph}${RESET} ` : "";
  const n = `${g}${color}${value}${RESET}`;
  return { group, rank, forms: [`${n} ${WORD}${word}${RESET}`, n] };
}

/** The row label: the glyph and the name, then the glyph alone. */
const tag = (glyph: keyof typeof GLYPHS, name: string): Segment => ({ group: 0, rank: 50, forms: [`${icon(glyph)}${WORD}${name}${RESET}`, `${GLYPHS[glyph].color}${GLYPHS[glyph].glyph}${RESET}`] });

/** `→ title` in whatever room the packed row leaves, cut at a word; nothing when the title cannot keep 12 cells. */
function withTail(row: string, width: number, next: { id: string; title: string } | null): string {
  if (!next?.title) return row;
  const left = width - cellWidth(row) - cellWidth(SEP) - 2;
  return left >= 12 ? `${row}${SEP}${NUM}→${RESET} ${C.region}${ellipsize(next.title, left)}${RESET}` : row;
}

/**
 * The WORK row: open ledger work (Active, Urgent P0/P1, Due, Open), then the read-only GitLab and Jira counts
 * (MRs you authored, reviews waiting on you, tickets in open sprints), then the item to work next. No row before
 * either source has anything; the GitLab/Jira half is left out when WorkContext has never run.
 */
export function renderWorkQueue(state: State): string {
  if (state.geometry.phone) return "";
  const q = workQueue(state);
  if (!q) return "";
  const width = state.geometry.content;
  const external: Segment[] = q.mrs === null ? [] : [
    count(null, q.mrs, "MRs", 1, 3),
    count(null, q.reviews ?? 0, "Review", 1, 4, (q.reviews ?? 0) > 0 ? AMBER : NUM),
    count(null, q.tickets ?? 0, "Jira", 1, 2),
    ...(q.contextAge !== null && q.contextAge > CONTEXT_STALE_S ? [{ group: 9, rank: 99, forms: [`${C.slate500}Stale ${ago(q.contextAge)}${RESET}`, ""] }] : []),
  ];
  const row = pack(width, [
    tag("work", "WORK"),
    count("active", q.active, "Active", 0, 5),
    count("hot", q.urgent, "Urgent", 0, 4),
    ...(q.due > 0 ? [count(null, q.due, "Due", 0, 6, RED)] : []),
    count(null, q.open, "Open", 0, 1),
    ...external,
  ], SEP);
  return band(withTail(row, width, q.next), width, BAND.work) + "\n";
}

/**
 * One line, only when the memory health gate's last observation asks for something: its first critical action in red,
 * else its first warning in amber. The log is append-only and grows without bound, so only its last line is read.
 */
export function renderAttention(state: State): string {
  if (state.geometry.phone) return "";
  const line = readLastLine(join(state.root, "MEMORY", "OBSERVABILITY", "memory-health.jsonl"));
  let health: Record<string, unknown> = {};
  try { health = object(JSON.parse(line || "{}")); } catch { return ""; }
  let action = "", color = AMBER;
  for (const value of Array.isArray(health.actions) ? health.actions : []) {
    const item = object(value), text = string(item.text).replace(/\x1b/g, "");
    if (!text) continue;
    if (item.severity === "critical") { action = text; color = RED; break; }
    if (!action) action = text;
  }
  if (!action) return "";
  const width = state.geometry.content;
  const head = `${icon("state")}${WORD}${state.geometry.density === 3 ? "MEMORY:" : "MEM"}${RESET} ${rgb(219, 234, 254)}→${RESET} `;
  const room = width - cellWidth(head);
  return band(fit(width, `${head}${color}${action}${RESET}`, `${head}${color}${ellipsize(action, Math.max(8, room))}${RESET}`, `${color}${ellipsize(action, width)}${RESET}`), width, BAND.state) + "\n";
}
