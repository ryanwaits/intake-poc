import type { Chart } from './chart';
import type { Decisions } from './decisions';
import { type Field, type FieldStatus, fromChart, PAPERWORK } from './form';
import {
  BASE_VITALS,
  CATEGORIES,
  GENERAL_HISTORY,
  PROTOCOLS,
  RED_FLAGS,
  type RedFlag,
} from './protocols';
import { coverageQuestion, inScope, SETTING_QUESTION } from './questions';
import type { Device, FieldPlan, Intake, IntakePlan, PrepCard } from './types';

/**
 * Confidence gates. Models return probabilities; code decides.
 * Placeholder values until the arena calibrates them per arm.
 */
export type Gates = typeof GATES;

export const GATES = {
  /** Low on purpose: escalate on roughly a 1-in-5 chance. Missing an emergency is the worst error. */
  escalateAt: 0.2,
  complaintAt: 0.5,
  settingConfidenceAt: 0.6,
  /** Skip a question only when the patient has clearly answered it already. */
  answeredAt: 0.7,
};

const ALL_DEVICES: Device[] = ['otoscope', 'stethoscope', 'exam_camera', 'pulse_oximeter'];
const unique = <T>(xs: T[]) => [...new Set(xs)];

function card(decisions: Decisions | null, gates: Gates): PrepCard {
  if (!decisions) {
    return {
      escalations: [],
      setting: { value: 'navigator_review', why: null },
      complaints: [],
      medicPrep: { devices: ALL_DEVICES, vitals: BASE_VITALS, tests: [] },
    };
  }

  const escalations = (Object.keys(RED_FLAGS) as RedFlag[])
    .filter((id) => decisions.flags[id] >= gates.escalateAt)
    .map((id) => ({
      id,
      label: RED_FLAGS[id].label,
      why: {
        question: RED_FLAGS[id].detect,
        p: decisions.flags[id],
        rule: `p ≥ ${gates.escalateAt} → escalate`,
      },
    }));

  const complaints = CATEGORIES.filter((id) => decisions.complaints[id] >= gates.complaintAt)
    .sort((a, b) => decisions.complaints[b] - decisions.complaints[a])
    .map((id) => ({
      id,
      label: PROTOCOLS[id].label,
      why: {
        question: PROTOCOLS[id].detect,
        p: decisions.complaints[id],
        rule: `p ≥ ${gates.complaintAt} → load protocol`,
      },
    }));

  const routed = decisions.setting;
  const settingWhy = {
    question: SETTING_QUESTION,
    p: routed.confidence,
    rule: `confidence ≥ ${gates.settingConfidenceAt} → route, else navigator`,
  };
  // Red flags and "emergency" go to a provider now. Software never tells the patient to go to the ER.
  const setting: PrepCard['setting'] =
    escalations.length > 0 || routed.value === 'emergency'
      ? { value: 'provider_now', why: escalations[0]?.why ?? settingWhy }
      : routed.confidence < gates.settingConfidenceAt
        ? { value: 'navigator_review', why: settingWhy }
        : { value: routed.value, why: settingWhy };

  const protocols = complaints.map((c) => PROTOCOLS[c.id]);
  return {
    escalations,
    setting,
    complaints,
    medicPrep: {
      devices: unique(protocols.flatMap((p): Device[] => p.devices)),
      vitals: BASE_VITALS,
      tests: unique(protocols.flatMap((p) => p.tests)),
    },
  };
}

function fieldPlan(
  field: Field,
  chart: Chart,
  decisions: Decisions | null,
  today: Date,
  gates: Gates,
): FieldPlan {
  const base = { id: field.id, section: field.section, ask: field.ask };
  const known = fromChart(field, chart, today);
  if (known) return { ...base, ...known, why: null };

  const p = field.covers ? decisions?.answered[field.id] : undefined;
  if (p === undefined) return { ...base, status: 'ask', values: [], why: null };
  const answered = p >= gates.answeredAt;
  const why = {
    question: coverageQuestion(field),
    p,
    rule: `p(answered) ≥ ${gates.answeredAt} → skip, else ask`,
  };
  return { ...base, status: answered ? 'answered' : 'ask', values: [], why };
}

/**
 * The same deterministic code for every arm: chart rules first, then the model's decisions.
 * `decisions: null` is the degraded plan: prefill still works, everything else is asked.
 */
export function plan(
  chart: Chart,
  intake: Intake,
  decisions: Decisions | null,
  today = new Date(),
  gates: Gates = GATES,
): IntakePlan {
  const prep = card(decisions, gates);
  const visit =
    prep.complaints.length > 0
      ? prep.complaints.flatMap((c) => PROTOCOLS[c.id as keyof typeof PROTOCOLS].history)
      : GENERAL_HISTORY;
  const fields = [...new Map([...PAPERWORK, ...visit].map((f) => [f.id, f])).values()];
  const plans = inScope(fields, intake).map((f) => fieldPlan(f, chart, decisions, today, gates));

  const counts = { prefilled: 0, confirm: 0, sign: 0, answered: 0, ask: 0, total: plans.length };
  for (const f of plans) counts[f.status satisfies FieldStatus] += 1;

  return {
    mode: decisions ? 'live' : 'degraded',
    model: decisions?.model ?? null,
    fields: plans,
    counts,
    card: prep,
    usage: decisions?.usage ?? null,
  };
}
