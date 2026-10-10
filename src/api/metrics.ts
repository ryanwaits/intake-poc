import { Counter, collectDefaultMetrics, Gauge, Histogram, Registry } from 'prom-client';

/**
 * Prometheus metrics. Labels are low-cardinality and never carry patient data:
 * routes, status codes, model ids, modes and decision kinds only.
 */
export const registry = new Registry();
collectDefaultMetrics({ register: registry });

export const httpRequests = new Counter({
  name: 'intake_http_requests_total',
  help: 'HTTP requests by route and status code.',
  labelNames: ['route', 'status'] as const,
  registers: [registry],
});

export const httpDuration = new Histogram({
  name: 'intake_http_request_duration_seconds',
  help: 'HTTP request duration. The latency SLO counts intake requests under 1 s.',
  labelNames: ['route'] as const,
  buckets: [0.05, 0.1, 0.25, 0.5, 1, 2, 5],
  registers: [registry],
});

export const intakes = new Counter({
  name: 'intake_plans_total',
  help: 'Intake plans served, by mode. The live SLO counts mode="live".',
  labelNames: ['mode'] as const,
  registers: [registry],
});

export const decideDuration = new Histogram({
  name: 'intake_decide_duration_seconds',
  help: 'Model call duration, by model and outcome.',
  labelNames: ['model', 'outcome'] as const,
  buckets: [0.05, 0.1, 0.25, 0.5, 1, 2, 5],
  registers: [registry],
});

export const fields = new Counter({
  name: 'intake_fields_total',
  help: 'Form fields by how they were filled: the paperwork the patient was spared.',
  labelNames: ['status'] as const,
  registers: [registry],
});

export const escalations = new Counter({
  name: 'intake_escalations_total',
  help: 'Intakes routed to a provider now.',
  registers: [registry],
});

export const shadowAgreement = new Counter({
  name: 'intake_shadow_agreement_total',
  help: 'Shadow model compared with the live one, per decision kind.',
  labelNames: ['model', 'decision', 'agree'] as const,
  registers: [registry],
});

export const shadowErrors = new Counter({
  name: 'intake_shadow_errors_total',
  help: 'Shadow model calls that failed. Never affects the patient.',
  labelNames: ['model'] as const,
  registers: [registry],
});

export const breakerState = new Gauge({
  name: 'intake_breaker_open',
  help: 'Model circuit breaker: 0 closed, 0.5 half-open (one trial call), 1 open (serving degraded).',
  labelNames: ['model'] as const,
  registers: [registry],
});
