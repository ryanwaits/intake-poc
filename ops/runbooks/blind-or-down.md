# Runbook: the service is down from outside, or an SLI gone blind

Alerts: `IntakeProbeFailing` (page), `IntakeProbeNoData`, `IntakeSLINoData` (tickets).

## `IntakeProbeFailing`: the readiness probe fails from outside

The service's own metrics can't see this: a dead process reports nothing. Treat it as an outage.

1. **Is anything running?** `docker compose ps intake`. Crash loop → `docker compose logs intake`; boot fails fast on bad config.
2. **Draining?** `/readyz` returns 503 for a few seconds after SIGTERM. Longer than that means the service isn't becoming ready: check its logs.
3. **Network path?** If the service is ready but the probe fails, check the network between the probe and the service, not the service itself.

## `IntakeSLINoData`: an SLI has no series

The SLO alerts for that SLI cannot fire while this is open.

1. **No traffic, or no scrape?** `up{job="intake"}` in Prometheus. 0 → see the probe section above.
2. **Query broken?** Run the SLI's queries from `ops/slo/intake.sloth.yaml` by hand. A metric or label rename (or Prometheus normalizing `le="1"` to `le="1.0"`) returns nothing. Fix the spec, `bun run ops:slo`, and CI checks for drift.

## `IntakeProbeNoData`: the probe stopped reporting

Outside availability is unmeasured. Check the `blackbox` exporter is up and the `intake-probe` scrape job in `ops/prometheus/prometheus.yml`.
