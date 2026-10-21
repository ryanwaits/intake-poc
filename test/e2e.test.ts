import { afterAll, beforeAll, describe, expect, test } from 'bun:test';
import maria from '../fixtures/patients/maria.json';
import walter from '../fixtures/patients/walter.json';
import { JEV_MODEL } from '../src/core/jev';
import { hasModel } from './live';

/**
 * End to end, nothing mocked: the real service as a process, over HTTP, calling the real pinned
 * model. Set INTAKE_URL to run the HTTP journeys against a deployed service instead (synthetic
 * patients only); the process-level checks (logs, boot, shutdown, outage) then skip.
 */

const remote = process.env.INTAKE_URL;

type Service = { url: string; output: () => string; proc: Bun.Subprocess | null };

async function boot(env: Record<string, string> = {}): Promise<Service> {
  const port = String(20_000 + Math.floor(Math.random() * 20_000));
  const proc = Bun.spawn(['bun', 'src/api/server.ts'], {
    env: { ...process.env, PORT: port, INTAKE_DRAIN_SECONDS: '1', ...env },
    stdout: 'pipe',
    stderr: 'pipe',
  });
  let out = '';
  for (const stream of [proc.stdout, proc.stderr]) {
    void (async () => {
      for await (const chunk of stream) out += new TextDecoder().decode(chunk);
    })();
  }
  const url = `http://localhost:${port}`;
  for (let i = 0; i < 50; i++) {
    if (
      await fetch(`${url}/healthz`).then(
        (r) => r.ok,
        () => false,
      )
    )
      return { url, output: () => out, proc };
    await Bun.sleep(100);
  }
  proc.kill();
  throw new Error(`service did not start:\n${out}`);
}

const intake = (svc: Service, body: unknown) =>
  fetch(`${svc.url}/v1/intake`, { method: 'POST', body: JSON.stringify(body) });

/** Poll until `check` passes, for work that happens after the response (shadow, signals). */
async function eventually(check: () => Promise<boolean>, ms = 5_000) {
  for (const started = Date.now(); Date.now() - started < ms; await Bun.sleep(100)) {
    if (await check()) return;
  }
  throw new Error('condition not met in time');
}

describe.skipIf(!hasModel)('intake service, end to end', () => {
  let svc: Service;

  beforeAll(async () => {
    svc = remote
      ? { url: remote, output: () => '', proc: null }
      : await boot({ INTAKE_SHADOW_DECIDER: `jev:${JEV_MODEL}`, INTAKE_SHADOW_SAMPLE: '1' });
  });
  afterAll(() => svc.proc?.kill());

  test.skipIf(Boolean(remote))('boots on the pinned model', () => {
    expect(svc.output()).toContain(`"msg":"listening"`);
    expect(svc.output()).toContain(`"model":"${JEV_MODEL}"`);
    expect(svc.output()).toContain('"extractor":"@cf/cloudflare/clairic"');
  });

  test('health and readiness', async () => {
    expect((await fetch(`${svc.url}/healthz`)).status).toBe(200);
    expect((await fetch(`${svc.url}/readyz`)).status).toBe(200);
  });

  test('ear complaint: a short form, the otoscope ready, answered questions skipped', async () => {
    const res = await intake(svc, { reason: "ear's been killing me 3 days", bundle: maria });
    expect(res.status).toBe(200);
    expect(res.headers.get('x-request-id')).toBeTruthy();
    const plan = await res.json();
    expect(plan.mode).toBe('live');
    expect(plan.model).toBe(JEV_MODEL);
    expect(plan.card.escalations).toEqual([]);
    expect(plan.card.complaints.map((c: { id: string }) => c.id)).toContain('ent');
    expect(plan.card.medicPrep.devices).toContain('otoscope');
    const onset = plan.fields.find((f: { id: string }) => f.id === 'onset');
    expect(onset.status).toBe('answered');
    // Shown back in the patient's own words, with where it came from.
    expect(onset.said.value).toContain('3 days');
    expect(onset.said.why.rule).toContain('show back to confirm');
  }, 10_000);

  test('no_said variant: the same skips, without "You said", and recorded', async () => {
    const res = await intake(svc, {
      reason: "ear's been killing me 3 days",
      bundle: maria,
      variant: 'no_said',
    });
    expect(res.status).toBe(200);
    const plan = await res.json();
    expect(plan.mode).toBe('live');
    expect(plan.fields.find((f: { id: string }) => f.id === 'onset').status).toBe('answered');
    expect(plan.fields.every((f: { said: unknown }) => f.said === null)).toBe(true);
    const text = await (await fetch(`${svc.url}/metrics`)).text();
    expect(text).toContain('intake_plans_total{mode="live",variant="no_said"}');
    if (!remote) expect(svc.output()).toContain('"variant":"no_said"');
  }, 10_000);

  test('chest tightness escalates to a provider, never to the patient form', async () => {
    const res = await intake(svc, {
      reason: 'chest feels tight when I walk up stairs',
      bundle: walter,
    });
    const plan = await res.json();
    expect(plan.mode).toBe('live');
    expect(plan.card.escalations.map((e: { id: string }) => e.id)).toEqual(['chest_pain']);
    expect(plan.card.setting.value).toBe('provider_now');
    expect(JSON.stringify(plan.fields)).not.toContain('chest_pain');
  }, 10_000);

  test('bad input is rejected', async () => {
    expect((await intake(svc, { reason: '', bundle: maria })).status).toBe(400);
    expect((await intake(svc, { reason: 'x', bundle: { resourceType: 'Patient' } })).status).toBe(
      400,
    );
    expect(
      (await intake(svc, { reason: 'x', bundle: { resourceType: 'Bundle', entry: [] } })).status,
    ).toBe(400);
    expect((await intake(svc, { reason: 'x', bundle: maria, variant: 'gates_off' })).status).toBe(
      400,
    );
  });

  test('metrics count intakes and never carry patient data', async () => {
    await intake(svc, { reason: 'SECRET-COMPLAINT my ear hurts', bundle: maria });
    const text = await (await fetch(`${svc.url}/metrics`)).text();
    expect(text).toContain('intake_plans_total{mode="live",variant="control"}');
    expect(text).toContain('intake_fields_total{status="prefilled",variant="control"}');
    expect(text).not.toContain('SECRET-COMPLAINT');
    expect(text).not.toContain('Maria');
  }, 10_000);

  test.skipIf(Boolean(remote))(
    'logs never carry the complaint or the chart',
    async () => {
      await intake(svc, { reason: 'SECRET-COMPLAINT my ear hurts', bundle: maria });
      const logs = svc.output();
      expect(logs).toContain('"msg":"intake"');
      for (const phi of ['SECRET-COMPLAINT', 'lisinopril', 'Maria', 'Walter'])
        expect(logs).not.toContain(phi);
    },
    10_000,
  );

  test.skipIf(Boolean(remote))(
    'shadow model runs off the patient path and records agreement',
    async () => {
      await intake(svc, { reason: 'ear hurts', bundle: maria });
      await eventually(async () =>
        (await (await fetch(`${svc.url}/metrics`)).text()).includes(
          `intake_shadow_agreement_total{model="${JEV_MODEL}",decision="escalate"`,
        ),
      );
    },
    10_000,
  );
});

describe.skipIf(!hasModel || Boolean(remote))('outage and lifecycle, end to end', () => {
  test('model unreachable: patients still get a plan, and the breaker opens', async () => {
    // A real failure, not a stub: the model rejects the key.
    const svc = await boot({ TYPESAFE_API_KEY: 'invalid-key' });
    try {
      const res = await intake(svc, { reason: 'my ear hurts', bundle: maria });
      expect(res.status).toBe(200);
      const plan = await res.json();
      expect(plan.mode).toBe('degraded');
      expect(plan.card.setting.value).toBe('navigator_review');
      expect(plan.fields.find((f: { id: string }) => f.id === 'name').status).toBe('prefilled');

      for (let i = 0; i < 5; i++) await intake(svc, { reason: 'my ear hurts', bundle: maria });
      expect(svc.output()).toContain('"msg":"breaker","model":"jev-1.13.0","state":"open"');
    } finally {
      svc.proc?.kill();
    }
  }, 20_000);

  test("extraction model unreachable: the same plan, just without the patient's words", async () => {
    // A real failure: Cloudflare rejects the token.
    const svc = await boot({ CLOUDFLARE_API_TOKEN: 'invalid-token' });
    try {
      const plan = await (
        await intake(svc, { reason: "ear's been killing me 3 days", bundle: maria })
      ).json();
      expect(plan.mode).toBe('live');
      const onset = plan.fields.find((f: { id: string }) => f.id === 'onset');
      expect(onset.status).toBe('answered');
      expect(onset.said).toBeNull();
      expect(svc.output()).toContain('"extractError":"Error"');
      const metrics = await (await fetch(`${svc.url}/metrics`)).text();
      expect(metrics).toContain('intake_extractions_total{outcome="error"} 1');
    } finally {
      svc.proc?.kill();
    }
  }, 10_000);

  test('SIGTERM fails readiness first, then exits cleanly', async () => {
    const svc = await boot();
    svc.proc?.kill('SIGTERM');
    await eventually(async () => (await fetch(`${svc.url}/readyz`)).status === 503, 1_000);
    expect(await svc.proc?.exited).toBe(0);
  }, 10_000);

  test('bad config fails the boot instead of taking traffic', async () => {
    for (const bad of [
      { INTAKE_SHADOW_SAMPLE: '2' },
      { INTAKE_EXTRACTOR: 'clairic', CLOUDFLARE_API_TOKEN: '' },
    ]) {
      const proc = Bun.spawn(['bun', '--no-env-file', 'src/api/server.ts'], {
        env: { ...process.env, ...bad },
        stdout: 'ignore',
        stderr: 'ignore',
      });
      expect(await proc.exited).not.toBe(0);
    }
  });
});
