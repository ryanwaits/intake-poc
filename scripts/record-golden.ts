/**
 * Record the golden intakes in test/golden against the pinned models.
 *   bun run golden:record
 */
import { extractor } from '../src/api/config';
import { type PatientBundle, parseChart, toSummary } from '../src/core/chart';
import type { Decisions } from '../src/core/decisions';
import type { Extraction } from '../src/core/extract';
import { JEV_MODEL, liveEvaluate } from '../src/core/jev';
import { plan } from '../src/core/plan';
import { typedDecide } from '../src/core/run';
import { GOLDEN_SPECS, type Golden, goldenPath, TODAY } from '../test/golden/specs';

const decide = typedDecide(liveEvaluate(JEV_MODEL));
const extract = extractor({ ...process.env, INTAKE_EXTRACTOR: 'clairic' })?.extract;
if (!extract) throw new Error('Recording goldens needs the Clairic extractor');
const today = new Date(TODAY);

for (const spec of GOLDEN_SPECS) {
  const bundle = (await Bun.file(`fixtures/patients/${spec.patient}.json`).json()) as PatientBundle;
  const chart = parseChart(bundle);
  const intake = { reason: spec.reason, patient: toSummary(chart, today) };

  let decisions: Decisions | null = null;
  let extraction: Extraction | null = null;
  if (spec.model === 'live' && spec.extractor !== 'down') {
    const recorded = await extract(intake);
    extraction = { ...recorded, usage: { ...recorded.usage, latencyMs: 0 } };
  }
  if (spec.model === 'live') {
    const recorded = await decide(intake);
    // Latency changes every run and would make every re-record a diff.
    decisions = {
      ...recorded,
      flags: { ...recorded.flags, ...spec.edit?.flags },
      usage: { ...recorded.usage, latencyMs: 0 },
    };
  }

  const golden: Golden = {
    ...spec,
    today: TODAY,
    summary: intake.patient,
    decisions,
    extraction,
    plan: plan(chart, intake, decisions, extraction, today),
  };
  await Bun.write(goldenPath(spec.name), `${JSON.stringify(golden, null, 2)}\n`);
  console.log(`${spec.name}: ${golden.plan.mode}, ${golden.plan.counts.ask} to type`);
}
