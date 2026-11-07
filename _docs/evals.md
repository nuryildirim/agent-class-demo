# Evaluation Report: Haiku 5.5 vs. Sonnet 5.5

_Build plan step 5. Run on November 7, 2026._

## Summary

- **Live demo model: Sonnet 5.5.** It matched the answer key on all 60 runs and never approved a claim that should have been rejected or reviewed. It costs about $0.022 per claim, or about $0.44 for all 20 demo claims.
- **Student default: Haiku 5.5.** It scored 97% at about a tenth of Sonnet's cost ($0.002 per claim). Its only mistakes sent two simple solo meals to the admin for review instead of approving them. That costs the admin a little time, but it is safe.
- **The evaluation found problems we did not know about.** The first two runs exposed a data leak into the agent, a gap in the prompt, and a bug in the test receipts. We fixed all three before the final run.

## What we measured

Each of the 20 demo claims (C01–C20) has a known correct outcome in `data/demo-claims.json`: approve, reject, or review. That file is the answer key. It is never written to the database, so the agent cannot see it.

We ran the agent on every claim **3 times per model**, which gives 60 runs per model. Running each claim more than once shows how consistent a model is, because the same claim can get different answers.

| Metric | What it means |
|---|---|
| Accuracy | The recommended outcome matches the answer key. A failed run counts as wrong. |
| Unsafe approvals | The agent said "approve" when the right answer was reject or review. These are the costly mistakes, because an admin might bulk-approve them without reading. |
| Receipt read correctly | The Extract step on its own: did the model read the right total? On the blurry receipt, did it say the receipt was hard to read? |
| Cited the expected rule | The recommendation names at least one of the policy rules the answer key expects. |
| Cost, turns, time | Taken from each run's record in `agent_runs`. |

## Results by run

We ran the evaluation three times, making fixes between runs.

| Run | Model | Accuracy | Unsafe approvals | Receipt read correctly | Cost (60 runs) |
|---|---|---|---|---|---|
| 1. Starting point | Haiku | 56/60 (93%) | 1 | 60/60 | $0.12 |
| | Sonnet | 57/60 (95%) | **3** | 60/60 | $1.38 |
| 2. After fixes 1 and 2 | Haiku | 51/60 (85%) | 0 | 60/60 | $0.12 |
| | Sonnet | 57/60 (95%) | 0 | 60/60 | $1.45 |
| 3. After fix 3 (final) | Haiku | **58/60 (97%)** | 0 | 60/60 | $0.13 |
| | Sonnet | **60/60 (100%)** | 0 | 60/60 | $1.33 |

### Final run in detail

| | Haiku 5.5 | Sonnet 5.5 |
|---|---|---|
| Accuracy | 58/60 (97%) | 60/60 (100%) |
| Unsafe approvals | 0 | 0 |
| Failed runs | 0 | 0 |
| Receipt read correctly | 60/60 | 60/60 |
| Cited the expected rule | 60/60 | 60/60 |
| Average cost per claim | $0.0021 | $0.0221 |
| Average turns | 8.2 | 7.4 |
| Average time | 149 seconds (one stalled batch; typically about 13, see below) | 12 seconds |

Haiku's mistakes: C02 and C11, both solo meals during business travel. Twice it recommended review instead of approve, saying the policy does not clearly cover solo meals.

## Findings and fixes

### 1. The agent could see the admin's earlier decision

**What we saw.** Claims C01–C10 had already been bulk-approved while testing the admin queue. The `get_claim` tool returned each claim's `status`, so the agent saw "approved." Several Haiku summaries said things like "the claim status already reads approved, so the admin should confirm that is intended."

**Why it matters.** An agent that can see the answer may simply agree with it. That makes the evaluation unreliable, and in real use the recommendation would no longer be independent of the decision.

**Fix.** `get_claim` no longer returns `status` (`lib/agent-tools.ts`). `find_similar_claims` still returns it, because spotting a duplicate needs to know a past claim was "already paid."

### 2. Sonnet approved the blurry receipt

**What we saw.** On C17, the blurry receipt, Sonnet read the total correctly ($58.25) and marked the receipt "partly readable." It then approved the claim, 3 times out of 3. The answer key says review, because policy rule GEN-02 needs a readable itemized receipt. These were the only unsafe approvals in the first run.

**Why it matters.** A stronger model read through the blur, then trusted its own reading over the policy. The model's own receipt reading said "partly readable," but its recommendation did not follow from it.

**Fix.** We added one line to the system prompt (`lib/agent.ts`): if any part of the receipt is not clearly readable, choose review, even if the total looks right. In the next run, both models sent C17 to review every time.

### 3. Some test receipts were cut off

**What we saw.** After fix 2, every model started sending C03 to review, and Haiku did the same with C08 and C15. Their summaries said the receipt was cut off. They were right: long lines such as "Check-in: 2026-10-19 Check-out: 2026-10-21" ran past the right edge of the image.

**Why it matters.** The models were not wrong; the test data was. The stricter prompt simply made the agent report a defect it had been ignoring.

**Fix.** `scripts/make-receipts.mjs` now shrinks any line that is too long to fit. We regenerated the 12 affected images, uploaded them to Supabase Storage, and updated their fingerprints. C14 still shares a fingerprint with the past claim H02, so duplicate detection still works.

## Lessons for the class

- **An evaluation is a debugging tool, not just a score.** Two of the three problems were in our own setup (a data leak and a broken test image), not in the models.
- **Measure the costly mistakes separately.** Run 1 had similar accuracy for both models, but Sonnet's mistakes were unsafe approvals and Haiku's were mostly extra reviews. Accuracy alone would have hidden that.
- **Run each case more than once.** Haiku's answer on C02 and C11 changed between runs. One run per claim would have given a misleading picture.
- **One prompt line can change behavior, in both directions.** Fix 2 removed the unsafe approvals, but it also exposed the broken receipts. Rerun the whole set after every change.
- **The human still decides.** Even at 100%, this is 20 claims we wrote ourselves. The architecture, not the score, is what keeps the agent from approving or paying anything.

## Limits of this evaluation

- **The set is small and made up.** Twenty claims, written to match a short policy. Real receipts and edge cases would be messier.
- **The final prompt was tuned on this same set.** The final scores are likely a little optimistic, because we fixed problems we found on these exact claims.
- **One slow batch.** In the final run, several Haiku runs took about 17 minutes each, even though they finished normally in 8 to 10 turns. They paused at the same time, which points to the laptop sleeping or a network stall rather than the model. This raised Haiku's reported average time to 149 seconds. Typical runs take about 13 seconds.
- **Costs are much lower than the handoff estimate.** The handoff assumed about $1.35 for one Sonnet pass over 20 claims; the measured cost is about $0.44. The whole evaluation (360 runs across three rounds) cost about $4.50.

## How to reproduce

1. Start the app: `npm run dev`
2. In another terminal: `npm run eval -- --models haiku,sonnet --repeats 3`
3. The script prints each mistake and a score table, then a link to the results page for that batch.

Results page: `/admin/eval`. Each result links to that run's full trace. Add `?since=<time>` to show only runs after a given time, for example after a prompt change. The final run is at `/admin/eval?since=2026-11-07T17:15:07.501Z`, and run 2 is at `/admin/eval?since=2026-11-07T16:59:10.919Z`.

Notes:
- Every evaluation run is saved like any other run, so it also becomes that claim's latest recommendation in the admin queue.
- Use `--claims C11,C17` to rerun only a few claims.

## Code

| File | Role |
|---|---|
| `lib/eval.ts` | Answer key and scoring |
| `scripts/eval.mjs` | Runs a batch through `/api/review`, then scores it through `/api/eval` |
| `app/api/eval/route.ts` | Returns the scores as JSON |
| `app/admin/eval/page.tsx` | Results page |
