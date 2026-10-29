import { mtime } from "../Cache";
import type { State } from "../State";

const KEYS = ["low", "medium", "high", "max"] as const;
export type Mix = Record<(typeof KEYS)[number], number>;
const ALLOWED = new RegExp(`^mix_(${KEYS.join("|")})=[0-9]+$`);
const DEFAULT_TTL = 20;

export function emptyMix(): Mix {
  return { low: 0, medium: 0, high: 0, max: 0 };
}

/**
 * Per-rung shares of the session's output tokens. The resolver (TOOLS/ModelMix.ts) is imported, not spawned, and runs
 * only when the per-session cache is older than the TTL (default 20 s). Only the numeric allowlist is ever read back
 * from the cache file.
 */
export function readMix(state: State): Mix {
  const mix = emptyMix();
  const session = state.sessionId === "" ? "" : state.session;
  if (!session) return mix;
  const name = `model-mix-${session}.txt`;
  const ttl = /^\d+$/.test(state.env.MODEL_MIX_TTL ?? "") ? Number(state.env.MODEL_MIX_TTL) : DEFAULT_TTL;
  const at = mtime(state.cache.path(name));
  if (state.now - (at > 0 ? at : state.now - 999999) > ttl) {
    try {
      const { computeMix } = require("../../TOOLS/ModelMix.ts") as typeof import("../../TOOLS/ModelMix");
      const pct = computeMix(session, state.transcript || undefined).pct;
      state.cache.put(name, KEYS.map((k) => `mix_${k}=${Math.max(0, Math.trunc(pct[k] ?? 0))}`).join("\n") + "\n");
    } catch { /* a failed refresh keeps the previous cache */ }
  }
  for (const line of (state.cache.text(name) ?? "").split("\n")) {
    if (ALLOWED.test(line)) mix[line.slice(4, line.indexOf("=")) as keyof Mix] = Number(line.slice(line.indexOf("=") + 1));
  }
  return mix;
}
