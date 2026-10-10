import type { Decide } from './run';

export type BreakerState = 'closed' | 'open' | 'half-open';

export class BreakerOpenError extends Error {}

/**
 * Circuit breaker around the model call. After `failures` consecutive errors it opens and
 * fails instantly for `cooldownMs`, so an outage costs patients the degraded plan, not a
 * timeout each. Then one trial call: success closes it, failure opens it again.
 * Added after the 2026-10-09 game day (ops/postmortems).
 */
export function withBreaker(
  decide: Decide,
  { failures = 5, cooldownMs = 30_000, onState = (_: BreakerState) => {} } = {},
): Decide {
  let state: BreakerState = 'closed';
  let consecutive = 0;
  let openedAt = 0;
  let trialInFlight = false;
  const set = (next: BreakerState) => {
    if (next !== state) {
      state = next;
      onState(next);
    }
  };

  return async (intake) => {
    if (state === 'open' && Date.now() - openedAt >= cooldownMs) set('half-open');
    if (state === 'open' || (state === 'half-open' && trialInFlight)) throw new BreakerOpenError();
    const isTrial = state === 'half-open';
    if (isTrial) trialInFlight = true;
    try {
      const decisions = await decide(intake);
      consecutive = 0;
      set('closed');
      return decisions;
    } catch (error) {
      consecutive += 1;
      if (state === 'half-open' || consecutive >= failures) {
        openedAt = Date.now();
        set('open');
      }
      throw error;
    } finally {
      if (isTrial) trialInFlight = false;
    }
  };
}
