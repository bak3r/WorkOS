#!/usr/bin/env bun
/**
 * EvalRunner — assertion-first suite runner for WorkOS Assay.
 *
 * A CASE is `{id, prompt, assert:[...]}`. The model under test answers the prompt
 * with the LIVE system prompt + DA identity as its system (so a config edit that
 * shifts dispositions shows up). Each assertion is graded by code (Assertions.ts)
 * or by a Claude judge (Judge.ts). Cases run `trials` times and report pass^k
 * (every trial passed: the reliability metric and the regression gate) beside
 * pass@k, with SEM and a 95% CI over per-case means (Stats.ts).
 *
 * Evidence rules (from upstream Assay):
 *   - Deterministic asserts run first; a failed required one skips the judges on
 *     that output and fails the trial. Weights never buy off a required failure.
 *   - A trial with no model answer, or with any judge that returned no verdict,
 *     is UNAVAILABLE: excluded from every score. Any unavailable trial makes the
 *     run no-verdict (exit 2), and latest.json keeps the last real verdict.
 *   - Fewer completed trials than requested never claims pass^k for that case.
 *   - A case with `adversarial_output` grades that canned output every run. It
 *     passes every code assert, so only the judge can catch it; a judge that
 *     passes it is not load-bearing and the suite fails.
 *
 * Suite resolution: USER customizations first (assayUserDir()/Suites), then the
 * skill's own Suites/. Results: WORKOS/MEMORY/STATE/Evals-Results/<suite>/.
 *
 * Slimmed from upstream 8.761.0: no judgment-layer engine, no router, no
 * calibration taste, no image lane. Claude only, through WORKOS/TOOLS/Inference.ts.
 */

import { getClaudeDir, assayUserDir } from '../../../WORKOS/TOOLS/Paths';
import { readFileSync, existsSync, mkdirSync, writeFileSync } from 'node:fs';
import { dirname, isAbsolute, join, resolve } from 'node:path';
import { homedir } from 'node:os';
import { parseArgs } from 'node:util';
import { evaluateDeterministic, isModelAssert, type Assertion, type AssertResult } from './Assertions.ts';
import { judgeAssertion, type JudgeOptions } from './Judge.ts';
import { summarize, type Summary } from './Stats.ts';
import { validateSuite } from './SuiteManager.ts';
import { inference, type InferenceLevel } from '../../../WORKOS/TOOLS/Inference.ts';

const parseYaml = (s: string): any => Bun.YAML.parse(s); // built-in; identical to the yaml package for suite files

const CLAUDE_ROOT = getClaudeDir();
export const RESULTS_DIR = join(CLAUDE_ROOT, 'WORKOS', 'MEMORY', 'STATE', 'Evals-Results');
const SKILL_SUITES = join(import.meta.dir, '..', 'Suites');

export interface EvalCase {
  id: string;
  prompt: string;
  assert: Assertion[];
  threshold?: number;
  negative?: boolean; // documents a should-NOT case (balance); no behavior change
  /** A canned output that passes every code assert on this case and only the judge can catch. */
  adversarial_output?: string;
}

export interface EvalSuiteV2 {
  name: string;
  type?: 'capability' | 'regression';
  pass_threshold?: number;
  agent_level?: InferenceLevel;
  judge_level?: InferenceLevel;
  trials?: number;
  subject_timeout_ms?: number; // per-answer timeout for the model under test (default 90000)
  system_prompt?: string; // override; default = live system prompt + DA identity
  system_prompt_file?: string; // REPLACES the system prompt with this file (~ ok; relative to the suite file)
  append_to_base?: boolean; // with system_prompt_file: append to the live base prompt instead of replacing
  cases: EvalCase[];
}

export interface TrialResult { score: number; passed: boolean; asserts: AssertResult[]; output: string; unavailable?: string }

export interface CaseResult {
  id: string;
  mean_score: number;
  pass_at_k: number;
  pass_to_k: number;
  requested_trials: number;
  completed_trials: number;
  /** Trials with no verdict (inference or judge unavailable). Excluded from every score. */
  infra_errors: number;
  trials: TrialResult[];
  adversarial?: { caught: boolean; unavailable: boolean; asserts: AssertResult[] };
}

export interface SuiteResult {
  suite: string;
  type: string;
  passed: boolean;
  score: number; // suite mean of per-case means
  pass_to_k: number; // headline: mean per-case pass^k
  pass_at_k: number;
  summary: string;
  run_id: string;
  infra_errors: number;
  /** Any unavailable evaluator makes this run no-verdict: exit 2, latest.json untouched. */
  verifier_unavailable: boolean;
  cases: { id: string; mean_score: number; pass_to_k: number; pass_at_k: number; requested_trials: number; completed_trials: number; infra_errors: number }[];
  /** Never a bare mean: SEM + 95% CI over per-case means. */
  stats?: Summary;
  /** Fraction of the suite's assertions that are model-graded. Should fall over time. */
  judged_residue?: number;
  adversarial?: { cases: number; caught: number; missed: string[] };
  agent_level?: InferenceLevel;
  judge_level?: InferenceLevel;
  duration_ms?: number;
  ts?: string;
}

/** Injectable dependencies keep the unavailable-evidence rules testable without paid inference. */
export interface EvalRunDeps {
  invoke?: (systemPrompt: string, userPrompt: string, level: InferenceLevel, timeout: number) => Promise<{ success: boolean; output: string; error?: string }>;
  judge?: typeof judgeAssertion;
  resultsDir?: string;
  quiet?: boolean;
}

export function buildLiveSystemPrompt(): string {
  const sources = [
    join(CLAUDE_ROOT, 'WORKOS', 'WORKOS_SYSTEM_PROMPT.md'),
    join(CLAUDE_ROOT, 'WORKOS', 'USER', 'DIGITAL_ASSISTANT', 'DA_IDENTITY.md'),
  ];
  const parts = sources.filter(existsSync).map((f) => readFileSync(f, 'utf-8'));
  return parts.length ? parts.join('\n\n---\n\n') : 'You are a precise assistant. Verify before claiming done; be concise.';
}

export function resolveSuite(name: string): string | null {
  if ((name.endsWith('.yaml') || name.endsWith('.yml')) && existsSync(name)) return resolve(name);
  for (const dir of [join(assayUserDir(), 'Suites'), SKILL_SUITES]) {
    for (const ext of ['yaml', 'yml']) {
      for (const sub of ['', 'Regression', 'Capability', '_drafts']) {
        const p = join(dir, sub, `${name}.${ext}`);
        if (existsSync(p)) return p;
      }
    }
  }
  return null;
}

function expandHome(p: string): string {
  return p === '~' ? homedir() : p.startsWith('~/') ? join(homedir(), p.slice(2)) : p;
}

/** Every assert on one output. Code asserts first; a failed required one skips the judges. */
export async function applyAsserts(output: string, asserts: Assertion[], judgeLevel: InferenceLevel, judge: typeof judgeAssertion = judgeAssertion, judgeOpts: JudgeOptions = {}): Promise<AssertResult[]> {
  const out: AssertResult[] = new Array(asserts.length);
  const record = (a: Assertion, r: AssertResult): AssertResult => ({
    ...r,
    required: a.required ?? !isModelAssert(a.type),
    ...(a.derived_from ? { derived_from: a.derived_from } : {}),
  });
  for (const [i, a] of asserts.entries()) if (!isModelAssert(a.type)) out[i] = record(a, evaluateDeterministic(output, a));
  const blocked = out.some((r) => r?.required && !r.passed);
  await Promise.all(asserts.map(async (a, i) => {
    if (!isModelAssert(a.type)) return;
    out[i] = record(a, blocked
      ? { type: a.type, passed: false, score: 0, weight: a.weight ?? 1, skipped: true, reason: 'Skipped: required deterministic prerequisite failed' }
      : await judge(output, a, { ...judgeOpts, level: judgeLevel }));
  }));
  return out;
}

function weighted(results: AssertResult[]): number {
  const tw = results.reduce((s, r) => s + r.weight, 0);
  return tw > 0 ? results.reduce((s, r) => s + r.score * r.weight, 0) / tw : 0;
}

/** Required failures cannot be bought off by weights or a permissive threshold. */
export function scoreAssertions(results: AssertResult[], threshold: number): { score: number; passed: boolean } {
  const blocked = results.some((r) => r.skipped || (r.required && !r.passed));
  const score = blocked ? 0 : weighted(results);
  return { score, passed: !blocked && score >= threshold };
}

/** Per-case statistics from the completed trials only. */
export function caseStats(trials: TrialResult[], requested: number): Pick<CaseResult, 'mean_score' | 'pass_at_k' | 'pass_to_k' | 'completed_trials' | 'infra_errors'> {
  const done = trials.filter((t) => !t.unavailable);
  const passed = done.filter((t) => t.passed).length;
  return {
    mean_score: done.length ? done.reduce((s, t) => s + t.score, 0) / done.length : 0,
    pass_at_k: passed > 0 ? 1 : 0,
    // pass^k means every one of the k requested trials passed; a partial set cannot establish it.
    pass_to_k: done.length === requested && passed === requested ? 1 : 0,
    completed_trials: done.length,
    infra_errors: trials.length - done.length,
  };
}

function loadSuite(name: string, override: Partial<EvalSuiteV2>): { suite?: EvalSuiteV2; path?: string; error?: string } {
  const path = resolveSuite(name);
  if (path) {
    const suite = { ...(parseYaml(readFileSync(path, 'utf-8')) as EvalSuiteV2), ...override };
    return { suite, path };
  }
  if (override.cases?.length) return { suite: { name, ...override } as EvalSuiteV2 };
  return { error: `Suite not found: ${name}` };
}

function systemPromptFor(suite: EvalSuiteV2, path?: string): string {
  if (suite.system_prompt) return suite.system_prompt;
  if (suite.system_prompt_file) {
    const raw = expandHome(suite.system_prompt_file);
    const file = isAbsolute(raw) ? raw : resolve(path ? dirname(path) : process.cwd(), raw);
    const body = readFileSync(file, 'utf-8');
    return suite.append_to_base ? `${buildLiveSystemPrompt()}\n\n---\n\n${body}` : body;
  }
  return buildLiveSystemPrompt();
}

// The model under test runs single-shot with NO tools. Without this the agentic
// system prompt makes it narrate tool calls and defer the answer, so the eval
// measures "reaches for tools" instead of the target disposition.
const EVAL_CONTEXT =
  '\n\n---\n[EVALUATION CONTEXT] You are being evaluated in a single-shot setting with NO tools available. ' +
  'Do not narrate or simulate tool calls. Give your best final answer directly, applying your normal judgment, ' +
  'voice, and verification discipline within the answer itself (e.g. state plainly when something would need checking).';

const errorResult = (name: string, summary: string, unavailable = false): SuiteResult => ({
  suite: name, type: 'unknown', passed: false, score: 0, pass_to_k: 0, pass_at_k: 0, summary, run_id: 'error',
  infra_errors: unavailable ? 1 : 0, verifier_unavailable: unavailable, cases: [],
});

export async function runSuite(name: string, override: Partial<EvalSuiteV2> = {}, deps: EvalRunDeps = {}): Promise<SuiteResult> {
  const startedAt = Date.now();
  const log = deps.quiet ? () => {} : (s: string) => console.log(s);
  const loaded = loadSuite(name, override);
  if (!loaded.suite) return errorResult(name, loaded.error!);
  const suite = loaded.suite;
  if (!Array.isArray(suite.cases) || suite.cases.length === 0) {
    const legacy = (suite as unknown as { tasks?: unknown[] }).tasks;
    return errorResult(name, Array.isArray(legacy)
      ? `Suite '${name}' is in the legacy v1 format (\`tasks:\`); this runner needs v2 \`cases:\` with prompt/assert.`
      : `Suite '${name}' has no \`cases:\` to run.`);
  }
  for (const c of suite.cases) {
    if (!c.id || typeof c.prompt !== 'string' || !Array.isArray(c.assert)) return errorResult(name, `Invalid suite: case ${c.id ?? '(no id)'} needs id, prompt and assert[]`);
  }
  const validation = validateSuite(suite);
  if (!validation.ok) return errorResult(name, `Invalid suite: ${validation.errors.join('; ')}`, true);

  const threshold = suite.pass_threshold ?? 0.75;
  const trials = Math.max(1, suite.trials ?? 3);
  const agentLevel: InferenceLevel = suite.agent_level ?? 'medium';
  const judgeLevel: InferenceLevel = suite.judge_level ?? 'high';
  const timeout = suite.subject_timeout_ms ?? 90_000;
  const systemPrompt = systemPromptFor(suite, loaded.path) + EVAL_CONTEXT;
  const invoke = deps.invoke ?? (async (sys: string, user: string, level: InferenceLevel, t: number) => {
    const r = await inference({ systemPrompt: sys, userPrompt: user, level, timeout: t });
    return { success: r.success, output: r.output ?? '', error: r.error };
  });
  const judge = deps.judge ?? judgeAssertion;
  const runId = `run_${Date.now()}_${Math.random().toString(36).slice(2, 8)}`;

  const caseResults: CaseResult[] = [];
  const adversarial = { cases: 0, caught: 0, missed: [] as string[] };
  for (const c of suite.cases) {
    const caseThreshold = c.threshold ?? threshold;
    let adv: CaseResult['adversarial'];
    if (typeof c.adversarial_output === 'string') {
      adversarial.cases++;
      const asserts = await applyAsserts(c.adversarial_output, c.assert, judgeLevel, judge);
      const unavailable = asserts.some((r) => r.unavailable);
      const caught = !unavailable && !scoreAssertions(asserts, caseThreshold).passed;
      if (caught) adversarial.caught++; else if (!unavailable) adversarial.missed.push(c.id);
      adv = { caught, unavailable, asserts };
      log(`  ${c.id} adversarial: ${unavailable ? '⚠️ verifier unavailable — no verdict' : caught ? '🪤 caught' : '❌ MISSED — the judge passed the canned output'}`);
    }
    const trialResults: TrialResult[] = [];
    for (let t = 0; t < trials; t++) {
      const res = await invoke(systemPrompt, c.prompt, agentLevel, timeout);
      if (!res.success) {
        trialResults.push({ score: 0, passed: false, asserts: [], output: '', unavailable: `model under test unavailable: ${res.error ?? 'inference failed'}` });
        log(`  ${c.id} t${t + 1}: ⚠️ verifier unavailable — ${(res.error ?? 'inference failed').split('\n')[0].slice(0, 120)}`);
        continue;
      }
      const output = res.output.trim();
      const asserts = await applyAsserts(output, c.assert, judgeLevel, judge);
      const missing = asserts.find((r) => r.unavailable);
      if (missing) {
        trialResults.push({ score: 0, passed: false, asserts, output, unavailable: missing.reason });
        log(`  ${c.id} t${t + 1}: ⚠️ evaluator unavailable — ${missing.reason.split('\n')[0].slice(0, 120)}`);
        continue;
      }
      const { score, passed } = scoreAssertions(asserts, caseThreshold);
      trialResults.push({ score, passed, asserts, output });
      log(`  ${c.id} t${t + 1}: ${passed ? '✅' : '❌'} ${(score * 100).toFixed(0)}%`);
    }
    caseResults.push({ id: c.id, requested_trials: trials, trials: trialResults, ...(adv ? { adversarial: adv } : {}), ...caseStats(trialResults, trials) });
  }

  const infraErrors = caseResults.reduce((s, c) => s + c.infra_errors + (c.adversarial?.unavailable ? 1 : 0), 0);
  const verifierUnavailable = infraErrors > 0;
  const stats = summarize(caseResults.map((c) => c.mean_score));
  const meanScore = stats.mean;
  const passToK = caseResults.reduce((s, c) => s + c.pass_to_k, 0) / caseResults.length;
  const passAtK = caseResults.reduce((s, c) => s + c.pass_at_k, 0) / caseResults.length;
  const allAsserts = suite.cases.flatMap((c) => c.assert);
  const judgedResidue = allAsserts.length ? allAsserts.filter((a) => isModelAssert(a.type)).length / allAsserts.length : 0;
  const passed = !verifierUnavailable && meanScore >= threshold && adversarial.missed.length === 0;

  const result: SuiteResult = {
    suite: suite.name ?? name,
    type: suite.type ?? 'regression',
    passed,
    score: meanScore,
    pass_to_k: passToK,
    pass_at_k: passAtK,
    summary: verifierUnavailable
      ? `verifier unavailable — ${infraErrors} trial${infraErrors === 1 ? '' : 's'} had no evaluator verdict; no verdict`
      : `pass^k ${(passToK * 100).toFixed(0)}%, mean ${(meanScore * 100).toFixed(1)}% ±${(stats.sem * 100).toFixed(1)} over ${trials} trials${adversarial.missed.length ? `; adversarial missed: ${adversarial.missed.join(', ')}` : ''}`,
    run_id: runId,
    infra_errors: infraErrors,
    verifier_unavailable: verifierUnavailable,
    cases: caseResults.map((c) => ({ id: c.id, mean_score: c.mean_score, pass_to_k: c.pass_to_k, pass_at_k: c.pass_at_k, requested_trials: c.requested_trials, completed_trials: c.completed_trials, infra_errors: c.infra_errors })),
    stats,
    judged_residue: judgedResidue,
    ...(adversarial.cases ? { adversarial } : {}),
    agent_level: agentLevel,
    judge_level: judgeLevel,
    duration_ms: Date.now() - startedAt,
    ts: new Date().toISOString(),
  };
  if (verifierUnavailable && result.passed) throw new Error('invariant: unavailable evidence cannot pass');

  // Persist transcripts (read them: the Anthropic gate) and, for a real verdict, latest status.
  const dir = join(deps.resultsDir ?? RESULTS_DIR, result.suite);
  mkdirSync(join(dir, runId), { recursive: true });
  writeFileSync(join(dir, runId, 'run.json'), JSON.stringify({ ...result, detail: caseResults }, null, 2));
  if (!verifierUnavailable) writeFileSync(join(dir, 'latest.json'), JSON.stringify(result, null, 2));
  return result;
}

if (import.meta.main) {
  const { values } = parseArgs({
    args: Bun.argv.slice(2),
    options: {
      suite: { type: 'string', short: 's' },
      trials: { type: 'string', short: 't' },
      json: { type: 'boolean' },
      help: { type: 'boolean', short: 'h' },
    },
    allowPositionals: true,
  });
  if (values.help || !values.suite) {
    console.log(`EvalRunner — assertion-first suite runner\n\n  bun EvalRunner.ts -s <suite|path.yaml> [-t trials] [--json]\n\nExit 0 = passed, 1 = regressed, 2 = evaluator unavailable (no verdict).`);
    process.exit(values.help ? 0 : 1);
  }
  const override: Partial<EvalSuiteV2> = {};
  if (values.trials) override.trials = parseInt(values.trials);
  if (!values.json) console.log(`\nRunning suite: ${values.suite}\n`);
  const result = await runSuite(values.suite, override, { quiet: !!values.json });
  if (values.json) {
    console.log(JSON.stringify(result, null, 2));
  } else {
    console.log(`\n📊 ${result.verifier_unavailable ? '⚠️ NO VERDICT' : result.passed ? '✅ PASSED' : '❌ REGRESSED'}: ${result.suite} (${result.type})`);
    console.log(`   ${result.summary}`);
    if (result.stats) console.log(`   95% CI [${(result.stats.ci95_lo * 100).toFixed(1)}%, ${(result.stats.ci95_hi * 100).toFixed(1)}%] over ${result.stats.n} cases · judge ${result.judge_level} · judged residue ${((result.judged_residue ?? 0) * 100).toFixed(0)}% · ${((result.duration_ms ?? 0) / 1000).toFixed(0)}s`);
    for (const c of result.cases) console.log(`   - ${c.id}: pass^k ${(c.pass_to_k * 100).toFixed(0)}%  mean ${(c.mean_score * 100).toFixed(0)}%  trials ${c.completed_trials}/${c.requested_trials}`);
  }
  process.exit(result.verifier_unavailable ? 2 : result.passed ? 0 : 1);
}
