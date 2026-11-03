import { afterAll, beforeAll, describe, expect, test } from 'bun:test';
import { serve } from '../src/server';
import type { Reading, Tombstone } from '../src/types';

/**
 * One member's week, over real HTTP against the real store and rules. The only input we control is
 * the clock, so a seven-day protocol runs in milliseconds.
 */
const HOUR = 3_600_000;
const DAY = 24 * HOUR;
const start = Date.parse('2026-10-01T12:00:00Z'); // 07:00 in the member's CDT
let now = new Date(start);
let server: ReturnType<typeof serve>;

const cuff = { appId: 'com.example.cuffapp', appName: 'Cuff App', deviceModel: 'HEM-7155T' };
const at = (ms: number) => new Date(ms).toISOString();
const bp = (id: string, ms: number, systolic: number, diastolic: number, over = {}): Reading => ({
  id,
  platform: 'healthkit',
  systolic,
  diastolic,
  measuredAt: at(ms),
  tzOffsetMin: -300,
  source: cuff,
  method: 'device',
  ...over,
});

async function call(path: string, body?: unknown, member: string | null = 'm1') {
  const res = await fetch(new URL(path, server.url), {
    method: body === undefined ? 'GET' : 'POST',
    headers: { 'content-type': 'application/json', ...(member ? { 'x-member-id': member } : {}) },
    body: body === undefined ? undefined : JSON.stringify(body),
  });
  return { status: res.status, body: await res.json() };
}

const send = (readings: Reading[], tombstones: Tombstone[] = []) =>
  call('/v1/health/changes', { readings, tombstones });

// 07:30 and 20:30 local, every day for a week: 14 cuff readings.
const week = Array.from({ length: 7 }, (_, d) => [
  bp(`am${d}`, start + d * DAY + 0.5 * HOUR, 136 + d, 86),
  bp(`pm${d}`, start + d * DAY + 13.5 * HOUR, 132 + d, 84),
]).flat();
const typedCopy = bp('typed0', start + 0.5 * HOUR + 60_000, 136, 86, {
  source: { appId: 'com.apple.Health', appName: 'Health' },
  method: 'manual',
});
const ringCrisis = bp('ring0', start + 2 * DAY + HOUR, 186, 112, {
  source: { appId: 'com.example.ring', appName: 'Ring', deviceModel: 'Ring 4' },
});

beforeAll(() => {
  server = serve(0, undefined, () => now);
});
afterAll(() => server.stop(true));

describe('BP pathway, one member, one week', () => {
  test('no member id → 401', async () => {
    expect((await call('/v1/bp-pathway', undefined, null)).status).toBe(401);
  });

  test('readings before opting in are refused, so the app keeps its anchor', async () => {
    expect((await send([week[0] as Reading])).status).toBe(409);
  });

  test('enrolling starts collecting', async () => {
    const res = await call('/v1/bp-pathway/enroll', { entry: 'history' });
    expect(res.status).toBe(201);
    expect(res.body.state).toBe('collecting');
    expect(res.body.entry).toBe('history');
  });

  test('a week of syncs, one page per day', async () => {
    for (let d = 0; d < 7; d++) {
      const page = week.slice(d * 2, d * 2 + 2);
      if (d === 0) page.push(typedCopy);
      if (d === 2) page.push(ringCrisis);
      now = new Date(start + d * DAY + 14 * HOUR);
      const res = await send(page);
      expect(res.status).toBe(200);
      expect(res.body.rejected).toEqual([]);
      expect(res.body.accepted).toEqual(page.map((r) => r.id));
    }
  });

  test('ready: guideline average from cuff readings only, provenance kept', async () => {
    const { body } = await call('/v1/bp-pathway');
    expect(body.state).toBe('ready');
    expect(body.summary.counted).toBe(14);
    expect(body.summary.average).toEqual({ systolic: 137, diastolic: 85 });
    expect(body.summary.excluded).toEqual([
      { id: 'typed0', reason: 'duplicate' },
      { id: 'ring0', reason: 'unverified_device' },
    ]);
    expect(body.summary.crisis).toEqual(['ring0']);
    expect(
      body.summary.days.every((d: { am: number; pm: number }) => d.am === 1 && d.pm === 1),
    ).toBe(true);
  });

  test('the crisis reading raised exactly one care-team task', async () => {
    const { body } = await call('/v1/care/tasks');
    expect(body).toEqual([
      { member: 'm1', readingId: 'ring0', kind: 'crisis', at: at(start + 2 * DAY + 14 * HOUR) },
    ]);
  });

  test('resending every page changes nothing (the anchor-on-ack retry path)', async () => {
    const res = await send([...week, typedCopy, ringCrisis]);
    expect(res.body.accepted).toHaveLength(16);
    expect((await call('/v1/care/tasks')).body).toHaveLength(1);
    expect((await call('/v1/bp-pathway')).body.summary.counted).toBe(14);
  });

  test('bad writes are rejected per reading; the page still succeeds', async () => {
    const res = await send([
      bp('bad1', start + 3 * DAY, 400, 90),
      bp('bad2', start - DAY, 130, 80),
      bp('bad3', now.getTime() + DAY, 130, 80),
    ]);
    expect(res.status).toBe(200);
    expect(res.body.rejected).toEqual([
      { id: 'bad1', reason: 'implausible' },
      { id: 'bad2', reason: 'before_enrollment' },
      { id: 'bad3', reason: 'future' },
    ]);
  });

  test('deleting readings in Apple Health drops the average until the week is full again', async () => {
    const res = await send(
      [],
      ['am1', 'pm1', 'am2'].map((id) => ({ id, platform: 'healthkit' })),
    );
    expect(res.status).toBe(200);
    const { body } = await call('/v1/bp-pathway');
    expect(body.summary.counted).toBe(11);
    expect(body.summary.average).toBeNull();
    expect(body.state).toBe('collecting');
  });

  test('no new readings for 72 hours → stalled', async () => {
    now = new Date(now.getTime() + 73 * HOUR);
    expect((await call('/v1/bp-pathway')).body.state).toBe('stalled');
  });

  test('waiting on a mailed cuff: no stall until a week passes without a first reading', async () => {
    const enrolled = now.getTime();
    await call('/v1/bp-pathway/enroll', { entry: 'history' }, 'm4');
    now = new Date(enrolled + 73 * HOUR);
    expect((await call('/v1/bp-pathway', undefined, 'm4')).body.state).toBe('collecting');
    now = new Date(enrolled + 169 * HOUR);
    expect((await call('/v1/bp-pathway', undefined, 'm4')).body.state).toBe('stalled');
  });

  test('a page over 500 is refused whole', async () => {
    const big = Array.from({ length: 501 }, (_, i) => bp(`x${i}`, start + DAY, 130, 80));
    expect((await send(big)).status).toBe(413);
  });

  test('entry C: a clinician enrolls a member, dated to the visit, never the future', async () => {
    const visit = at(now.getTime() - 2 * DAY);
    const res = await call('/v1/care/members/m2/enroll', { at: visit }, null);
    expect(res.status).toBe(201);
    expect(res.body).toMatchObject({ entry: 'clinician', enrolledAt: visit, state: 'collecting' });
    const future = await call('/v1/care/members/m3/enroll', { at: at(now.getTime() + HOUR) }, null);
    expect(future.status).toBe(400);
    const stale = await call(
      '/v1/care/members/m3/enroll',
      { at: at(now.getTime() - 15 * DAY) },
      null,
    );
    expect(stale.status).toBe(400);
  });

  test('care-team review closes the loop', async () => {
    const { body } = await call('/v1/care/members/m1/review', {});
    expect(body.state).toBe('reviewed');
  });
});
