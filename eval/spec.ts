import type { Field } from '../src/core/form';
import { PAPERWORK } from '../src/core/form';
import { type Category, PROTOCOLS, type RedFlag } from '../src/core/protocols';
import type { PatientSummary } from '../src/core/types';
import {
  COMPLAINTS,
  FIELD_FACTS,
  NEAR_MISSES,
  PATIENTS,
  RED_FLAG_FACTS,
  type Style,
} from './facts';

/** What a case says, chosen by code. The writer model only phrases it. */
export type Spec = {
  id: string;
  patient: PatientSummary;
  complaints: Category[];
  complaintPhrases: string[];
  /** Field id → the fact phrase the message must state. */
  stated: Record<string, string>;
  /** Field ids the message must not answer. */
  unstated: string[];
  flag: RedFlag | null;
  flagPhrase: string | null;
  nearMiss: string | null;
  style: Style;
};

/** Deterministic PRNG so the case set is reproducible from a seed. */
function mulberry32(seed: number) {
  let a = seed;
  return () => {
    a = (a + 0x6d2b79f5) | 0;
    let t = Math.imul(a ^ (a >>> 15), 1 | a);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

/** Coverable fields truly in scope: paperwork fields with `covers` plus the true complaints' protocols. */
export function scopeFields(complaints: Category[], patient: PatientSummary): Field[] {
  const all = [...PAPERWORK, ...complaints.flatMap((c) => PROTOCOLS[c].history)];
  const unique = new Map(all.filter((f) => f.covers).map((f) => [f.id, f]));
  return [...unique.values()].filter((f) => f.when?.(patient) ?? true);
}

const STYLE_WEIGHTS: [Style, number][] = [
  ['terse', 0.25],
  ['conversational', 0.3],
  ['rambling', 0.15],
  ['typos', 0.18],
  ['injection', 0.12],
];

export function makeSpecs(n: number, seed = 42): Spec[] {
  const rand = mulberry32(seed);
  const pick = <T>(xs: readonly T[]): T => xs[Math.floor(rand() * xs.length)] as T;
  const weighted = <T>(pairs: [T, number][]): T => {
    let r = rand();
    for (const [x, w] of pairs) {
      r -= w;
      if (r < 0) return x;
    }
    return pairs[pairs.length - 1]?.[0] as T;
  };

  return Array.from({ length: n }, (_, i) => {
    const patient = pick(PATIENTS);
    const categories = (Object.keys(COMPLAINTS) as Category[]).filter(
      (c) => c !== 'med_refill' || patient.medications.length > 0,
    );
    const first = pick(categories);
    const second = rand() < 0.3 ? pick(categories.filter((c) => c !== first)) : null;
    const complaints = second ? [first, second] : [first];

    const stated: Record<string, string> = {};
    const unstated: string[] = [];
    for (const field of scopeFields(complaints, patient)) {
      const facts = FIELD_FACTS[field.id]?.(patient) ?? [];
      if (facts.length > 0 && rand() < 0.5) stated[field.id] = pick(facts);
      else unstated.push(field.id);
    }

    const r = rand();
    const flag = r < 0.2 ? pick(Object.keys(RED_FLAG_FACTS) as RedFlag[]) : null;
    return {
      id: `syn-${String(i + 1).padStart(3, '0')}`,
      patient,
      complaints,
      complaintPhrases: complaints.map((c) => pick(COMPLAINTS[c])),
      stated,
      unstated,
      flag,
      flagPhrase: flag ? pick(RED_FLAG_FACTS[flag]) : null,
      nearMiss: !flag && r < 0.3 ? pick(NEAR_MISSES) : null,
      style: weighted(STYLE_WEIGHTS),
    };
  });
}
