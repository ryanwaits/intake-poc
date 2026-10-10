import { expect, spyOn, test } from 'bun:test';
import maria from '../fixtures/patients/maria.json';
import { createApp } from '../src/api/server';
import { fakeDecide } from './fake-decide';

const app = createApp({ decide: fakeDecide() });
const post = (body: unknown) =>
  app.request('/v1/intake', { method: 'POST', body: JSON.stringify(body) });

test('healthz does not depend on Jev', async () => {
  const res = await createApp({ decide: () => Promise.reject(new Error('down')) }).request(
    '/healthz',
  );
  expect(res.status).toBe(200);
});

test('prep returns a card and echoes a request id', async () => {
  const res = await post({ reason: 'my ear hurts', bundle: maria });
  expect(res.status).toBe(200);
  expect(res.headers.get('x-request-id')).toBeTruthy();
  expect((await res.json()).mode).toBe('live');
});

test('bad input is rejected', async () => {
  expect((await post({ reason: '', bundle: maria })).status).toBe(400);
  expect((await post({ reason: 'x', bundle: { resourceType: 'Patient' } })).status).toBe(400);
  expect((await post({ reason: 'x', bundle: { resourceType: 'Bundle', entry: [] } })).status).toBe(
    400,
  );
});

test('logs never contain the complaint or chart', async () => {
  const lines: string[] = [];
  const out = spyOn(console, 'log').mockImplementation((l: string) => lines.push(l));
  const err = spyOn(console, 'error').mockImplementation((l: string) => lines.push(l));
  await post({ reason: 'SECRET-COMPLAINT', bundle: maria });
  out.mockRestore();
  err.mockRestore();
  const all = lines.join('\n');
  expect(all).toContain('"msg":"intake"');
  expect(all).not.toContain('SECRET-COMPLAINT');
  expect(all).not.toContain('lisinopril');
  expect(all).not.toContain('Maria');
});

test('readyz fails while draining so traffic moves away first', async () => {
  let draining = false;
  const app2 = createApp({ decide: fakeDecide(), ready: () => !draining });
  expect((await app2.request('/readyz')).status).toBe(200);
  draining = true;
  expect((await app2.request('/readyz')).status).toBe(503);
});

test('metrics expose SLO counters and never patient data', async () => {
  await post({ reason: 'SECRET-COMPLAINT', bundle: maria });
  const text = await (await app.request('/metrics')).text();
  expect(text).toContain('intake_plans_total{mode="live"}');
  expect(text).toContain('intake_http_request_duration_seconds_bucket');
  expect(text).toContain('intake_fields_total{status="prefilled"}');
  expect(text).not.toContain('SECRET-COMPLAINT');
  expect(text).not.toContain('Maria');
});

test('shadow model runs off the patient path and records agreement', async () => {
  const withShadow = createApp({
    decide: fakeDecide(),
    shadow: { decide: fakeDecide({ flags: { chest_pain: 0.9 } }), model: 'candidate', sample: 1 },
  });
  const res = await withShadow.request('/v1/intake', {
    method: 'POST',
    body: JSON.stringify({ reason: 'ear hurts', bundle: maria }),
  });
  expect((await res.json()).card.setting.value).toBe('clinic');
  await Bun.sleep(10);
  const text = await (await withShadow.request('/metrics')).text();
  expect(text).toContain(
    'intake_shadow_agreement_total{model="candidate",decision="escalate",agree="false"} 1',
  );
  expect(text).toContain(
    'intake_shadow_agreement_total{model="candidate",decision="complaints",agree="true"} 1',
  );
});
