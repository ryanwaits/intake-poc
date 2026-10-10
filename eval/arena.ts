/**
 * Run arms over the eval set. One JSONL record per (arm, case, repeat); reruns resume.
 *   bun run eval:arena jev,haiku-typed            all cases, repeat 0
 *   bun run eval:arena jev --repeats 5 --limit 40 --split test   consistency runs
 */
import { appendFileSync, mkdirSync } from 'node:fs';
import { parseArgs } from 'node:util';
import type { Decisions } from '../src/core/decisions';
import { ARMS, type Arm } from './arms';
import { type Case, loadCases } from './case';

export const RESULTS_DIR = 'eval/results';
const BUDGET_USD = 50;

export type Record = {
  arm: string;
  caseId: string;
  repeat: number;
  ok: boolean;
  error: string | null;
  /** Wall-clock time of the whole decide call, network included. */
  latencyMs: number;
  inputTokens: number;
  outputTokens: number;
  costUsd: number;
  decisions: Decisions | null;
  at: string;
};

export const recordsPath = (arm: string) => `${RESULTS_DIR}/${arm}.jsonl`;

export async function loadRecords(arm: string): Promise<Record[]> {
  const file = Bun.file(recordsPath(arm));
  if (!(await file.exists())) return [];
  return (await file.text())
    .split('\n')
    .filter(Boolean)
    .map((l) => JSON.parse(l) as Record);
}

/** Even case numbers are dev, odd are test. Fixed before any arm ran. */
export function splitOf(c: Case): 'dev' | 'test' {
  const n = Number(c.id.match(/\d+$/)?.[0] ?? 0);
  return n % 2 === 0 ? 'dev' : 'test';
}

async function spent(): Promise<number> {
  let usd = 0;
  for (const arm of ARMS) for (const r of await loadRecords(arm.id)) usd += r.costUsd;
  return usd;
}

async function runArm(arm: Arm, cases: Case[], repeats: number) {
  const done = new Set((await loadRecords(arm.id)).map((r) => `${r.caseId}#${r.repeat}`));
  const jobs = cases.flatMap((c) =>
    Array.from({ length: repeats }, (_, repeat) => ({ c, repeat })).filter(
      ({ c, repeat }) => !done.has(`${c.id}#${repeat}`),
    ),
  );
  console.error(`${arm.id}: ${jobs.length} calls to make (${done.size} already done)`);
  if (jobs.length === 0) return;

  let budgetLeft = BUDGET_USD - (await spent());
  const decide = arm.decide();
  mkdirSync(RESULTS_DIR, { recursive: true });

  let next = 0;
  let finished = 0;
  const worker = async () => {
    while (next < jobs.length) {
      const job = jobs[next++];
      if (!job) return;
      if (budgetLeft <= 0) {
        console.error(`${arm.id}: budget of $${BUDGET_USD} reached, stopping`);
        return;
      }
      const started = performance.now();
      let record: Record;
      try {
        const decisions = await decide({ reason: job.c.reason, patient: job.c.patient });
        const { inputTokens, outputTokens } = decisions.usage;
        const costUsd =
          (inputTokens * arm.price.input + outputTokens * arm.price.output) / 1_000_000;
        record = {
          arm: arm.id,
          caseId: job.c.id,
          repeat: job.repeat,
          ok: true,
          error: null,
          latencyMs: Math.round(performance.now() - started),
          inputTokens,
          outputTokens,
          costUsd,
          decisions,
          at: new Date().toISOString(),
        };
      } catch (error) {
        record = {
          arm: arm.id,
          caseId: job.c.id,
          repeat: job.repeat,
          ok: false,
          error:
            error instanceof Error
              ? `${error.constructor.name}: ${error.message.slice(0, 200)}`
              : 'Unknown',
          latencyMs: Math.round(performance.now() - started),
          inputTokens: 0,
          outputTokens: 0,
          costUsd: 0,
          decisions: null,
          at: new Date().toISOString(),
        };
      }
      budgetLeft -= record.costUsd;
      appendFileSync(recordsPath(arm.id), `${JSON.stringify(record)}\n`);
      finished += 1;
      if (finished % 25 === 0) {
        console.error(
          `  ${arm.id} ${finished}/${jobs.length}  budget left $${budgetLeft.toFixed(2)}`,
        );
      }
    }
  };
  await Promise.all(Array.from({ length: arm.concurrency }, worker));
  console.error(`${arm.id}: done, budget left $${budgetLeft.toFixed(2)}`);
}

if (import.meta.main) {
  const { values, positionals } = parseArgs({
    args: Bun.argv.slice(2),
    allowPositionals: true,
    options: {
      split: { type: 'string', default: 'all' },
      repeats: { type: 'string', default: '1' },
      limit: { type: 'string' },
    },
  });
  const ids = (positionals[0] ?? '').split(',').filter(Boolean);
  const arms = ids.includes('all') ? ARMS : ARMS.filter((a) => ids.includes(a.id));
  if (arms.length === 0) throw new Error(`Pick arms: ${ARMS.map((a) => a.id).join(', ')}, or all`);

  let cases = await loadCases();
  if (values.split !== 'all') cases = cases.filter((c) => splitOf(c) === values.split);
  if (values.limit) cases = cases.slice(0, Number(values.limit));

  for (const arm of arms) await runArm(arm, cases, Number(values.repeats));
}
