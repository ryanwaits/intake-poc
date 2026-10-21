import {
  type JsonValue,
  type Questions,
  type SystemOneResult,
  TypeSafeClient,
} from '@typesafe-ai/sdk';

/** Pinned: thresholds in `decide` are tuned against this exact model, and `jev-latest` can move. */
export const JEV_MODEL = 'jev-1.13.0';

export type JevResult = SystemOneResult<Questions>;

/** The seam between the service and the model. Tests inject a fake; `liveEvaluate` calls TypeSafe. */
export type Evaluate = (
  state: { [key: string]: JsonValue },
  questions: Questions,
) => Promise<JevResult>;

export function liveEvaluate(model = JEV_MODEL, apiKey?: string): Evaluate {
  const client = new TypeSafeClient({
    apiKey,
    defaultModel: model,
    // The intake form's latency SLO is 1 s. Jev's p99 is ~250 ms, so one 400 ms attempt plus one
    // quick retry fits inside it. (Was 2 s + retry: an outage blew the SLO, see docs/postmortems.)
    timeout: 400,
    retry: { maxRetries: 1, backoffInitialMs: 50, backoffMaxMs: 50 },
    // `debug` would log request bodies, which hold patient data.
    logLevel: 'error',
  });
  return (state, questions) => client.systemOne({ state, questions });
}
