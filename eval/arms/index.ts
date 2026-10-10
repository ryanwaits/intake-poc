import { liveEvaluate } from '../../src/core/jev';
import { type Decide, typedDecide } from '../../src/core/run';
import { claudeE2E, claudeTyped } from './claude';
import { localTyped } from './local';
import { lunaTyped } from './luna';
import { rulesDecide } from './rules';
import { clefEvaluate, kevEvaluate } from './system-one';

export type Arm = {
  id: string;
  label: string;
  model: string;
  approach: 'rules' | 'decision-api' | 'typed' | 'end-to-end';
  /** Lazy, so selecting one arm never constructs another provider's client. */
  decide: () => Decide;
  /** USD per million tokens. */
  price: { input: number; output: number };
  concurrency: number;
  /** Can the vendor cover PHI under a BAA, and can it run in the clinic's own cloud account? */
  baa: string;
  selfHost: boolean;
  /** Code that exists only for this arm, for the complexity comparison. */
  files: string[];
};

const TYPED_CORE = ['src/core/questions.ts', 'src/core/decisions.ts'];

/**
 * Prices as published on 2026-10-08/09: TypeSafe models page, Anthropic and OpenAI pricing pages,
 * Cloudflare Workers AI model pages (Clef $0.24, Clef-flash $0.09 per million input tokens).
 * Clef and Kev publish open weights (Apache-2.0), so both can also run in your own account.
 */
export const ARMS: Arm[] = [
  {
    id: 'rules',
    label: 'Rules only',
    model: 'none',
    approach: 'rules',
    decide: rulesDecide,
    price: { input: 0, output: 0 },
    concurrency: 16,
    baa: 'n/a, no vendor',
    selfHost: true,
    files: ['eval/arms/rules.ts'],
  },
  {
    id: 'jev',
    label: 'Jev decision API',
    model: 'jev-1.13.0',
    approach: 'decision-api',
    decide: () => typedDecide(liveEvaluate()),
    price: { input: 0.042, output: 0 },
    concurrency: 8,
    baa: 'Not offered publicly',
    selfHost: false,
    files: [...TYPED_CORE, 'src/core/jev.ts'],
  },
  {
    id: 'clef',
    label: 'Clef 27B (Cloudflare)',
    model: '@cf/cloudflare/clef',
    approach: 'decision-api',
    decide: () => typedDecide(clefEvaluate('clef')),
    price: { input: 0.24, output: 0 },
    concurrency: 8,
    baa: 'Not stated for Workers AI',
    selfHost: true,
    files: [...TYPED_CORE, 'eval/arms/system-one.ts'],
  },
  {
    id: 'clef-flash',
    label: 'Clef-flash 9B (Cloudflare)',
    model: '@cf/cloudflare/clef-flash',
    approach: 'decision-api',
    decide: () => typedDecide(clefEvaluate('clef-flash')),
    price: { input: 0.09, output: 0 },
    concurrency: 8,
    baa: 'Not stated for Workers AI',
    selfHost: true,
    files: [...TYPED_CORE, 'eval/arms/system-one.ts'],
  },
  {
    id: 'kev-4b',
    label: 'Kev-4B local (MLX)',
    model: 'jaredpalmer/kev-4b@v1.0',
    approach: 'decision-api',
    decide: () => typedDecide(kevEvaluate(process.env.KEV_URL ?? 'http://127.0.0.1:8009')),
    price: { input: 0, output: 0 },
    concurrency: 1,
    baa: 'Not needed, data never leaves',
    selfHost: true,
    files: [...TYPED_CORE, 'eval/arms/system-one.ts'],
  },
  {
    id: 'haiku-typed',
    label: 'Haiku 5.5, typed',
    model: 'claude-haiku-5-5',
    approach: 'typed',
    decide: () => claudeTyped('claude-haiku-5-5'),
    price: { input: 0.1, output: 0.5 },
    concurrency: 8,
    baa: 'Yes, via Anthropic sales',
    selfHost: false,
    files: [...TYPED_CORE, 'eval/arms/typed.ts', 'eval/arms/claude.ts'],
  },
  {
    id: 'luna-typed',
    label: 'GPT-6 Luna, typed + logprobs',
    model: 'gpt-6-luna',
    approach: 'typed',
    decide: () => lunaTyped('gpt-6-luna'),
    price: { input: 0.1, output: 0.5 },
    concurrency: 8,
    baa: 'Yes, via OpenAI sales',
    selfHost: false,
    files: [...TYPED_CORE, 'eval/arms/typed.ts', 'eval/arms/luna.ts'],
  },
  {
    id: 'local-typed',
    label: 'Qwen 3.8 27B local, typed',
    model: 'qwen3.8:27b',
    approach: 'typed',
    decide: () => localTyped('qwen3.8:27b'),
    price: { input: 0, output: 0 },
    concurrency: 1,
    baa: 'Not needed, data never leaves',
    selfHost: true,
    files: [...TYPED_CORE, 'eval/arms/typed.ts', 'eval/arms/local.ts'],
  },
  {
    id: 'haiku-e2e',
    label: 'Haiku 5.5, one prompt',
    model: 'claude-haiku-5-5',
    approach: 'end-to-end',
    decide: () => claudeE2E('claude-haiku-5-5'),
    price: { input: 0.1, output: 0.5 },
    concurrency: 8,
    baa: 'Yes, via Anthropic sales',
    selfHost: false,
    files: ['eval/arms/e2e.ts', 'eval/arms/claude.ts'],
  },
  {
    id: 'opus-e2e',
    label: 'Opus 5.5, one prompt',
    model: 'claude-opus-5-5',
    approach: 'end-to-end',
    decide: () => claudeE2E('claude-opus-5-5'),
    price: { input: 4, output: 20 },
    concurrency: 4,
    baa: 'Yes, via Anthropic sales',
    selfHost: false,
    files: ['eval/arms/e2e.ts', 'eval/arms/claude.ts'],
  },
];
