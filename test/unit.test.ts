import { expect, test } from 'bun:test';
import { BreakerOpenError, type BreakerState, withBreaker } from '../src/core/breaker';
import { ageBand, ageInYears } from '../src/core/chart';
import type { Decide } from '../src/core/run';
import { loadGolden } from './golden/specs';

/**
 * The few unit tests left: bugs that would be silent and that no end-to-end run reaches cheaply.
 * Everything else is covered by e2e, integration and golden tests.
 */

test('age is computed in code, birthday-aware', () => {
  const today = new Date('2026-10-08T12:00:00Z');
  expect(ageInYears('1961-10-09', today)).toBe(64);
  expect(ageInYears('1961-10-08', today)).toBe(65);
  expect(ageBand(17)).toBe('child');
  expect(ageBand(65)).toBe('older_adult');
});

test('breaker opens after consecutive failures, fails fast, then recovers through one trial', async () => {
  const { decisions, summary } = await loadGolden('maria-ear');
  if (!decisions) throw new Error('maria-ear has no recorded decisions');
  const intake = { reason: 'ear hurts', patient: summary };

  let up = false;
  let calls = 0;
  const flaky: Decide = async () => {
    calls += 1;
    if (!up) throw new TypeError('fetch failed');
    return decisions;
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
