# Runbook: intake server errors

Alert: `IntakeAvailability`.

Model failures do **not** cause 5xx (they degrade), so server errors here mean the service itself is broken.

1. **Recent deploy?** If the errors started with a new image, roll back to the previous one and `docker compose up -d intake`.
2. **Crashing?** `docker compose ps intake`, `docker compose logs intake`. Boot fails fast on bad config (`loadConfig`), so a crash loop after a config change points at the change.
3. **Out of memory?** `docker inspect intake-poc-intake-1 --format '{{.State.OOMKilled}}'`.
4. Logs are an allowlist of fields with no patient data, so they are safe to paste into the incident channel.
