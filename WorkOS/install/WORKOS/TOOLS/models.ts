#!/usr/bin/env bun
/**
 * MODELS — the tables code imports when it needs to name a model.
 *
 * Doctrine lives in OPERATIONAL_RULES § Model selection and Algorithm §Spend, never here.
 * This file holds data, not policy.
 *
 * Prefer a tier ALIAS ("opus"/"sonnet"/"haiku"/"fable") everywhere: the `claude` CLI resolves
 * an alias to the latest model in that tier, so an alias never goes stale and a pinned ID
 * always will. Import CURRENT only where an exact ID is contractually required — a REST path,
 * or a drift check that must name the expected latest.
 *
 * ON A NEW RELEASE: bump CURRENT (one edit), then `bun UpdateModels.ts --check`.
 */

import { readFileSync } from "node:fs";
import { homedir } from "node:os";
import { join } from "node:path";

export type ClaudeTier = "opus" | "sonnet" | "haiku" | "fable";

/**
 * Is the `fable` alias usable on this install? On Bedrock / Vertex the model list is the
 * operator's `availableModels` in settings.json; when that list exists and names no Fable id
 * (Bedrock offers none today), `max` must resolve to opus or every max-rung call fails.
 * Anthropic API / subscription installs (no provider flag, or no list) keep Fable.
 * Mirrors the installer's fableUnavailable() (skills/WorkOS/Tools/InstallEngine.ts), which
 * also installs agents/Max.md with `model: opus` in that case.
 */
export function fableOffered(env: NodeJS.ProcessEnv = process.env): boolean {
  let settings: { env?: Record<string, unknown>; availableModels?: unknown } = {};
  try {
    const root = env.CLAUDE_CONFIG_DIR || join(env.HOME || homedir(), ".claude");
    settings = JSON.parse(readFileSync(join(root, "settings.json"), "utf8"));
  } catch { /* no settings → nothing restricts the lineup */ }
  const on = (k: string) => ["1", "true"].includes(String(env[k] ?? settings.env?.[k] ?? ""));
  if (!on("CLAUDE_CODE_USE_BEDROCK") && !on("CLAUDE_CODE_USE_VERTEX")) return true;
  const list = settings.availableModels;
  if (!Array.isArray(list)) return true;
  return list.some((m) => typeof m === "string" && /fable/i.test(m));
}

/** Intent levels. Consumers name a level, never a model name. */
export type EffortLevel = "max" | "high" | "medium" | "low";

/**
 * Level → tier. THE SINGLE EDIT POINT on a lineup change: if Fable leaves the subscription,
 * set `max: "opus"` and every consumer follows. `max` and `high` are distinct models, which is
 * what makes the Inference.ts max→high fallback a real degrade rather than a no-op — except
 * where the provider offers no Fable (fableOffered() false: Bedrock/Vertex with an
 * availableModels list and no Fable id), where max resolves to opus at runtime.
 */
export const EFFORT_MODEL: Record<EffortLevel, ClaudeTier> = {
  max: fableOffered() ? "fable" : "opus",   // top rung (~2× Opus); opus where Fable is not offered
  high: "opus",
  medium: "sonnet",
  low: "haiku",
};

/**
 * Do Agent dispatches execute Fable when asked (explicitly or by inheritance)?
 * CarrierProbe.ts compares live observation against this value and /ic fails on a stale
 * (>30d) or contradicted probe. Flip ONLY on transcript evidence — a subagent's self-report
 * is not evidence. Last probe: 2026-07-12 (true).
 */
export const DISPATCH_EXECUTES_FABLE = true;

/**
 * Three separate "level" dials — this file maps 1↔2:
 *   1. MODEL RUNG (EFFORT_MODEL): which Claude model runs.
 *   2. REASONING EFFORT (HarnessEffort): how hard a model thinks. Claude Code owns it
 *      (`/effort`, settings, `--effort`); a hook can read it but cannot set the main loop's
 *      value. WorkOS runs uniformly at `high`.
 *   3. COMPOSITION (ultracode): whether to fan a task into a multi-agent Workflow. Not an
 *      effort level; orthogonal to 1 and 2.
 */
export type HarnessEffort = "low" | "medium" | "high" | "xhigh" | "max";

/** Every rung thinks at `high`; the MODEL rung still varies. Consumed by Inference.ts. */
export const UNIFORM_HARNESS_EFFORT: HarnessEffort = "high";

/** Auto-tracking alias for an effort level (preferred — never drifts). */
export function modelForEffort(level: EffortLevel): string {
  return EFFORT_MODEL[level];
}

/** Pinned ID for an effort level (only where an exact ID is required). */
export function pinnedModelForEffort(level: EffortLevel): string {
  return CURRENT[EFFORT_MODEL[level]];
}

/**
 * Current Claude model IDs. THE SINGLE EDIT POINT on a model release. Verify the exact string
 * against the models overview before bumping; `bun UpdateModels.ts --apply <tier> <id>`
 * rewrites these safely.
 */
export const CURRENT: Record<ClaudeTier, string> = {
  fable: "claude-fable-5",
  opus: "claude-opus-5",
  sonnet: "claude-sonnet-5",
  haiku: "claude-haiku-4-5-20251001",
};

/** Pinned ID for a Claude tier. */
export function currentModel(tier: ClaudeTier): string {
  return CURRENT[tier];
}

/**
 * Dated/pinned Claude-ID pattern — matches claude-{tier}-{major}[-{minor}][-date], covering
 * both the Claude 5 lineup ("claude-sonnet-5") and older two-part IDs ("claude-opus-4-8").
 * Used by the drift scanner to find pinned IDs that may be stale.
 */
export const CLAUDE_ID_PATTERN = /claude-(opus|sonnet|haiku|fable)-\d+(?:-\d+)?(?:-\d{8})?/g;
