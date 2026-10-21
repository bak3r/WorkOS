/**
 * example-greeting.scenario.ts
 *
 * Minimum-viable scenario demonstrating WorkosAgentAdapter + scenario.userSimulatorAgent
 * + scenario.judgeAgent. The "agent under test" is a plain WorkOS-Inference call.
 *
 * Run:
 *   bun skills/Evals/Tools/ScenarioRunner.ts --scenario skills/Evals/Scenarios/example-greeting.scenario.ts
 *
 * *** API KEY BILLING WARNING ***
 * @langwatch/scenario userSimulatorAgent and judgeAgent use @ai-sdk/anthropic
 * which bills ANTHROPIC_API_KEY directly, NOT the subscription. Running a
 * scenario consumes API credit. The agent-under-test (WorkosAgentAdapter) still
 * routes through Inference.ts subscription — only the sim + judge billing is
 * the API. Set EVALS_ALLOW_API_BILLING=1 to acknowledge and run.
 */

import type { ScenarioConfig } from '@langwatch/scenario';
import { requireOptional } from '../../../WORKOS/TOOLS/lib/optional-dep.ts';
import { join } from 'node:path';
import { WorkosAgentAdapter } from '../Tools/WorkosAgentAdapter.ts';

const { anthropic } = await requireOptional(() => import('@ai-sdk/anthropic'), {
  pkg: '@ai-sdk/anthropic', feature: 'Evals multi-turn scenarios (ScenarioRunner)', installDir: join(import.meta.dir, '..'),
});
const { default: scenario } = await requireOptional(() => import('@langwatch/scenario'), {
  pkg: '@langwatch/scenario', feature: 'Evals multi-turn scenarios (ScenarioRunner)', installDir: join(import.meta.dir, '..'),
});

if (process.env.EVALS_ALLOW_API_BILLING !== '1') {
  throw new Error(
    'Evals scenario is guarded. Set EVALS_ALLOW_API_BILLING=1 to opt in — the @langwatch/scenario user-sim and judge bill the ANTHROPIC_API_KEY, not the subscription.',
  );
}

const judgeModel = anthropic('claude-sonnet-4-6');

const config: ScenarioConfig = {
  name: 'polite greeting',
  description:
    'A user greets a general-purpose assistant. The assistant should respond politely, in English, and keep the response concise.',
  agents: [
    new WorkosAgentAdapter({
      name: 'pai-assistant',
      systemPrompt: 'You are a concise, polite assistant. Keep replies under 40 words.',
      level: 'low',
    }),
    scenario.userSimulatorAgent({ model: judgeModel }),
    scenario.judgeAgent({
      model: judgeModel,
      criteria: [
        'Assistant responds in English',
        'Response is polite',
        'Response is under 40 words',
      ],
    }),
  ],
  script: [scenario.user(), scenario.agent(), scenario.judge()],
  maxTurns: 4,
};

export default config;
