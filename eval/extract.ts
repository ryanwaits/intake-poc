/**
 * Clairic (Cloudflare's System One extraction model) on the synthetic cases: can it pull the
 * patient's actual answer out of their words, so a skipped question becomes "You said: 3 days"?
 *
 * Ground truth is known by construction: each case's spec records the exact fact phrase the
 * writer had to state per field, and which fields it had to leave out. Jev's recorded answers
 * (eval/results/jev.jsonl) give the decision side, so the pipeline Jev → Clairic is scored too.
 * The value-confidence gate is tuned on dev and reported on test, as in the arena.
 *
 *   bun --env-file=.env eval/extract.ts          # runs missing cases, then scores
 */
import { coveredFields } from '../src/core/questions';
import { loadRecords, RESULTS_DIR, splitOf } from './arena';
import { type Case, loadCases } from './case';

const MODEL = '@cf/cloudflare/clairic';
/** Workers AI catalog, 2026-10-20: $0.10 per million input tokens, output free. */
const USD_PER_M_INPUT = 0.1;
/** Jev's skip gate in production (`GATES.answeredAt`). */
const JEV_SKIP_AT = 0.7;
const RECORDS = `${RESULTS_DIR}/clairic-extract.jsonl`;
const SUMMARY = `${RESULTS_DIR}/clairic-extract.json`;

type Answer = {
  type: string;
  p_null: number;
  confidence: number;
  value: string | number | null;
  span?: [number, number];
};
type Row = {
  caseId: string;
  ok: boolean;
  error: string | null;
  latencyMs: number;
  inputTokens: number;
  answers: Record<string, Answer>;
};

async function extract(c: Case): Promise<Row> {
  const fields: Record<string, { type: string; instructions?: string; unit?: string }> =
    Object.fromEntries(
      coveredFields({ reason: c.reason, patient: c.patient })
        .filter((f) => c.labels.answered && f.id in c.labels.answered)
        .map((f) => [f.id, { type: 'text', instructions: f.covers }]),
    );
  // One typed example, to show values that need no parsing: onset as a duration.
  if ('onset' in fields) {
    fields.onset_days = {
      type: 'duration',
      unit: 'days',
      instructions: 'How long the symptoms have lasted so far',
    };
  }
  const started = performance.now();
  try {
    const res = await fetch(
      `https://api.cloudflare.com/client/v4/accounts/${process.env.CLOUDFLARE_ACCOUNT_ID}/ai/run/${MODEL}`,
      {
        method: 'POST',
        headers: {
          authorization: `Bearer ${process.env.CLOUDFLARE_API_TOKEN}`,
          'content-type': 'application/json',
        },
        // The patient's words only: spans are offsets into this text.
        body: JSON.stringify({ state: c.reason, fields }),
        signal: AbortSignal.timeout(20_000),
      },
    );
    if (!res.ok) throw new Error(`Workers AI ${res.status}`);
    const body = (await res.json()) as {
      result: { answers: Record<string, Answer>; usage: { input_tokens: number } };
    };
    return {
      caseId: c.id,
      ok: true,
      error: null,
      latencyMs: Math.round(performance.now() - started),
      inputTokens: body.result.usage.input_tokens,
      answers: body.result.answers,
    };
  } catch (e) {
    return {
      caseId: c.id,
      ok: false,
      error: e instanceof Error ? e.message : 'Unknown',
      latencyMs: Math.round(performance.now() - started),
      inputTokens: 0,
      answers: {},
    };
  }
}

async function loadRows(): Promise<Row[]> {
  const file = Bun.file(RECORDS);
  if (!(await file.exists())) return [];
  return (await file.text())
    .split('\n')
    .filter(Boolean)
    .map((l) => JSON.parse(l) as Row);
}

const STOP = new Set(
  "a an the i im i'm my me it its is was be been has have had and or of to in on at for with this that so just like about now some since".split(
    ' ',
  ),
);
const words = (s: string) =>
  s
    .toLowerCase()
    .replace(/[^a-z0-9' ]/g, ' ')
    .split(/\s+/)
    .filter((w) => w && !STOP.has(w));

/** Lenient: the extracted span shares a content word with the fact phrase the case had to state. */
export function matches(value: string, fact: string): boolean {
  const fw = new Set(words(fact));
  return words(value).some((w) => fw.has(w));
}

type FieldScore = {
  caseId: string;
  split: 'dev' | 'test';
  field: string;
  stated: boolean;
  jevP: number | null;
  value: string | null;
  confidence: number;
  correct: boolean;
};

function fieldScores(cases: Case[], rows: Row[], jev: Map<string, Record<string, number>>) {
  const byId = new Map(rows.filter((r) => r.ok).map((r) => [r.caseId, r]));
  const out: FieldScore[] = [];
  for (const c of cases) {
    const row = byId.get(c.id);
    if (!row || !c.labels.answered) continue;
    for (const [field, stated] of Object.entries(c.labels.answered)) {
      const a = row.answers[field];
      if (!a) continue;
      const value = typeof a.value === 'string' ? a.value : null;
      const fact = c.meta.spec?.stated[field];
      out.push({
        caseId: c.id,
        split: splitOf(c),
        field,
        stated,
        jevP: jev.get(c.id)?.[field] ?? null,
        value,
        confidence: a.confidence,
        correct: stated && value !== null && fact !== undefined && matches(value, fact),
      });
    }
  }
  return out;
}

const pct = (n: number, d: number) => (d === 0 ? null : Math.round((1000 * n) / d) / 10);

function detection(scores: FieldScore[], present: (s: FieldScore) => boolean) {
  const tp = scores.filter((s) => s.stated && present(s)).length;
  const fp = scores.filter((s) => !s.stated && present(s)).length;
  const fn = scores.filter((s) => s.stated && !present(s)).length;
  const tn = scores.filter((s) => !s.stated && !present(s)).length;
  return {
    accuracy: pct(tp + tn, scores.length),
    precision: pct(tp, tp + fp),
    recall: pct(tp, tp + fn),
    /** Unanswered questions that would be skipped: the costly error. */
    falseSkips: fp,
    fields: scores.length,
  };
}

/** Jev decides the skip, Clairic fills the value if it's confident enough. */
function pipeline(scores: FieldScore[], gate: number) {
  const skipped = scores.filter((s) => (s.jevP ?? 0) >= JEV_SKIP_AT);
  const shown = skipped.filter((s) => s.value !== null && s.confidence >= gate);
  return {
    jevSkips: skipped.length,
    withValue: shown.length,
    coverage: pct(shown.length, skipped.length),
    valueCorrect: pct(shown.filter((s) => s.correct).length, shown.length),
  };
}

/** Lowest gate whose shown values are ≥ 95% correct on dev. */
function tuneGate(dev: FieldScore[]): number {
  for (let g = 0; g <= 0.95; g = Math.round((g + 0.05) * 100) / 100) {
    const p = pipeline(dev, g);
    if ((p.valueCorrect ?? 0) >= 95 && p.withValue >= 20) return g;
  }
  return 0.95;
}

function quantile(xs: number[], q: number) {
  const s = [...xs].sort((a, b) => a - b);
  return s[Math.min(s.length - 1, Math.floor(s.length * q))] ?? 0;
}

const cases = (await loadCases()).filter((c) => c.source === 'synthetic');
const rows = await loadRows();
const done = new Set(rows.filter((r) => r.ok).map((r) => r.caseId));
const todo = cases.filter((c) => !done.has(c.id));

if (todo.length > 0) {
  if (!process.env.CLOUDFLARE_API_TOKEN) throw new Error('CLOUDFLARE_API_TOKEN is not set');
  console.log(`Running ${todo.length} cases on ${MODEL}`);
  const fresh: Row[] = [];
  let next = 0;
  await Promise.all(
    Array.from({ length: 8 }, async () => {
      while (next < todo.length) {
        const c = todo[next++];
        if (c) fresh.push(await extract(c));
      }
    }),
  );
  const kept = rows.filter((r) => r.ok);
  await Bun.write(RECORDS, `${[...kept, ...fresh].map((r) => JSON.stringify(r)).join('\n')}\n`);
  rows.splice(0, rows.length, ...kept, ...fresh);
  console.log(`errors: ${fresh.filter((r) => !r.ok).length}`);
}

const jev = new Map(
  (await loadRecords('jev'))
    .filter((r) => r.repeat === 0 && r.ok && r.decisions)
    .map((r) => [r.caseId, r.decisions?.answered ?? {}]),
);
const scores = fieldScores(cases, rows, jev);
const dev = scores.filter((s) => s.split === 'dev');
const test = scores.filter((s) => s.split === 'test');
const gate = tuneGate(dev);
const ok = rows.filter((r) => r.ok);
const meanInput = ok.reduce((n, r) => n + r.inputTokens, 0) / ok.length;

const summary = {
  model: MODEL,
  cases: { run: rows.length, ok: ok.length, errors: rows.length - ok.length },
  test: {
    detection: {
      jev: detection(test, (s) => (s.jevP ?? 0) >= JEV_SKIP_AT),
      clairicNonNull: detection(test, (s) => s.value !== null),
      clairicAtGate: detection(test, (s) => s.value !== null && s.confidence >= gate),
    },
    valueCorrectWhenStated: pct(
      test.filter((s) => s.correct).length,
      test.filter((s) => s.stated && s.value !== null).length,
    ),
    pipeline: { gate, ...pipeline(test, gate) },
  },
  latencyMs: {
    p50: quantile(
      ok.map((r) => r.latencyMs),
      0.5,
    ),
    p95: quantile(
      ok.map((r) => r.latencyMs),
      0.95,
    ),
  },
  inputTokensMean: Math.round(meanInput),
  usdPer100kIntakes: Math.round(((meanInput * 100_000) / 1e6) * USD_PER_M_INPUT * 100) / 100,
  onsetDaysExamples: ok
    .filter((r) => r.answers.onset_days?.value != null)
    .slice(0, 6)
    .map((r) => ({
      caseId: r.caseId,
      said: r.answers.onset?.value ?? null,
      days: r.answers.onset_days?.value,
    })),
};
await Bun.write(SUMMARY, `${JSON.stringify(summary, null, 2)}\n`);
console.log(JSON.stringify(summary, null, 2));
