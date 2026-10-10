import { type Questions, TypeSafeClient } from '@typesafe-ai/sdk';
import type { Evaluate, JevResult } from '../../src/core/jev';

/**
 * Other decision models that speak TypeSafe's System One API: same questions, same
 * answers, so they plug into `typedDecide` with no changes to the service.
 */

/** Kev: open weights served locally by `python -m kev.serve` (System One at /v1/systemone). */
export function kevEvaluate(baseURL: string, model = 'kev-latest'): Evaluate {
  const client = new TypeSafeClient({
    apiKey: 'local',
    baseURL,
    defaultModel: model,
    timeout: 120_000,
    retry: { maxRetries: 0 },
    logLevel: 'error',
  });
  return (state, questions) => client.systemOne({ state, questions });
}

/** Clef on Cloudflare Workers AI: System One body, Cloudflare's URL and response wrapper. */
export function clefEvaluate(model: 'clef' | 'clef-flash'): Evaluate {
  const account = process.env.CLOUDFLARE_ACCOUNT_ID;
  const token = process.env.CLOUDFLARE_API_TOKEN;
  if (!account || !token) throw new Error('Set CLOUDFLARE_ACCOUNT_ID and CLOUDFLARE_API_TOKEN');
  const url = `https://api.cloudflare.com/client/v4/accounts/${account}/ai/run/@cf/cloudflare/${model}`;
  return async (state, questions: Questions) => {
    const res = await fetch(url, {
      method: 'POST',
      headers: { authorization: `Bearer ${token}`, 'content-type': 'application/json' },
      body: JSON.stringify({ model, state, questions }),
      signal: AbortSignal.timeout(30_000),
    });
    if (!res.ok) throw new Error(`Workers AI ${res.status}: ${(await res.text()).slice(0, 200)}`);
    const body = (await res.json()) as { result?: JevResult } & Partial<JevResult>;
    const result = body.result ?? (body as JevResult);
    if (!result.answers) throw new Error('Workers AI returned no answers');
    return {
      model: result.model ?? model,
      answers: result.answers,
      usage: result.usage ?? { input_tokens: 0, output_tokens: 0 },
    };
  };
}
