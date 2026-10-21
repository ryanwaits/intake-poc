# Postmortem: game day, decision model outage

**Date:** 2026-10-09 · **Type:** planned game day (local stack: service, Prometheus, Grafana) · **Format:** blameless

> **2026-10-21:** the monitoring stack (Prometheus rules, Grafana, the probe) was removed from the repo to keep the POC on the product. Items 1 and 2, the fixes that changed what patients get, stay in the code and run as e2e tests. Items 3, 4 and 6 belong to whatever monitoring the clinic runs.

## Summary

We cut the intake service off from the decision model (Jev) for 8m 39s under 2 intakes per second of synthetic traffic. No intake failed and no patient got an unsafe plan: every request was answered with the degraded plan (chart prefill, every question asked, human triage). Both page alerts fired within 83 seconds. The game day found one real defect: the model client's timeout and retry were longer than the 1 s latency SLO, so an outage also made every intake take 4.5 s. We fixed it during the exercise with a 400 ms timeout and a circuit breaker, and verified the fix while the outage was still running.

## Timeline (UTC)

| Time | Event |
|---|---|
| 03:27 | Traffic starts: eval-set complaints against the fixture charts, 2 intakes/s. Shadow model `jev-latest` on 20% of traffic. |
| 03:29–03:33 | Pre-check: SLI recording rules return **no data** while healthy. Two causes, both fixed before the outage (see *What went wrong*). |
| 03:33:46 | **Outage starts.** `TYPESAFE_BASE_URL` points at an unroutable address. Container restart: 8 s with no listener. |
| 03:33:54 | Service ready. Every intake is degraded, 4.5 s each (2 s timeout × 2 attempts + backoff). |
| 03:35:09 | **Alerts fired** (detection 83 s, page severity): `IntakeDegraded` and `IntakeLatency`, page and ticket severities. |
| 03:35:45 | Fix deployed mid-outage: 400 ms timeout, one 50 ms-backoff retry, circuit breaker (5 failures → open 30 s). |
| 03:35:59 | Fixed service ready. The first intakes take about 0.86 s until five straight failures open the breaker, and degraded intakes return in 10–20 ms. |
| ~03:41 | 5-minute latency SLI back to 0. Latency page still held by the slower 30 m / 6 h condition, by design. |
| 03:42:25 | **Outage ends.** Real endpoint restored. |
| 03:42:32 | Live plans again (215 ms). Alerts clear as the outage ages out of each burn window. |

## Impact

- **Patients:** none harmed. 100% of intakes answered; during the outage every intake went to a navigator and patients were asked every coverable question, since nothing could be skipped from their own words.
- **Latency:** before the fix, p95 4.35 s against a 1 s SLO. After the fix, p95 under 50 ms while degraded.
- **Error budget:** the live-planning budget (99%) and the latency budget (99%) were both overspent for the 30-day window. On a fresh demo stack the window holds only ~16 minutes of data, so the percentages are large; the burn rates (up to ~18×) are the meaningful number.
- **Availability SLO:** untouched (0 server errors). The 8 s restart gaps are invisible to it because refused connections never reach the server.

## What went well

- Degraded mode did exactly its job: safe plan, no 5xx, no crash loop, liveness unaffected.
- Multi-window burn-rate alerts fired in 83 s at page severity, and didn't flap after recovery.
- Shadow mode showed a 0.1% field disagreement between `jev-latest` and the pinned model before the outage. Same model, so that is its run-to-run noise: the baseline any future candidate is compared against.
- Logs stayed free of patient data throughout (allowlisted fields only).

## What went wrong

1. **Client timeout longer than the SLO.** 2 s per attempt plus one retry meant an outage turned into 4.5 s intakes. The 2 s value predated the SLO and nobody had put the two numbers side by side.
2. **SLIs silently empty while healthy** (caught in pre-check, before the outage):
   - Prometheus 3 stores histogram bucket labels normalized (`le="1"` becomes `le="1.0"`), so the latency SLI matched nothing.
   - With zero errors there is no error series at all, so `errors / total` was empty instead of 0, and the availability and live SLIs had no data.
   Either would have meant alerts that can never fire.
3. **Server-side SLIs can't see a dead process.** Restart gaps produced connection errors on the client and nothing in the service's metrics.

## Action items

| # | Action | Status |
|---|---|---|
| 1 | Timeout 400 ms + one 50 ms-backoff retry, sized from Jev's measured p99 (245 ms, n=384) to fit inside 1 s | Done, `src/core/jev.ts` |
| 2 | Circuit breaker on the live model: fail fast while open, one trial call to close; state as `intake_breaker_open` | Done, `src/core/breaker.ts` |
| 3 | `or vector(0)` on error queries and `le=~"1(\.0)?"` on the latency bucket; CI regenerates rules and fails on drift | Done at the time; removed with the stack |
| 4 | Black-box probe from outside the cluster (ingress or synthetic check) so a dead process counts against availability | Done at the time; removed with the stack |
| 5 | Kubernetes rollouts keep ≥2 ready pods (PDB, readiness drain) so a restart is never a full gap like compose's | Dropped: the Kubernetes manifests were removed from this repo |
| 6 | Add a "no data" alert per SLI (`absent()`), so a broken query pages someone instead of hiding | Done at the time; removed with the stack |

## Rerun after the fix (2026-10-09, 16:18 UTC)

The same outage, rerun on the fixed service. It started before traffic had a healthy baseline, so there's no clean before-and-after on the dashboard.

| Time (UTC) | Event |
|---|---|
| 16:18:38 | Outage starts: the service restarts pointed at an unroutable model address. |
| 16:19:35 | `IntakeDegraded` (page and ticket) becomes active, 57 s in. |
| 16:22:16 | Both alerts firing. Breaker open, p95 intake latency 48 ms. 395 intakes so far, all answered with the degraded plan. |
| 16:22:25 | Real endpoint restored. |
| 16:22:58 | Live plans back. |

The fix held: an outage now costs patients the degraded plan, not the latency budget.
