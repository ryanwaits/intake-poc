import type { ChoiceResponse } from '@typesafe-ai/sdk';
import type { JevResult } from './jev';
import { CATEGORIES, type Category, RED_FLAGS, type RedFlag } from './protocols';
import { key, SETTING_CRITERIA } from './questions';
import type { Setting } from './types';

/**
 * Everything a model decides, as probabilities. The seam every arena arm fills;
 * `plan` turns it into the form and card with the same code for every arm.
 */
export type Decisions = {
  model: string;
  setting: { value: Setting; confidence: number };
  /** P(yes) per red flag. */
  flags: Record<RedFlag, number>;
  /** P(yes) per complaint category. */
  complaints: Record<Category, number>;
  /** P(answered) per field id with `covers`. */
  answered: Record<string, number>;
  usage: { inputTokens: number; outputTokens: number; latencyMs: number };
};

type Answers = JevResult['answers'];

function yesP(answers: Answers, k: string): number {
  const a = answers[k];
  if (a?.type !== 'noul') throw new Error(`Missing yes/no answer: ${k}`);
  return a.noul;
}

function picked(answers: Answers, k: string): ChoiceResponse {
  const a = answers[k];
  if (a?.type !== 'choice') throw new Error(`Missing choice answer: ${k}`);
  return a;
}

/** Typed-question answers (Jev's shape) to `Decisions`. A missing answer throws, which degrades the plan. */
export function fromAnswers(
  answers: Answers,
  fieldIds: string[],
  model: string,
  usage: Decisions['usage'],
): Decisions {
  const setting = picked(answers, key.setting);
  if (!(setting.choice in SETTING_CRITERIA)) throw new Error(`Unknown setting: ${setting.choice}`);
  return {
    model,
    setting: { value: setting.choice as Setting, confidence: setting.confidence },
    flags: Object.fromEntries(
      (Object.keys(RED_FLAGS) as RedFlag[]).map((id) => [id, yesP(answers, key.flag(id))]),
    ) as Record<RedFlag, number>,
    complaints: Object.fromEntries(
      CATEGORIES.map((id) => [id, yesP(answers, key.complaint(id))]),
    ) as Record<Category, number>,
    answered: Object.fromEntries(
      fieldIds.map((id) => [id, picked(answers, key.field(id)).probabilities.answered ?? 0]),
    ),
    usage,
  };
}
