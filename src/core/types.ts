import type { Known } from './chart';
import type { FieldStatus, Section } from './form';

/** Age is bucketed in code; models are weak at date math and never see a birth date. */
export type AgeBand = 'child' | 'adult' | 'older_adult';

/** The slim slice of the chart a model is allowed to see. No names, IDs, or dates. */
export type PatientSummary = {
  ageBand: AgeBand;
  sex: 'female' | 'male' | 'other' | 'unknown';
  problems: string[];
  medications: string[];
  allergies: string[];
};

export type Intake = {
  /** The patient's own words: the chief complaint. */
  reason: string;
  patient: PatientSummary;
};

export type Device = 'otoscope' | 'stethoscope' | 'exam_camera' | 'pulse_oximeter';
export type Vital = 'blood_pressure' | 'heart_rate' | 'temperature' | 'spo2' | 'respiratory_rate';

export type Setting = 'message' | 'video' | 'clinic' | 'emergency';

/** Every model-driven item says where it came from: the question, the probability, and the rule. */
export type Why = {
  question: string;
  p: number;
  rule: string;
};

export type FieldPlan = {
  id: string;
  section: Section;
  ask: string;
  status: FieldStatus;
  /** Chart values shown for prefill or confirm. */
  values: Known[];
  why: Why | null;
};

export type PrepCard = {
  /** Red flags for the provider. Never shown to the patient. */
  escalations: { id: string; label: string; why: Why }[];
  setting: { value: Setting | 'provider_now' | 'navigator_review'; why: Why | null };
  complaints: { id: string; label: string; why: Why }[];
  medicPrep: { devices: Device[]; vitals: Vital[]; tests: string[] };
};

export type IntakePlan = {
  /** `degraded` means the model was unreachable: code-only prefill, human triage. */
  mode: 'live' | 'degraded';
  model: string | null;
  /** The patient's form: every field in scope and how it gets filled. */
  fields: FieldPlan[];
  counts: Record<FieldStatus, number> & { total: number };
  card: PrepCard;
  usage: { inputTokens: number; outputTokens: number; latencyMs: number } | null;
};
