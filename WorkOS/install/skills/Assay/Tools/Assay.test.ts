/**
 * Assay-lite evidence rules, offline: every model call is injected, so these run free.
 *   bun test ./skills/Assay
 */
import { describe, expect, test, beforeAll } from 'bun:test';
import { mkdtempSync, writeFileSync, readFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import type { Assertion, AssertResult } from './Assertions.ts';
import { runSuite, caseStats, scoreAssertions, type EvalSuiteV2 } from './EvalRunner.ts';
import { countAsserts, rubricFor } from './IntentRubric.ts';
import { evaluateDeterministic } from './Assertions.ts';
import { judgeAssertion, extractJson } from './Judge.ts';

const tmp = mkdtempSync(join(tmpdir(), 'assay-test-'));
process.env.WORKOS_PROOF_DIR = join(tmp, 'receipts');
const { runProof, verifyArtifact, verdictOf, receiptPath } = await import('./Proof.ts');

/** A judge: positive asserts pass on `good`, negated ones fail on `secret`, everything is unavailable on `down`. */
const fakeJudge = async (output: string, a: Assertion): Promise<AssertResult> => {
  const w = a.weight ?? 1;
  if (output.includes('down')) return { type: a.type, passed: false, score: 0, reason: 'judge unavailable: timeout', weight: w, unavailable: true };
  const passed = a.type.startsWith('not-') ? !output.includes('secret') : output.includes('good');
  return { type: a.type, passed, score: passed ? 1 : 0, reason: passed ? 'ok' : 'no', weight: w };
};

const suite = (cases: EvalSuiteV2['cases'], extra: Partial<EvalSuiteV2> = {}): Partial<EvalSuiteV2> => ({ system_prompt: 'sys', trials: 2, cases, ...extra });
const judged = (id: string, adversarial = 'a bad answer'): EvalSuiteV2['cases'][number] => ({ id, prompt: 'p', assert: [{ type: 'llm-assert', value: ['is good'] }], adversarial_output: adversarial });
const deps = (outputs: (string | null)[]) => {
  let i = 0;
  return {
    quiet: true, resultsDir: join(tmp, 'results'), judge: fakeJudge as typeof judgeAssertion,
    invoke: async () => { const o = outputs[i++ % outputs.length]; return o === null ? { success: false, output: '', error: 'boom' } : { success: true, output: o }; },
  };
};

describe('EvalRunner', () => {
  test('all trials good: passes with pass^k 1 and a CI', async () => {
    const r = await runSuite('t-pass', suite([judged('c1')]), deps(['good']));
    expect(r.passed).toBe(true);
    expect(r.pass_to_k).toBe(1);
    expect(r.verifier_unavailable).toBe(false);
    expect(r.stats?.n).toBe(1);
    expect(r.adversarial).toEqual({ cases: 1, caught: 1, missed: [] });
  });

  test('an inference failure is unavailable, not a regression: no verdict, exit-2 shape', async () => {
    const r = await runSuite('t-down', suite([judged('c1')]), deps(['good', null]));
    expect(r.verifier_unavailable).toBe(true);
    expect(r.passed).toBe(false);
    expect(r.cases[0].completed_trials).toBe(1);
    expect(r.cases[0].pass_to_k).toBe(0); // a partial trial set never claims pass^k
    expect(r.cases[0].mean_score).toBe(1); // the completed trial still scores
  });

  test('an unavailable judge makes the trial unavailable', async () => {
    const r = await runSuite('t-judge-down', suite([judged('c1')]), deps(['down']));
    expect(r.verifier_unavailable).toBe(true);
    expect(r.infra_errors).toBe(2);
  });

  test('an adversarial output the judge passes fails the suite', async () => {
    const r = await runSuite('t-adv', suite([judged('c1', 'a good-looking fake')]), deps(['good']));
    expect(r.adversarial?.missed).toEqual(['c1']);
    expect(r.passed).toBe(false);
  });

  test('a failed required code assert skips the judges and fails the trial', async () => {
    const c = { id: 'c1', prompt: 'p', adversarial_output: 'a bad answer', assert: [{ type: 'not-icontains', value: 'forbidden' }, { type: 'llm-assert', value: ['is good'] }] as Assertion[] };
    const r = await runSuite('t-req', suite([c]), deps(['good but forbidden']));
    expect(r.passed).toBe(false);
    expect(r.cases[0].mean_score).toBe(0);
  });

  test('a judged suite without an adversarial fixture is invalid and gives no verdict', async () => {
    const r = await runSuite('t-invalid', suite([{ id: 'c1', prompt: 'p', assert: [{ type: 'llm-assert', value: ['x'] }] }]), deps(['good']));
    expect(r.verifier_unavailable).toBe(true);
    expect(r.summary).toContain('adversarial');
  });

  test('scoreAssertions and caseStats', () => {
    expect(scoreAssertions([{ type: 'x', passed: false, score: 0, reason: '', weight: 1, required: true }, { type: 'y', passed: true, score: 1, reason: '', weight: 9 }], 0.5)).toEqual({ score: 0, passed: false });
    const s = caseStats([{ score: 1, passed: true, asserts: [], output: '' }, { score: 0, passed: false, asserts: [], output: '', unavailable: 'x' }], 2);
    expect(s).toMatchObject({ completed_trials: 1, infra_errors: 1, pass_to_k: 0, pass_at_k: 1 });
  });
});

describe('Judge', () => {
  test('a failed call and an unparseable reply are unavailable, not a fail', async () => {
    const a: Assertion = { type: 'llm-rubric', value: 'r' };
    const down = await judgeAssertion('out', a, { invoke: async () => ({ success: false, output: '', error: 'timeout' }) });
    const junk = await judgeAssertion('out', a, { invoke: async () => ({ success: true, output: 'no json here' }) });
    expect(down.unavailable).toBe(true);
    expect(junk.unavailable).toBe(true);
  });

  test('UNKNOWN is a miss even when negated', async () => {
    const reply = '```json\n{"results":[{"assertion":"x","verdict":"UNKNOWN"}]}\n```';
    const r = await judgeAssertion('out', { type: 'not-llm-assert', value: ['x'] }, { invoke: async () => ({ success: true, output: reply }) });
    expect(r.passed).toBe(false);
    expect(r.unknown).toBe(true);
  });

  test('not-llm-assert passes only when every assertion is FALSE', async () => {
    const reply = (v: string) => `{"results":[{"assertion":"x","verdict":"${v}"}]}`;
    const no = await judgeAssertion('o', { type: 'not-llm-assert', value: ['x'] }, { invoke: async () => ({ success: true, output: reply('FALSE') }) });
    const yes = await judgeAssertion('o', { type: 'not-llm-assert', value: ['x'] }, { invoke: async () => ({ success: true, output: reply('TRUE') }) });
    expect([no.passed, yes.passed]).toEqual([true, false]);
  });

  test('extractJson takes the last object', () => {
    expect(extractJson('first {"a":1} then {"a":2}')).toEqual({ a: 2 });
  });
});

describe('IntentRubric', () => {
  test('length bounds compile to code, inverted for anti-criteria', () => {
    const under = countAsserts('The summary is under 5 words', false)[0];
    expect([evaluateDeterministic('one two three four', under).passed, evaluateDeterministic('one two three four five', under).passed]).toEqual([true, false]);
    const anti = countAsserts('More than 3 words', true)[0];
    expect([evaluateDeterministic('a b c', anti).passed, evaluateDeterministic('a b c d', anti).passed]).toEqual([true, false]);
    expect(countAsserts('at most 10 characters', false)[0]).toMatchObject({ type: 'max-length', threshold: 10, required: true });
    expect(countAsserts('names the owner', false)).toEqual([]);
  });

  test('every bullet is graded, with lineage', () => {
    const f = join(tmp, 'Intent.md');
    writeFileSync(f, '# X\n\n## Ideal State\n\n- Under 50 words\n- Names the owner of each step\n\n## Anti-criteria\n\n- Never invents a ticket number\n');
    const r = rubricFor(f);
    expect(r.asserts.map((a) => a.type)).toEqual(['regex', 'llm-assert', 'not-llm-assert']);
    expect(r.asserts.every((a) => a.derived_from?.match(/#(IS|AC)-\d$/))).toBe(true);
  });
});

describe('Proof', () => {
  let art: string;
  let intent: string;
  beforeAll(() => {
    art = join(tmp, 'out.md');
    intent = join(tmp, 'P.md');
    writeFileSync(intent, '# P\n\n## Ideal State\n\n- Under 20 words\n- The answer is good\n\n## Anti-criteria\n\n- Never mentions secrets\n');
  });

  test('verdict rule', () => {
    const f = (status: string) => ({ check: 'c', tier: 'code' as const, status: status as 'pass', message: '' });
    expect(verdictOf([])).toBe('unmeasured');
    expect(verdictOf([f('pass')])).toBe('pass');
    expect(verdictOf([f('pass'), f('flag')])).toBe('admitted-flagged');
    expect(verdictOf([f('flag'), f('unavailable')])).toBe('unavailable');
    expect(verdictOf([f('unavailable'), f('fail')])).toBe('fail');
  });

  test('a passing run writes a fresh receipt; changing the bytes makes it stale', async () => {
    writeFileSync(art, 'A short good answer.');
    const r = await runProof({ artifact: art, intent, judge: fakeJudge as typeof judgeAssertion });
    expect(r.verdict).toBe('pass');
    expect(verifyArtifact(art)).toMatchObject({ freshness: 'fresh', presentable: true });
    writeFileSync(art, 'A short good answer, edited.');
    expect(verifyArtifact(art)).toMatchObject({ freshness: 'stale', presentable: false });
  });

  test('a code failure fails and skips the judges', async () => {
    writeFileSync(art, 'good '.repeat(30));
    const r = await runProof({ artifact: art, intent, judge: fakeJudge as typeof judgeAssertion });
    expect(r.verdict).toBe('fail');
    expect(r.findings.filter((f) => f.tier === 'judge').every((f) => f.status === 'skipped')).toBe(true);
  });

  test('a judged no is a flag, not a fail', async () => {
    writeFileSync(art, 'A short plain answer.');
    const r = await runProof({ artifact: art, intent, judge: fakeJudge as typeof judgeAssertion });
    expect(r.verdict).toBe('admitted-flagged');
    expect(verifyArtifact(art).presentable).toBe(true);
  });

  test('an unavailable judge is no verdict and not presentable', async () => {
    writeFileSync(art, 'judge is down');
    const r = await runProof({ artifact: art, intent, judge: fakeJudge as typeof judgeAssertion });
    expect(r.verdict).toBe('unavailable');
    expect(verifyArtifact(art).presentable).toBe(false);
  });

  test('a hand-edited receipt reads as tampered', async () => {
    writeFileSync(art, 'A short good answer.');
    await runProof({ artifact: art, intent, judge: fakeJudge as typeof judgeAssertion });
    const rp = receiptPath(art);
    const edited = JSON.parse(readFileSync(rp, 'utf-8'));
    edited.verdict = 'pass';
    edited.counts.flag = 0;
    edited.ran_at = '2000-01-01T00:00:00.000Z';
    writeFileSync(rp, JSON.stringify(edited));
    expect(verifyArtifact(art).freshness).toBe('tampered');
  });

  test('no intent, ask or asserts is unmeasured', async () => {
    writeFileSync(art, 'anything');
    expect((await runProof({ artifact: art, judge: fakeJudge as typeof judgeAssertion })).verdict).toBe('unmeasured');
  });
});
