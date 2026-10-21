import { coveredFields } from './questions';
import type { Intake } from './types';

/** Preview on Workers AI. Pinned by id; Cloudflare hasn't published versioned ids yet. */
export const CLAIRIC_MODEL = '@cf/cloudflare/clairic';

/** One candidate answer: a span of the patient's own words, with the model's confidence. */
export type Span = { value: string; span: [number, number]; confidence: number };

/**
 * What the patient actually said, per coverable question. Values only: whether a question
 * was answered is still the decision model's call (see eval/RESULTS.md, "Extraction").
 */
export type Extraction = {
  model: string;
  spans: Record<string, Span>;
  /**
   * For fields with a `typed` shape: did the patient's words contain a value of that type?
   * Only whether one exists. The value itself (e.g. days) isn't kept: dates are code's job.
   */
  typed: Record<string, boolean>;
  usage: { inputTokens: number; latencyMs: number };
};

/** The seam for an extraction model, next to `Decide`. Sees the patient's words only. */
export type Extract = (intake: Intake) => Promise<Extraction>;

const typedKey = (id: string) => `${id}_typed`;

type Answer = { value: unknown; span?: unknown; confidence?: unknown };

export function liveExtract({
  accountId,
  apiToken,
  model = CLAIRIC_MODEL,
  // Runs in parallel with Jev. p95 was 630 ms in the eval; this keeps the intake under the 1 s SLO.
  timeoutMs = 800,
}: {
  accountId: string;
  apiToken: string;
  model?: string;
  timeoutMs?: number;
}): Extract {
  const url = `https://api.cloudflare.com/client/v4/accounts/${accountId}/ai/run/${model}`;
  return async (intake) => {
    const covered = coveredFields(intake);
    const fields = Object.fromEntries([
      ...covered.map((f) => [f.id, { type: 'text', instructions: f.covers }]),
      ...covered.flatMap((f) => (f.typed ? [[typedKey(f.id), f.typed]] : [])),
    ]);
    const started = performance.now();
    const res = await fetch(url, {
      method: 'POST',
      headers: { authorization: `Bearer ${apiToken}`, 'content-type': 'application/json' },
      // Spans are offsets into exactly this text, so it's the reason and nothing else.
      body: JSON.stringify({ state: intake.reason, fields }),
      signal: AbortSignal.timeout(timeoutMs),
    });
    // Status only: an error body can echo the request, which holds the patient's words.
    if (!res.ok) throw new Error(`Workers AI ${res.status}`);
    const body = (await res.json()) as {
      result?: { answers?: Record<string, Answer>; usage?: { input_tokens?: number } };
    };
    const answers = body.result?.answers;
    if (!answers) throw new Error('Workers AI returned no answers');

    const typed = Object.fromEntries(
      covered
        .filter((f) => f.typed && typedKey(f.id) in answers)
        .map((f) => [f.id, answers[typedKey(f.id)]?.value != null]),
    );
    const spans: Record<string, Span> = {};
    for (const [id, a] of Object.entries(answers)) {
      if (!covered.some((f) => f.id === id)) continue;
      if (typeof a.value !== 'string' || typeof a.confidence !== 'number') continue;
      if (!Array.isArray(a.span) || a.span.length !== 2) continue;
      spans[id] = {
        value: a.value,
        span: [Number(a.span[0]), Number(a.span[1])],
        confidence: a.confidence,
      };
    }
    return {
      model,
      spans,
      typed,
      usage: {
        inputTokens: body.result?.usage?.input_tokens ?? 0,
        latencyMs: Math.round(performance.now() - started),
      },
    };
  };
}
