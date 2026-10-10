import { type PatientBundle, parseChart, toSummary } from './chart';
import { type Decisions, fromAnswers } from './decisions';
import type { Evaluate } from './jev';
import { plan } from './plan';
import { buildQuestions, stateOf } from './questions';
import type { Intake, IntakePlan } from './types';

/** An arm of the arena: patient's words + chart summary in, decisions out. */
export type Decide = (intake: Intake) => Promise<Decisions>;

/** Typed questions answered by any `Evaluate` (Jev, or a general model in Jev's shape). */
export function typedDecide(evaluate: Evaluate): Decide {
  return async (intake) => {
    const { questions, fieldIds } = buildQuestions(intake);
    const started = performance.now();
    const result = await evaluate(stateOf(intake), questions);
    return fromAnswers(result.answers, fieldIds, result.model, {
      inputTokens: result.usage.input_tokens,
      outputTokens: result.usage.output_tokens,
      latencyMs: Math.round(performance.now() - started),
    });
  };
}

export type RunResult = {
  intake: Intake;
  plan: IntakePlan;
  /** Error class name when degraded. Never the message: it can echo request data. */
  error: string | null;
};

/** Chart + the patient's words in, plan out. Any model failure yields the degraded plan, never a throw. */
export async function run(
  bundle: PatientBundle,
  reason: string,
  decide: Decide,
  today = new Date(),
): Promise<RunResult> {
  const chart = parseChart(bundle);
  const intake = { reason, patient: toSummary(chart, today) };
  try {
    return { intake, plan: plan(chart, intake, await decide(intake), today), error: null };
  } catch (error) {
    return {
      intake,
      plan: plan(chart, intake, null, today),
      error: error instanceof Error ? error.constructor.name : 'Unknown',
    };
  }
}
