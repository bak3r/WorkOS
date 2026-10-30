#!/usr/bin/env bun
/**
 * @version 1.3.0
 * StopGates.hook.ts — the ONE Stop-event gate hook.
 *
 * 1.3.0 (WorkOS 2.0.0, port of upstream 8.761.0 StopGates 1.3.1): IsaCodeSyncGate is gate 0 and BLOCKS
 * (code governed by an ISA changed this turn, that ISA not written in the same turn). Upstream's blocks
 * combine, so the gate that holds the turn never displaces another gate's obligation (the recovery turn
 * carries stop_hook_active, on which the other gates self-exempt); this file now combines too. One block
 * is emitted exactly as its gate returned it; two or more are joined into one block. WorkOS has no
 * advisory-gate split: every gate here that returns decision:"block" blocks.
 *
 * Consolidation (2026-07-11, hooks BPE pass): merges the three per-turn gate
 * spawns into one process, reading stdin ONCE. Each gate file remains the
 * owner of its logic (and stays runnable standalone via its own shim); this
 * hook imports their exported run() and evaluates in the old registration
 * order:
 *
 *   0. IsaCodeSyncGate.run()   — code-sync teeth: governed code changed + its ISA not written blocks
 *   1. FormatGate.run()        — structural format checks
 *   2. VerificationGate.run()  — claim-vs-evidence teeth (T1-T3 block)
 *   3. ISACloseGate.run()      — ISA-freshness teeth at major-work completion
 *   4. ISAFoldGate.run()       — D-50 teeth: prod mutated + ISA untouched blocks
 *   5. ISAGate.run()           — structural close gate
 *
 * Decision semantics: every gate is evaluated; all `decision:"block"` results are combined into
 * ONE block (a single block is emitted unchanged). When nothing blocks, the first other decision
 * is emitted. `{continue:true}` returns (stop_hook_active recovery) are emitted once.
 *
 * Failure mode: each gate's run() fails open internally; this wrapper catches
 * anything residual per-gate so one gate's crash never silences the others.
 * The gate must never be why a Stop breaks — always exit 0.
 */

import { readHookInput } from "./lib/hook-io";
import { run as formatGate } from "./FormatGate.hook";
import { run as verificationGate } from "./VerificationGate.hook";
import { run as isaCloseGate } from "./ISACloseGate.hook";
import { run as isaFoldGate } from "./ISAFoldGate.hook";
import { run as isaStructureGate } from "./ISAGate.hook";
import { run as isaCodeSyncGate } from "./IsaCodeSyncGate.hook";

type GateFn = (input: any) => Promise<object | null>;

// OutputFormatGate (mode-banner telemetry) removed 2026-07-11; FormatGate is
// its unified-format successor WITH TEETH (2026-07-11): deterministic
// structural checks on the one WorkOS format — banner first, 🗣️ closer last,
// 🧠 line when a delta arrived, ≤2 prose em-dashes. Voice/vocabulary drift
// stays DriftReminder's job; this gate is structure only. First in order so a
// format fix is the recovery turn's single clear instruction.
const GATES: Array<[string, GateFn]> = [
  // IsaCodeSyncGate (upstream 2026-10-24, ISASystem.md § Code sync): code governed by an ISA changed this
  // turn and that ISA was not written in the same turn → block. Keyed to files, not to a run. First in
  // upstream's order too; its block combines with the others' (see the loop below).
  ["IsaCodeSyncGate", isaCodeSyncGate],
  ["FormatGate", formatGate],
  ["VerificationGate", verificationGate],
  // ISACloseGate: a completion claim on an active run with a provably stale ISA blocks
  // once. Order matters — evidence gaps (VerificationGate) outrank the bookkeeping fold-in.
  ["ISACloseGate", isaCloseGate],
  // ISAFoldGate (2026-07-29, D-50 enforcement): prod mutated this turn + active run +
  // ISA untouched + reply silent on ISA state → block. Phrase-independent — the gap
  // ISACloseGate's COMPLETION_RE cannot see ("rigged and armed" isn't "done").
  ["ISAFoldGate", isaFoldGate],
  // ISAGate (2026-07-24, granularity/testability upgrade F3): blocks a close
  // (phase: complete written this turn) on un-gameable STRUCTURAL violations —
  // non-M/N progress, fog-at-complete, missing anchors_to. Scoped to ISAs
  // touched this turn (legacy files never retroactively gated). Complements
  // ISACloseGate (stale-ISA) with a different, structural tooth.
  ["ISAGate", isaStructureGate],
];

(async () => {
  const input = await readHookInput();
  if (!input) process.exit(0);

  let emitted: object | null = null;
  const blocks: Array<{ decision?: string; reason?: string; message?: string }> = [];
  for (const [name, gate] of GATES) {
    try {
      const d = await gate(input);
      if (!d) continue;
      // Blocks combine: the recovery turn carries stop_hook_active, on which the other gates
      // self-exempt, so a block that displaced another would let that obligation escape.
      if ((d as { decision?: string }).decision === "block") blocks.push(d as { reason?: string });
      else if (!emitted) emitted = d;
    } catch (err) {
      console.error(`[StopGates] ${name} error:`, err);
    }
  }
  if (blocks.length === 1) emitted = blocks[0]!;
  else if (blocks.length > 1) {
    emitted = {
      decision: "block",
      reason: `The turn tried to end, but ${blocks.length} gates still hold obligations that were not met. Resolve each item below, then restate the outcome before stopping.\n\n` +
        blocks.map((b) => b.reason || b.message || "[unspecified]").join("\n\n"),
    };
  }
  if (emitted) console.log(JSON.stringify(emitted));
  process.exit(0);
})().catch((err) => {
  console.error("[StopGates] fatal:", err);
  process.exit(0);
});
