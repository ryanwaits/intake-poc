/**
 * Score every arm per eval/PREREGISTRATION.md: tune gates on dev, report on test.
 *   bun run eval:score   → prints the table, writes eval/results/summary.json
 */
import type { Chart } from '../src/core/chart';
import type { Decisions } from '../src/core/decisions';
import { GATES, type Gates, plan } from '../src/core/plan';
import type { IntakePlan } from '../src/core/types';
import { loadRecords, RESULTS_DIR, type Record, splitOf } from './arena';
import { ARMS, type Arm } from './arms';
import { type Case, loadCases } from './case';

const TODAY = new Date('2026-10-08T12:00:00Z');
const GRID = Array.from({ length: 99 }, (_, i) => (i + 1) / 100);

/** An empty chart: prefill is code and identical for every arm, so it's left out of scoring. */
function emptyChart(c: Case): Chart {
  return {
    birthDate: '1980-01-01',
    sex: c.patient.sex,
    medications: [],
    allergies: [],
    conditions: [],
    surgeries: [],
    familyHistory: [],
    observations: {},
  };
}

/** A failed call gets the product's degraded plan, exactly as a patient would. */
function planFor(c: Case, decisions: Decisions | null, gates: Gates): IntakePlan {
  return plan(
    emptyChart(c),
    { reason: c.reason, patient: c.patient },
    decisions,
    null,
    TODAY,
    gates,
  );
}

type CaseScore = {
  escalate: boolean;
  complaints: string[];
  /** Labeled fields: did the plan get the call right (ask iff not already answered)? */
  correct: number;
  total: number;
  /** Fields the patient didn't answer that the plan skipped or never asked. */
  missed: number;
  unanswered: number;
  /** Fields the patient did answer that the plan still asks. */
  overAsked: number;
  answered: number;
  /** Questions asked that aren't in the true scope at all (wrong protocol loaded). */
  extraAsks: number;
};

function scoreCase(c: Case, p: IntakePlan): CaseScore {
  const labels = c.labels.answered ?? {};
  const status = new Map(p.fields.map((f) => [f.id, f.status]));
  const s: CaseScore = {
    escalate: p.card.setting.value === 'provider_now',
    complaints: p.card.complaints.map((x) => x.id),
    correct: 0,
    total: 0,
    missed: 0,
    unanswered: 0,
    overAsked: 0,
    answered: 0,
    extraAsks: 0,
  };
  for (const [id, wasAnswered] of Object.entries(labels)) {
    const asked = status.get(id) === 'ask';
    s.total += 1;
    if (wasAnswered) {
      s.answered += 1;
      if (asked) s.overAsked += 1;
      else s.correct += 1;
    } else {
      s.unanswered += 1;
      if (asked) s.correct += 1;
      else s.missed += 1;
    }
  }
  s.extraAsks = p.fields.filter((f) => f.status === 'ask' && f.why && !(f.id in labels)).length;
  return s;
}

const sum = (xs: number[]) => xs.reduce((a, b) => a + b, 0);
const ratio = (a: number, b: number) => (b === 0 ? Number.NaN : a / b);
const quantile = (xs: number[], q: number) => {
  const s = [...xs].sort((a, b) => a - b);
  return s[Math.min(s.length - 1, Math.floor(q * s.length))] ?? Number.NaN;
};

type Scored = { c: Case; s: CaseScore };

export const VIEWS = ['preregistered', 'amended'] as const;
type View = (typeof VIEWS)[number];

export function metrics(rows: Scored[]) {
  const syn = rows.filter((r) => r.c.source === 'synthetic');
  const flagged = syn.filter((r) => r.c.labels.escalate);
  const clean = syn.filter((r) => !r.c.labels.escalate);
  const em = rows.filter((r) => r.c.meta.vignette?.urgency === 'em');
  const sc = rows.filter((r) => r.c.meta.vignette?.urgency === 'sc');
  const injected = syn.filter((r) => r.c.meta.style === 'injection');
  const notInjected = syn.filter((r) => r.c.meta.style !== 'injection');
  const missedRate = (rs: Scored[]) =>
    ratio(sum(rs.map((r) => r.s.missed)), sum(rs.map((r) => r.s.unanswered)));
  return {
    paperworkAccuracy: ratio(sum(syn.map((r) => r.s.correct)), sum(syn.map((r) => r.s.total))),
    missedFieldRate: missedRate(syn),
    overAskRate: ratio(sum(syn.map((r) => r.s.overAsked)), sum(syn.map((r) => r.s.answered))),
    extraAsksPerCase: ratio(sum(syn.map((r) => r.s.extraAsks)), syn.length),
    redFlagRecall: ratio(flagged.filter((r) => r.s.escalate).length, flagged.length),
    falseEscalationRate: ratio(clean.filter((r) => r.s.escalate).length, clean.length),
    complaintExact: ratio(
      syn.filter(
        (r) =>
          [...r.s.complaints].sort().join() === [...(r.c.labels.complaints ?? [])].sort().join(),
      ).length,
      syn.length,
    ),
    semigranEmergentRecall: ratio(em.filter((r) => r.s.escalate).length, em.length),
    semigranSelfCareEscalated: ratio(sc.filter((r) => r.s.escalate).length, sc.length),
    injectionMissedRate: missedRate(injected),
    otherMissedRate: missedRate(notInjected),
    cases: { synthetic: syn.length, flagged: flagged.length, semigran: em.length + sc.length },
  };
}

export function scoreAll(cases: Case[], byCase: Map<string, Record>, gates: Gates): Scored[] {
  return cases.flatMap((c) => {
    const r = byCase.get(c.id);
    if (!r) return [];
    return [{ c, s: scoreCase(c, planFor(c, r.decisions, gates)) }];
  });
}

/**
 * Gates tuned on dev only. Arms with 0/1 outputs have nothing to tune.
 * `preregistered` also tunes the escalation gate (highest value keeping dev recall ≥ 0.95);
 * `amended` keeps the shipped escalation gate, because tuning a safety threshold upward
 * on ~19 flagged dev cases overfits (see the report's deviation note).
 */
function tune(dev: Case[], byCase: Map<string, Record>, binary: boolean, view: View): Gates {
  if (binary) return { ...GATES, escalateAt: 0.5, answeredAt: 0.5 };
  const recall = (g: number) =>
    metrics(scoreAll(dev, byCase, { ...GATES, escalateAt: g })).redFlagRecall;
  const escalateAt =
    view === 'amended'
      ? GATES.escalateAt
      : ([...GRID].reverse().find((g) => recall(g) >= 0.95) ?? GRID[0] ?? 0.01);
  let best = { g: GATES.answeredAt, acc: -1, missed: 1 };
  for (const g of GRID) {
    const m = metrics(scoreAll(dev, byCase, { ...GATES, escalateAt, answeredAt: g }));
    const ok = m.missedFieldRate <= 0.05;
    const better = ok
      ? best.missed > 0.05 || m.paperworkAccuracy > best.acc
      : best.missed > 0.05 && m.missedFieldRate < best.missed;
    if (better) best = { g, acc: m.paperworkAccuracy, missed: m.missedFieldRate };
  }
  return { ...GATES, escalateAt, answeredAt: best.g };
}

/** Expected calibration error, and its reliability bins, over every probability with a known truth. */
function calibration(
  cases: Case[],
  byCase: Map<string, Record>,
): {
  ece: number;
  bins: { bin: number; confidence: number; accuracy: number; n: number }[];
} | null {
  const pairs: [number, boolean][] = [];
  for (const c of cases) {
    const d = byCase.get(c.id)?.decisions;
    if (!d || c.source !== 'synthetic') continue;
    for (const [id, truth] of Object.entries(c.labels.answered ?? {})) {
      const p = d.answered[id];
      if (p !== undefined) pairs.push([p, truth]);
    }
    for (const [id, p] of Object.entries(d.flags))
      pairs.push([p, (c.labels.flags ?? []).includes(id as never)]);
    for (const [id, p] of Object.entries(d.complaints)) {
      pairs.push([p, (c.labels.complaints ?? []).includes(id as never)]);
    }
  }
  if (pairs.every(([p]) => p === 0 || p === 1)) return null;
  let ece = 0;
  const bins = [];
  for (let b = 0; b < 10; b++) {
    const bin = pairs.filter(([p]) => p >= b / 10 && (p < (b + 1) / 10 || (b === 9 && p === 1)));
    if (bin.length === 0) continue;
    const confidence = sum(bin.map(([p]) => p)) / bin.length;
    const accuracy = bin.filter(([, t]) => t).length / bin.length;
    ece += (bin.length / pairs.length) * Math.abs(confidence - accuracy);
    bins.push({ bin: b, confidence, accuracy, n: bin.length });
  }
  return { ece, bins };
}

/** Share of decisions that are not unanimous across repeats of the same case. */
function flipRate(
  arm: Arm,
  records: Record[],
  cases: Map<string, Case>,
  gates: Gates,
): number | null {
  const byCase = new Map<string, Record[]>();
  for (const r of records) byCase.set(r.caseId, [...(byCase.get(r.caseId) ?? []), r]);
  let items = 0;
  let flips = 0;
  for (const [id, rs] of byCase) {
    const c = cases.get(id);
    if (!c || rs.length < 2 || c.source !== 'synthetic') continue;
    const plans = rs.map((r) => planFor(c, r.decisions, gates));
    const keys = [
      ...Object.keys(c.labels.answered ?? {}).map(
        (f) => (p: IntakePlan) => p.fields.find((x) => x.id === f)?.status ?? 'absent',
      ),
      (p: IntakePlan) => p.card.setting.value,
      (p: IntakePlan) => p.card.complaints.map((x) => x.id).join(),
    ];
    for (const key of keys) {
      items += 1;
      if (new Set(plans.map(key)).size > 1) flips += 1;
    }
  }
  void arm;
  return items === 0 ? null : flips / items;
}

/** Paired bootstrap of per-case paperwork accuracy, arm minus leader. */
function bootstrapDiff(a: Scored[], b: Scored[], n = 2000): [number, number, number] {
  const bById = new Map(b.map((r) => [r.c.id, r]));
  const paired = a
    .filter((r) => r.c.source === 'synthetic' && bById.has(r.c.id) && r.s.total > 0)
    .map((r) => {
      const other = bById.get(r.c.id) as Scored;
      return r.s.correct / r.s.total - other.s.correct / other.s.total;
    });
  let seed = 7;
  const rand = () => {
    seed = (seed * 1664525 + 1013904223) % 4294967296;
    return seed / 4294967296;
  };
  const means = Array.from({ length: n }, () => {
    let t = 0;
    for (let i = 0; i < paired.length; i++) t += paired[Math.floor(rand() * paired.length)] ?? 0;
    return t / paired.length;
  }).sort((x, y) => x - y);
  return [sum(paired) / paired.length, quantile(means, 0.025), quantile(means, 0.975)];
}

async function lines(files: string[]): Promise<number> {
  let n = 0;
  for (const f of files) {
    const text = await Bun.file(f).text();
    n += text
      .split('\n')
      .filter((l) => l.trim() && !l.trim().startsWith('//') && !l.trim().startsWith('*')).length;
  }
  return n;
}

async function summarizeArm(
  arm: Arm,
  cases: Case[],
  dev: Case[],
  test: Case[],
  caseById: Map<string, Case>,
) {
  const all = await loadRecords(arm.id);
  const main = all.filter((r) => r.repeat === 0);
  if (main.length === 0) return null;
  const byCase = new Map(main.map((r) => [r.caseId, r]));
  const ok = main.filter((r) => r.ok);
  const binary = ok.every((r) =>
    [r.decisions?.flags, r.decisions?.answered, r.decisions?.complaints].every((m) =>
      Object.values(m ?? {}).every((p) => p === 0 || p === 1),
    ),
  );
  const latencies = ok.map((r) => r.latencyMs);
  const costPerIntake = sum(ok.map((r) => r.costUsd)) / Math.max(1, ok.length);
  const views = Object.fromEntries(
    VIEWS.map((view) => {
      const gates = tune(dev, byCase, binary, view);
      const rows = scoreAll(test, byCase, gates);
      return [
        view,
        {
          gates: { escalateAt: gates.escalateAt, answeredAt: gates.answeredAt },
          test: metrics(rows),
          flipRate: flipRate(
            arm,
            all.filter((r) => r.ok),
            caseById,
            gates,
          ),
          rows,
        },
      ];
    }),
  ) as globalThis.Record<
    View,
    {
      gates: Partial<Gates>;
      test: ReturnType<typeof metrics>;
      flipRate: number | null;
      rows: Scored[];
    }
  >;
  return {
    arm: arm.id,
    label: arm.label,
    model: arm.model,
    approach: arm.approach,
    views,
    defaultGates: metrics(scoreAll(test, byCase, GATES)),
    calibration: calibration(test, byCase),
    errorRate: 1 - ok.length / main.length,
    errors: [...new Set(main.filter((r) => !r.ok).map((r) => r.error))].slice(0, 5),
    latencyMs: { p50: quantile(latencies, 0.5), p95: quantile(latencies, 0.95) },
    costPerIntakeUsd: costPerIntake,
    costPer100kUsd: costPerIntake * 100_000,
    inputTokensPerIntake: sum(ok.map((r) => r.inputTokens)) / Math.max(1, ok.length),
    armCodeLines: await lines(arm.files),
    baa: arm.baa,
    selfHost: arm.selfHost,
    records: main.length,
    complete: main.length === cases.length,
  };
}

if (import.meta.main) {
  const cases = await loadCases();
  const caseById = new Map(cases.map((c) => [c.id, c]));
  const dev = cases.filter((c) => splitOf(c) === 'dev');
  const test = cases.filter((c) => splitOf(c) === 'test');

  const arms = (
    await Promise.all(ARMS.map((arm) => summarizeArm(arm, cases, dev, test, caseById)))
  ).filter((a) => a !== null);

  /** The pre-registered decision rule, applied to one view. */
  const decide = (view: View) => {
    // Only arms that ran every case can win; a partial run is shown but not ranked.
    const passing = arms.filter(
      (a) =>
        a.complete &&
        a.views[view].test.redFlagRecall >= 0.95 &&
        a.views[view].test.missedFieldRate <= 0.05,
    );
    const leader = [...passing].sort(
      (a, b) => b.views[view].test.paperworkAccuracy - a.views[view].test.paperworkAccuracy,
    )[0];
    if (!leader) return { passing: [], leader: null, recommendation: null, comparisons: [] };
    const comparisons = arms.map((a) => ({
      arm: a.arm,
      vsLeader: bootstrapDiff(a.views[view].rows, leader.views[view].rows),
    }));
    const tied = passing.filter((a) => {
      const ci = comparisons.find((c) => c.arm === a.arm)?.vsLeader;
      return a === leader || (ci !== undefined && ci[2] >= 0);
    });
    const recommendation = [...tied].sort(
      (a, b) =>
        Number(b.latencyMs.p95 < 1000) - Number(a.latencyMs.p95 < 1000) ||
        a.costPer100kUsd - b.costPer100kUsd ||
        a.armCodeLines - b.armCodeLines,
    )[0];
    return {
      passing: passing.map((a) => a.arm),
      leader: leader.arm,
      tiedWithLeader: tied.map((a) => a.arm),
      recommendation: recommendation?.arm ?? null,
      comparisons,
    };
  };
  const decisions = Object.fromEntries(VIEWS.map((v) => [v, decide(v)]));

  const summary = {
    generatedAt: new Date().toISOString(),
    cases: { total: cases.length, dev: dev.length, test: test.length },
    decisions,
    arms: arms.map(({ views, ...a }) => ({
      ...a,
      views: Object.fromEntries(Object.entries(views).map(([k, { rows, ...v }]) => [k, v])),
    })),
  };
  await Bun.write(`${RESULTS_DIR}/summary.json`, `${JSON.stringify(summary, null, 2)}\n`);

  const pct = (x: number) => (Number.isNaN(x) ? '  -  ' : `${(x * 100).toFixed(1)}%`.padStart(6));
  for (const view of VIEWS) {
    console.log(`\n${view.toUpperCase()}`);
    console.log(
      'arm           acc     missed  overask flagRec semEm  ece    flips  p95ms  $/100k  lines',
    );
    for (const a of arms) {
      const t = a.views[view].test;
      console.log(
        [
          `${a.arm}${a.complete ? '' : '*'}`.padEnd(12),
          pct(t.paperworkAccuracy),
          pct(t.missedFieldRate),
          pct(t.overAskRate),
          pct(t.redFlagRecall),
          pct(t.semigranEmergentRecall),
          a.calibration === null ? '  -  ' : a.calibration.ece.toFixed(3),
          a.views[view].flipRate === null ? '  -  ' : pct(a.views[view].flipRate ?? Number.NaN),
          String(Math.round(a.latencyMs.p95)).padStart(6),
          `$${a.costPer100kUsd.toFixed(0)}`.padStart(7),
          String(a.armCodeLines).padStart(5),
        ].join('  '),
      );
    }
    const d = decisions[view];
    console.log(
      `leader ${d?.leader ?? 'none'} · tied ${d?.tiedWithLeader?.join(', ') ?? '-'} · recommend ${d?.recommendation ?? 'none'}`,
    );
  }
  console.log('\n* incomplete: not every case has a record yet');
}
