import { choice, noul, type Questions } from '@typesafe-ai/sdk';
import { type Field, PAPERWORK } from './form';
import {
  CATEGORIES,
  type Category,
  GENERAL_HISTORY,
  PROTOCOLS,
  RED_FLAGS,
  type RedFlag,
} from './protocols';
import type { Intake } from './types';

/** Question keys, shared by the builder and `fromAnswers`. */
export const key = {
  setting: 'setting',
  flag: (id: RedFlag) => `flag_${id}`,
  complaint: (id: Category) => `complaint_${id}`,
  field: (id: string) => `answered_${id}`,
};

export const SETTING_QUESTION = 'Based on `reason` and `patient`, where should this visit happen?';

/** Clinic first: Jev leans toward the first option, and the clinic is the safe default. */
export const SETTING_CRITERIA = {
  clinic: 'Needs a hands-on exam, a device such as an ear scope or stethoscope, or a test today.',
  video: 'Needs a conversation with a clinician but no hands-on exam, device or test.',
  message: 'A simple or administrative request a clinician can answer by secure message.',
  emergency: 'Could be an emergency that needs the ER or 911 now.',
};

export const ANSWERED_CRITERIA = {
  answered: 'The patient states this, even briefly or informally.',
  not_mentioned: 'The patient does not state this.',
};

export function coverageQuestion(field: Field): string {
  return `Does \`reason\` already tell us ${field.covers}?`;
}

/** What a model sees. Nothing else from the chart is sent. */
export function stateOf(intake: Intake) {
  return { reason: intake.reason, patient: intake.patient };
}

export function inScope(fields: readonly Field[], intake: Intake): Field[] {
  return fields.filter((f) => f.when?.(intake.patient) ?? true);
}

/** Every field a model could mark answered, across paperwork and all protocols, deduped. */
export function coveredFields(intake: Intake): Field[] {
  const all = [
    ...PAPERWORK,
    ...CATEGORIES.flatMap((c) => PROTOCOLS[c].history),
    ...GENERAL_HISTORY,
  ];
  const unique = new Map(all.filter((f) => f.covers).map((f) => [f.id, f]));
  return inScope([...unique.values()], intake);
}

/**
 * One request, speculative fan-out: route, red-flag and coverage questions all at once.
 * The complaint isn't known yet, so every protocol's questions are asked; `plan`
 * ignores the answers that don't apply. Each question is answered in isolation.
 */
export function buildQuestions(intake: Intake): { questions: Questions; fieldIds: string[] } {
  const questions: Questions = {
    [key.setting]: choice(SETTING_QUESTION, SETTING_CRITERIA),
  };
  for (const id of Object.keys(RED_FLAGS) as RedFlag[]) {
    questions[key.flag(id)] = noul(RED_FLAGS[id].detect);
  }
  for (const id of CATEGORIES) {
    questions[key.complaint(id)] = noul(PROTOCOLS[id].detect);
  }
  const fields = coveredFields(intake);
  for (const field of fields) {
    questions[key.field(field.id)] = choice(coverageQuestion(field), ANSWERED_CRITERIA);
  }
  return { questions, fieldIds: fields.map((f) => f.id) };
}
