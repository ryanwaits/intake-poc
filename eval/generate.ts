/**
 * Build the eval set: synthetic cases with labels known by construction, plus
 * Semigran vignettes rewritten in the patient's voice.
 *   bun run eval:generate [count=200]
 */
import { CATEGORIES, PROTOCOLS, RED_FLAGS, type RedFlag } from '../src/core/protocols';
import type { AgeBand, PatientSummary } from '../src/core/types';
import { CASES_PATH, type Case } from './case';
import { STYLES } from './facts';
import { chat, spend } from './gateway';
import { makeSpecs, type Spec, scopeFields } from './spec';

/** Neither model is an arena contestant, so no arm is graded on its own family's writing. */
const WRITER = 'google/gemini-3.8-flash';
const CHECKER = 'deepseek/deepseek-v4-flash';
const BUDGET_USD = 5;
const MAX_ATTEMPTS = 3;
const CONCURRENCY = 8;

function who(p: PatientSummary): string {
  return p.ageBand === 'child'
    ? `a parent writing about their ${p.sex === 'female' ? 'daughter' : 'son'}`
    : `the patient (${p.ageBand.replace('_', ' ')}, ${p.sex})`;
}

function writerPrompt(spec: Spec): string {
  const fields = scopeFields(spec.complaints, spec.patient);
  const must = Object.values(spec.stated);
  const mustNot = fields.filter((f) => spec.unstated.includes(f.id)).map((f) => f.covers);
  const extra = [spec.flagPhrase, spec.nearMiss].filter(Boolean);
  return [
    `Write the message ${who(spec.patient)} types into a clinic app when booking a visit.`,
    `Main problem: ${spec.complaintPhrases.join(', and also ')}.`,
    must.length
      ? `State each of these facts, in your own casual words:\n- ${must.join('\n- ')}`
      : '',
    mustNot.length ? `Do NOT state or hint at any of these:\n- ${mustNot.join('\n- ')}` : '',
    extra.length ? `Also mention: ${extra.join('; ')}.` : '',
    'Do not add any other symptoms, timing, or medical details.',
    `Style: ${STYLES[spec.style]}`,
    'Output only the message.',
  ]
    .filter(Boolean)
    .join('\n\n');
}

type Reading = { fields: Record<string, boolean>; flags: RedFlag[]; complaints: string[] };

async function check(spec: Spec, message: string): Promise<Reading> {
  const fields = scopeFields(spec.complaints, spec.patient);
  const flagIds = Object.keys(RED_FLAGS) as RedFlag[];
  const prompt = [
    `Patient message:\n"""${message}"""`,
    'For each field, does the message state it (either way, e.g. "no fever" states fever)?',
    ...fields.map((f) => `- ${f.id}: ${f.covers}`),
    'Which red flags does the message describe? Only real ones, not mild or unrelated mentions.',
    ...flagIds.map((id) => `- ${id}: ${RED_FLAGS[id].label}`),
    'Which complaint categories does the message describe?',
    ...CATEGORIES.map((c) => `- ${c}: ${PROTOCOLS[c].label}`),
  ].join('\n');
  const schema = {
    type: 'object',
    properties: {
      fields: {
        type: 'object',
        properties: Object.fromEntries(fields.map((f) => [f.id, { type: 'boolean' }])),
        required: fields.map((f) => f.id),
        additionalProperties: false,
      },
      flags: { type: 'array', items: { type: 'string', enum: flagIds } },
      complaints: { type: 'array', items: { type: 'string', enum: CATEGORIES } },
    },
    required: ['fields', 'flags', 'complaints'],
    additionalProperties: false,
  };
  const text = await chat(
    { model: CHECKER, user: prompt, temperature: 0, schema: { name: 'reading', schema } },
    BUDGET_USD,
  );
  return JSON.parse(text) as Reading;
}

/** Disagreements that invalidate the labels. Extra complaints are only noted. */
function disagreements(spec: Spec, r: Reading): { blocking: string[]; notes: string[] } {
  const blocking: string[] = [];
  for (const [id, said] of Object.entries(r.fields)) {
    const truth = id in spec.stated;
    if (said !== truth) blocking.push(`${id}: expected ${truth ? 'stated' : 'unstated'}`);
  }
  const flags = new Set(r.flags);
  if (spec.flag && !flags.has(spec.flag)) blocking.push(`flag ${spec.flag} missing`);
  for (const f of flags) if (f !== spec.flag) blocking.push(`unexpected flag ${f}`);
  for (const c of spec.complaints)
    if (!r.complaints.includes(c)) blocking.push(`complaint ${c} missing`);
  const notes = r.complaints
    .filter((c) => !spec.complaints.includes(c as never))
    .map((c) => `checker also read complaint ${c}`);
  return { blocking, notes };
}

async function synthetic(spec: Spec): Promise<Case | null> {
  for (let attempt = 1; attempt <= MAX_ATTEMPTS; attempt++) {
    const reason = await chat(
      { model: WRITER, user: writerPrompt(spec), temperature: 0.9, reasoningEffort: 'low' },
      BUDGET_USD,
    );
    const { blocking, notes } = disagreements(spec, await check(spec, reason));
    if (blocking.length > 0) continue;
    return {
      id: spec.id,
      source: 'synthetic',
      patient: spec.patient,
      reason,
      labels: {
        escalate: spec.flag !== null,
        complaints: spec.complaints,
        flags: spec.flag ? [spec.flag] : [],
        answered: Object.fromEntries(
          scopeFields(spec.complaints, spec.patient).map((f) => [f.id, f.id in spec.stated]),
        ),
      },
      meta: {
        style: spec.style,
        spec,
        writer: WRITER,
        checker: CHECKER,
        attempts: attempt,
        checkerNotes: notes,
      },
    };
  }
  return null;
}

type Vignette = {
  urgency_level: 'em' | 'ne' | 'sc';
  correct_diagnosis: string;
  case_description: string;
};

/** Age and sex come from the vignette's first line, in code. */
function vignettePatient(text: string): PatientSummary {
  const years = /(\d+)[- ]year[- ]old/i.exec(text);
  const months = /(\d+)[- ](month|week|day)[- ]old/i.test(text);
  const age = years ? Number(years[1]) : months ? 0 : 40;
  const ageBand: AgeBand = age < 18 ? 'child' : age >= 65 ? 'older_adult' : 'adult';
  const female = /\b(woman|girl|female|she)\b/i.test(text);
  const male = /\b(man|boy|male|he)\b/i.test(text);
  return {
    ageBand,
    sex: female ? 'female' : male ? 'male' : 'unknown',
    problems: [],
    medications: [],
    allergies: [],
  };
}

async function semigran(v: Vignette, i: number): Promise<Case> {
  const reason = await chat(
    {
      model: WRITER,
      temperature: 0.7,
      reasoningEffort: 'low',
      user: [
        'Rewrite this clinical vignette as the message the patient (or a parent, for a child) would type into a clinic app before being seen.',
        'Keep only the symptoms, history and timeline they would know, in plain first-person words.',
        'Leave out exam findings, measured vital signs, lab or imaging results, and any diagnosis. Two to five sentences. Output only the message.',
        `Vignette:\n"""${v.case_description}"""`,
      ].join('\n'),
    },
    BUDGET_USD,
  );
  return {
    id: `sem-${String(i + 1).padStart(2, '0')}`,
    source: 'semigran',
    patient: vignettePatient(v.case_description),
    reason,
    labels: { escalate: v.urgency_level === 'em', complaints: null, flags: null, answered: null },
    meta: {
      vignette: {
        urgency: v.urgency_level,
        diagnosis: v.correct_diagnosis,
        original: v.case_description,
      },
      writer: WRITER,
      attempts: 1,
      checkerNotes: [],
    },
  };
}

async function pool<T, R>(items: T[], fn: (item: T, i: number) => Promise<R>): Promise<R[]> {
  const out: R[] = new Array(items.length);
  let next = 0;
  const worker = async () => {
    while (next < items.length) {
      const i = next++;
      out[i] = await fn(items[i] as T, i);
      if ((i + 1) % 20 === 0) console.error(`  ${i + 1}/${items.length}  $${spend.usd.toFixed(3)}`);
    }
  };
  await Promise.all(Array.from({ length: CONCURRENCY }, worker));
  return out;
}

const count = Number(Bun.argv[2] ?? 200);
console.error(`Writing ${count} synthetic cases (${WRITER}, checked by ${CHECKER})`);
const specs = makeSpecs(count);
const synth = (await pool(specs, synthetic)).filter((c): c is Case => c !== null);

console.error('Rewriting Semigran vignettes in the patient voice');
const vignettes = (await Bun.file('eval/data/semigran.jsonl').text())
  .split('\n')
  .filter(Boolean)
  .map((l) => JSON.parse(l) as Vignette);
const sem = await pool(vignettes, semigran);

const cases = [...synth, ...sem];
await Bun.write(CASES_PATH, `${cases.map((c) => JSON.stringify(c)).join('\n')}\n`);

const attempts = synth.map((c) => c.meta.attempts);
console.error(
  [
    `\nWrote ${cases.length} cases to ${CASES_PATH}`,
    `  synthetic kept ${synth.length}/${count} (dropped ${count - synth.length} after ${MAX_ATTEMPTS} failed checks)`,
    `  first-try pass ${attempts.filter((a) => a === 1).length}/${synth.length}`,
    `  semigran ${sem.length}`,
    `  spend $${spend.usd.toFixed(3)} over ${spend.calls} calls`,
  ].join('\n'),
);
