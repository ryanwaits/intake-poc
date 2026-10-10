/**
 * Flatten summary.json, load.json and the eval set into the results page's datasets.
 *   bun eval/export.ts   → eval/results/dashboard/*.json
 */
import { loadCases } from './case';

const OUT = 'eval/results/dashboard';
const summary = await Bun.file('eval/results/summary.json').json();
const load = (await Bun.file('eval/results/load.json').exists())
  ? await Bun.file('eval/results/load.json').json()
  : {};
const cases = await loadCases();

type View = 'preregistered' | 'amended';
type Metrics = { [metric: string]: number };
type ArmSummary = {
  arm: string;
  label: string;
  model: string;
  approach: string;
  complete: boolean;
  records: number;
  views: Record<View, { test: Metrics; gates: Metrics; flipRate: number | null }>;
  calibration: { ece: number } | null;
  latencyMs: { p50: number; p95: number };
  costPer100kUsd: number;
  costPerIntakeUsd: number;
  inputTokensPerIntake: number;
  armCodeLines: number;
  baa: string;
  selfHost: boolean;
};
const round = (x: number | null | undefined, d = 4) =>
  x == null || Number.isNaN(x) ? null : Math.round(x * 10 ** d) / 10 ** d;

const decisionFor = (view: View) => summary.decisions[view];
const passes = (a: ArmSummary, view: View) =>
  (a.views[view].test.redFlagRecall ?? 0) >= 0.95 &&
  (a.views[view].test.missedFieldRate ?? 1) <= 0.05;

const arms = (summary.arms as ArmSummary[]).map((a) => {
  const t = a.views.amended.test;
  const p = a.views.preregistered.test;
  return {
    arm: a.arm,
    name: a.label,
    model: a.model,
    approach: a.approach,
    family:
      a.approach === 'decision-api'
        ? 'Decision model'
        : a.approach === 'rules'
          ? 'Rules'
          : 'General LLM',
    complete: a.complete,
    records: a.records,
    paperwork_accuracy: round(t.paperworkAccuracy),
    missed_field_rate: round(t.missedFieldRate),
    over_ask_rate: round(t.overAskRate),
    extra_asks_per_case: round(t.extraAsksPerCase, 2),
    complaint_exact: round(t.complaintExact),
    red_flag_recall: round(t.redFlagRecall),
    red_flag_recall_preregistered: round(p.redFlagRecall),
    false_escalation_rate: round(t.falseEscalationRate),
    semigran_emergent_recall: round(t.semigranEmergentRecall),
    injection_missed_rate: round(t.injectionMissedRate),
    other_missed_rate: round(t.otherMissedRate),
    calibration_error: round(a.calibration?.ece ?? null),
    flip_rate: round(a.views.amended.flipRate),
    p50_ms: Math.round(a.latencyMs.p50),
    p95_ms: Math.round(a.latencyMs.p95),
    cost_per_100k_usd: round(a.costPer100kUsd, 2),
    input_tokens: Math.round(a.inputTokensPerIntake),
    code_lines: a.armCodeLines,
    baa: a.baa,
    self_host: a.selfHost ? 'yes' : 'no',
    escalate_gate_preregistered: a.views.preregistered.gates.escalateAt,
    answered_gate: a.views.amended.gates.answeredAt,
    passes_amended: passes(a, 'amended') ? 'pass' : 'fail',
    passes_preregistered: passes(a, 'preregistered') ? 'pass' : 'fail',
  };
});

const ci = (['amended', 'preregistered'] as View[]).flatMap((view) =>
  (decisionFor(view).comparisons as { arm: string; vsLeader: number[] }[])
    .filter(
      (c) =>
        c.arm !== decisionFor(view).leader &&
        arms.find((a: { arm: string }) => a.arm === c.arm)?.complete,
    )
    .map((c) => ({
      view,
      arm: c.arm,
      name: arms.find((a: { arm: string }) => a.arm === c.arm)?.name,
      leader: decisionFor(view).leader,
      diff: round(c.vsLeader[0] ?? null),
      lo: round(c.vsLeader[1] ?? null),
      hi: round(c.vsLeader[2] ?? null),
    })),
);

const calibration = summary.arms.flatMap(
  (a: {
    arm: string;
    label: string;
    calibration: {
      bins: { bin: number; confidence: number; accuracy: number; n: number }[];
    } | null;
  }) =>
    (a.calibration?.bins ?? []).map((b) => ({
      arm: a.arm,
      name: a.label,
      bin: b.bin,
      confidence: round(b.confidence),
      accuracy: round(b.accuracy),
      n: b.n,
    })),
);

const loadRows = Object.entries(
  load as Record<
    string,
    {
      concurrency: number;
      throughputPerSec: number;
      p50Ms: number;
      p95Ms: number;
      errors: number;
    }[]
  >,
).flatMap(([arm, rows]) =>
  rows.map((r) => ({
    arm,
    name: arms.find((a: { arm: string }) => a.arm === arm)?.name ?? arm,
    concurrency: r.concurrency,
    throughput_per_sec: round(r.throughputPerSec, 2),
    p50_ms: r.p50Ms,
    p95_ms: r.p95Ms,
    errors: r.errors,
  })),
);

const synthetic = cases.filter((c) => c.source === 'synthetic');
const spend = summary.arms.reduce(
  (s: number, a: { costPerIntakeUsd: number; records: number }) =>
    s + a.costPerIntakeUsd * a.records,
  0,
);
const run = [
  {
    key: 'run',
    cases_total: cases.length,
    synthetic_cases: synthetic.length,
    synthetic_dropped: 200 - synthetic.length,
    semigran_cases: cases.length - synthetic.length,
    labeled_fields: synthetic.reduce((s, c) => s + Object.keys(c.labels.answered ?? {}).length, 0),
    red_flag_cases: synthetic.filter((c) => c.labels.escalate).length,
    test_cases: summary.cases.test,
    recommendation_amended_arm: decisionFor('amended').recommendation,
    leader_preregistered_arm: decisionFor('preregistered').leader,
    recommendation_amended:
      arms.find((a: { arm: string }) => a.arm === decisionFor('amended').recommendation)?.name ??
      null,
    leader_preregistered:
      arms.find((a: { arm: string }) => a.arm === decisionFor('preregistered').leader)?.name ??
      null,
    recommendation_preregistered:
      arms.find((a: { arm: string }) => a.arm === decisionFor('preregistered').recommendation)
        ?.name ?? null,
    tied_amended: (decisionFor('amended').tiedWithLeader as string[]).length,
    arena_spend_usd: round(spend, 2),
    generated_at: summary.generatedAt,
  },
];

for (const [name, rows] of Object.entries({ arms, ci, calibration, load: loadRows, run })) {
  await Bun.write(`${OUT}/${name}.json`, `${JSON.stringify(rows, null, 2)}\n`);
  console.log(`${name}: ${rows.length} rows`);
}
