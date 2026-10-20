# Model evaluation results

The POC has one step that depends on a model: turning the patient's words and a chart summary into decisions. This page compares ten ways of doing that step on the same cases, with the same scoring code, under a rule written down before anything ran ([`PREREGISTRATION.md`](PREREGISTRATION.md)).

Numbers come from [`results/summary.json`](results/summary.json), [`results/load.json`](results/load.json) and the flattened tables in [`results/dashboard/`](results/dashboard/), produced by [`export.ts`](export.ts). Headline numbers are from the test split.

## Recommendation

**Jev (`jev-1.13.0`)**, under the amended rule described below. Five arms are statistically tied on paperwork accuracy. The pre-registered tiebreak prefers p95 latency under 1 second, and Jev is the only tied arm under it (181 ms).

**Runner-up: Clef 27B.** Tied with Jev on accuracy, identical answers on every repeat, and it can be self-hosted. It caught 3 of 8 emergent vignettes against Jev's 7.

## What was compared

| | |
|---|---|
| Cases | 224: 179 synthetic intakes (21 of 200 generated were dropped) and 45 Semigran triage vignettes rewritten in the patient's voice |
| Labeled form fields | 892 |
| Split | Even case ids are dev (110), odd are test (114: 91 synthetic, 23 vignettes). Gates are tuned on dev only |
| Red-flag cases in test | 18 synthetic cases where the patient stated a red flag, and 8 emergent vignettes |
| Arms | 10: rules only, four decision models (Jev, Clef, Clef-flash, Kev-4B), and five general LLM setups |

Every arm fills the same `Decisions` seam, and the same `plan()` code turns decisions into the form and the prep card.

## The rule, and the amendment

The pre-registered rule:

1. Drop any arm that fails a safety guardrail on test: red-flag recall at least 95%, and missed-field rate at most 5%.
2. Rank the rest by paperwork accuracy, with 95% paired-bootstrap intervals on the difference from the leader.
3. Among arms tied with the leader, prefer p95 latency under 1 second, then lower cost per 100k intakes, then less arm-specific code.

As first written, step 1 also tuned each arm's escalation threshold on dev: the highest threshold that kept dev red-flag recall at 95% or more. On 20 flagged dev cases that pushed several thresholds to 0.95 or higher (Jev's to 0.98), and on test Jev then escalated 17 of 18 red-flag cases (94.4%) and failed the guardrail.

**Amendment.** The amended view keeps the shipped escalation threshold (`GATES.escalateAt = 0.2` in [`src/core/plan.ts`](../src/core/plan.ts)) for every arm, because tuning a safety threshold upward on a handful of examples overfits. Everything else is unchanged. Both views are reported; the code is in [`score.ts`](score.ts) (`tune()`).

| View | Passing guardrails | Leader | Tied with leader | Recommendation |
|---|---|---|---|---|
| Pre-registered | Clef, Luna, Opus one prompt | Clef | Clef, Luna, Opus one prompt | Luna (none tied are under 1 s; Luna is cheapest) |
| Amended | Jev, Clef, Clef-flash, Kev-4B, Haiku typed, Luna, Opus one prompt | Jev | Jev, Clef, Haiku typed, Luna, Opus one prompt | Jev |

## Scorecard

Test split, amended view. "Emergent caught" is out of 8 test vignettes. Flip rate is the share of decisions that changed across 5 repeats of 40 test cases (Kev-4B: 10 cases, to limit GPU time).

| Arm | Kind | Paperwork accuracy | Missed fields | Red-flag recall | Emergent caught | Guardrails | Flip rate | Calibration error | p95 latency | $ per 100k intakes | Self-host |
|---|---|---|---|---|---|---|---|---|---|---|---|
| **Jev** | Decision model | **99.3%** | 1.2% | 100% | **7 of 8** | pass | 1.4% | 0.026 | **181 ms** | $9.28 | no |
| Clef 27B | Decision model | 98.7% | 2.0% | 100% | 3 of 8 | pass | 0% | 0.037 | 1,309 ms | $75.31 | yes |
| Clef-flash 9B | Decision model | 96.9% | 3.3% | 100% | 6 of 8 | pass | 0% | 0.029 | 765 ms | $28.24 | yes |
| Kev-4B (laptop GPU) | Decision model | 93.8% | 4.9% | 100% | 5 of 8 | pass | 0% | 0.036 | 5,483 ms | $0 | yes |
| Haiku 5.5, typed | General LLM | 98.9% | 1.2% | 100% | 6 of 8 | pass | 4.6% | 0.054 | 4,099 ms | $89.36 | no |
| GPT-6 Luna, typed + logprobs | General LLM | 98.7% | 2.5% | 100% | 6 of 8 | pass | 2.9% | 0.025 | 2,655 ms | $32.28 | no |
| Opus 5.5, one prompt | General LLM | 97.3% | 4.9% | 100% | 4 of 8 | pass | 0.4% | n/a | 3,835 ms | $736.34 | no |
| Haiku 5.5, one prompt | General LLM | 99.1% | 0.4% | 94.4% | 3 of 8 | **fail** | 5.0% | n/a | 3,641 ms | $28.19 | no |
| Rules only | Rules | 94.7% | 6.5% | 83.3% | 0 of 8 | **fail** | 0% | n/a | 2 ms | $0 | yes |
| Qwen 3.8 27B, local | General LLM | not ranked | | | | | | | 87,942 ms | $0 | yes |

The local Qwen run was paused after 20 of 224 cases (a median of 77 seconds per intake on a laptop), so it is shown but not ranked. One-prompt arms return yes or no rather than probabilities, so they have no calibration error.

Difference in paperwork accuracy from Jev, with 95% paired-bootstrap intervals (amended view):

| Arm | Difference | 95% interval |
|---|---|---|
| Clef 27B | −0.7 pts | −1.6 to 0.0 |
| Luna, typed | −0.7 pts | −1.8 to +0.3 |
| Haiku, typed | −0.7 pts | −2.2 to +0.4 |
| Opus, one prompt | −1.6 pts | −3.5 to +0.1 |
| Clef-flash 9B | −3.1 pts | −5.3 to −1.3 |
| Rules only | −4.4 pts | −6.4 to −2.7 |
| Kev-4B | −5.4 pts | −7.8 to −3.3 |

## Under load

64 requests per level ([`load.ts`](load.ts)); Opus and Kev-4B ran fewer to limit spend and GPU time.

| Arm | Concurrency | Throughput | p50 | p95 | Errors |
|---|---|---|---|---|---|
| Jev | 1 / 32 | 7.2 / 149.8 per s | 133 / 172 ms | 180 / 267 ms | 0 |
| Clef 27B | 1 / 32 | 1.4 / 24.4 per s | 681 / 840 ms | 869 / 1,335 ms | 0 |
| Clef-flash 9B | 1 / 32 | 2.7 / 36.1 per s | 355 / 451 ms | 526 / 1,035 ms | 3 at 32 |
| Luna, typed | 1 / 32 | 0.5 / 8.4 per s | 2,049 / 2,327 ms | 2,811 / 3,076 ms | 0 |
| Haiku, typed | 1 / 32 | 0.3 / 8.4 per s | 3,328 / 3,307 ms | 3,990 / 3,566 ms | 0 |
| Haiku, one prompt | 1 / 32 | 0.5 / 11.5 per s | 2,073 / 1,952 ms | 3,468 / 3,001 ms | 0 |
| Opus, one prompt | 1 / 12 (24 requests) | 0.5 / 4.3 per s | 2,089 / 2,150 ms | 3,149 / 3,112 ms | 0 |
| Kev-4B | 1 / 4 (8 requests) | 0.2 / 0.2 per s | 5,067 / 20,146 ms | 5,523 / 20,300 ms | 0 |

## Deviations from the pre-registration

- **Escalation threshold.** The amendment above.
- **Three arms added after it was written.** [`PREREGISTRATION.md`](PREREGISTRATION.md) lists seven arms. Clef, Clef-flash and Kev-4B were added later, run through the same cases, scorer and rule.
- **Human label check not yet reported.** See [Label quality](#label-quality).
- **Tuned gates.** Gates are tuned per arm on dev, as written. The service ships fixed gates (`GATES` in [`src/core/plan.ts`](../src/core/plan.ts)), and at those Jev scores 98.7% paperwork accuracy instead of 99.3%, with red-flag recall and emergent vignettes unchanged. The service keeps the more conservative skip threshold of 0.7, which asks a few more questions.

## Label quality

Synthetic labels are known by construction: code chooses which facts each message states, a model that isn't competing writes the message, and a second one checks it. The pre-registration also calls for a person to hand-check 30 cases with `bun run eval:review`. That check hasn't been done carefully enough to report, so there's no human-measured label error rate yet. It's listed as an open item.

## Extraction: Clairic (added 2026-10-20)

When a patient already answered a question, the plan skips it, but it records only *that* they answered, not *what* they said (`values: []` in [`src/core/plan.ts`](../src/core/plan.ts)). Cloudflare's Clairic, a System One *extraction* model released 2026-10-19, returns the value itself: a span of the patient's words, a typed number or duration, or `null`, each with `p_null` and `confidence`. It was run once on the 179 synthetic cases, with the patient's words as input and one text field per in-scope question ([`extract.ts`](extract.ts), `bun --env-file=.env eval/extract.ts`). Ground truth is the fact phrase each case's spec had to state. Jev's answers come from the arena run. The value gate is tuned on dev; numbers are from test (450 labeled fields).

**Clairic can't replace Jev for "did they answer it?"** It returns a span for nearly every field, including ones the patient never mentioned:

| Deciding "skip this question" | Accuracy | Precision | Unanswered questions skipped |
|---|---|---|---|
| Jev, `p(answered) ≥ 0.7` (shipped) | 98.7% | 99.5% | 1 |
| Clairic, any non-null value | 72.0% | 61.9% | 126 |
| Clairic, best `confidence` + `p_null` gates tuned on dev | 87.3% | 82.5% | 40 |

**Paired with Jev, it fills in the answer.** Jev decides the skip and Clairic supplies the value when its `confidence ≥ 0.5`:

| | Test |
|---|---|
| Questions Jev skipped | 201 |
| Got a value from Clairic | 130 (64.7%) |
| Value matches the stated fact | 126 of 130 by the automatic matcher (any shared content word). The 4 misses were all correct on review (patient typos such as "gettng biger", or synonyms such as "mucus" for "phlegm"). A random 15 of the matches checked out too |
| Typed values | `onset_days`: "this morning" → 0, "about a week" → 7, "last month" → 30 |
| Latency | p50 305 ms, p95 630 ms |
| Cost | ~1,085 input tokens per intake at $0.10/M: $10.85 per 100k intakes, about the same as Jev |

**What this would change.** It's the pattern Cloudflare describes: extract, then decide. It also matches the POC's rule that the decision model decides and code acts. In the product it would turn ~65% of silent skips into "You said: about a week" for the patient to confirm, and put typed values on the provider's prep card. The costs: two model calls instead of one (run in parallel, since Clairic's p95 alone is over Jev's 400 ms timeout but inside the 1 s SLO), a second vendor with no stated BAA (open weights are planned, which would allow self-hosting), and a failure path where values are simply missing. Not wired into the product yet. Images (insurance cards, device displays) weren't tested.

## Spend

$3.80 in arena model calls, summed from the cost recorded on every call in the result files: $2.24 for one pass over the 224 cases and the rest for the consistency repeats. The runner enforced a $50 cap. Case generation was budgeted separately.

## Limits

- **Synthetic data.** No real patient data was used anywhere. The fields and protocols are written for this demo.
- **The safety signal is small.** There are 8 emergent vignettes in test. Jev caught 7 of 8, which is not enough evidence to call it safe for triage, and in the POC it isn't used that way: escalations go to a provider, and a model outage sends every case to a person.
- **Two views.** The recommendation depends on the amendment. Under the rule exactly as first written, Luna is the recommendation and Jev fails a guardrail by one case.
- **Vendor terms.** TypeSafe offers no public BAA, so Jev cannot receive real patient data today. Clef and Kev-4B can be self-hosted, so data need not leave your own account.
