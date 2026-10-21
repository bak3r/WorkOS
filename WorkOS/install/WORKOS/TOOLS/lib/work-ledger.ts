/**
 * work-ledger.ts — the Work System's system of record: a local, append-only ledger.
 *
 * Storage: WORKOS/USER/WORK/ledger.jsonl — one JSON event per line
 * (create | update | close), appended with a single O_APPEND write per event.
 * Current state is the fold of the log in file order. The rendered view is
 * WORKOS/USER/WORK/TASKLIST.md, rewritten only when its content changes.
 *
 * Jira and GitLab are READ-ONLY context elsewhere (WorkContext.ts). Nothing in
 * this module talks to either; links.jira / links.mr only record references.
 *
 * Invariants:
 *   - Reads never throw. A corrupt line is skipped and counted.
 *   - `slug` is the idempotency key: unique among non-closed items. addItem()
 *     with the slug of an open item returns that item instead of creating one.
 *   - fold / filter / render are pure (no clocks, no IO) so they are unit-testable.
 */

import { appendFileSync, closeSync, existsSync, mkdirSync, openSync, readFileSync, readSync, rmSync, statSync } from "node:fs";
import { dirname, join } from "node:path";
import { randomBytes } from "node:crypto";
import { getWorkosDir } from "../../../hooks/lib/paths";
import { atomicWriteText } from "./atomic-write";

export const ITEM_TYPES = [
  "task", "reminder", "research", "queue", "session", "project-check", "goal", "commitment", "idea",
] as const;
export const ITEM_STATUSES = [
  "queued", "ready", "in-progress", "blocked", "in-review", "done", "dropped",
] as const;
export const ITEM_SOURCES = ["manual", "reminder-router", "worksweep", "commitment", "distill"] as const;
export const PRIORITIES = ["P0", "P1", "P2", "P3"] as const;
export const CLOSED_STATUSES = ["done", "dropped"];
/** TASKLIST section order when config does not name one. */
export const DEFAULT_RENDER_STATUSES = ["in-progress", "blocked", "in-review", "ready", "queued"];

export type ItemType = (typeof ITEM_TYPES)[number];
export type ItemStatus = (typeof ITEM_STATUSES)[number];
export type ItemSource = (typeof ITEM_SOURCES)[number];
export type Priority = (typeof PRIORITIES)[number];

export interface ItemLinks {
  jira: string[];
  mr: string[];
  isa?: string;
  branch?: string;
  project?: string;
}

export interface WorkItem {
  id: string;
  type: ItemType;
  title: string;
  body: string;
  status: ItemStatus;
  priority?: Priority;
  labels: string[];
  source: ItemSource;
  slug?: string;
  links: ItemLinks;
  due?: string;
  created: string;
  updated: string;
  closed?: string;
}

/** Scalar fields an update may set. `null` clears an optional field. */
export interface ItemPatch {
  title?: string;
  body?: string;
  status?: ItemStatus;
  priority?: Priority | null;
  due?: string | null;
  isa?: string | null;
  branch?: string | null;
  project?: string | null;
}

export type LedgerEvent =
  | { v: 1; ts: string; op: "create"; id: string; item: Omit<WorkItem, "id" | "created" | "updated" | "closed"> }
  | {
      v: 1; ts: string; op: "update"; id: string;
      set?: ItemPatch;
      labels_add?: string[]; labels_remove?: string[];
      jira_add?: string[]; mr_add?: string[];
    }
  | { v: 1; ts: string; op: "close"; id: string; status: "done" | "dropped"; note?: string };

export interface LedgerState {
  items: WorkItem[];
  /** Unparseable or structurally invalid lines skipped during the read. */
  corrupt: number;
}

// ── Paths ────────────────────────────────────────────────────────────────────

export function ledgerPath(): string {
  return join(getWorkosDir(), "USER", "WORK", "ledger.jsonl");
}
export function tasklistPath(): string {
  return join(getWorkosDir(), "USER", "WORK", "TASKLIST.md");
}

// ── Validation helpers ───────────────────────────────────────────────────────

export const isItemType = (v: unknown): v is ItemType => ITEM_TYPES.includes(v as ItemType);
export const isItemStatus = (v: unknown): v is ItemStatus => ITEM_STATUSES.includes(v as ItemStatus);
export const isPriority = (v: unknown): v is Priority => PRIORITIES.includes(v as Priority);
export const isIsoDate = (v: unknown): v is string =>
  typeof v === "string" && /^\d{4}-\d{2}-\d{2}$/.test(v) && !Number.isNaN(Date.parse(v));
export const isClosed = (item: WorkItem): boolean => CLOSED_STATUSES.includes(item.status);

const uniq = (xs: string[]): string[] => [...new Set(xs.filter((x) => typeof x === "string" && x.length > 0))];

// ── Pure core ────────────────────────────────────────────────────────────────

/** Parse raw log text. Every unparseable or shapeless line is skipped and counted. */
export function parseLedger(raw: string): { events: LedgerEvent[]; corrupt: number } {
  const events: LedgerEvent[] = [];
  let corrupt = 0;
  for (const line of raw.split("\n")) {
    if (!line.trim()) continue;
    try {
      const ev = JSON.parse(line);
      if (ev && typeof ev === "object" && typeof ev.id === "string" && ["create", "update", "close"].includes(ev.op)) {
        events.push(ev as LedgerEvent);
      } else {
        corrupt++;
      }
    } catch {
      corrupt++;
    }
  }
  return { events, corrupt };
}

/**
 * Fold events (file order) into current items. Pure; never consults a clock.
 * A duplicate create, or an update/close for an unknown id, is ignored and
 * counted as corrupt — it can only come from a hand edit or a torn write.
 */
export function foldLedger(events: LedgerEvent[]): LedgerState {
  const byId = new Map<string, WorkItem>();
  let corrupt = 0;
  for (const ev of events) {
    if (ev.op === "create") {
      if (byId.has(ev.id) || !ev.item || typeof ev.item.title !== "string") { corrupt++; continue; }
      const it = ev.item;
      byId.set(ev.id, {
        id: ev.id,
        type: isItemType(it.type) ? it.type : "task",
        title: it.title,
        body: typeof it.body === "string" ? it.body : "",
        status: isItemStatus(it.status) ? it.status : "queued",
        ...(isPriority(it.priority) ? { priority: it.priority } : {}),
        labels: uniq(Array.isArray(it.labels) ? it.labels : []),
        source: ITEM_SOURCES.includes(it.source as ItemSource) ? it.source : "manual",
        ...(it.slug ? { slug: it.slug } : {}),
        links: {
          jira: uniq(it.links?.jira ?? []),
          mr: uniq(it.links?.mr ?? []),
          ...(it.links?.isa ? { isa: it.links.isa } : {}),
          ...(it.links?.branch ? { branch: it.links.branch } : {}),
          ...(it.links?.project ? { project: it.links.project } : {}),
        },
        ...(isIsoDate(it.due) ? { due: it.due } : {}),
        created: ev.ts,
        updated: ev.ts,
        ...(isClosed({ status: it.status } as WorkItem) ? { closed: ev.ts } : {}),
      });
      continue;
    }
    const cur = byId.get(ev.id);
    if (!cur) { corrupt++; continue; }
    const next: WorkItem = { ...cur, labels: [...cur.labels], links: { ...cur.links, jira: [...cur.links.jira], mr: [...cur.links.mr] } };
    if (ev.op === "close") {
      next.status = ev.status === "dropped" ? "dropped" : "done";
      next.closed = ev.ts;
      if (ev.note) next.body = next.body ? `${next.body}\n\nClosed: ${ev.note}` : `Closed: ${ev.note}`;
    } else {
      const s = ev.set ?? {};
      if (typeof s.title === "string" && s.title) next.title = s.title;
      if (typeof s.body === "string") next.body = s.body;
      if (isItemStatus(s.status)) {
        next.status = s.status;
        if (isClosed(next)) next.closed = next.closed ?? ev.ts;
        else delete next.closed;
      }
      if (s.priority === null) delete next.priority;
      else if (isPriority(s.priority)) next.priority = s.priority;
      if (s.due === null) delete next.due;
      else if (isIsoDate(s.due)) next.due = s.due;
      for (const k of ["isa", "branch", "project"] as const) {
        if (s[k] === null) delete next.links[k];
        else if (typeof s[k] === "string" && s[k]) next.links[k] = s[k] as string;
      }
      const remove = new Set(ev.labels_remove ?? []);
      next.labels = uniq([...next.labels.filter((l) => !remove.has(l)), ...(ev.labels_add ?? [])]);
      next.links.jira = uniq([...next.links.jira, ...(ev.jira_add ?? [])]);
      next.links.mr = uniq([...next.links.mr, ...(ev.mr_add ?? [])]);
    }
    next.updated = ev.ts;
    byId.set(ev.id, next);
  }
  return { items: [...byId.values()], corrupt };
}

export interface ItemFilter {
  status?: string;
  type?: string;
  label?: string;
  /** Default false: closed items are hidden unless status asks for one. */
  includeClosed?: boolean;
}

export function filterItems(items: WorkItem[], f: ItemFilter = {}): WorkItem[] {
  return items.filter((it) => {
    if (f.status && it.status !== f.status) return false;
    if (!f.status && !f.includeClosed && isClosed(it)) return false;
    if (f.type && it.type !== f.type) return false;
    if (f.label && !it.labels.includes(f.label)) return false;
    return true;
  });
}

/** The open item holding `slug`, if any. */
export function findOpenBySlug(items: WorkItem[], slug: string): WorkItem | undefined {
  return items.find((it) => it.slug === slug && !isClosed(it));
}

/** Whole days from `now` (local date) to an ISO date; negative = overdue. */
export function daysUntil(due: string, now: Date): number {
  const d = new Date(due + "T00:00:00");
  const today = new Date(now.getFullYear(), now.getMonth(), now.getDate());
  return Math.round((d.getTime() - today.getTime()) / 86_400_000);
}

function itemLine(it: WorkItem): string {
  const bits = [`\`${it.id}\``];
  if (it.priority) bits.push(`[${it.priority}]`);
  bits.push(it.title.replace(/\s+/g, " ").trim());
  const meta: string[] = [it.type];
  if (it.due) meta.push(`due ${it.due}`);
  if (it.links.jira.length) meta.push(it.links.jira.join(", "));
  if (it.links.mr.length) meta.push(`${it.links.mr.length} MR`);
  if (it.labels.length) meta.push(it.labels.map((l) => `#${l}`).join(" "));
  return `- [${isClosed(it) ? "x" : " "}] ${bits.join(" ")} — ${meta.join(" · ")}`;
}

const PRIORITY_RANK: Record<string, number> = { P0: 0, P1: 1, P2: 2, P3: 3 };

/**
 * Render TASKLIST.md. Deterministic from the items alone (no "generated at"
 * stamp), so an unchanged ledger renders byte-identical output.
 */
export function renderTasklist(items: WorkItem[], statuses: string[] = DEFAULT_RENDER_STATUSES, recentClosed = 20): string {
  const order = statuses.filter((s) => isItemStatus(s) && !CLOSED_STATUSES.includes(s));
  // Open statuses the config left out still render, after the configured ones.
  for (const s of ITEM_STATUSES) if (!CLOSED_STATUSES.includes(s) && !order.includes(s)) order.push(s);
  const sortOpen = (a: WorkItem, b: WorkItem) =>
    (a.due ?? "9999").localeCompare(b.due ?? "9999") ||
    (PRIORITY_RANK[a.priority ?? "P9"] ?? 9) - (PRIORITY_RANK[b.priority ?? "P9"] ?? 9) ||
    a.created.localeCompare(b.created) || a.id.localeCompare(b.id);

  const open = items.filter((it) => !isClosed(it));
  const out: string[] = [
    "# TASKLIST",
    "",
    "> Rendered from `ledger.jsonl` by WorkLedger.ts — do not edit by hand; edits are overwritten.",
    "> Change items with `bun WORKOS/TOOLS/WorkLedger.ts update|close <id>`.",
    "",
    `${open.length} open · ${items.length - open.length} closed`,
  ];
  for (const s of order) {
    const rows = open.filter((it) => it.status === s).sort(sortOpen);
    if (rows.length === 0) continue;
    out.push("", `## ${s} (${rows.length})`, "", ...rows.map(itemLine));
  }
  const closed = items
    .filter(isClosed)
    .sort((a, b) => (b.closed ?? "").localeCompare(a.closed ?? "") || a.id.localeCompare(b.id))
    .slice(0, recentClosed);
  if (closed.length) out.push("", `## recently closed (${closed.length})`, "", ...closed.map(itemLine));
  return out.join("\n") + "\n";
}

export function newItemId(now: Date, taken: Set<string>): string {
  const yy = String(now.getFullYear() % 100).padStart(2, "0");
  const mm = String(now.getMonth() + 1).padStart(2, "0");
  const dd = String(now.getDate()).padStart(2, "0");
  for (;;) {
    const id = `W-${yy}${mm}${dd}-${randomBytes(2).toString("hex")}`;
    if (!taken.has(id)) return id;
  }
}

// ── IO layer ─────────────────────────────────────────────────────────────────

/** Current ledger state. Never throws: a missing or unreadable file is empty. */
export function readLedger(path = ledgerPath()): LedgerState {
  let raw = "";
  try {
    raw = readFileSync(path, "utf-8");
  } catch {
    return { items: [], corrupt: 0 };
  }
  const parsed = parseLedger(raw);
  const folded = foldLedger(parsed.events);
  return { items: folded.items, corrupt: parsed.corrupt + folded.corrupt };
}

/** True when the file exists, is non-empty and does not end in a newline (a torn write). */
function hasTornTail(path: string): boolean {
  let fd: number | undefined;
  try {
    const size = statSync(path).size;
    if (size === 0) return false;
    fd = openSync(path, "r");
    const b = Buffer.alloc(1);
    readSync(fd, b, 0, 1, size - 1);
    return b[0] !== 0x0a;
  } catch {
    return false;
  } finally {
    if (fd !== undefined) try { closeSync(fd); } catch {}
  }
}

function appendEvent(ev: LedgerEvent, path: string): void {
  mkdirSync(dirname(path), { recursive: true });
  // One write call per event: O_APPEND places it atomically, so concurrent
  // writers never interleave inside a line. A torn tail gets a newline first,
  // so the crash leaves one corrupt line instead of eating this event too.
  appendFileSync(path, (hasTornTail(path) ? "\n" : "") + JSON.stringify(ev) + "\n");
}

const LOCK_STALE_MS = 10_000;

/**
 * mkdir lock around check-then-append, so two capture surfaces racing on the
 * same slug cannot both create. On a stuck lock we proceed after ~1s: a rare
 * duplicate beats a hook that hangs the prompt.
 */
function withLock<T>(path: string, fn: () => T): T {
  const lock = path + ".lock";
  let held = false;
  for (let i = 0; i < 50 && !held; i++) {
    try {
      mkdirSync(dirname(path), { recursive: true });
      mkdirSync(lock);
      held = true;
    } catch {
      try {
        if (Date.now() - statSync(lock).mtimeMs > LOCK_STALE_MS) rmSync(lock, { recursive: true, force: true });
      } catch {}
      Bun.sleepSync(20);
    }
  }
  try {
    return fn();
  } finally {
    if (held) try { rmSync(lock, { recursive: true, force: true }); } catch {}
  }
}

export interface NewItem {
  type: ItemType;
  title: string;
  body?: string;
  status?: ItemStatus;
  priority?: Priority;
  labels?: string[];
  source?: ItemSource;
  slug?: string;
  links?: Partial<ItemLinks>;
  due?: string;
}

/** Create an item, or return the open item that already holds `slug`. */
export function addItem(input: NewItem, path = ledgerPath(), now = new Date()): { item: WorkItem; created: boolean } {
  if (!isItemType(input.type)) throw new Error(`invalid type "${input.type}"`);
  if (!input.title || !input.title.trim()) throw new Error("title is required");
  if (input.status && !isItemStatus(input.status)) throw new Error(`invalid status "${input.status}"`);
  if (input.priority && !isPriority(input.priority)) throw new Error(`invalid priority "${input.priority}"`);
  if (input.due && !isIsoDate(input.due)) throw new Error(`invalid due "${input.due}" (want YYYY-MM-DD)`);
  return withLock(path, () => {
    const { items } = readLedger(path);
    if (input.slug) {
      const existing = findOpenBySlug(items, input.slug);
      if (existing) return { item: existing, created: false };
    }
    const id = newItemId(now, new Set(items.map((i) => i.id)));
    const ev: LedgerEvent = {
      v: 1, ts: now.toISOString(), op: "create", id,
      item: {
        type: input.type,
        title: input.title.trim(),
        body: input.body ?? "",
        status: input.status ?? "queued",
        ...(input.priority ? { priority: input.priority } : {}),
        labels: uniq(input.labels ?? []),
        source: input.source ?? "manual",
        ...(input.slug ? { slug: input.slug } : {}),
        links: { jira: uniq(input.links?.jira ?? []), mr: uniq(input.links?.mr ?? []),
          ...(input.links?.isa ? { isa: input.links.isa } : {}),
          ...(input.links?.branch ? { branch: input.links.branch } : {}),
          ...(input.links?.project ? { project: input.links.project } : {}) },
        ...(input.due ? { due: input.due } : {}),
      },
    };
    appendEvent(ev, path);
    return { item: foldLedger([ev]).items[0], created: true };
  });
}

export interface ItemUpdate {
  set?: ItemPatch;
  labels_add?: string[];
  labels_remove?: string[];
  jira_add?: string[];
  mr_add?: string[];
}

/** Apply an update to an existing item. Returns null when the id is unknown. */
export function updateItem(id: string, u: ItemUpdate, path = ledgerPath(), now = new Date()): WorkItem | null {
  const s = u.set ?? {};
  if (s.status !== undefined && !isItemStatus(s.status)) throw new Error(`invalid status "${s.status}"`);
  if (s.priority != null && !isPriority(s.priority)) throw new Error(`invalid priority "${s.priority}"`);
  if (s.due != null && !isIsoDate(s.due)) throw new Error(`invalid due "${s.due}" (want YYYY-MM-DD)`);
  return withLock(path, () => {
    const { items } = readLedger(path);
    if (!items.some((i) => i.id === id)) return null;
    const ev: LedgerEvent = { v: 1, ts: now.toISOString(), op: "update", id, ...u };
    appendEvent(ev, path);
    return readLedger(path).items.find((i) => i.id === id) ?? null;
  });
}

/** Close an item as done (default) or dropped. Returns null when the id is unknown. */
export function closeItem(id: string, opts: { status?: "done" | "dropped"; note?: string } = {}, path = ledgerPath(), now = new Date()): WorkItem | null {
  return withLock(path, () => {
    const { items } = readLedger(path);
    if (!items.some((i) => i.id === id)) return null;
    const ev: LedgerEvent = {
      v: 1, ts: now.toISOString(), op: "close", id, status: opts.status ?? "done",
      ...(opts.note ? { note: opts.note } : {}),
    };
    appendEvent(ev, path);
    return readLedger(path).items.find((i) => i.id === id) ?? null;
  });
}

/** Rewrite TASKLIST.md from the ledger; a no-op when the content is unchanged. */
export function writeTasklist(
  statuses: string[] = DEFAULT_RENDER_STATUSES,
  lPath = ledgerPath(),
  tPath = tasklistPath(),
): { changed: boolean; path: string; corrupt: number } {
  const { items, corrupt } = readLedger(lPath);
  const next = renderTasklist(items, statuses);
  let prev: string | null = null;
  try {
    if (existsSync(tPath)) prev = readFileSync(tPath, "utf-8");
  } catch {}
  if (prev === next) return { changed: false, path: tPath, corrupt };
  atomicWriteText(tPath, next);
  return { changed: true, path: tPath, corrupt };
}
