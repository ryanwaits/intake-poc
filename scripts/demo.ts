/**
 * Run one intake through the live pipeline and print the patient's form and the prep card.
 *   bun run demo maria "ear's been killing me 3 days, also need my lisinopril refilled"
 */

import { extractor } from '../src/api/config';
import type { PatientBundle } from '../src/core/chart';
import type { FieldStatus } from '../src/core/form';
import { liveEvaluate } from '../src/core/jev';
import { run, typedDecide } from '../src/core/run';

const [name = 'maria', reason = "ear's been killing me 3 days, also need my lisinopril refilled"] =
  Bun.argv.slice(2);

const bundle = (await Bun.file(`fixtures/patients/${name}.json`).json()) as PatientBundle;
const { intake, plan, error, extractError } = await run(bundle, reason, {
  decide: typedDecide(liveEvaluate()),
  extract: extractor(process.env)?.extract,
});
const { counts, card } = plan;

const pct = (p: number) => `${Math.round(p * 100)}%`.padStart(4);

console.log(`\nReason   "${reason}"`);
console.log(`Patient  ${JSON.stringify(intake.patient)}`);
console.log(`Mode     ${plan.mode}${error ? ` (${error})` : ''}  ${plan.model ?? ''}`);
if (extractError) console.log(`Extract  failed (${extractError}): no "You said" values`);
if (plan.usage) {
  console.log(`Model    ${plan.usage.latencyMs} ms, ${plan.usage.inputTokens} input tokens`);
}

console.log(
  `\nPaperwork: ${counts.total} fields → ${counts.ask} to type, ${counts.confirm} to confirm, ${counts.sign} to sign`,
);
const labels: Record<FieldStatus, string> = {
  ask: 'Type',
  confirm: 'Confirm (one tap)',
  sign: 'Sign',
  answered: 'Already answered in their words',
  prefilled: 'Prefilled from chart',
};
for (const status of ['ask', 'confirm', 'sign', 'answered', 'prefilled'] as FieldStatus[]) {
  const fields = plan.fields.filter((f) => f.status === status);
  if (fields.length === 0) continue;
  console.log(`  ${labels[status]}`);
  for (const f of fields) {
    const values = f.values.map((v) => v.value).join('; ');
    const p = f.why ? `  (answered ${pct(f.why.p)})` : '';
    const said = f.said ? `  You said: "${f.said.value}"` : '';
    console.log(`    ${f.ask}${values ? `: ${values}` : ''}${p}${said}`);
  }
}

console.log('\nPrep card');
console.log(`  setting     ${card.setting.value}`);
for (const e of card.escalations) console.log(`  ! escalate  ${pct(e.why.p)}  ${e.label}`);
for (const c of card.complaints) console.log(`  complaint   ${pct(c.why.p)}  ${c.label}`);
console.log(`  devices     ${card.medicPrep.devices.join(', ') || 'none'}`);
console.log(`  tests       ${card.medicPrep.tests.join(', ') || 'none'}\n`);
