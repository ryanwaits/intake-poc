import { describe, expect, test } from 'bun:test';
import { type PatientBundle, parseChart, toSummary } from '../src/core/chart';
import { JEV_MODEL, liveEvaluate } from '../src/core/jev';
import { plan } from '../src/core/plan';
import { typedDecide } from '../src/core/run';
import { GOLDEN_SPECS, loadGolden } from './golden/specs';
import { hasModel } from './live';

/**
 * The model boundary, against the real pinned model: the SDK's answers still map onto every
 * question we ask, and the model still makes the calls the goldens recorded. Schema drift on
 * either side fails here, not in front of a patient.
 */
describe.skipIf(!hasModel)('model boundary', () => {
  const decide = typedDecide(liveEvaluate(JEV_MODEL, process.env.TYPESAFE_API_KEY));

  for (const spec of GOLDEN_SPECS.filter((s) => s.model === 'live')) {
    test(`${spec.name}: pinned model answers every question, and agrees with the golden`, async () => {
      const golden = await loadGolden(spec.name);
      const bundle = (await Bun.file(
        `fixtures/patients/${spec.patient}.json`,
      ).json()) as PatientBundle;
      const chart = parseChart(bundle);
      const today = new Date(golden.today);
      const intake = { reason: spec.reason, patient: toSummary(chart, today) };

      const decisions = await decide(intake);
      const recorded = golden.decisions;
      if (!recorded) throw new Error(`${spec.name} has no recorded decisions`);

      expect(decisions.model).toBe(JEV_MODEL);
      for (const group of ['flags', 'complaints', 'answered'] as const) {
        expect(Object.keys(decisions[group]).sort()).toEqual(Object.keys(recorded[group]).sort());
        for (const p of Object.values(decisions[group])) expect(p).toBeWithin(0, 1.000001);
      }

      // An edited golden pins a probability the live model won't return, so only its schema is compared.
      if (spec.edit) return;
      const card = plan(chart, intake, decisions, today).card;
      expect(card.escalations.map((e) => e.id)).toEqual(
        golden.plan.card.escalations.map((e) => e.id),
      );
      expect(card.complaints.map((c) => c.id)).toEqual(
        golden.plan.card.complaints.map((c) => c.id),
      );
      expect(card.setting.value).toBe(golden.plan.card.setting.value);
    }, 10_000);
  }
});
