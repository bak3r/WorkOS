#!/usr/bin/env bun
/**
 * IntentRubric — an intent's Ideal State and Anti-criteria as asserts.
 *
 * Every skill intent opens with `## Ideal State` (testable outcome bullets) and
 * `## Anti-criteria` (what must never happen). This compiles those bullets into the
 * assert list EvalRunner and Proof grade against, so the definition of done the model
 * reads is the one its output is scored on. Proof and suites share this one compiler.
 *
 *   - A countable length bullet ("under 120 words", "at most 800 characters") becomes a
 *     required code assert. An Anti-criteria count holds the output to the inverted bound.
 *   - Every other bullet becomes one single-claim judged assert: `llm-assert` for an Ideal
 *     State bullet, `not-llm-assert` for an Anti-criteria bullet (passes when the judge says
 *     FALSE). UNKNOWN is a miss either way (Judge.ts). No bullet is ever ungraded.
 *   - Every assert carries `derived_from: <intent path>#IS-n` or `#AC-n`.
 *
 * Slimmed from upstream LifeOS 8.761.0: only word and character counts compile to code
 * (upstream also counts bullets, headings, links, sentences), and no fixture compiler.
 *
 *   bun IntentRubric.ts rubric <intent.md | skills/<Skill>> [--json]
 *   bun IntentRubric.ts suite <intent.md> --name <suite> --prompt "<p>" [--prompt ...]
 *       --adversarial "<output that only the judge can catch>" [--system-prompt-file <path>]
 *       [--judge-level low|medium|high|max] [--type capability|regression] [--trials N] [--threshold 0.75]
 *       [--out <file.yaml> [--force]]
 *
 * Exit: 0 ok · 1 no usable Ideal State or the suite does not validate · 64 usage.
 */

import { existsSync, readFileSync, readdirSync, statSync, writeFileSync } from 'node:fs';
import { basename, join, relative, resolve } from 'node:path';
import { parseArgs } from 'node:util';
import { parseIntent } from '../../../WORKOS/TOOLS/lib/IntentSections.ts';
import { getClaudeDir } from '../../../WORKOS/TOOLS/Paths.ts';
import type { Assertion } from './Assertions.ts';
import { validateSuite } from './SuiteManager.ts';

export interface IntentRubric { intent: string; path: string; sha256: string; asserts: Assertion[]; gap?: string }

const NUM_WORDS: Record<string, number> = { one: 1, two: 2, three: 3, four: 4, five: 5, six: 6, seven: 7, eight: 8, nine: 9, ten: 10, twelve: 12, twenty: 20 };

function num(s: string): number | null {
  const t = s.toLowerCase().replace(/[,_]/g, '');
  if (/^\d+$/.test(t)) return Number(t);
  return NUM_WORDS[t] ?? null;
}

/**
 * A regex that matches when the output has at most `n` words, a word being a run of
 * non-whitespace. Each token must end at whitespace or the end, so a word is never split
 * into two tokens and a miss never backtracks. Assertions.ts compiles regexes with no flags.
 */
export function maxWordsRegex(n: number): string {
  return `^\\s*(?:\\S+(?:\\s+|$)){0,${n}}$`;
}

/** Code asserts for a countable length bound, or [] when the bullet is not one. */
export function countAsserts(bullet: string, anti: boolean): Assertion[] {
  const m = bullet.match(/\b(under|fewer than|less than|at most|no more than|up to|maximum of|max(?:imum)?|over|more than|at least|minimum of)\s+(\d[\d,]*|[a-z]+)\s+(words?|characters?|chars?)\b/i);
  if (!m) return [];
  let n = num(m[2]);
  if (n === null) return [];
  const op = m[1].toLowerCase();
  const unit = m[3].toLowerCase().startsWith('w') ? 'words' : 'characters';
  // Normalise to an upper or lower bound on the output.
  let upper: number | null = null, lower: number | null = null;
  if (/^(under|fewer than|less than)$/.test(op)) upper = n - 1;
  else if (/^(at most|no more than|up to|maximum of|max|maximum)$/.test(op)) upper = n;
  else if (/^(over|more than)$/.test(op)) lower = n + 1;
  else lower = n;
  // An anti-criterion forbids the bound it names, so invert it.
  if (anti) { if (upper !== null) { lower = upper + 1; upper = null; } else if (lower !== null) { upper = lower - 1; lower = null; } }
  const metric = `${unit}:${upper !== null ? `<=${upper}` : `>=${lower}`}`;
  if (unit === 'characters') {
    return [upper !== null ? { type: 'max-length', threshold: upper, required: true, metric } : { type: 'min-length', threshold: lower!, required: true, metric }];
  }
  if (upper !== null) return [{ type: 'regex', value: maxWordsRegex(upper), required: true, metric }];
  if (lower! <= 0) return [];
  return [{ type: 'not-regex', value: maxWordsRegex(lower! - 1), required: true, metric }];
}

function displayPath(p: string): string {
  const root = getClaudeDir();
  const abs = resolve(p);
  return abs.startsWith(root + '/') ? relative(root, abs) : abs;
}

/** The asserts for one intent file's Ideal State and Anti-criteria. */
export function rubricFor(path: string): IntentRubric {
  const text = readFileSync(path, 'utf-8');
  const parsed = parseIntent(text);
  const shown = displayPath(path);
  const sha256 = new Bun.CryptoHasher('sha256').update(text).digest('hex');
  const intent = basename(path, '.md') === 'SKILL' ? basename(resolve(path, '..')) : basename(path, '.md');
  const asserts: Assertion[] = [];
  parsed.idealState.forEach((b, i) => {
    const id = `${shown}#IS-${i + 1}`;
    const code = countAsserts(b, false).map((a) => ({ ...a, derived_from: id }));
    asserts.push(...code);
    // A count alone is fully covered by code; anything more the bullet asks stays judged.
    const onlyCount = code.length > 0 && b.replace(/[^\p{L}\p{N}\s]/gu, '').split(/\s+/).filter(Boolean).length <= 8;
    if (!onlyCount) asserts.push({ type: 'llm-assert', value: [b], derived_from: id });
  });
  parsed.antiCriteria.forEach((b, i) => {
    const id = `${shown}#AC-${i + 1}`;
    const code = countAsserts(b, true).map((a) => ({ ...a, derived_from: id }));
    asserts.push(...code);
    const onlyCount = code.length > 0 && b.replace(/[^\p{L}\p{N}\s]/gu, '').split(/\s+/).filter(Boolean).length <= 8;
    if (!onlyCount) asserts.push({ type: 'not-llm-assert', value: [`The output does what this anti-criterion forbids: "${b}"`], derived_from: id });
  });
  return { intent, path: shown, sha256, asserts, ...(parsed.idealState.length ? {} : { gap: 'no ## Ideal State bullets' }) };
}

/** One intent file, or every Intents/*.md of a skill directory (its SKILL.md when it has none). */
export function intentFiles(src: string): string[] {
  if (!existsSync(src)) throw new Error(`no such file or directory: ${src}`);
  if (statSync(src).isFile()) return [src];
  const dir = join(src, 'Intents');
  if (existsSync(dir)) return readdirSync(dir).filter((f) => f.endsWith('.md')).sort().map((f) => join(dir, f));
  return [join(src, 'SKILL.md')];
}

function toYaml(v: unknown): string {
  return Bun.YAML.stringify(v, null, 2);
}

if (import.meta.main) {
  const [cmd, src, ...rest] = Bun.argv.slice(2);
  const { values } = parseArgs({
    args: rest,
    options: {
      json: { type: 'boolean' }, name: { type: 'string' }, prompt: { type: 'string', multiple: true },
      adversarial: { type: 'string' }, 'system-prompt-file': { type: 'string' }, 'judge-level': { type: 'string' },
      type: { type: 'string' }, trials: { type: 'string' }, threshold: { type: 'string' }, out: { type: 'string' }, force: { type: 'boolean' },
    },
  });
  if (!cmd || !src || !['rubric', 'suite'].includes(cmd)) {
    console.error('usage: IntentRubric.ts rubric <intent.md | skills/<Skill>> [--json]\n       IntentRubric.ts suite <intent.md> --name <suite> --prompt "<p>" --adversarial "<text>" [--out <file.yaml>]');
    process.exit(64);
  }
  let rubrics: IntentRubric[];
  try { rubrics = intentFiles(src).map(rubricFor); } catch (e) { console.error(`IntentRubric: ${(e as Error).message}`); process.exit(64); }
  for (const r of rubrics) if (r.gap) console.error(`skipped ${r.path}: ${r.gap}`);
  const usable = rubrics.filter((r) => !r.gap);
  if (!usable.length) { console.error('IntentRubric: no intent in the source has Ideal State bullets'); process.exit(1); }

  if (cmd === 'rubric') {
    if (values.json) console.log(JSON.stringify(usable, null, 2));
    else for (const r of usable) console.log(`# ${r.path} (sha256 ${r.sha256.slice(0, 12)})\n${toYaml(r.asserts)}`);
    process.exit(0);
  }

  if (usable.length !== 1 || !values.name || !values.prompt?.length) {
    console.error('IntentRubric suite: needs one intent file, --name and at least one --prompt'); process.exit(64);
  }
  const r = usable[0];
  const suite: Record<string, unknown> = {
    name: values.name,
    description: `Generated from ${r.path} (sha256 ${r.sha256.slice(0, 12)}); regenerate when the intent changes.`,
    type: values.type ?? 'capability',
    trials: values.trials ? Number(values.trials) : 3,
    pass_threshold: values.threshold ? Number(values.threshold) : 0.75,
    ...(values['judge-level'] ? { judge_level: values['judge-level'] } : {}),
    ...(values['system-prompt-file'] ? { system_prompt_file: values['system-prompt-file'] } : {}),
    cases: values.prompt.map((p, i) => ({
      id: `${r.intent.toLowerCase()}_${i + 1}`,
      prompt: p,
      assert: r.asserts,
      ...(i === 0 && values.adversarial ? { adversarial_output: values.adversarial } : {}),
    })),
  };
  const v = validateSuite(suite as never);
  if (!v.ok) { console.error(`generated suite does not validate:\n  ${v.errors.join('\n  ')}`); process.exit(1); }
  const yaml = toYaml(suite);
  if (!values.out) { console.log(yaml); process.exit(0); }
  if (existsSync(values.out) && !values.force) { console.error(`refusing to overwrite ${values.out} (pass --force)`); process.exit(1); }
  writeFileSync(values.out, yaml);
  console.log(`wrote ${values.out}`);
}
