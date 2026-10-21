import { type PatientBundle, parseChart, toSummary } from './chart';
import { type Decisions, fromAnswers } from './decisions';
import type { Extract, Extraction } from './extract';
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

/** The models behind one intake. `extract` is optional: without it, skipped questions carry no words. */
export type Models = { decide: Decide; extract?: Extract | null };

export type RunResult = {
  intake: Intake;
  plan: IntakePlan;
  /** Error class name when degraded. Never the message: it can echo request data. */
  error: string | null;
  /** Same, for the extraction model. Its failure never degrades the plan. */
  extractError: string | null;
  extraction: Extraction | null;
};

const errorName = (e: unknown) => (e instanceof Error ? e.constructor.name : 'Unknown');

/**
 * Chart + the patient's words in, plan out. Both models run in parallel. A decision-model failure
 * yields the degraded plan; an extraction failure only drops the "You said" values. Never throws.
 */
export async function run(
  bundle: PatientBundle,
  reason: string,
  { decide, extract }: Models,
  today = new Date(),
): Promise<RunResult> {
  const chart = parseChart(bundle);
  const intake = { reason, patient: toSummary(chart, today) };
  const [decided, extracted] = await Promise.allSettled([
    decide(intake),
    extract ? extract(intake) : Promise.resolve(null),
  ]);
  const extraction = extracted.status === 'fulfilled' ? extracted.value : null;
  const extractError = extracted.status === 'rejected' ? errorName(extracted.reason) : null;
  if (decided.status === 'rejected') {
    return {
      intake,
      plan: plan(chart, intake, null, null, today),
      error: errorName(decided.reason),
      extractError,
      extraction,
    };
  }
  return {
    intake,
    plan: plan(chart, intake, decided.value, extraction, today),
    error: null,
    extractError,
    extraction,
  };
}
