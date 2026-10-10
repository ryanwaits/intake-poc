import { describe, expect, test } from 'bun:test';
import maria from '../fixtures/patients/maria.json';
import walter from '../fixtures/patients/walter.json';
import { ageBand, ageInYears, type PatientBundle, parseChart, toSummary } from '../src/core/chart';
import { buildQuestions, key } from '../src/core/questions';
import { run } from '../src/core/run';
import { fakeDecide } from './fake-decide';

const today = new Date('2026-10-08T12:00:00Z');
const mariaChart = parseChart(maria as PatientBundle);
const status = (fields: { id: string; status: string }[], id: string) =>
  fields.find((f) => f.id === id)?.status;

describe('chart', () => {
  test('age is computed in code, birthday-aware', () => {
    expect(ageInYears('1961-10-09', today)).toBe(64);
    expect(ageInYears('1961-10-08', today)).toBe(65);
    expect(ageBand(17)).toBe('child');
    expect(ageBand(65)).toBe('older_adult');
  });

  test('chart parses registration, coverage and latest observations', () => {
    expect(mariaChart.name).toBe('Maria Synthetic');
    expect(mariaChart.employer).toBe('Example Manufacturing Co');
    expect(mariaChart.emergencyContact).toBe('Luis Synthetic, Spouse, 555-0143');
    expect(mariaChart.observations['72166-2']?.value).toBe('Never smoker');
  });

  test('model summary keeps active items and drops identifiers', () => {
    const summary = toSummary(mariaChart, today);
    expect(summary).toEqual({
      ageBand: 'adult',
      sex: 'female',
      problems: ['Hypertension'],
      medications: ['lisinopril 10 MG Oral Tablet'],
      allergies: ['Penicillin'],
    });
    expect(JSON.stringify(summary)).not.toMatch(/Maria|555-|RZ-|1974/);
  });
});

describe('questions', () => {
  const intake = { reason: 'my ear hurts', patient: toSummary(mariaChart, today) };

  test('one request covers routing, red flags, complaints and every coverable field', () => {
    const { questions, fieldIds } = buildQuestions(intake);
    expect(questions[key.setting]?.type).toBe('choice');
    expect(questions[key.flag('chest_pain')]?.type).toBe('noul');
    expect(fieldIds).toContain('onset');
    expect(fieldIds).toContain('pregnancy');
    expect(new Set(fieldIds).size).toBe(fieldIds.length);
  });

  test('code-side rules filter fields before a model sees them', () => {
    const male = { ...intake, patient: { ...intake.patient, sex: 'male' as const } };
    expect(buildQuestions(male).fieldIds).not.toContain('pregnancy');
    expect(buildQuestions(intake).fieldIds).not.toContain('fall_risk');
  });
});

describe('paperwork plan', () => {
  test('chart prefills, stale values and lists get a confirm, consents get signed', async () => {
    const { plan } = await run(maria as PatientBundle, 'my ear hurts', fakeDecide(), today);
    expect(status(plan.fields, 'name')).toBe('prefilled');
    expect(status(plan.fields, 'employer')).toBe('prefilled');
    expect(status(plan.fields, 'pharmacy')).toBe('ask');
    expect(status(plan.fields, 'medications')).toBe('confirm');
    expect(status(plan.fields, 'tobacco')).toBe('confirm'); // recorded 2024, stale
    expect(status(plan.fields, 'phq2')).toBe('prefilled'); // recorded 2026, fresh
    expect(status(plan.fields, 'consent_telehealth')).toBe('sign');
  });

  test('ear complaint: answered visit questions are skipped, the medic preps the otoscope', async () => {
    const { plan } = await run(
      maria as PatientBundle,
      'ear hurts 3 days',
      fakeDecide({ complaints: { ent: 0.95 }, answered: { onset: 0.9 } }),
      today,
    );
    expect(plan.card.complaints.map((c) => c.id)).toEqual(['ent']);
    expect(status(plan.fields, 'onset')).toBe('answered');
    expect(status(plan.fields, 'side')).toBe('ask');
    expect(plan.card.medicPrep.devices).toEqual(['otoscope', 'exam_camera']);
    expect(plan.counts.total).toBe(
      plan.counts.ask +
        plan.counts.confirm +
        plan.counts.sign +
        plan.counts.answered +
        plan.counts.prefilled,
    );
  });

  test('a 1-in-4 red flag escalates to a provider now', async () => {
    const { plan } = await run(
      walter as PatientBundle,
      'chest tight',
      fakeDecide({ flags: { chest_pain: 0.25 } }),
      today,
    );
    expect(plan.card.escalations.map((e) => e.id)).toEqual(['chest_pain']);
    expect(plan.card.setting.value).toBe('provider_now');
  });

  test('older adults get the fall screen; no pregnancy question for men', async () => {
    const { plan } = await run(walter as PatientBundle, 'cough', fakeDecide(), today);
    expect(status(plan.fields, 'fall_risk')).toBe('ask');
    expect(status(plan.fields, 'pregnancy')).toBeUndefined();
  });
});

describe('degraded mode', () => {
  test('model failure still prefills from the chart and never throws', async () => {
    const down = async () => {
      throw new TypeError('fetch failed');
    };
    const { plan, error } = await run(maria as PatientBundle, 'ear hurts', down, today);
    expect(error).toBe('TypeError');
    expect(plan.mode).toBe('degraded');
    expect(status(plan.fields, 'name')).toBe('prefilled');
    expect(status(plan.fields, 'onset')).toBe('ask');
    expect(plan.card.setting.value).toBe('navigator_review');
    expect(plan.card.medicPrep.devices).toHaveLength(4);
  });
});
