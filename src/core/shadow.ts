import type { IntakePlan } from './types';

export type Comparison = {
  escalate: boolean;
  setting: boolean;
  complaints: boolean;
  /** Fields both plans contain whose ask/skip call matches. */
  fields: { agree: number; total: number };
};

/** How a candidate model's plan differs from the live one. Decisions only, no patient data. */
export function compare(live: IntakePlan, shadow: IntakePlan): Comparison {
  const asked = (p: IntakePlan) => new Map(p.fields.map((f) => [f.id, f.status === 'ask']));
  const a = asked(live);
  const b = asked(shadow);
  let agree = 0;
  let total = 0;
  for (const [id, liveAsks] of a) {
    const shadowAsks = b.get(id);
    if (shadowAsks === undefined) continue;
    total += 1;
    if (liveAsks === shadowAsks) agree += 1;
  }
  const complaints = (p: IntakePlan) =>
    p.card.complaints
      .map((c) => c.id)
      .sort()
      .join();
  return {
    escalate:
      (live.card.setting.value === 'provider_now') ===
      (shadow.card.setting.value === 'provider_now'),
    setting: live.card.setting.value === shadow.card.setting.value,
    complaints: complaints(live) === complaints(shadow),
    fields: { agree, total },
  };
}
