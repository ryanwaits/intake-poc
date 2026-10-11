import { expect, test } from 'bun:test';
import { type PatientBundle, parseChart, toSummary } from '../src/core/chart';
import { plan } from '../src/core/plan';
import { GOLDEN_SPECS, loadGolden } from './golden/specs';

/**
 * Golden tests: recorded real model output through today's code. A failure means the plan a
 * patient gets has changed. If that's intended, `bun run golden:record` and review the diff.
 */
for (const spec of GOLDEN_SPECS) {
  test(`golden ${spec.name}: ${spec.note}`, async () => {
    const golden = await loadGolden(spec.name);
    const bundle = (await Bun.file(
      `fixtures/patients/${spec.patient}.json`,
    ).json()) as PatientBundle;
    const chart = parseChart(bundle);
    const today = new Date(golden.today);
    const summary = toSummary(chart, today);

    // What the model is allowed to see: no names, contact details, IDs or dates.
    expect(summary).toEqual(golden.summary);
    const seen = JSON.stringify(summary);
    for (const id of [chart.name, chart.phone, chart.email, chart.memberId, chart.birthDate]) {
      if (id) expect(seen).not.toContain(id);
    }

    expect(plan(chart, { reason: spec.reason, patient: summary }, golden.decisions, today)).toEqual(
      golden.plan,
    );
  });
}
