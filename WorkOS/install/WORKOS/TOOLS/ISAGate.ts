#!/usr/bin/env bun
// ISAGate.ts — the deterministic ISA structural gate.
//
// The ISA doctrine promises granular, testable, anchored claims and a document
// that is a real test harness, not a work-log. Until now those promises were
// enforced by a markdown checklist the model may or may not run on itself — so
// they leaked (92 closed ISAs missing anchoring, 60 with no anti-claim, 14 with
// unresolved fog at close; the 2026-07-23 audit). This tool makes the STRUCTURAL,
// un-gameable subset mechanical.
//
// Two tiers, and the split is doctrinal (the Goodhart line the 2026-07-24 Forge
// audit drew):
//   HARD  — binary structural facts a throwaway entry cannot satisfy. Block close.
//           (unresolved fog at complete · non-`M/N` progress format)
//   ADVISORY — anything a count could game (a lone anti-claim, a no-probe tag).
//           Surface, never block — blocking a count just manufactures the count.
//
// Exit: 0 clean (or advisories only); 2 hard violations AND phase==complete.
// Advisories print at any phase; hard violations only BLOCK at close, because a
// mid-climb ISA legitimately has open fog and unwired anchors.

import { readFileSync } from "node:fs";

export interface Violation {
  code: string;
  tier: "hard" | "advisory";
  message: string;
}

export interface GateReport {
  isaPath: string;
  phase: string;
  hard: Violation[];
  advisory: Violation[];
  blocks: boolean; // hard violations AND phase==complete
}

function frontmatter(text: string): Record<string, string> {
  const m = text.match(/^---\n([\s\S]*?)\n---/);
  const fm: Record<string, string> = {};
  if (!m) return fm;
  for (const line of m[1]!.split("\n")) {
    const kv = line.match(/^([A-Za-z_][\w]*):\s*(.*)$/);
    if (kv) fm[kv[1]!] = kv[2]!.trim();
  }
  return fm;
}

// Body of a named H2 section, up to the next H2. Null if the section is absent.
function section(text: string, heading: string): string | null {
  const re = new RegExp(`^##\\s+${heading}\\b[^\\n]*\\n([\\s\\S]*?)(?=\\n##\\s|$)`, "m");
  const m = text.match(re);
  return m ? m[1]! : null;
}

// A claim's description text, keyed by id (across Claims + Features blocks).
function claimDescriptions(text: string): { id: string; desc: string; anti: boolean }[] {
  const out: { id: string; desc: string; anti: boolean }[] = [];
  const RE = /^- \[[ xX~-]\]\s+([A-Za-z][A-Za-z0-9.-]*?)\s*(?::|—)\s*(.+)$/;
  for (const raw of text.split("\n")) {
    const m = raw.trim().match(RE);
    if (m) out.push({ id: m[1]!, desc: m[2]!.trim(), anti: /^Anti:/i.test(m[2]!.trim()) });
  }
  return out;
}

const EVENT_MARKERS = /\b(remediated|this session|this consolidation|touched only|iter \d+|deployed (?:this|in) |shipped this)\b/i;
const BUNDLE_MARKERS = /\b\w+ and \w+.*\b(and|with)\b|;\s*\w+.*;\s*\w+|\bincluding\b/i;

export function gateReport(isaPath: string): GateReport {
  const text = readFileSync(isaPath, "utf8");
  const fm = frontmatter(text);
  const phase = fm.phase ?? "";
  const hard: Violation[] = [];
  const advisory: Violation[] = [];

  // ── HARD (structural, un-gameable) ────────────────────────────────────────

  // H1 · progress must be a mechanical M/N count, not `true`/prose.
  if (!/^\d+\/\d+$/.test(fm.progress ?? "")) {
    hard.push({
      code: "progress-format",
      tier: "hard",
      message: `progress: "${fm.progress ?? ""}" is not M/N — done must be a mechanical claim count, not an opinion.`,
    });
  }

  // H2 · unresolved fog at close. Fog is honest mid-climb; at complete it must be empty.
  const fog = section(text, "Not yet specified");
  const fogLines = fog
    ? fog.split("\n").map((l) => l.trim()).filter((l) => l && !l.startsWith("<!--"))
    : [];
  if (phase === "complete" && fogLines.length > 0) {
    hard.push({
      code: "fog-at-complete",
      tier: "hard",
      message: `${fogLines.length} unresolved fog line(s) in "## Not yet specified" at phase: complete — graduate each to a claim or kill it in Decisions.`,
    });
  }

  // ── ADVISORY (count-gameable — surface, never block) ─────────────────────

  const claims = claimDescriptions(text);

  // A1 · at least one anti-claim (a goal with zero named failure modes is under-specified).
  if (claims.length > 0 && !claims.some((c) => c.anti)) {
    advisory.push({
      code: "no-anti-claim",
      tier: "advisory",
      message: `no Anti: claim — name at least one thing that must NOT happen. (advisory: a lone anti-claim added to pass is theater; write a real one.)`,
    });
  }

  // A3 · bundled claims (Splitting Test — likely 2+ assertions in one claim).
  const bundled = claims.filter((c) => !c.anti && BUNDLE_MARKERS.test(c.desc)).map((c) => c.id);
  if (bundled.length) {
    advisory.push({
      code: "bundled-claim",
      tier: "advisory",
      message: `${bundled.length} claim(s) look bundled (Splitting Test — 2+ assertions): ${bundled.slice(0, 8).join(", ")}. Split until each is one binary probe.`,
    });
  }

  // A4 · event-claims (work-log masquerading as claims — verify nothing ongoing).
  const events = claims.filter((c) => EVENT_MARKERS.test(c.desc)).map((c) => c.id);
  if (events.length) {
    advisory.push({
      code: "event-claim",
      tier: "advisory",
      message: `${events.length} claim(s) read as work-log events (verify nothing ongoing): ${events.slice(0, 8).join(", ")}. State the durable end-state, not the action taken.`,
    });
  }

  // A5 · broken edge graph (v2.21.0). Edges are optional forever — this fires
  // only when edges EXIST and are broken (typo'd blocker, cycle), which would
  // otherwise sit latent until someone happens to run IsaFrontier. Advisory,
  // never blocking, per the edges-never-required constraint.
  try {
    const { parseClaims: parseFrontierClaims, validateEdges } = require("./IsaFrontier");
    const fClaims = parseFrontierClaims(text);
    if (fClaims.some((c: { after: string[] }) => c.after.length > 0)) {
      const edgeErrors: string[] = validateEdges(fClaims);
      if (edgeErrors.length) {
        advisory.push({
          code: "edge-graph-broken",
          tier: "advisory",
          message: `dependency edges don't resolve: ${edgeErrors.slice(0, 4).join("; ")}${edgeErrors.length > 4 ? "; …" : ""}. Fix or drop the (after:) references.`,
        });
      }
    }
  } catch { /* IsaFrontier unavailable — edges simply aren't checked here */ }

  return { isaPath, phase, hard, advisory, blocks: hard.length > 0 && phase === "complete" };
}

// ── CLI ───────────────────────────────────────────────────────────────────
if (import.meta.main) {
  const args = process.argv.slice(2);
  const jsonOut = args.includes("--json");
  const path = args.find((a) => !a.startsWith("--")) ?? "./ISA.md";
  const r = gateReport(path);
  if (jsonOut) {
    console.log(JSON.stringify(r, null, 2));
  } else {
    for (const v of r.hard) console.log(`❌ HARD  [${v.code}] ${v.message}`);
    for (const v of r.advisory) console.log(`⚠️  ADVISORY [${v.code}] ${v.message}`);
    if (!r.hard.length && !r.advisory.length) console.log(`✅ clean — no structural violations`);
    console.log(
      `\n${r.hard.length} hard · ${r.advisory.length} advisory · phase: ${r.phase || "?"} · ${r.blocks ? "BLOCKS close" : "does not block"}`,
    );
  }
  process.exit(r.blocks ? 2 : 0);
}
