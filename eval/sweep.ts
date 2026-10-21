/**
 * The skip gate's tradeoff curve: questions saved vs questions wrongly skipped, as `answeredAt`
 * moves. Offline, on recorded Jev decisions, test split. The escalation gate stays fixed: safety
 * thresholds are never swept for paperwork.
 *   bun run eval:sweep   → prints the curve, writes eval/results/sweep.json
 */
import { GATES } from '../src/core/plan';
import { loadRecords, RESULTS_DIR, splitOf } from './arena';
import { loadCases } from './case';
import { metrics, scoreAll } from './score';

const ARM = 'jev';
const GRID = Array.from({ length: 19 }, (_, i) => (i + 1) / 20);

const cases = (await loadCases()).filter((c) => splitOf(c) === 'test');
const byCase = new Map(
  (await loadRecords(ARM)).filter((r) => r.repeat === 0).map((r) => [r.caseId, r]),
);

const curve = GRID.map((answeredAt) => {
  const rows = scoreAll(cases, byCase, { ...GATES, answeredAt }).filter(
    (r) => r.c.source === 'synthetic',
  );
  const m = metrics(rows);
  // Labeled questions the form didn't ask: answered ones rightly skipped, unanswered ones missed.
  const skipped = rows.reduce((n, r) => n + (r.s.answered - r.s.overAsked) + r.s.missed, 0);
  return {
    answeredAt,
    savedPerIntake: skipped / rows.length,
    falseSkipRate: m.missedFieldRate,
    overAskRate: m.overAskRate,
    redFlagRecall: m.redFlagRecall,
  };
});

await Bun.write(
  `${RESULTS_DIR}/sweep.json`,
  `${JSON.stringify({ arm: ARM, split: 'test', shipped: GATES.answeredAt, curve }, null, 2)}\n`,
);

const pct = (x: number) => `${(x * 100).toFixed(1)}%`.padStart(6);
console.log(`${ARM}, test split. Shipped answeredAt = ${GATES.answeredAt}\n`);
console.log('gate  saved/intake                false skip  over-ask  red-flag recall');
for (const p of curve) {
  const bar = '█'.repeat(Math.round(p.savedPerIntake * 4)).padEnd(16);
  const mark = Math.abs(p.answeredAt - GATES.answeredAt) < 1e-9 ? '  ◀ shipped' : '';
  console.log(
    `${p.answeredAt.toFixed(2)}  ${p.savedPerIntake.toFixed(2).padStart(5)} ${bar}  ${pct(p.falseSkipRate)}     ${pct(p.overAskRate)}    ${pct(p.redFlagRecall)}${mark}`,
  );
}
