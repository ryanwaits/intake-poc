import type { Category, RedFlag } from '../src/core/protocols';
import type { PatientSummary } from '../src/core/types';
import type { Spec } from './spec';

/** One eval case: the patient's words, the chart summary a model sees, and the true labels. */
export type Case = {
  id: string;
  source: 'synthetic' | 'semigran';
  patient: PatientSummary;
  reason: string;
  labels: {
    /** Should a provider see this now? Synthetic: a red flag was stated. Semigran: emergent vignette. */
    escalate: boolean;
    /** Synthetic only: labels known by construction. */
    complaints: Category[] | null;
    flags: RedFlag[] | null;
    /** Field id → did the message answer it. Every coverable field truly in scope. */
    answered: Record<string, boolean> | null;
  };
  meta: {
    style?: Spec['style'];
    spec?: Spec;
    vignette?: { urgency: 'em' | 'ne' | 'sc'; diagnosis: string; original: string };
    writer: string;
    checker?: string;
    attempts: number;
    /** Things the checker read differently, kept for the human review. */
    checkerNotes: string[];
  };
};

export const CASES_PATH = 'eval/data/cases.jsonl';

export async function loadCases(path = CASES_PATH): Promise<Case[]> {
  const text = await Bun.file(path).text();
  return text
    .split('\n')
    .filter(Boolean)
    .map((line) => JSON.parse(line) as Case);
}
