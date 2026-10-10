import type {
  AllergyIntolerance,
  Bundle,
  CodeableConcept,
  Condition,
  Coverage,
  FamilyMemberHistory,
  FhirResource,
  MedicationRequest,
  Observation,
  Patient,
  Procedure,
} from 'fhir/r4';
import type { AgeBand, PatientSummary } from './types';

/** A patient's FHIR R4 bundle: Patient plus Coverage, Conditions, meds, allergies, observations. */
export type PatientBundle = Bundle<FhirResource>;

/** A fact from the chart, with when it was recorded so code can judge staleness. */
export type Known = { value: string; recordedAt?: string };

/**
 * What the chart already knows. Used by code to prefill the form.
 * Holds identifiers, so it never goes to a model; `toSummary` makes the model's slice.
 */
export type Chart = {
  name?: string;
  birthDate: string;
  sex: PatientSummary['sex'];
  address?: string;
  phone?: string;
  email?: string;
  language?: string;
  emergencyContact?: string;
  employer?: string;
  memberId?: string;
  medications: Known[];
  allergies: Known[];
  conditions: Known[];
  surgeries: Known[];
  familyHistory: Known[];
  /** Latest observation per LOINC code. */
  observations: Record<string, Known>;
};

/** LOINC codes for the observations the form reads. */
export const LOINC = {
  tobacco: '72166-2',
  alcohol: '11331-6',
  phq2: '55757-9',
} as const;

/** Whole years between a FHIR date (YYYY, YYYY-MM or YYYY-MM-DD) and `today`. */
export function ageInYears(birthDate: string, today: Date): number {
  const [y = 0, m = 1, d = 1] = birthDate.split('-').map(Number);
  let age = today.getUTCFullYear() - y;
  const beforeBirthday =
    today.getUTCMonth() + 1 < m || (today.getUTCMonth() + 1 === m && today.getUTCDate() < d);
  if (beforeBirthday) age -= 1;
  return age;
}

export function daysSince(date: string, today: Date): number {
  return Math.floor((today.getTime() - new Date(date).getTime()) / 86_400_000);
}

export function ageBand(years: number): AgeBand {
  if (years < 18) return 'child';
  if (years >= 65) return 'older_adult';
  return 'adult';
}

function text(concept: CodeableConcept | undefined): string | undefined {
  return concept?.text ?? concept?.coding?.[0]?.display;
}

function isActive(concept: CodeableConcept | undefined): boolean {
  return concept?.coding?.some((c) => c.code === 'active') ?? false;
}

function of<T extends FhirResource['resourceType']>(resources: FhirResource[], type: T) {
  return resources.filter(
    (r): r is Extract<FhirResource, { resourceType: T }> => r.resourceType === type,
  );
}

function known(value: string | undefined, recordedAt?: string): Known[] {
  return value ? [{ value, recordedAt }] : [];
}

export function parseChart(bundle: PatientBundle): Chart {
  const resources = (bundle.entry ?? []).flatMap((e) => (e.resource ? [e.resource] : []));
  const patient = of(resources, 'Patient')[0] as Patient | undefined;
  if (!patient?.birthDate) throw new Error('Bundle has no Patient with a birthDate');

  const name = patient.name?.[0];
  const address = patient.address?.[0];
  const contact = patient.contact?.[0];
  const telecom = (system: string) => patient.telecom?.find((t) => t.system === system)?.value;
  const coverage = of(resources, 'Coverage')[0] as Coverage | undefined;
  const gender = patient.gender;

  const observations: Record<string, Known> = {};
  for (const o of of(resources, 'Observation') as Observation[]) {
    const code = o.code.coding?.find((c) => c.system === 'http://loinc.org')?.code;
    const value = text(o.valueCodeableConcept) ?? o.valueQuantity?.value?.toString();
    if (!code || !value) continue;
    const prior = observations[code];
    if (!prior?.recordedAt || (o.effectiveDateTime ?? '') > prior.recordedAt) {
      observations[code] = { value, recordedAt: o.effectiveDateTime };
    }
  }

  return {
    name: name && [...(name.given ?? []), name.family].filter(Boolean).join(' '),
    birthDate: patient.birthDate,
    sex: gender === 'female' || gender === 'male' || gender === 'other' ? gender : 'unknown',
    address:
      address &&
      [...(address.line ?? []), address.city, address.state, address.postalCode]
        .filter(Boolean)
        .join(', '),
    phone: telecom('phone'),
    email: telecom('email'),
    language: text(patient.communication?.[0]?.language),
    emergencyContact:
      contact &&
      [
        [...(contact.name?.given ?? []), contact.name?.family].filter(Boolean).join(' '),
        text(contact.relationship?.[0]),
        contact.telecom?.[0]?.value,
      ]
        .filter(Boolean)
        .join(', '),
    employer: coverage?.class?.find((c) => c.type.coding?.[0]?.code === 'group')?.name,
    memberId: coverage?.subscriberId,
    medications: (of(resources, 'MedicationRequest') as MedicationRequest[])
      .filter((m) => m.status === 'active')
      .flatMap((m) => known(text(m.medicationCodeableConcept), m.authoredOn)),
    allergies: (of(resources, 'AllergyIntolerance') as AllergyIntolerance[])
      .filter((a) => isActive(a.clinicalStatus))
      .flatMap((a) => known(text(a.code), a.recordedDate)),
    conditions: (of(resources, 'Condition') as Condition[])
      .filter((c) => isActive(c.clinicalStatus))
      .flatMap((c) => known(text(c.code), c.recordedDate)),
    surgeries: (of(resources, 'Procedure') as Procedure[])
      .filter((p) => p.status === 'completed')
      .flatMap((p) => known(text(p.code), p.performedDateTime)),
    familyHistory: (of(resources, 'FamilyMemberHistory') as FamilyMemberHistory[]).flatMap((f) =>
      known(
        [text(f.relationship), f.condition?.map((c) => text(c.code)).join(', ')]
          .filter(Boolean)
          .join(': '),
        f.date,
      ),
    ),
    observations,
  };
}

/** The slim slice a model is allowed to see: no names, IDs, contact details or dates. */
export function toSummary(chart: Chart, today = new Date()): PatientSummary {
  return {
    ageBand: ageBand(ageInYears(chart.birthDate, today)),
    sex: chart.sex,
    problems: chart.conditions.map((c) => c.value),
    medications: chart.medications.map((m) => m.value),
    allergies: chart.allergies.map((a) => a.value),
  };
}
