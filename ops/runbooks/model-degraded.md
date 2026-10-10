# Runbook: intakes degraded or slow

Alerts: `IntakeDegraded`, `IntakeLatency`.

## What the patient sees

Nothing breaks. When the decision model fails or times out, the service serves the **degraded plan**: chart prefill still works, every coverable question is asked, every intake goes to a human navigator, and the medic preps the full device kit. Safe, but slower for patients and costly for staff. That is why it has its own error budget.

## Check, in order

1. **Is it the model or us?** Grafana → *Intake service* → *Intake latency*: if `model p95` sits near 400 ms (the client timeout) or vanishes while HTTP p95 climbs, the model is failing.
   ```sh
   docker compose logs --no-log-prefix intake | jq -c 'select(.msg=="intake" and .mode=="degraded") | .error' | sort | uniq -c
   ```
   `APIConnectionError` / `APITimeoutError` → network or TypeSafe outage. `AuthenticationError` → key rotated or revoked. `RateLimitError` → we outgrew the account's limits (80 req/s, 100k tokens/s).
2. **TypeSafe status.** Check `trust.typesafe.ai`, then list models from inside the container (same network path and key as the service):
   ```sh
   docker compose exec intake sh -c 'wget -qO- --header "Authorization: Bearer $TYPESAFE_API_KEY" https://api.typesafe.ai/v1/models'
   ```
3. **Egress.** A firewall or proxy change can block `api.typesafe.ai:443`.

## Mitigate

- Auth: set the new `TYPESAFE_API_KEY` and `docker compose up -d intake`.
- Outage: nothing to roll back; degraded mode is the mitigation. Tell clinic operations that intakes will take longer and every case goes to a navigator.
- Rate limits: lower shadow traffic first (`INTAKE_SHADOW_SAMPLE=0`), it doubles model calls on the sampled share.

## History

The game day on 2026-10-09 found the old timeout (2 s, one retry) was longer than the 1 s latency SLO. It's now 400 ms with one fast retry and a circuit breaker. See `ops/postmortems/2026-10-09-game-day-jev-outage.md`.
