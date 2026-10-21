#!/usr/bin/env bun
// Normalize env path vars Claude Code may inject unexpanded — literal $HOME/${HOME}
// in WORKOS_DIR/WORKOS_CONFIG_DIR/PROJECTS_DIR resolves to a shadow dir (#1404 / PR #1451, author jbmml).
for (const __k of ["WORKOS_DIR", "WORKOS_CONFIG_DIR", "PROJECTS_DIR"]) {
  const __v = process.env[__k];
  if (__v && /^\$\{?HOME\}?(\/|$)/.test(__v)) process.env[__k] = __v.replace(/^\$\{?HOME\}?/, process.env.HOME ?? "~");
}


/**
 * MigrateScan — intake content from external sources (other WorkOS installs, other
 * agent harnesses, Obsidian/Notion exports, Claude.md files, Cursor rules,
 * other assistants' custom instructions, raw work-notes dumps) and propose a target
 * destination in the WorkOS structure per chunk.
 *
 * V1 scope: markdown / plain text files. Chunks by markdown heading (##/###)
 * or paragraph group. Classifies each chunk by keyword matching + heuristics.
 * Emits a proposal queue JSON that MigrateApprove.ts commits after {{PRINCIPAL_NAME}}'s
 * approval.
 *
 * Usage:
 *   bun MigrateScan.ts --source <file>           Scan a single file
 *   bun MigrateScan.ts --source <dir>            Scan all .md/.txt in directory
 *   bun MigrateScan.ts --stdin                   Read from stdin
 *   bun MigrateScan.ts --source X --json         JSON output for approve pipeline
 *   bun MigrateScan.ts --source X --dry-run      Preview without writing queue
 */

import { readFileSync, writeFileSync, existsSync, readdirSync, statSync, mkdirSync, appendFileSync } from "fs";
import { join, basename, dirname, extname } from "path";
import { randomUUID } from "crypto";
import { homedir } from "node:os";
import { getDAName, getPrincipalName } from "../../hooks/lib/identity";

// Normalize env path vars that Claude Code injects without shell expansion (WorkOS#1404)
for (const k of ["WORKOS_DIR", "WORKOS_CONFIG_DIR", "PROJECTS_DIR"]) {
  const v = process.env[k];
  if (v && /^\$\{?HOME\}?(\/|$)/.test(v)) process.env[k] = v.replace(/^\$\{?HOME\}?/, process.env.HOME ?? "~");
}


const HOME = process.env.HOME ?? process.env.USERPROFILE ?? homedir();
const WORKOS_DIR = process.env.WORKOS_DIR || join(HOME, ".claude", "WORKOS");
const QUEUE_FILE = join(WORKOS_DIR, "MEMORY", "MIGRATION", "migration-proposals.jsonl");

type Target =
  | "TELOS.md#Mission"
  | "TELOS.md#Goals"
  | "TELOS.md#Problems"
  | "TELOS.md#Strategies"
  | "TELOS.md#Challenges"
  | "TELOS.md#Beliefs"
  | "TELOS.md#Wisdom"
  | "TELOS.md#Models"
  | "TELOS.md#Frames"
  | "TELOS.md#Narratives"
  | "USER/PRINCIPAL/PRINCIPAL_IDENTITY.md"
  | "MEMORY/KNOWLEDGE/Ideas"
  | "MEMORY/KNOWLEDGE/People"
  | "MEMORY/KNOWLEDGE/Companies"
  | "MEMORY/KNOWLEDGE/Research"
  | "memory/feedback"
  | "UNCLEAR";

type Proposal = {
  id: string;
  timestamp: string;
  source_file: string;
  source_section: string;
  content_preview: string;
  content_full: string;
  proposed_target: Target;
  classification_confidence: number; // 0-1
  classification_reasons: string[];
  alternatives: Target[];
  status: "pending" | "approved" | "rejected" | "modified";
};

// ─── Classification rules (keyword → target, with weight) ───

// DA name resolved at runtime and regex-escaped, so the feedback rule matches
// whatever the install's assistant is called.
const DA_NAME_RE = getDAName().replace(/[.*+?^${}()|[\]\\]/g, "\\$&");

const RULES: Array<{ target: Target; patterns: RegExp[]; weight: number }> = [
  // Work TELOS — each target is an H2 section of the unified USER/TELOS/TELOS.md
  { target: "TELOS.md#Mission", patterns: [/\bmission\b/i, /\bnorth[\s-]?star\b/i, /\bwhy I\b(work|build|do)/i, /\blife's?\s+work\b/i], weight: 3 },
  { target: "TELOS.md#Goals", patterns: [/\bgoal[s]?\b/i, /\btarget\b/i, /\bmilestone\b/i, /\bby (end of|Q[1-4]|next year|2026|2027)/i, /\baim to\b/i], weight: 2 },
  { target: "TELOS.md#Problems", patterns: [/\bproblem\b/i, /\bissue\b/i, /\bcrisis\b/i, /\bbroken\b/i, /\bsolve\b/i], weight: 2 },
  { target: "TELOS.md#Strategies", patterns: [/\bstrategy\b/i, /\bapproach\b/i, /\bplan of attack\b/i, /\bhow we'?ll\b/i], weight: 2 },
  { target: "TELOS.md#Challenges", patterns: [/\bstruggle[s]? with\b/i, /\bI procrastinate\b/i, /\bweakness\b/i, /\bbad at\b/i, /\bblocker\b/i], weight: 2 },
  { target: "TELOS.md#Beliefs", patterns: [/\bI (believe|am convinced|am certain)\b/i, /\bmy conviction\b/i, /\bcore belief\b/i], weight: 2 },
  { target: "TELOS.md#Wisdom", patterns: [/\blearned that\b/i, /\binsight\b/i, /\brule of thumb\b/i, /\bhard[-\s]won\b/i, /\baphorism\b/i], weight: 2 },
  { target: "TELOS.md#Models", patterns: [/\bmental model\b/i, /\bframework\b/i, /\bheuristic\b/i, /\bway of thinking\b/i], weight: 2 },
  { target: "TELOS.md#Frames", patterns: [/\bframe\b/i, /\blens\b/i, /\bway of seeing\b/i], weight: 1 },
  { target: "TELOS.md#Narratives", patterns: [/\bpitch\b/i, /\bone[-\s]liner\b/i, /\belevator pitch\b/i, /\bhow I describe\b/i], weight: 2 },

  // Learning (no separate file — engineering lessons land in Wisdom)
  { target: "TELOS.md#Wisdom", patterns: [/\blearn\b/i, /\blesson\b/i, /\bclass\b/i, /\bstudy\b/i, /\bcourse\b/i], weight: 2 },

  // Identity
  { target: "USER/PRINCIPAL/PRINCIPAL_IDENTITY.md", patterns: [/\bI am\b/i, /\bmy role\b/i, /\bmy background\b/i, /\bI work as\b/i, /\bexperience\b/i], weight: 1 },

  // Knowledge
  { target: "MEMORY/KNOWLEDGE/Ideas", patterns: [/\bidea:\b/i, /\bthesis\b/i, /\bhypothesis\b/i, /\btheory\b/i], weight: 2 },
  { target: "MEMORY/KNOWLEDGE/People", patterns: [/\b(met|know|friends with)\s+[A-Z][a-z]+\s+[A-Z][a-z]+/], weight: 1 },
  { target: "MEMORY/KNOWLEDGE/Companies", patterns: [/\b(company|startup|corporation)\b/i], weight: 1 },
  { target: "MEMORY/KNOWLEDGE/Research", patterns: [/\bresearch\b/i, /\bstudy shows\b/i, /\baccording to\b/i], weight: 1 },

  // Feedback (AI collaboration preferences)
  { target: "memory/feedback", patterns: [/\b(always|never|do not) (do|use|include)\b/i, new RegExp(`\\bwhen (you|${DA_NAME_RE})\\b`, "i"), new RegExp(`\\b${DA_NAME_RE} should\\b`, "i"), /\bfrom now on\b/i, /\brule:\b/i], weight: 3 },
];

// ─── Chunking ───

function readSource(sourcePath: string, stdin: boolean): Array<{ file: string; content: string }> {
  if (stdin) {
    const content = readFileSync(0, "utf-8"); // stdin
    return [{ file: "<stdin>", content }];
  }
  if (!existsSync(sourcePath)) {
    console.error(`Source does not exist: ${sourcePath}`);
    process.exit(1);
  }
  const stat = statSync(sourcePath);
  if (stat.isFile()) {
    return [{ file: sourcePath, content: readFileSync(sourcePath, "utf-8") }];
  }
  // Directory — scan .md and .txt recursively
  const results: Array<{ file: string; content: string }> = [];
  function walk(dir: string): void {
    for (const entry of readdirSync(dir)) {
      const p = join(dir, entry);
      const s = statSync(p);
      if (s.isDirectory()) walk(p);
      else if (/\.(md|txt|markdown)$/i.test(entry)) {
        results.push({ file: p, content: readFileSync(p, "utf-8") });
      }
    }
  }
  walk(sourcePath);
  return results;
}

function chunkContent(file: string, content: string): Array<{ section: string; body: string }> {
  // Strategy: split on H2/H3 headings. For content without headings, split on
  // double-blank-line paragraph groups. Each chunk gets a section label.
  const chunks: Array<{ section: string; body: string }> = [];

  if (/^#{2,3}\s+/m.test(content)) {
    const parts = content.split(/^(#{2,3}\s+.+)$/m);
    // parts alternates: [preamble, heading1, body1, heading2, body2, ...]
    if (parts[0].trim()) {
      chunks.push({ section: `${basename(file)}:preamble`, body: parts[0].trim() });
    }
    for (let i = 1; i < parts.length; i += 2) {
      const heading = parts[i].replace(/^#{2,3}\s+/, "").trim();
      const body = (parts[i + 1] || "").trim();
      if (body) chunks.push({ section: `${basename(file)}:${heading}`, body });
    }
  } else {
    const paragraphs = content.split(/\n\s*\n/).filter((p) => p.trim().length > 30);
    for (let i = 0; i < paragraphs.length; i++) {
      chunks.push({ section: `${basename(file)}:p${i + 1}`, body: paragraphs[i].trim() });
    }
  }

  return chunks;
}

// ─── Classification ───

function classify(body: string): { target: Target; confidence: number; reasons: string[]; alternatives: Target[] } {
  const scores: Record<string, { score: number; reasons: string[] }> = {};

  for (const rule of RULES) {
    let hits = 0;
    const matched: string[] = [];
    for (const p of rule.patterns) {
      const m = body.match(p);
      if (m) {
        hits += 1;
        matched.push(`matched /${p.source}/`);
      }
    }
    if (hits > 0) {
      scores[rule.target] = scores[rule.target] || { score: 0, reasons: [] };
      scores[rule.target].score += hits * rule.weight;
      scores[rule.target].reasons.push(...matched);
    }
  }

  const entries = Object.entries(scores).sort((a, b) => b[1].score - a[1].score);
  if (entries.length === 0) {
    return { target: "UNCLEAR" as Target, confidence: 0, reasons: ["no patterns matched"], alternatives: [] };
  }

  const top = entries[0];
  const runnerUp = entries[1];
  const totalScore = top[1].score;
  const runnerUpScore = runnerUp ? runnerUp[1].score : 0;
  const margin = totalScore - runnerUpScore;
  const confidence = Math.min(1, (margin + totalScore * 0.3) / 10);

  return {
    target: top[0] as Target,
    confidence,
    reasons: top[1].reasons.slice(0, 3),
    alternatives: entries.slice(1, 4).map(([t]) => t as Target),
  };
}

// ─── Main ───

function main(): void {
  const args = process.argv.slice(2);
  const sourceIdx = args.indexOf("--source");
  const useStdin = args.includes("--stdin");
  const jsonOut = args.includes("--json");
  const dryRun = args.includes("--dry-run");

  if (!useStdin && sourceIdx === -1) {
    console.error("Required: --source <path> OR --stdin");
    console.error("Optional: --json (JSON output)  --dry-run (don't write queue)");
    process.exit(1);
  }

  const sources = readSource(useStdin ? "" : args[sourceIdx + 1], useStdin);
  const proposals: Proposal[] = [];

  for (const { file, content } of sources) {
    for (const { section, body } of chunkContent(file, content)) {
      if (body.length < 40) continue; // skip trivial
      const { target, confidence, reasons, alternatives } = classify(body);
      proposals.push({
        id: randomUUID(),
        timestamp: new Date().toISOString(),
        source_file: file,
        source_section: section,
        content_preview: body.slice(0, 160).replace(/\n/g, " "),
        content_full: body,
        proposed_target: target,
        classification_confidence: confidence,
        classification_reasons: reasons,
        alternatives,
        status: "pending",
      });
    }
  }

  // Summary
  const byTarget: Record<string, number> = {};
  for (const p of proposals) byTarget[p.proposed_target] = (byTarget[p.proposed_target] || 0) + 1;

  const avgConfidence = proposals.length
    ? proposals.reduce((s, p) => s + p.classification_confidence, 0) / proposals.length
    : 0;

  if (!dryRun && proposals.length) {
    const dir = dirname(QUEUE_FILE);
    if (!existsSync(dir)) mkdirSync(dir, { recursive: true });
    for (const p of proposals) appendFileSync(QUEUE_FILE, JSON.stringify(p) + "\n");
  }

  if (jsonOut) {
    console.log(JSON.stringify({ proposals, by_target: byTarget, avg_confidence: avgConfidence }, null, 2));
    return;
  }

  console.log(`═══ Migration Scan Results ═══\n`);
  console.log(`Sources scanned:    ${sources.length}`);
  console.log(`Chunks extracted:   ${proposals.length}`);
  console.log(`Avg confidence:     ${Math.round(avgConfidence * 100)}%`);
  console.log(`Queue file:         ${dryRun ? "(dry-run — not written)" : QUEUE_FILE}`);
  console.log(``);
  console.log(`Proposed routing:`);
  for (const [target, n] of Object.entries(byTarget).sort((a, b) => b[1] - a[1])) {
    const icon = target === "UNCLEAR" ? "❓" : target.startsWith("memory/feedback") ? "🧠" : "📂";
    console.log(`  ${icon}  ${target.padEnd(38)}  ${n} chunks`);
  }
  console.log(``);
  const unclear = proposals.filter((p) => p.proposed_target === "UNCLEAR");
  if (unclear.length) {
    console.log(`⚠️  ${unclear.length} chunks unclear — will need ${getPrincipalName()}'s routing decision.`);
  }
  const lowConf = proposals.filter((p) => p.classification_confidence < 0.4 && p.proposed_target !== "UNCLEAR");
  if (lowConf.length) {
    console.log(`⚠️  ${lowConf.length} chunks classified at <40% confidence — review recommended.`);
  }
  console.log(``);
  console.log(`Next: bun ~/.claude/WORKOS/TOOLS/MigrateApprove.ts --review`);
}

main();
