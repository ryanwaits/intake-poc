import { describe, expect, test } from 'bun:test';
import { extractor } from '../src/api/config';
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
      const card = plan(chart, intake, decisions, null, today).card;
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

/**
 * The extraction boundary, against the real Clairic: it still answers every coverable question
 * in the shape `liveExtract` reads, and still finds the words the goldens recorded.
 */
describe.skipIf(!hasModel)('extraction boundary', () => {
  const extract = extractor(process.env)?.extract;

  for (const spec of GOLDEN_SPECS.filter((s) => s.model === 'live' && s.extractor !== 'down')) {
    test(`${spec.name}: Clairic returns the patient's words the golden showed back`, async () => {
      if (!extract) throw new Error('INTAKE_EXTRACTOR=none: the extraction boundary needs Clairic');
      const golden = await loadGolden(spec.name);
      const intake = { reason: spec.reason, patient: golden.summary };

      const extraction = await extract(intake);
      for (const s of Object.values(extraction.spans)) {
        expect(s.confidence).toBeWithin(0, 1.000001);
        expect(spec.reason.slice(s.span[0], s.span[1])).toBe(s.value);
      }
      for (const f of golden.plan.fields.filter((f) => f.said)) {
        expect(extraction.spans[f.id]?.value).toBe(f.said?.value);
      }
    }, 10_000);
  }
});
