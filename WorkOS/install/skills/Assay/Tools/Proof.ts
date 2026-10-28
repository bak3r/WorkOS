#!/usr/bin/env bun
/**
 * Proof — check one produced artifact against what was asked, before the principal sees it,
 * and write a receipt bound to its exact bytes.
 *
 *   bun Proof.ts run --artifact <file> [--intent <Intent.md>] [--ask "<what was asked>"]
 *                    [--asserts <asserts.yaml>] [--judge-level low|medium|high|max] [--no-judge] [--json]
 *   bun Proof.ts verify --artifact <file> [--json]
 *   bun Proof.ts show --artifact <file>
 *
 * Checks, by tier:
 *   code   the asserts in --asserts, and the countable bullets of --intent (IntentRubric.ts)
 *   judge  every other Ideal State / Anti-criteria bullet of --intent, and the --ask, each as
 *          one Claude judge call through WORKOS/TOOLS/Inference.ts
 *
 * Verdict rule (upstream LifeOS ProofReceipt.mayPresent, minus earned calibration):
 *   fail              a code check failed. Blocks.
 *   unavailable       a judge returned no verdict. No verdict; never a pass.
 *   admitted-flagged  nothing blocked, but a judge said no. WorkOS judges are uncalibrated
 *                     (no label store), so a judged "no" is a named flag the presenter must
 *                     state, never a block.
 *   unmeasured        nothing was checked against the ideal state (no intent, ask or asserts).
 *   pass              at least one check passed and nothing blocked or flagged.
 *
 * Receipts live in WORKOS/MEMORY/STATE/Proof/receipts/<sha256 of the artifact's absolute path>.json.
 * Freshness is by the artifact's sha256, never size or mtime, and each receipt carries the sha256
 * of its own body so a hand edit reads as tampered.
 *
 * Slimmed from upstream LifeOS 8.761.0: text artifacts only (no image, video or page lanes), no
 * judgment-layer questions, no label store, no hand-off or send gates.
 *
 * Exit: run 0 pass · 1 fail · 2 unavailable · 3 admitted-flagged or unmeasured · 64 usage.
 *       verify 0 fresh and presentable · 1 missing, stale, tampered or failing.
 */

import { createHash } from 'node:crypto';
import { existsSync, mkdirSync, readFileSync, renameSync, writeFileSync } from 'node:fs';
import { extname, join, resolve } from 'node:path';
import { parseArgs } from 'node:util';
import { workosPath } from '../../../WORKOS/TOOLS/Paths.ts';
import { evaluateDeterministic, isModelAssert, type Assertion, type AssertResult } from './Assertions.ts';
import { judgeAssertion, type JudgeOptions } from './Judge.ts';
import { rubricFor } from './IntentRubric.ts';
import type { InferenceLevel } from '../../../WORKOS/TOOLS/Inference.ts';

export const RECEIPT_SCHEMA = 'workos-proof-receipt/1';
export type ProofVerdict = 'pass' | 'admitted-flagged' | 'unmeasured' | 'fail' | 'unavailable';
export type ProofTier = 'code' | 'judge';

export interface ProofFinding {
  check: string;
  tier: ProofTier;
  /** pass | fail (code, blocks) | flag (judged no, never blocks) | unavailable (no verdict) | skipped */
  status: 'pass' | 'fail' | 'flag' | 'unavailable' | 'skipped';
  message: string;
  derived_from?: string;
}

export interface ProofReceipt {
  schema: typeof RECEIPT_SCHEMA;
  artifact: { path: string; sha256: string; bytes: number };
  against: { intent?: { path: string; sha256: string }; ask_sha256?: string; asserts?: { path: string; sha256: string } };
  ran_at: string;
  judge_level?: InferenceLevel;
  judge_calibrated: false;
  verdict: ProofVerdict;
  counts: Record<ProofFinding['status'], number>;
  findings: ProofFinding[];
  receipt_sha256: string;
}

const TEXT_KINDS = new Set(['', '.md', '.markdown', '.txt', '.html', '.htm', '.json', '.yaml', '.yml', '.csv', '.ts', '.tsx', '.js', '.mjs', '.py', '.cs', '.sql', '.sh', '.xml', '.toml', '.ini', '.log', '.eml']);

export const receiptsDir = (): string => process.env.WORKOS_PROOF_DIR ?? workosPath('MEMORY', 'STATE', 'Proof', 'receipts');
const sha = (b: string | Uint8Array): string => createHash('sha256').update(b).digest('hex');
export const receiptPath = (artifact: string): string => join(receiptsDir(), `${sha(resolve(artifact))}.json`);

function sealed(r: Omit<ProofReceipt, 'receipt_sha256'>): ProofReceipt {
  return { ...r, receipt_sha256: sha(JSON.stringify(r)) };
}

export function receiptIntact(r: ProofReceipt): boolean {
  const { receipt_sha256, ...body } = r;
  return sha(JSON.stringify(body)) === receipt_sha256;
}

/** The verdict rule, as a pure function over findings. */
export function verdictOf(findings: ProofFinding[]): ProofVerdict {
  const has = (s: ProofFinding['status']) => findings.some((f) => f.status === s);
  if (has('fail')) return 'fail';
  if (has('unavailable')) return 'unavailable';
  if (has('flag')) return 'admitted-flagged';
  return has('pass') ? 'pass' : 'unmeasured';
}

function toFinding(a: Assertion, r: AssertResult): ProofFinding {
  const tier: ProofTier = isModelAssert(a.type) ? 'judge' : 'code';
  const label = a.metric ?? (Array.isArray(a.value) ? String(a.value[0]) : String(a.value ?? a.type));
  const status: ProofFinding['status'] = r.unavailable ? 'unavailable' : r.skipped ? 'skipped' : r.passed ? 'pass' : tier === 'code' ? 'fail' : 'flag';
  return { check: `${a.type}: ${label.slice(0, 160)}`, tier, status, message: r.reason.slice(0, 400), ...(a.derived_from ? { derived_from: a.derived_from } : {}) };
}

export interface ProofRunOptions {
  artifact: string;
  intent?: string;
  ask?: string;
  asserts?: string;
  judgeLevel?: InferenceLevel;
  noJudge?: boolean;
  judge?: typeof judgeAssertion;
  judgeOpts?: JudgeOptions;
}

export async function runProof(o: ProofRunOptions): Promise<ProofReceipt> {
  const path = resolve(o.artifact);
  if (!existsSync(path)) throw new Error(`no such artifact: ${o.artifact}`);
  if (!TEXT_KINDS.has(extname(path).toLowerCase())) throw new Error(`unmeasured kind ${extname(path)}: WorkOS Proof checks text artifacts only`);
  const bytes = readFileSync(path);
  const text = bytes.toString('utf-8');
  const against: ProofReceipt['against'] = {};
  const asserts: Assertion[] = [];

  if (o.asserts) {
    const raw = readFileSync(o.asserts, 'utf-8');
    const parsed = Bun.YAML.parse(raw) as unknown;
    const list = Array.isArray(parsed) ? parsed : (parsed as { assert?: unknown[] })?.assert;
    if (!Array.isArray(list)) throw new Error(`${o.asserts}: expected a list of asserts or {assert: [...]}`);
    asserts.push(...(list as Assertion[]));
    against.asserts = { path: resolve(o.asserts), sha256: sha(raw) };
  }
  if (o.intent) {
    const r = rubricFor(o.intent);
    if (r.gap) throw new Error(`${o.intent}: ${r.gap}`);
    asserts.push(...r.asserts);
    against.intent = { path: r.path, sha256: r.sha256 };
  }
  if (o.ask) {
    asserts.push({ type: 'llm-assert', value: ['The output does what was asked, as stated in the REFERENCE.'], reference: o.ask, derived_from: 'ask' });
    against.ask_sha256 = sha(o.ask);
  }

  const judge = o.judge ?? judgeAssertion;
  const level = o.judgeLevel ?? 'high';
  const findings: ProofFinding[] = [];
  const codeResults = asserts.map((a) => (isModelAssert(a.type) ? null : evaluateDeterministic(text, a)));
  const blocked = codeResults.some((r, i) => r && (asserts[i].required ?? true) && !r.passed);
  const results = await Promise.all(asserts.map(async (a, i) => {
    if (codeResults[i]) return codeResults[i]!;
    if (o.noJudge) return { type: a.type, passed: false, score: 0, weight: 1, skipped: true, reason: 'judges not run (--no-judge)' } as AssertResult;
    if (blocked) return { type: a.type, passed: false, score: 0, weight: 1, skipped: true, reason: 'Skipped: a code check failed' } as AssertResult;
    return judge(text, a, { ...o.judgeOpts, level });
  }));
  asserts.forEach((a, i) => findings.push(toFinding(a, results[i])));

  const counts = { pass: 0, fail: 0, flag: 0, unavailable: 0, skipped: 0 } as ProofReceipt['counts'];
  for (const f of findings) counts[f.status]++;
  const receipt = sealed({
    schema: RECEIPT_SCHEMA,
    artifact: { path, sha256: sha(bytes), bytes: bytes.length },
    against,
    ran_at: new Date().toISOString(),
    ...(o.noJudge ? {} : { judge_level: level }),
    judge_calibrated: false,
    verdict: verdictOf(findings),
    counts,
    findings,
  });
  const out = receiptPath(path);
  mkdirSync(receiptsDir(), { recursive: true, mode: 0o700 });
  const tmp = `${out}.${process.pid}.tmp`;
  writeFileSync(tmp, JSON.stringify(receipt, null, 2), { mode: 0o600 });
  renameSync(tmp, out);
  return receipt;
}

export type Freshness = 'fresh' | 'stale' | 'missing' | 'tampered';

export function verifyArtifact(artifact: string): { freshness: Freshness; receipt?: ProofReceipt; presentable: boolean } {
  const path = resolve(artifact);
  const rp = receiptPath(path);
  if (!existsSync(rp)) return { freshness: 'missing', presentable: false };
  let receipt: ProofReceipt;
  try { receipt = JSON.parse(readFileSync(rp, 'utf-8')); } catch { return { freshness: 'tampered', presentable: false }; }
  if (receipt.schema !== RECEIPT_SCHEMA || !receiptIntact(receipt)) return { freshness: 'tampered', receipt, presentable: false };
  if (!existsSync(path) || sha(readFileSync(path)) !== receipt.artifact.sha256) return { freshness: 'stale', receipt, presentable: false };
  return { freshness: 'fresh', receipt, presentable: receipt.verdict === 'pass' || receipt.verdict === 'admitted-flagged' };
}

function report(r: ProofReceipt): string {
  const icon: Record<ProofFinding['status'], string> = { pass: '✅', fail: '❌', flag: '🚩', unavailable: '⚠️', skipped: '⏭️' };
  const lines = [`Proof ${r.verdict.toUpperCase()}: ${r.artifact.path} (sha256 ${r.artifact.sha256.slice(0, 12)})`];
  lines.push(`  ${r.counts.pass} pass · ${r.counts.fail} fail · ${r.counts.flag} flag · ${r.counts.unavailable} unavailable · ${r.counts.skipped} skipped${r.judge_level ? ` · judge ${r.judge_level} (uncalibrated)` : ''}`);
  for (const f of r.findings) lines.push(`  ${icon[f.status]} [${f.tier}] ${f.check}${f.status === 'pass' ? '' : ` — ${f.message}`}`);
  if (r.verdict === 'admitted-flagged') lines.push('  Present it only with every 🚩 flag stated.');
  lines.push(`  receipt: ${receiptPath(r.artifact.path)}`);
  return lines.join('\n');
}

if (import.meta.main) {
  const [cmd, ...rest] = Bun.argv.slice(2);
  const { values } = parseArgs({
    args: rest,
    options: {
      artifact: { type: 'string' }, intent: { type: 'string' }, ask: { type: 'string' }, asserts: { type: 'string' },
      'judge-level': { type: 'string' }, 'no-judge': { type: 'boolean' }, json: { type: 'boolean' }, help: { type: 'boolean', short: 'h' },
    },
  });
  if (values.help || !cmd || !['run', 'verify', 'show'].includes(cmd) || !values.artifact) {
    console.log('usage: Proof.ts run --artifact <file> [--intent <Intent.md>] [--ask "<asked>"] [--asserts <file.yaml>] [--judge-level L] [--no-judge] [--json]\n       Proof.ts verify --artifact <file> [--json]\n       Proof.ts show --artifact <file>');
    process.exit(values.help ? 0 : 64);
  }
  if (cmd === 'run') {
    let r: ProofReceipt;
    try {
      r = await runProof({ artifact: values.artifact, intent: values.intent, ask: values.ask, asserts: values.asserts, judgeLevel: values['judge-level'] as InferenceLevel | undefined, noJudge: values['no-judge'] });
    } catch (e) { console.error(`Proof: ${(e as Error).message}`); process.exit(64); }
    console.log(values.json ? JSON.stringify(r, null, 2) : report(r));
    process.exit({ pass: 0, fail: 1, unavailable: 2, 'admitted-flagged': 3, unmeasured: 3 }[r.verdict]);
  }
  const v = verifyArtifact(values.artifact);
  if (cmd === 'show') {
    if (!v.receipt) { console.log(`no receipt for ${values.artifact}`); process.exit(1); }
    console.log(`${report(v.receipt)}\n  freshness: ${v.freshness}`);
    process.exit(0);
  }
  if (values.json) console.log(JSON.stringify({ freshness: v.freshness, verdict: v.receipt?.verdict ?? null, presentable: v.presentable }));
  else console.log(`${values.artifact}: ${v.freshness}${v.receipt ? `, verdict ${v.receipt.verdict}` : ''}${v.presentable ? ' — presentable' : ' — not presentable'}`);
  process.exit(v.presentable ? 0 : 1);
}
