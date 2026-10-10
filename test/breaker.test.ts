import { expect, test } from 'bun:test';
import { BreakerOpenError, type BreakerState, withBreaker } from '../src/core/breaker';
import type { Decide } from '../src/core/run';
import { fakeDecide } from './fake-decide';

const intake = {
  reason: 'ear hurts',
  patient: {
    ageBand: 'adult' as const,
    sex: 'female' as const,
    problems: [],
    medications: [],
    allergies: [],
  },
};

test('opens after consecutive failures, fails fast, then recovers through one trial', async () => {
  let up = false;
  let calls = 0;
  const flaky: Decide = async (i) => {
    calls += 1;
    if (!up) throw new TypeError('fetch failed');
    return fakeDecide()(i);
  };
  const states: BreakerState[] = [];
  const decide = withBreaker(flaky, {
    failures: 3,
    cooldownMs: 50,
    onState: (s) => states.push(s),
  });

  for (let i = 0; i < 3; i++) await expect(decide(intake)).rejects.toThrow(TypeError);
  await expect(decide(intake)).rejects.toThrow(BreakerOpenError);
  expect(calls).toBe(3); // open: the model is not called

  up = true;
  await Bun.sleep(60);
  await decide(intake); // half-open trial succeeds
  expect(states).toEqual(['open', 'half-open', 'closed']);
});
