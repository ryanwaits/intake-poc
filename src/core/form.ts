import { type Chart, daysSince, type Known, LOINC } from './chart';
import type { PatientSummary } from './types';

export type Section = 'registration' | 'consent' | 'history' | 'screening' | 'visit';

/**
 * One line of new-patient paperwork, and the rule for whether the patient has to fill it.
 * Rules are code; the only model call is `covers`: did the patient's own words already answer it?
 */
export type Field = {
  id: string;
  section: Section;
  /** Shown to the patient when nothing else fills the field. */
  ask: string;
  /** Prefill from the chart. Empty means the chart doesn't know. */
  source?: (chart: Chart) => Known[];
  /** Chart values always get a one-tap confirm: lists that only the patient knows are complete. */
  confirm?: true;
  /** Chart values older than this get a one-tap confirm instead of a silent prefill. */
  freshDays?: number;
  /** What counts as answered in the patient's own words. A model judges this. */
  covers?: string;
  /**
   * The shape a real answer has. A skip also needs the extraction model to find a value of this
   * type, so "came on suddenly" (how) doesn't pass for when. Can only add a question, never skip one.
   */
  typed?: { type: 'duration'; unit: 'days'; instructions: string };
  /** Legal: always signed, never skipped. */
  consent?: true;
  /** Only part of the form when this holds. */
  when?: (patient: PatientSummary) => boolean;
};

const one = (value: string | undefined): Known[] => (value ? [{ value }] : []);
const observation = (code: string) => (chart: Chart) => {
  const o = chart.observations[code];
  return o ? [o] : [];
};

export const PAPERWORK: Field[] = [
  { id: 'name', section: 'registration', ask: 'Full legal name', source: (c) => one(c.name) },
  {
    id: 'birth_date',
    section: 'registration',
    ask: 'Date of birth',
    source: (c) => one(c.birthDate),
  },
  {
    id: 'sex',
    section: 'registration',
    ask: 'Sex',
    source: (c) => one(c.sex === 'unknown' ? undefined : c.sex),
  },
  { id: 'address', section: 'registration', ask: 'Home address', source: (c) => one(c.address) },
  { id: 'phone', section: 'registration', ask: 'Phone number', source: (c) => one(c.phone) },
  { id: 'email', section: 'registration', ask: 'Email', source: (c) => one(c.email) },
  {
    id: 'language',
    section: 'registration',
    ask: 'Preferred language',
    source: (c) => one(c.language),
  },
  {
    id: 'emergency_contact',
    section: 'registration',
    ask: 'Emergency contact: name, relationship, phone',
    source: (c) => one(c.emergencyContact),
  },
  { id: 'employer', section: 'registration', ask: 'Employer', source: (c) => one(c.employer) },
  { id: 'member_id', section: 'registration', ask: 'Member ID', source: (c) => one(c.memberId) },
  { id: 'pharmacy', section: 'registration', ask: 'Preferred pharmacy' },

  { id: 'consent_treatment', section: 'consent', ask: 'Consent to treatment', consent: true },
  { id: 'consent_telehealth', section: 'consent', ask: 'Consent to telehealth', consent: true },
  { id: 'privacy_notice', section: 'consent', ask: 'Notice of privacy practices', consent: true },

  {
    id: 'medications',
    section: 'history',
    ask: 'Medications you take now',
    source: (c) => c.medications,
    confirm: true,
  },
  {
    id: 'allergies',
    section: 'history',
    ask: 'Allergies',
    source: (c) => c.allergies,
    confirm: true,
  },
  {
    id: 'conditions',
    section: 'history',
    ask: 'Ongoing health conditions',
    source: (c) => c.conditions,
    confirm: true,
  },
  {
    id: 'surgeries',
    section: 'history',
    ask: 'Past surgeries',
    source: (c) => c.surgeries,
    confirm: true,
  },
  {
    id: 'family_history',
    section: 'history',
    ask: 'Family medical history',
    source: (c) => c.familyHistory,
    confirm: true,
  },
  {
    id: 'tobacco',
    section: 'history',
    ask: 'Do you smoke, vape or use tobacco?',
    source: observation(LOINC.tobacco),
    freshDays: 365,
  },
  {
    id: 'alcohol',
    section: 'history',
    ask: 'How often do you drink alcohol?',
    source: observation(LOINC.alcohol),
    freshDays: 365,
  },
  {
    id: 'pregnancy',
    section: 'history',
    ask: 'Is there any chance you could be pregnant?',
    covers: 'whether the patient is or could be pregnant',
    when: (p) => p.sex === 'female' && p.ageBand === 'adult',
  },

  {
    id: 'phq2',
    section: 'screening',
    ask: 'Over the last 2 weeks, how often have you felt down, or had little interest in things?',
    source: observation(LOINC.phq2),
    freshDays: 365,
  },
  {
    id: 'fall_risk',
    section: 'screening',
    ask: 'Have you fallen in the past year?',
    covers: 'whether the patient has fallen recently',
    when: (p) => p.ageBand === 'older_adult',
  },
];

export type FieldStatus = 'prefilled' | 'confirm' | 'sign' | 'answered' | 'ask';

/** Pure code: what the chart and the calendar decide before any model is asked. */
export function fromChart(
  field: Field,
  chart: Chart,
  today: Date,
): { status: 'prefilled' | 'confirm' | 'sign'; values: Known[] } | null {
  if (field.consent) return { status: 'sign', values: [] };
  const values = field.source?.(chart) ?? [];
  if (values.length === 0) return null;
  const stale =
    field.freshDays !== undefined &&
    values.some((v) => !v.recordedAt || daysSince(v.recordedAt, today) > (field.freshDays ?? 0));
  return { status: field.confirm || stale ? 'confirm' : 'prefilled', values };
}
