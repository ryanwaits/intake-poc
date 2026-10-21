# Intake POC

Less paperwork for a hybrid clinic (remote provider, on-site medic). FHIR chart + patient's own words → decision model (Jev) + extraction model (Clairic), in parallel → patient form (prefill / confirm / sign / answered / ask) + medic/provider prep card.

## Rules
- Models answer narrow typed questions behind `Decide` (`src/core/run.ts`); code decides. Gates live in `GATES` (`src/core/plan.ts`).
- Dates, ages, staleness: code only. Models see the patient's words plus `toSummary`: no names, IDs, contact details or dates.
- Pinned model `jev-1.13.0`. Re-run the arena before changing it.
- Model failure → degraded plan (`plan(..., null)`). Never throw to the caller.
- Extraction (`Extract`, `src/core/extract.ts`) supplies values only. It never decides a skip, an escalation or a route; its failure only drops `said`. It sees the patient's words and nothing else.
- Logs: allowlisted fields only (`src/api/log.ts`). Never log `reason` or chart data.
- Synthetic data only. TypeSafe has no BAA.
- Model-driven items carry a `why` (question, p, rule). Escalations go to providers, never to patients.
- Tests, in priority order: e2e with nothing mocked, integration at boundaries, goldens. No fake models. Unit tests only for silent bugs no flow reaches. A changed golden is a changed product: re-record and review the diff.

## Commands
`bun test` (real model, needs `TYPESAFE_API_KEY`) · `bun run golden:record` · `bun run typecheck` · `bun run lint` · `bun run demo <patient> "<reason>"` · `bun run dev`
