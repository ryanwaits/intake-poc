import type { Config, Reading } from './types';

/**
 * The clinical rules, in code. No model in this loop.
 * `isCrisis` is mirrored on iOS and Android and held to goldens/crisis.json in all three.
 */
export const isCrisis = (r: Pick<Reading, 'systolic' | 'diastolic'>, c: Config['crisis']) =>
  r.systolic >= c.systolic || r.diastolic >= c.diastolic;

export type Exclusion =
  | 'manual'
  | 'unverified_device'
  | 'duplicate'
  | 'outside_window'
  | 'first_day'
  | 'after_protocol';

export type Summary = {
  configVersion: string;
  counted: number;
  required: number;
  /** Only once enough readings count. A partial week isn't a clinical number. */
  average: { systolic: number; diastolic: number } | null;
  days: { day: string; am: number; pm: number }[];
  excluded: { id: string; reason: Exclusion }[];
  /** Crisis readings from any source, counted or not. Safety never filters by provenance. */
  crisis: string[];
};

const DAY_MS = 86_400_000;

/** Wall-clock time where the member was, from UTC plus the offset the phone recorded. */
export function local(r: Pick<Reading, 'measuredAt' | 'tzOffsetMin'>) {
  const d = new Date(Date.parse(r.measuredAt) + r.tzOffsetMin * 60_000);
  return { day: d.toISOString().slice(0, 10), hour: d.getUTCHours() };
}

export const isCuff = (r: Reading, cuffs: Config['cuffs']) =>
  r.method !== 'manual' &&
  cuffs.some((c) => c.appId === r.source.appId && (!c.model || c.model === r.source.deviceModel));

const inHours = (hour: number, [start, end]: [number, number]) => hour >= start && hour < end;

export function summarize(readings: Reading[], config: Config): Summary {
  const { protocol, cuffs } = config;
  const sorted = [...readings].sort((a, b) => Date.parse(a.measuredAt) - Date.parse(b.measuredAt));
  const excluded: Summary['excluded'] = [];

  // The same reading written twice (cuff app + a typed copy, an iPhone and an Android phone): keep
  // the more trusted one. Identical back-to-back readings from one source are real, so they stay.
  const kept: Reading[] = [];
  for (const r of sorted) {
    const twin = kept.findIndex(
      (k) =>
        k.systolic === r.systolic &&
        k.diastolic === r.diastolic &&
        (k.source.appId !== r.source.appId || k.platform !== r.platform) &&
        Math.abs(Date.parse(k.measuredAt) - Date.parse(r.measuredAt)) <=
          protocol.duplicateWindowSec * 1000,
    );
    const k = kept[twin];
    if (!k) {
      kept.push(r);
    } else if (isCuff(r, cuffs) && !isCuff(k, cuffs)) {
      excluded.push({ id: k.id, reason: 'duplicate' });
      kept[twin] = r;
    } else {
      excluded.push({ id: r.id, reason: 'duplicate' });
    }
  }

  const slotted: { r: Reading; day: string; slot: 'am' | 'pm' }[] = [];
  for (const r of kept) {
    if (r.method === 'manual') {
      excluded.push({ id: r.id, reason: 'manual' });
      continue;
    }
    if (!isCuff(r, cuffs)) {
      excluded.push({ id: r.id, reason: 'unverified_device' });
      continue;
    }
    const { day, hour } = local(r);
    const slot = inHours(hour, protocol.amHours)
      ? 'am'
      : inHours(hour, protocol.pmHours)
        ? 'pm'
        : null;
    if (!slot) {
      excluded.push({ id: r.id, reason: 'outside_window' });
      continue;
    }
    slotted.push({ r, day, slot });
  }

  const first = slotted[0]?.day;
  const days: Summary['days'] = first
    ? Array.from({ length: protocol.days }, (_, i) => ({
        day: new Date(Date.parse(first) + i * DAY_MS).toISOString().slice(0, 10),
        am: 0,
        pm: 0,
      }))
    : [];

  const counted: Reading[] = [];
  for (const { r, day, slot } of slotted) {
    const index = Math.round((Date.parse(day) - Date.parse(first ?? day)) / DAY_MS);
    const progress = days[index];
    if (!progress) {
      excluded.push({ id: r.id, reason: 'after_protocol' });
      continue;
    }
    progress[slot] += 1;
    if (protocol.discardFirstDay && index === 0) {
      excluded.push({ id: r.id, reason: 'first_day' });
      continue;
    }
    counted.push(r);
  }

  const mean = (xs: number[]) => Math.round(xs.reduce((a, b) => a + b, 0) / xs.length);
  return {
    configVersion: config.version,
    counted: counted.length,
    required: protocol.minReadings,
    average:
      counted.length >= protocol.minReadings
        ? {
            systolic: mean(counted.map((r) => r.systolic)),
            diastolic: mean(counted.map((r) => r.diastolic)),
          }
        : null,
    days,
    excluded,
    crisis: sorted.filter((r) => isCrisis(r, config.crisis)).map((r) => r.id),
  };
}

export type State = 'none' | 'collecting' | 'stalled' | 'ready' | 'reviewed';

/** Derived on read, never stored, so there's no state to drift from the readings. */
export function state(
  p: { enrolledAt?: string; reviewedAt?: string; lastReadingAt?: string },
  summary: Summary,
  now: Date,
  config: Config,
): State {
  if (!p.enrolledAt) return 'none';
  if (p.reviewedAt) return 'reviewed';
  if (summary.average) return 'ready';
  const quietHours = p.lastReadingAt ? config.stalledAfterHours : config.firstReadingWithinHours;
  const since = Date.parse(p.lastReadingAt ?? p.enrolledAt);
  return now.getTime() - since > quietHours * 3_600_000 ? 'stalled' : 'collecting';
}
