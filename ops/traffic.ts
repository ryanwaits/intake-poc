/**
 * Steady synthetic traffic for the local stack: eval-set complaints against the fixture charts.
 *   bun run ops:traffic [requestsPerSecond=2] [minutes=10] [url=http://localhost:8080]
 */
import { loadCases } from '../eval/case';

const [rps = '2', minutes = '10', base = 'http://localhost:8080'] = Bun.argv.slice(2);
const bundles = await Promise.all(
  ['maria', 'walter'].map((p) => Bun.file(`fixtures/patients/${p}.json`).json()),
);
const reasons = (await loadCases()).map((c) => c.reason);
const until = Date.now() + Number(minutes) * 60_000;
const counts: Record<string, number> = {};

let i = 0;
const tick = setInterval(() => {
  if (Date.now() > until) {
    clearInterval(tick);
    console.log('done', counts);
    return;
  }
  const body = JSON.stringify({ reason: reasons[i % reasons.length], bundle: bundles[i % 2] });
  i += 1;
  fetch(`${base}/v1/intake`, {
    method: 'POST',
    body,
    headers: { 'content-type': 'application/json' },
  })
    .then(async (res) => {
      const mode = res.ok ? ((await res.json()) as { mode: string }).mode : `http ${res.status}`;
      counts[mode] = (counts[mode] ?? 0) + 1;
    })
    .catch(() => {
      counts.unreachable = (counts.unreachable ?? 0) + 1;
    });
  if (i % (Number(rps) * 30) === 0) console.log(new Date().toISOString().slice(11, 19), counts);
}, 1000 / Number(rps));
