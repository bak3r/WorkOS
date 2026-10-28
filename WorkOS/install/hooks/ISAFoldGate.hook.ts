#!/usr/bin/env bun
/**
 * @version 1.0.3
 * ISAFoldGate.hook.ts — the D-50 gate: prod mutated, ISA untouched → fold before closing.
 *
 * Origin (2026-07-29, {{PRINCIPAL_NAME}}: "you were supposed to do that after the work finished — why
 * isn't that functionality working from the hooks?"): ISACloseGate only wakes on completion
 * PHRASES, so a turn that installs secrets, applies an import, or deploys — and then reports
 * in words outside COMPLETION_RE's vocabulary — ends with the state-of-record stale and no
 * gate fired. Vector's D-50 named the failure class ("a fact that changed a claim got
 * written into narrative instead of into the claim"); this is its enforcement.
 *
 * BLOCK iff ALL hold; any failure ⇒ PASS (default pass, fail-open):
 *   1. not a stop-hook recovery pass (loop guard)
 *   2. the session is bound to an active run in work.json (phase ≠ complete)
 *   3. this turn's transcript contains ≥1 SUCCESSFUL prod-mutating call:
 *      a `deploy`-kind event, a remote D1 write (wrangler d1 execute … --remote with a
 *      write verb or --file), `wrangler secret put`, a remote KV key put/delete, or one
 *      of our own write-flag tools (`--apply`, Release.ts)
 *   4. no ISA edit in this turn, and no subagent this turn (a delegate may own the fold)
 *   5. the final message does not honestly address ISA state (ISA_ADDRESSED_RE — "ISA
 *      updated", "no ISA delta needed", etc. all pass)
 *
 * Unlike ISACloseGate there is NO once-per-run latch: every mutating turn owes its fold,
 * so recurrence is the point. Natural termination: the recovery turn either edits the ISA
 * or states why no delta is needed — both pass condition 4/5 next evaluation.
 *
 * Kill switch: ISAFOLDGATE_OFF=1. Fail-OPEN on any read/parse error.
 * TRIGGER: Stop (evaluated inside StopGates.hook.ts, after ISACloseGate)
 */

import { getWorkosDir } from "./lib/paths";
import type { HookInput } from "./lib/hook-io";
import { parseTurnEvents, spawnedAgent, type TxEvent } from "./lib/transcript-evidence";
import { findActiveSessionByUUID } from "./lib/isa-utils";
import { isaEditedThisTurn, ISA_ADDRESSED_RE } from "./ISACloseGate.hook";
import { appendFileSync, mkdirSync, readFileSync, statSync } from "fs";
import { dirname, join } from "path";

const WORKOS = getWorkosDir();
const OBS_PATH = join(WORKOS, "MEMORY", "OBSERVABILITY", "isa-fold-gate.jsonl");

/** Prod-mutating command shapes. Conservative and explicit: each one is a class this
 * system actually uses to change remote state. A plain local test/build never matches. */
const PROD_MUTATION_RES: RegExp[] = [
  /wrangler\s+d1\s+execute\s+\S+[^\n]*--remote[^\n]*(--file|\bINSERT\b|\bUPDATE\b|\bDELETE\b|\bCREATE\b|\bALTER\b)/is,
  /wrangler\s+secret\s+put\b/i,
  /wrangler\s+kv\s+key\s+(put|delete)\b/i,
  /Tools\/Release\.ts\b/,
  /\s--apply\b/, // our importers' one write flag (ImportBackfill, ProvisionPortal, …)
];

/** A search/display command whose ARGUMENTS routinely contain the exact strings
 * PROD_MUTATION_RES hunts for — `rg -n "Tools/Release.ts"` is a grep, not a
 * release. Only these three tests together are safe: the exemption applies solely
 * to a single unchained invocation, so `rg x && wrangler secret put y` keeps its
 * teeth, and none of these binaries can run a subcommand from argv (which is why
 * `find`/`fd`/`awk`/`sed` are deliberately absent — they have -exec/system()).
 *
 * `less` and `bat` are absent for the same reason: both are pagers with shell
 * escapes (`less` runs `!cmd` and honours LESSOPEN; `bat` shells out to its
 * pager), so an exempted invocation is not a guaranteed read. EXEC_FLAG_RE
 * covers the remaining argv-level escapes: any flag that hands the exempted
 * binary a command to run turns a "grep" into arbitrary execution — `rg --pre
 * <cmd>` / `--pre-glob`, `rg --hostname-bin <cmd>`, `ack --pager=<cmd>`. Testing
 * the whole command for these is the tightest form of the same rule.
 * (ported from public PR #1738, @elhoim; exemption tightened here) */
const READ_ONLY_CMD_RE = /^\s*(rg|grep|egrep|fgrep|ag|ack|cat|head|tail|ls|wc)\b/;
const SHELL_CHAIN_RE = /[;&|`\n]|\$\(/;
const EXEC_FLAG_RE = /--(pre|pre-glob|hostname-bin|pager)\b/;

export function prodMutations(ev: TxEvent[]): TxEvent[] {
  return ev.filter((e) => {
    if (e.isError) return false; // a failed attempt changed nothing
    if (e.kind === "deploy") return true;
    if (e.kind !== "command") return false;
    if (READ_ONLY_CMD_RE.test(e.target) && !SHELL_CHAIN_RE.test(e.target) && !EXEC_FLAG_RE.test(e.target)) return false;
    // Match on the command text only, never its output.
    return PROD_MUTATION_RES.some((re) => re.test(e.target));
  });
}

function obs(entry: Record<string, unknown>): void {
  try {
    mkdirSync(dirname(OBS_PATH), { recursive: true });
    appendFileSync(OBS_PATH, JSON.stringify({ ts: new Date().toISOString(), ...entry }) + "\n");
  } catch {
    /* observability must never break the gate */
  }
}

export async function run(input: HookInput): Promise<object | null> {
  try {
    if (process.env.ISAFOLDGATE_OFF === "1") return null;
    if ((input as { stop_hook_active?: boolean }).stop_hook_active) return null;

    const active = findActiveSessionByUUID(input.session_id);
    if (!active || active.session?.phase === "complete") return null;

    let ev: TxEvent[];
    try {
      ev = parseTurnEvents(input.transcript_path);
    } catch {
      obs({ decision: "pass-transcript-error" });
      return null;
    }

    const mutations = prodMutations(ev);
    if (mutations.length === 0) return null;
    if (isaEditedThisTurn(ev)) {
      obs({ decision: "pass-isa-edited", slug: active.slug, mutations: mutations.length });
      return null;
    }
    if (spawnedAgent(ev)) {
      obs({ decision: "pass-delegated", slug: active.slug });
      return null;
    }

    const message = (input as { last_assistant_message?: string }).last_assistant_message ?? "";
    if (ISA_ADDRESSED_RE.test(message)) {
      obs({ decision: "pass-isa-addressed", slug: active.slug });
      return null;
    }

    const sample = mutations
      .slice(0, 3)
      .map((m) => (m.kind === "deploy" ? "deploy" : m.target.slice(0, 60)))
      .join(" · ");
    obs({ decision: "block", slug: active.slug, mutations: mutations.length, sample });
    return {
      decision: "block",
      reason:
        `ISA FOLD GAP [ISAFoldGate/D-50]. This turn changed live state (${mutations.length} prod-mutating call(s): ${sample}) ` +
        `on the run '${active.slug}', but its ISA was not touched and the reply does not address ISA state. ` +
        `A fact that changes a claim goes into the claim, same turn (D-50; Algorithm claims 12-14). ` +
        `Fold the new state into ${active.session.isa || "the run's ISA"} now (evidence stubs on affected claims, ` +
        `progress/phase if changed), then restate — or state explicitly why no ISA delta is needed.`,
    };
  } catch (err) {
    obs({ decision: "pass-error", error: String(err) });
    return null;
  }
}

// ── the bridge reader (ported from upstream LifeOS 8.761.0 ISAFoldGate 1.4.5 for IsaCodeSyncGate) ───────
// Additive: nothing above reads it, so this gate's own behaviour is unchanged.

/** The tail a Stop gate judges in turn scope; the same 8 MB transcript-evidence reads. */
const TURN_CAP_BYTES = 8 * 1024 * 1024;

/** One tool call, paired with its result by id. */
export interface ToolCall {
  id: string;
  name: string;
  input: Record<string, any>;
  /** A tool_result for this call exists. An unanswered call is not evidence that anything ran. */
  answered: boolean;
  /** Answered and not an error. */
  ok: boolean;
  /** The full result text (transcript-evidence keeps only its first 4,000 characters). */
  resultText: string;
  /** The call was made inside a subagent's sidechain, not by this session. */
  sidechain: boolean;
  /** Epoch-ms timestamp of the transcript entry that made the call; null when it carries none. */
  ts: number | null;
  /** Arrival position of this call's result among all results paired in scope (0 first); -1 when unanswered. */
  resultOrder: number;
  /** Epoch-ms timestamp of the entry that carried the result; null when unanswered or it carries none. */
  resultTs: number | null;
}

/** A strict read refuses any malformed line in scope; a lenient one skips it and counts it in `malformed`. */
export type CallsRead = { ok: true; calls: ToolCall[]; malformed: number } | { ok: false; reason: string };

/** The entry that opens a turn: a user/human message with text that is not only tool results.
 *  The rule transcript-evidence's turn boundary uses. */
function opensTurn(e: Record<string, any>): boolean {
  const role = e.role ?? e.message?.role ?? e.type;
  if (role !== "user" && role !== "human") return false;
  const content = e.message?.content ?? e.content;
  if (Array.isArray(content) && content.length && content.every((b: any) => b?.type === "tool_result")) return false;
  return typeof content === "string" ? content.trim().length > 0
    : Array.isArray(content) && content.some((b: any) => b?.type === "text" && typeof b.text === "string" && b.text.trim());
}

function resultTextOf(content: unknown): string {
  if (typeof content === "string") return content;
  if (Array.isArray(content)) return content.map((c: any) => (typeof c?.text === "string" ? c.text : "")).join("\n");
  return "";
}

/**
 * The entry is written by `role` as the harness writes it: every role field it carries (`type`,
 * `role`, `message.role`) names that role, and it carries at least one. As in the shared reader,
 * `human` names the user, and `type: "message"` is the neutral envelope that names no role (S038).
 */
function writtenBy(e: Record<string, any>, role: "assistant" | "user"): boolean {
  const named = [e.type === "message" ? null : e.type, e.role, e.message?.role]
    .filter((v): v is string => typeof v === "string")
    .map((v) => (v === "human" ? "user" : v));
  return named.length > 0 && named.every((v) => v === role);
}

/** The entry's own `timestamp` as epoch-ms, or null when it has none that parses. */
function entryMs(e: Record<string, any>): number | null {
  const ms = typeof e.timestamp === "string" ? Date.parse(e.timestamp) : NaN;
  return Number.isFinite(ms) ? ms : null;
}

/**
 * Tool calls of the current turn ("turn") or of the whole session ("session"), each paired with its
 * result by id. A bridge, not a second evidence reader: transcript-evidence's parseTurnEvents is the
 * reader and judge of the turn, and this exists only for what it does not report yet, a MultiEdit
 * call (it emits no event for one) and a Bash result's full text across the whole session (it keeps
 * 4,000 characters of an 8 MB tail). Both are requested of transcript-evidence's owner; when they
 * land, the callers drop this. It refuses what strict parseTurnEvents refuses: a transcript that is
 * missing, unreadable or not a regular file, and a line in scope that is not a JSON object (the
 * cut-off first line of a turn-scope tail read excepted). Session scope reads the whole file.
 */
export function transcriptToolCalls(path: unknown, scope: "turn" | "session", opts: { lenient?: boolean } = {}): CallsRead {
  if (typeof path !== "string" || !path) return { ok: false, reason: "no transcript path was given" };
  let buf: Buffer;
  try {
    if (!statSync(path).isFile()) return { ok: false, reason: "the transcript is not a regular file" };
    buf = readFileSync(path);
  } catch {
    return { ok: false, reason: "the transcript could not be read" };
  }
  const rowsOf = (text: string) => {
    const rows: { line: number; entry: Record<string, any> | null }[] = [];
    const lines = text.split("\n");
    for (let i = 0; i < lines.length; i++) {
      const s = lines[i]!.trim();
      if (!s) continue;
      let entry: Record<string, any> | null = null;
      try {
        const v = JSON.parse(s);
        entry = v && typeof v === "object" && !Array.isArray(v) ? v : null;
      } catch { entry = null; }
      rows.push({ line: i + 1, entry });
    }
    return rows;
  };
  const opening = (rows: { entry: Record<string, any> | null }[]) => {
    for (let k = rows.length - 1; k >= 0; k--) {
      const e = rows[k]!.entry;
      if (e && opensTurn(e)) return k;
    }
    return -1;
  };
  let rows: { line: number; entry: Record<string, any> | null }[];
  let start = 0;
  if (scope === "turn" && buf.length > TURN_CAP_BYTES) {
    const tail = buf.subarray(buf.length - TURN_CAP_BYTES).toString("utf-8");
    rows = rowsOf(tail.slice(tail.indexOf("\n") + 1));
    start = opening(rows);
    // The turn opened before the tail (one result can be larger than the cap): read the whole turn.
    if (start < 0) { rows = rowsOf(buf.toString("utf-8")); start = Math.max(0, opening(rows)); }
  } else {
    rows = rowsOf(buf.toString("utf-8"));
    if (scope === "turn") start = Math.max(0, opening(rows));
  }
  const calls: ToolCall[] = [];
  const byId = new Map<string, ToolCall>();
  let arrived = 0;
  let malformed = 0;
  for (let k = start; k < rows.length; k++) {
    const r = rows[k]!;
    if (!r.entry) {
      if (!opts.lenient) return { ok: false, reason: `a line of the ${scope === "turn" ? "current turn" : "session"} is not a valid transcript entry (line ${r.line})` };
      malformed++;
      continue;
    }
    const content = r.entry.message?.content ?? r.entry.content;
    if (!Array.isArray(content)) continue;
    for (const b of content) {
      if (b?.type === "tool_use" && typeof b.id === "string" && typeof b.name === "string") {
        if (!writtenBy(r.entry, "assistant")) continue; // only the assistant makes a call
        if (byId.has(b.id)) continue; // a transcript can repeat an entry; one call per id
        const c: ToolCall = {
          id: b.id, name: b.name, input: b.input && typeof b.input === "object" ? b.input : {},
          answered: false, ok: false, resultText: "", sidechain: r.entry.isSidechain === true,
          ts: entryMs(r.entry), resultOrder: -1, resultTs: null,
        };
        calls.push(c);
        byId.set(b.id, c);
      } else if (b?.type === "tool_result" && typeof b.tool_use_id === "string") {
        const c = byId.get(b.tool_use_id);
        if (!c || c.answered) continue;
        // Only a user entry carries a result, and only from the same side of a sidechain as its call.
        if (!writtenBy(r.entry, "user") || (r.entry.isSidechain === true) !== c.sidechain) continue;
        c.answered = true;
        c.ok = b.is_error !== true;
        c.resultText = resultTextOf(b.content);
        c.resultOrder = arrived++;
        c.resultTs = entryMs(r.entry);
      }
    }
  }
  return { ok: true, calls, malformed };
}

