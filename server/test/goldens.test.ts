import { describe, expect, test } from 'bun:test';
import crisis from '../../goldens/crisis.json';
import protocol from '../../goldens/protocol.json';
import { isCrisis, summarize } from '../src/rules';
import type { Config, Reading } from '../src/types';

type Row = [string, keyof typeof protocol.sources, Reading['method'], number, number, string];

const reading = ([id, source, method, systolic, diastolic, measuredAt]: Row): Reading => ({
  id,
  platform: 'healthkit',
  systolic,
  diastolic,
  measuredAt,
  tzOffsetMin: -300,
  source: protocol.sources[source],
  method,
});

describe('goldens/crisis.json', () => {
  for (const c of crisis.cases) {
    test(c.name, () => expect(isCrisis(c.reading, crisis.config)).toBe(c.expect));
  }
});

describe('goldens/protocol.json', () => {
  for (const c of protocol.cases) {
    test(c.name, () => {
      const base = protocol.config as Config;
      const config = {
        ...base,
        protocol: { ...base.protocol, ...('protocol' in c ? c.protocol : {}) },
      };
      const { configVersion, required, ...summary } = summarize(
        (c.readings as Row[]).map(reading),
        config,
      );
      expect(configVersion).toBe('golden');
      expect(required).toBe(config.protocol.minReadings);
      expect(summary).toEqual(c.expect as typeof summary);
    });
  }
});
