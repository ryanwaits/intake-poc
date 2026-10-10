import { Hono } from 'hono';
import type { PatientBundle } from '../core/chart';
import { type Decide, run } from '../core/run';
import { compare } from '../core/shadow';
import type { IntakePlan } from '../core/types';
import { loadConfig } from './config';
import { log } from './log';
import {
  decideDuration,
  escalations,
  fields,
  httpDuration,
  httpRequests,
  intakes,
  registry,
  shadowAgreement,
  shadowErrors,
} from './metrics';

const MAX_REASON_CHARS = 2_000;

type Env = { Variables: { reqId: string } };

type Shadow = { decide: Decide; model: string; sample: number };

export type AppOptions = {
  /** The live model: its plan is what the patient gets. */
  decide: Decide;
  model?: string;
  /** A candidate model run on a sample of traffic after the response is sent. */
  shadow?: Shadow | null;
  /** False while draining on shutdown, so the load balancer stops sending traffic. */
  ready?: () => boolean;
};

export function createApp({
  decide,
  model = 'live',
  shadow = null,
  ready = () => true,
}: AppOptions) {
  const app = new Hono<Env>();

  app.use(async (c, next) => {
    const reqId = c.req.header('x-request-id') ?? crypto.randomUUID();
    c.set('reqId', reqId);
    c.header('x-request-id', reqId);
    const started = performance.now();
    await next();
    const seconds = (performance.now() - started) / 1000;
    // routePath is the matched pattern, so unknown URLs can't explode label cardinality.
    const route = c.req.routePath;
    httpRequests.inc({ route, status: String(c.res.status) });
    httpDuration.observe({ route }, seconds);
    log('info', 'request', {
      reqId,
      method: c.req.method,
      path: route,
      status: c.res.status,
      ms: Math.round(seconds * 1000),
    });
  });

  /** Liveness: the process is up. Never depends on Jev. */
  app.get('/healthz', (c) => c.json({ ok: true }));

  /** Readiness: take traffic. Also independent of Jev: degraded mode still serves patients. */
  app.get('/readyz', (c) => (ready() ? c.json({ ready: true }) : c.json({ ready: false }, 503)));

  app.get('/metrics', async (c) =>
    c.text(await registry.metrics(), 200, { 'content-type': registry.contentType }),
  );

  app.post('/v1/intake', async (c) => {
    const body = await c.req.json().catch(() => null);
    const reason = body?.reason;
    const bundle = body?.bundle as PatientBundle | undefined;
    if (typeof reason !== 'string' || reason.trim() === '' || reason.length > MAX_REASON_CHARS) {
      return c.json({ error: `reason must be 1-${MAX_REASON_CHARS} characters` }, 400);
    }
    if (bundle?.resourceType !== 'Bundle') {
      return c.json({ error: 'bundle must be a FHIR R4 Bundle' }, 400);
    }

    let result: Awaited<ReturnType<typeof run>>;
    try {
      result = await run(bundle, reason, decide);
    } catch {
      return c.json({ error: 'bundle must contain a Patient with a birthDate' }, 400);
    }

    const { plan, error } = result;
    intakes.inc({ mode: plan.mode });
    if (plan.usage) decideDuration.observe({ model, outcome: 'ok' }, plan.usage.latencyMs / 1000);
    else decideDuration.observe({ model, outcome: 'error' }, 0);
    for (const f of plan.fields) fields.inc({ status: f.status });
    if (plan.card.setting.value === 'provider_now') escalations.inc();
    log(plan.mode === 'live' ? 'info' : 'warn', 'intake', {
      reqId: c.get('reqId'),
      mode: plan.mode,
      model: plan.model ?? undefined,
      modelMs: plan.usage?.latencyMs,
      inputTokens: plan.usage?.inputTokens,
      escalations: plan.card.escalations.length,
      fields: plan.counts.total,
      asked: plan.counts.ask,
      error: error ?? undefined,
    });

    // Shadow mode: after the response, never on the patient's path, only against live plans.
    if (shadow && plan.mode === 'live' && Math.random() < shadow.sample) {
      void runShadow(shadow, bundle, reason, plan, c.get('reqId'));
    }
    return c.json(plan);
  });

  return app;
}

async function runShadow(
  shadow: Shadow,
  bundle: PatientBundle,
  reason: string,
  livePlan: IntakePlan,
  reqId: string,
) {
  const { plan, error } = await run(bundle, reason, shadow.decide);
  if (plan.mode !== 'live') {
    shadowErrors.inc({ model: shadow.model });
    log('warn', 'shadow', { reqId, model: shadow.model, error: error ?? undefined });
    return;
  }
  const diff = compare(livePlan, plan);
  const record = (decision: string, agree: boolean, n = 1) =>
    shadowAgreement.inc({ model: shadow.model, decision, agree: String(agree) }, n);
  record('escalate', diff.escalate);
  record('setting', diff.setting);
  record('complaints', diff.complaints);
  const { agree, total } = diff.fields;
  if (agree > 0) record('fields', true, agree);
  if (total > agree) record('fields', false, total - agree);
  log('info', 'shadow', { reqId, model: shadow.model, modelMs: plan.usage?.latencyMs });
}

if (import.meta.main) {
  const config = loadConfig();
  let draining = false;
  const app = createApp({
    decide: config.live.decide,
    model: config.live.model,
    shadow: config.shadow,
    ready: () => !draining,
  });
  const server = Bun.serve({ port: config.port, fetch: app.fetch });
  log('info', 'listening', { port: config.port, model: config.live.model });

  // Graceful shutdown: fail readiness, let the load balancer notice, finish in-flight requests, exit.
  const shutdown = async () => {
    if (draining) return;
    draining = true;
    log('info', 'draining');
    await Bun.sleep(config.drainSeconds * 1000);
    await server.stop();
    log('info', 'stopped');
    process.exit(0);
  };
  process.on('SIGTERM', shutdown);
  process.on('SIGINT', shutdown);
}
