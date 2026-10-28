/**
 * @version 1.1.0
 * hook-io.ts — Shared stdin reader for Stop hooks
 *
 * Eliminates duplicated stdin-reading boilerplate across individual hooks.
 * Each hook calls readHookInput() to get the parsed JSON payload, and
 * parseTranscriptFromInput() if it needs the full transcript.
 *
 * 1.1.0 (WorkOS 1.1.0): ported from upstream LifeOS 8.761.0 hook-io.ts 1.8.0, without its
 * Vigil reporting (WorkOS does not ship Vigil, so gateInputFailureDecision and gate-run stay
 * out). Gained: typed read failures recorded to a local fallback ledger instead of vanishing,
 * the agent_id / agent_type / source input fields, and a memoised transcript parse.
 */

import { appendFileSync, mkdirSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { basename, dirname, join } from 'node:path';
import { workosPath } from '../../WORKOS/TOOLS/Paths';
import { parseTranscript, type ParsedTranscript } from '../../WORKOS/TOOLS/TranscriptParser';
import { parseHookStdin, isString } from './hook-input';

export interface HookInput {
  session_id: string;
  transcript_path: string;
  hook_event_name: string;
  last_assistant_message?: string;
  /**
   * Active effort level for the current run (Anthropic CC v2.1.133+).
   * Mirrors the same value as `$CLAUDE_EFFORT` in Bash subprocesses.
   * Absent when effort routing is undecided; treat absence as "run full work."
   */
  effort?: {
    level?: string;
  };
  /**
   * Anthropic Stop-hook loop-breaker (documented hook API).
   * `true` when this Stop hook is firing as a follow-up to a previous
   * `{"decision":"block"}` response — the hook MUST short-circuit (continue:true)
   * to avoid deadlocking the session. See OutputFormatGate.hook.ts +
   * VerificationGate.hook.ts for canonical usage.
   */
  stop_hook_active?: boolean;
  /** Present only on subagent hook input — the delegate's id (see lib/subagent.ts). */
  agent_id?: string;
  /** Present on subagent input, and on the main session of a `--agent` launch. */
  agent_type?: string;
  /** SessionStart only: startup | resume | clear | compact | fork. */
  source?: string;
}

/**
 * Where a payload that could not be used is noted. A hook must never wedge the harness, so
 * such a payload still allows (readHookInput returns null); this local line is the only
 * record that it happened. Override: WORKOS_HOOK_IO_FALLBACK.
 */
export function hookIoFallbackPath(): string {
  if (process.env.WORKOS_HOOK_IO_FALLBACK) return process.env.WORKOS_HOOK_IO_FALLBACK;
  if (process.env.NODE_ENV === 'test') return join(tmpdir(), `workos-hook-io-fallback-test-${process.pid}`, 'hook-io-fallback.jsonl');
  return workosPath('MEMORY', 'STATE', 'hook-io-fallback.jsonl');
}

/** Append one content-free line (time, hook name, event name, reason) and name the hook on stderr. Never throws. */
export function recordMissingTranscript(payload: Record<string, unknown>): void {
  const hook = basename(process.argv[1] ?? '') || 'unknown-hook';
  const event = typeof payload.hook_event_name === 'string' ? payload.hook_event_name : 'unknown-event';
  console.error(`[hook-io] ${hook}: stdin missing transcript_path; allowing without a record (noted in hook-io-fallback.jsonl)`);
  recordInputFailure('missing_transcript_path', event);
}

/**
 * Why a hook payload could not be used. `empty` is a hook run with nothing on stdin; every
 * other reason is an integrity failure a gate must not read as "nothing to check".
 */
export type HookInputFailure = 'empty' | 'boundary_rejected' | 'missing_transcript_path' | 'read_error';
export type HookInputRead = { ok: true; input: HookInput } | { ok: false; reason: HookInputFailure; event: string };

/** Append one content-free integrity-failure line (time, hook, event, reason). Never throws. */
export function recordInputFailure(reason: HookInputFailure, event: string): void {
  const hook = basename(process.argv[1] ?? '') || 'unknown-hook';
  try {
    const path = hookIoFallbackPath();
    mkdirSync(dirname(path), { recursive: true });
    appendFileSync(path, JSON.stringify({ ts: new Date().toISOString(), hook, event, reason }) + '\n');
  } catch { /* best effort; the typed result still carries the failure */ }
}

/**
 * Read and parse JSON from stdin with a 2000ms timeout. Returns the parsed input or a typed
 * failure; every failure except `empty` is recorded to the fallback ledger. A gate should use
 * this rather than the null form, so a failed read never looks like a passed check.
 */
export async function readHookInputResult(): Promise<HookInputRead> {
  let reader: ReadableStreamDefaultReader<Uint8Array> | null = null;
  try {
    const decoder = new TextDecoder();
    reader = Bun.stdin.stream().getReader();
    let input = '';

    const timeoutPromise = new Promise<void>((resolve) => {
      setTimeout(() => resolve(), 2000);
    });

    const readPromise = (async () => {
      while (true) {
        const { done, value } = await reader!.read();
        if (done) break;
        input += decoder.decode(value, { stream: true });
      }
    })();

    await Promise.race([readPromise, timeoutPromise]);
    reader.cancel().catch(() => {});

    // Validate the stdin boundary instead of casting. A Stop hook needs at least
    // a transcript_path to do anything.
    if (!input.trim()) return { ok: false, reason: 'empty', event: 'unknown-event' };
    const parsed = parseHookStdin(input);
    if (!parsed.ok) {
      console.error('[hook-io] stdin rejected at boundary:', parsed.reason);
      recordInputFailure('boundary_rejected', 'unknown-event');
      return { ok: false, reason: 'boundary_rejected', event: 'unknown-event' };
    }
    const event = isString(parsed.value.hook_event_name) ? parsed.value.hook_event_name : 'unknown-event';
    if (!isString(parsed.value.transcript_path)) {
      recordMissingTranscript(parsed.value as Record<string, unknown>);
      return { ok: false, reason: 'missing_transcript_path', event };
    }
    return { ok: true, input: parsed.value as unknown as HookInput };
  } catch (error) {
    if (reader) reader.cancel().catch(() => {});
    console.error('[hook-io] Error reading stdin:', error);
    recordInputFailure('read_error', 'unknown-event');
    return { ok: false, reason: 'read_error', event: 'unknown-event' };
  }
}

/**
 * Read and parse JSON from stdin with a 2000ms timeout.
 * Returns null if stdin is empty or malformed (the fail-safe contract every consumer null-checks).
 */
export async function readHookInput(): Promise<HookInput | null> {
  const read = await readHookInputResult();
  return read.ok ? read.input : null;
}

/**
 * Parse transcript from hook input. Waits 150ms for transcript to be
 * fully written to disk before parsing.
 *
 * Memoised on the input object: StopGates hands one input to every gate, and each gate used
 * to pay the wait and the parse again (about 600ms of sleep per stop upstream). One input now
 * waits and parses once; a new turn is a new input object, so nothing reads a stale transcript.
 */
const parsedByInput = new WeakMap<HookInput, Promise<ParsedTranscript>>();
export function parseTranscriptFromInput(input: HookInput): Promise<ParsedTranscript> {
  let p = parsedByInput.get(input);
  if (!p) {
    p = new Promise<void>(resolve => setTimeout(resolve, 150)).then(() => parseTranscript(input.transcript_path));
    parsedByInput.set(input, p);
  }
  return p;
}
