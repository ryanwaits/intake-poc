/**
 * Scalability: the same burst of intakes at low and high concurrency per arm.
 * Throughput, tail latency and errors (rate limits show up here, not in the arena).
 *   bun eval/load.ts jev,haiku-typed
 */
import { ARMS } from './arms';
import { loadCases } from './case';

const PLAN: Record<string, { n: number; levels: number[] }> = {
  rules: { n: 64, levels: [1, 32] },
  jev: { n: 64, levels: [1, 32] },
  'haiku-typed': { n: 64, levels: [1, 32] },
  'luna-typed': { n: 64, levels: [1, 32] },
  'haiku-e2e': { n: 64, levels: [1, 32] },
  'opus-e2e': { n: 24, levels: [1, 12] },
  'local-typed': { n: 6, levels: [1, 3] },
  clef: { n: 64, levels: [1, 32] },
  'clef-flash': { n: 64, levels: [1, 32] },
  'kev-4b': { n: 8, levels: [1, 4] },
};

const ids = (Bun.argv[2] ?? Object.keys(PLAN).join(',')).split(',');
const cases = (await loadCases()).filter((c) => c.source === 'synthetic');
const out: Record<string, unknown[]> = {};

for (const arm of ARMS.filter((a) => ids.includes(a.id))) {
  const plan = PLAN[arm.id];
  if (!plan) continue;
  const decide = arm.decide();
  out[arm.id] = [];
  for (const concurrency of plan.levels) {
    const jobs = cases.slice(0, plan.n);
    const latencies: number[] = [];
    const errors: string[] = [];
    let next = 0;
    const started = performance.now();
    await Promise.all(
      Array.from({ length: concurrency }, async () => {
        while (next < jobs.length) {
          const c = jobs[next++];
          if (!c) return;
          const t = performance.now();
          try {
            await decide({ reason: c.reason, patient: c.patient });
            latencies.push(performance.now() - t);
          } catch (e) {
            errors.push(e instanceof Error ? e.constructor.name : 'Unknown');
          }
        }
      }),
    );
    const seconds = (performance.now() - started) / 1000;
    latencies.sort((a, b) => a - b);
    const row = {
      concurrency,
      requests: jobs.length,
      throughputPerSec: jobs.length / seconds,
      p50Ms: Math.round(latencies[Math.floor(latencies.length * 0.5)] ?? 0),
      p95Ms: Math.round(latencies[Math.floor(latencies.length * 0.95)] ?? 0),
      errors: errors.length,
      errorTypes: [...new Set(errors)],
    };
    out[arm.id]?.push(row);
    console.log(arm.id, JSON.stringify(row));
  }
}

const path = 'eval/results/load.json';
const prior = (await Bun.file(path).exists()) ? await Bun.file(path).json() : {};
await Bun.write(path, `${JSON.stringify({ ...prior, ...out }, null, 2)}\n`);
