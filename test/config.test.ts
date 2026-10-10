import { expect, test } from 'bun:test';
import { decider, loadConfig } from '../src/api/config';

const env = { TYPESAFE_API_KEY: 'test-key' };

test('defaults to the pinned Jev model and no shadow', () => {
  const config = loadConfig(env);
  expect(config.live.model).toBe('jev-1.13.0');
  expect(config.shadow).toBeNull();
});

test('a shadow model and sample come from the environment', () => {
  const config = loadConfig({
    ...env,
    INTAKE_SHADOW_DECIDER: 'jev:jev-latest',
    INTAKE_SHADOW_SAMPLE: '0.1',
  });
  expect(config.shadow?.model).toBe('jev-latest');
  expect(config.shadow?.sample).toBe(0.1);
});

test('bad config fails the boot instead of taking traffic', () => {
  expect(() => loadConfig({ ...env, INTAKE_SHADOW_SAMPLE: '2' })).toThrow('between 0 and 1');
  expect(() => loadConfig({ ...env, PORT: 'abc' })).toThrow('port number');
  expect(() => decider('gpt:whatever')).toThrow('Unknown decider');
});
