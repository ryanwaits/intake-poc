# Arena pre-registration

Written and committed before any arm is run against the eval set. Changing anything below after results exist must be called out in the report as a deviation.

## Question

For the POC's one model-dependent step (turn the patient's words and chart summary into decisions), which approach gives the best outcome, all things weighed: safety, paperwork removed, speed, cost, code, scale, and how it behaves when inputs get weird?

## Arms

Every arm fills the same `Decisions` seam; the same `plan()` code turns decisions into the form and card.

| Arm | Approach | Model |
|---|---|---|
| A `rules` | Keyword and pattern matching, no model | none |
| B `jev` | Typed questions, decision API, native probabilities | `jev-1.13.0` |
| C `haiku-typed` | The same typed questions, one structured-output call, verbalized confidence | `claude-haiku-5-5` |
| D `luna-typed` | The same typed questions, probabilities from token logprobs | `gpt-6-luna` |
| E `local-typed` | The same typed questions, verbalized confidence, runs on our own hardware | `qwen3.8:27b` (Ollama) |
| F `haiku-e2e` | One holistic prompt returns the decisions, no per-question probabilities | `claude-haiku-5-5` |
| G `opus-e2e` | The same holistic prompt | `claude-opus-5-5` (effort `low`) |

## Data

- ~200 synthetic cases with labels known by construction (`eval/spec.ts`), written by `google/gemini-3.8-flash`, checked by `deepseek/deepseek-v4-flash`. Neither is a contestant.
- 45 Semigran vignettes rewritten in the patient's voice; label: emergent or not.
- Ryan hand-checks 30 cases (`eval:review`); the label error rate found there is reported.
- Split: cases with an even number in their id → **dev**, odd → **test**. Gates are tuned on dev, every headline number is from test.

## Metrics

**Safety guardrails** (an arm that fails either is out of the running, whatever else it scores):
1. Red-flag recall on synthetic test cases ≥ 0.95 (escalate when a red flag was stated).
2. Missed-field rate ≤ 5%: of fields the patient did not answer, the share the plan skipped or never asked.

**Primary:** paperwork accuracy, the share of labeled fields where the plan made the right call (ask iff not answered), end to end, including the effect of complaint routing.

**Secondary:** over-ask rate; Semigran emergent recall and self-care false-escalation rate; complaint accuracy; calibration (expected calibration error, for arms that return probabilities); p50/p95 latency; cost per intake and per 100k intakes; flip rate across 5 repeats on 40 test cases; injection cases' over-skip rate vs the rest; invalid-output rate; lines of arm-specific code.

**Reported, not ranked:** BAA availability and whether it can run inside the clinic's own cloud account.

## Gates

Each arm with probabilities gets its own `escalateAt` and `answeredAt`, chosen on dev: `escalateAt` is the highest value that keeps dev red-flag recall ≥ 0.95, `answeredAt` the value that maximizes dev paperwork accuracy subject to missed-field rate ≤ 5%. Arms with only yes/no outputs (A, F, G) have nothing to tune. Results with the shipped default `GATES` are reported alongside.

## Decision rule

1. Drop arms that fail a guardrail on test.
2. Rank the rest by paperwork accuracy on test, with 95% paired-bootstrap confidence intervals on the difference from the leader.
3. Among arms whose interval overlaps the leader's, prefer: p95 latency under 1 s (the form is interactive), then lower cost per 100k intakes, then less arm-specific code.
4. The report names one recommendation and the runner-up for teams that need a BAA or self-hosting.

## Budget

$50 total for arena runs, enforced by the runner. Case generation is budgeted separately ($5).
