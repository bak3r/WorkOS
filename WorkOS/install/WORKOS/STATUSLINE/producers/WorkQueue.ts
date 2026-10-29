import { join } from "node:path";
import { readJson } from "../Cache";
import { object, type State } from "../State";
import { daysUntil, isClosed, readLedger, type WorkItem } from "../../TOOLS/lib/work-ledger";

/** What the WORK row draws: the local ledger's open work, plus the read-only GitLab and Jira counts WorkContext cached. */
export interface WorkQueue {
  /** Open ledger items, ideas excluded. */
  open: number;
  active: number;
  /** P0/P1 open work. */
  urgent: number;
  /** Open items due today or earlier. */
  due: number;
  /** Merge requests you authored, merge requests waiting on your review, Jira tickets in open sprints; null when WorkContext has no cache. */
  mrs: number | null;
  reviews: number | null;
  tickets: number | null;
  /** Age in seconds of the WorkContext cache, or null without one. */
  contextAge: number | null;
  /** The item to work next: P0 before P1, in-progress before queued, then the oldest. */
  next: { id: string; title: string } | null;
}

/** Counts from the ledger items and the WorkContext cache. Pure, so the test feeds it fixtures. */
export function summarize(items: WorkItem[], context: Record<string, unknown> | null, now: Date): WorkQueue {
  const work = items.filter((i) => !isClosed(i) && i.type !== "idea");
  const rank = (i: WorkItem): number => i.priority === "P0" ? 0 : i.priority === "P1" ? 1 : 2;
  const urgent = work.filter((i) => rank(i) < 2);
  const active = work.filter((i) => i.status === "in-progress");
  const pick = [...work].sort((a, b) => rank(a) - rank(b) || Number(b.status === "in-progress") - Number(a.status === "in-progress") || Date.parse(a.created) - Date.parse(b.created))
    .find((i) => rank(i) < 2 || i.status === "in-progress");
  const ctxItems = context ? object(context.items) : null;
  const len = (v: unknown): number | null => (Array.isArray(v) ? v.length : null);
  const fetched = context && typeof context.fetched_at === "string" ? Date.parse(context.fetched_at) : NaN;
  return {
    open: work.length,
    active: active.length,
    urgent: urgent.length,
    due: work.filter((i) => typeof i.due === "string" && daysUntil(i.due, now) <= 0).length,
    mrs: ctxItems ? len(ctxItems.mrs_authored) : null,
    reviews: ctxItems ? len(ctxItems.mrs_reviewing) : null,
    tickets: ctxItems ? len(ctxItems.jira) : null,
    contextAge: Number.isFinite(fetched) ? Math.max(0, Math.floor((now.getTime() - fetched) / 1000)) : null,
    next: pick ? { id: pick.id, title: pick.title } : null,
  };
}

/** The live view: two local reads, no process and no network. Null when neither the ledger nor the cache has anything to say. */
export function workQueue(state: State): WorkQueue | null {
  const { items } = readLedger(join(state.root, "USER", "WORK", "ledger.jsonl"));
  const raw = readJson(join(state.root, "MEMORY", "STATE", "work-context.json"));
  const context = raw === null ? null : object(raw);
  if (!items.length && !context) return null;
  return summarize(items, context, new Date(state.nowMs));
}
