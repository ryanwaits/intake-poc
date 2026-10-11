import type { Decisions } from '../../src/core/decisions';
import { GATES } from '../../src/core/plan';
import type { RedFlag } from '../../src/core/protocols';
import type { IntakePlan, PatientSummary } from '../../src/core/types';

/**
 * Golden intakes: a synthetic chart and the patient's words, the decisions the pinned model
 * actually returned for them, and the plan the code built. Recorded, never hand-written:
 *   bun run golden:record
 * Review the diff like code. A changed plan is a changed product.
 */
export type GoldenSpec = {
  name: string;
  /** What this golden guards, for whoever reviews its diff. */
  note: string;
  /** A file in fixtures/patients. */
  patient: 'maria' | 'walter';
  reason: string;
  /** `live`: recorded from the pinned model. `down`: the model was unreachable. */
  model: 'live' | 'down';
  /** Pins one recorded probability to a boundary, for edge cases real text rarely lands on. */
  edit?: { flags: Partial<Record<RedFlag, number>> };
};

export type Golden = GoldenSpec & {
  today: string;
  summary: PatientSummary;
  decisions: Decisions | null;
  plan: IntakePlan;
};

/** Fixed so staleness and age don't drift as the calendar moves. */
export const TODAY = '2026-10-08T12:00:00Z';

export const GOLDEN_SPECS: GoldenSpec[] = [
  {
    name: 'maria-ear',
    note: 'Chart prefill, a stale tobacco answer to confirm, an ear complaint that preps the otoscope, and visit questions the patient already answered get skipped.',
    patient: 'maria',
    reason: "ear's been killing me 3 days, also need my lisinopril refilled",
    model: 'live',
  },
  {
    name: 'walter-chest',
    note: 'Chest tightness in an older adult with heart disease escalates to a provider now. Fall screen asked, no pregnancy question.',
    patient: 'walter',
    reason: 'chest feels tight when I walk up stairs',
    model: 'live',
  },
  {
    name: 'walter-cough-flag-at-gate',
    note: 'Edge: a red flag exactly at the escalation gate still escalates. Missing an emergency is the worst error.',
    patient: 'walter',
    reason: 'had a cough for about a week, mostly at night',
    model: 'live',
    edit: { flags: { chest_pain: GATES.escalateAt } },
  },
  {
    name: 'maria-model-down',
    note: 'Model unreachable: chart prefill still works, every question is asked, a navigator triages, the medic preps every device.',
    patient: 'maria',
    reason: 'my ear hurts',
    model: 'down',
  },
];

export const goldenPath = (name: string) => `test/golden/${name}.json`;

export async function loadGolden(name: string): Promise<Golden> {
  return (await Bun.file(goldenPath(name)).json()) as Golden;
}
