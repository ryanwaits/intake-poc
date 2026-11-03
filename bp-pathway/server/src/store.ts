import { isCrisis } from './rules';
import type { Changes, Config, Entry, Reading } from './types';

/** In memory for the spike. The real home is the FHIR store (Observation + Device). */
type Member = {
  enrollment?: { entry: Entry; at: string };
  reviewedAt?: string;
  lastReadingAt?: string;
  readings: Map<string, Reading>;
};

export type Task = { member: string; readingId: string; kind: 'crisis'; at: string };

export type Rejection = 'malformed' | 'implausible' | 'future' | 'before_enrollment';

const key = (r: { platform: string; id: string }) => `${r.platform}:${r.id}`;

/** Plausible cuff output. Anything outside is a bad write, not a reading. */
function check(r: Reading, enrolledAt: string, now: Date): Rejection | null {
  if (typeof r.id !== 'string' || !r.id || !r.source?.appId) return 'malformed';
  const at = Date.parse(r.measuredAt);
  if (Number.isNaN(at) || !Number.isFinite(r.tzOffsetMin)) return 'malformed';
  if (!(r.systolic >= 50 && r.systolic <= 300 && r.diastolic >= 20 && r.diastolic <= 200)) {
    return 'implausible';
  }
  if (at > now.getTime() + 5 * 60_000) return 'future';
  // Member-initiated sharing: nothing measured before they opted in.
  if (at < Date.parse(enrolledAt)) return 'before_enrollment';
  return null;
}

export function createStore(config: Config) {
  const members = new Map<string, Member>();
  const tasks: Task[] = [];

  const get = (id: string) => {
    let m = members.get(id);
    if (!m) {
      m = { readings: new Map() };
      members.set(id, m);
    }
    return m;
  };

  return {
    member: get,
    tasks: () => tasks,

    /** First enrollment wins: re-enrolling never moves the start of a protocol. */
    enroll(id: string, entry: Entry, at: Date) {
      const m = get(id);
      m.enrollment ??= { entry, at: at.toISOString() };
      return m.enrollment;
    },

    review(id: string, now: Date) {
      get(id).reviewedAt = now.toISOString();
    },

    /** Idempotent on (platform, id): a resent page changes nothing and raises no second task. */
    apply(id: string, changes: Changes, now: Date) {
      const m = get(id);
      const enrolledAt = m.enrollment?.at;
      if (!enrolledAt) return null;

      const accepted: string[] = [];
      const rejected: { id: string; reason: Rejection }[] = [];
      for (const r of changes.readings) {
        const reason = check(r, enrolledAt, now);
        if (reason) {
          rejected.push({ id: String(r.id), reason });
          continue;
        }
        const k = key(r);
        if (!m.readings.has(k)) {
          m.readings.set(k, r);
          m.lastReadingAt = now.toISOString();
          if (isCrisis(r, config.crisis)) {
            tasks.push({ member: id, readingId: r.id, kind: 'crisis', at: now.toISOString() });
          }
        }
        accepted.push(r.id);
      }
      for (const t of changes.tombstones) m.readings.delete(key(t));
      return { accepted, rejected };
    },
  };
}
