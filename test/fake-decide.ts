import type { Decisions } from '../src/core/decisions';
import { CATEGORIES, type Category, RED_FLAGS, type RedFlag } from '../src/core/protocols';
import { buildQuestions } from '../src/core/questions';
import type { Decide } from '../src/core/run';

type Overrides = {
  flags?: Partial<Record<RedFlag, number>>;
  complaints?: Partial<Record<Category, number>>;
  answered?: Record<string, number>;
  setting?: Decisions['setting'];
};

/**
 * Deterministic stand-in for any arm: confident "no" on every flag and complaint,
 * nothing answered, routed to the clinic, unless overridden.
 */
export function fakeDecide(overrides: Overrides = {}): Decide {
  return async (intake) => ({
    model: 'fake',
    setting: overrides.setting ?? { value: 'clinic', confidence: 0.9 },
    flags: Object.fromEntries(
      (Object.keys(RED_FLAGS) as RedFlag[]).map((id) => [id, overrides.flags?.[id] ?? 0.02]),
    ) as Record<RedFlag, number>,
    complaints: Object.fromEntries(
      CATEGORIES.map((id) => [id, overrides.complaints?.[id] ?? 0.02]),
    ) as Record<Category, number>,
    answered: Object.fromEntries(
      buildQuestions(intake).fieldIds.map((id) => [id, overrides.answered?.[id] ?? 0.05]),
    ),
    usage: { inputTokens: 100, outputTokens: 0, latencyMs: 1 },
  });
}
