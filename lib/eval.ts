// Evaluation: how often does the agent recommend the right thing?
//
// Each of the 20 demo claims has a known correct answer in
// data/demo-claims.json (the "answer key"). The answer key lives only in that
// file. It is never written to the database, so the agent cannot see it.
//
// To evaluate, we run the agent on the 20 claims (see scripts/eval.mjs), then
// compare every run's recommendation with the answer key. Each run counts as
// one try, so running each claim 3 times gives 60 tries per model, which also
// shows how CONSISTENT a model is (the same claim can get different answers).
//
// What we score, per model:
//   - Accuracy:        the recommended outcome matches the answer key.
//   - Unsafe approvals: the agent said "approve" but the right answer was
//                      reject or review. These are the costly mistakes: the
//                      admin might bulk-approve them without reading.
//   - Receipt reading: the "Extract" step on its own. Did the model read the
//                      right total? On the blurry receipt, did it say so?
//   - Cost, turns, and time per run.
//
// A failed run (no recommendation saved) counts as wrong.

import "server-only";
import demo from "@/data/demo-claims.json";
import { db, type AgentRun, type Outcome, type Recommendation } from "./db";

// ---------------------------------------------------------------------------
// The answer key
// ---------------------------------------------------------------------------

type ReceiptSpec = {
  items?: [string, number][];
  tax?: [string, number];
  tip?: number;
  copy_of?: string; // the claim whose receipt image this one reuses
  blurry?: boolean;
};
type DemoClaim = { id: string; receipt: ReceiptSpec; expected?: { outcome: Outcome; rules: string[]; reason: string } };

export type AnswerKeyEntry = {
  claimId: string;
  outcome: Outcome;
  rules: string[];
  reason: string;
  receiptTotal: number; // what the receipt image really says
  blurry: boolean;
};

const allDemoClaims = [...demo.past_claims, ...demo.claims] as DemoClaim[];

export const ANSWER_KEY: AnswerKeyEntry[] = (demo.claims as DemoClaim[]).map((claim) => {
  const receipt = trueReceipt(claim.receipt);
  return {
    claimId: claim.id,
    outcome: claim.expected!.outcome,
    rules: claim.expected!.rules,
    reason: claim.expected!.reason,
    receiptTotal: receiptTotal(receipt),
    blurry: receipt.blurry === true,
  };
});

// A receipt that is a copy of another claim's receipt shows that claim's numbers.
function trueReceipt(spec: ReceiptSpec): ReceiptSpec {
  if (!spec.copy_of) return spec;
  return allDemoClaims.find((c) => c.id === spec.copy_of)!.receipt;
}

// Items + tax + tip, the same sum scripts/make-receipts.mjs prints on the image.
// Counted in cents to avoid floating-point surprises.
function receiptTotal(r: ReceiptSpec) {
  const cents = (dollars: number) => Math.round(dollars * 100);
  const items = (r.items ?? []).reduce((sum, [, price]) => sum + cents(price), 0);
  return (items + cents(r.tax?.[1] ?? 0) + cents(r.tip ?? 0)) / 100;
}

// ---------------------------------------------------------------------------
// Scoring
// ---------------------------------------------------------------------------

// One agent run on one answer-key claim, scored.
export type ScoredRun = {
  runId: string;
  claimId: string;
  model: string;
  startedAt: string;
  got: Outcome | null; // null: the run failed
  expected: Outcome;
  correct: boolean;
  unsafeApproval: boolean;
  receiptReadCorrectly: boolean | null; // null: the run failed
  citedExpectedRule: boolean;
  costUsd: number;
  turns: number;
  seconds: number | null;
};

export type ModelScore = {
  model: string;
  runs: number;
  correct: number;
  accuracy: number; // 0 to 1
  failedRuns: number;
  unsafeApprovals: number;
  receiptsReadCorrectly: number;
  citedExpectedRule: number;
  // confusion[expected][got]: how many runs with this answer key got this outcome
  confusion: Record<Outcome, Record<Outcome | "failed", number>>;
  avgCostUsd: number;
  totalCostUsd: number;
  avgTurns: number;
  avgSeconds: number;
};

const OUTCOMES: Outcome[] = ["approve", "reject", "review"];

export function scoreRun(run: AgentRun, rec: Recommendation | null): ScoredRun {
  const key = ANSWER_KEY.find((k) => k.claimId === run.claim_id);
  if (!key) throw new Error(`${run.claim_id} is not in the answer key`);

  const got = rec?.outcome ?? null;
  const reading = rec?.receipt_reading ?? null;

  // A clear receipt is read correctly when the total matches to the cent.
  // A blurry receipt is read correctly when the model says it is not clear
  // (and does not invent a wrong total).
  let receiptReadCorrectly: boolean | null = null;
  if (rec) {
    const totalRight = reading?.total != null && Math.abs(reading.total - key.receiptTotal) < 0.005;
    receiptReadCorrectly = key.blurry
      ? reading != null && reading.legibility !== "clear" && (reading.total == null || totalRight)
      : totalRight;
  }

  const finished = run.finished_at ? new Date(run.finished_at).getTime() : null;
  return {
    runId: run.id,
    claimId: run.claim_id,
    model: run.model,
    startedAt: run.started_at,
    got,
    expected: key.outcome,
    correct: got === key.outcome,
    unsafeApproval: got === "approve" && key.outcome !== "approve",
    receiptReadCorrectly,
    citedExpectedRule: rec != null && key.rules.some((id) => rec.policy_rule_ids.includes(id)),
    costUsd: Number(run.cost_usd ?? 0),
    turns: run.turns ?? 0,
    seconds: finished ? (finished - new Date(run.started_at).getTime()) / 1000 : null,
  };
}

export function summarize(runs: ScoredRun[]): ModelScore[] {
  const models = [...new Set(runs.map((r) => r.model))].sort();
  return models.map((model) => {
    const mine = runs.filter((r) => r.model === model);
    const count = (test: (r: ScoredRun) => boolean) => mine.filter(test).length;
    const average = (values: number[]) => (values.length ? values.reduce((a, b) => a + b, 0) / values.length : 0);

    const confusion = Object.fromEntries(
      OUTCOMES.map((expected) => [
        expected,
        Object.fromEntries(
          [...OUTCOMES, "failed" as const].map((got) => [
            got,
            count((r) => r.expected === expected && (r.got ?? "failed") === got),
          ])
        ),
      ])
    ) as ModelScore["confusion"];

    const totalCostUsd = mine.reduce((sum, r) => sum + r.costUsd, 0);
    return {
      model,
      runs: mine.length,
      correct: count((r) => r.correct),
      accuracy: mine.length ? count((r) => r.correct) / mine.length : 0,
      failedRuns: count((r) => r.got === null),
      unsafeApprovals: count((r) => r.unsafeApproval),
      receiptsReadCorrectly: count((r) => r.receiptReadCorrectly === true),
      citedExpectedRule: count((r) => r.citedExpectedRule),
      confusion,
      avgCostUsd: mine.length ? totalCostUsd / mine.length : 0,
      totalCostUsd,
      avgTurns: average(mine.map((r) => r.turns)),
      avgSeconds: average(mine.flatMap((r) => (r.seconds == null ? [] : [r.seconds]))),
    };
  });
}

// ---------------------------------------------------------------------------
// Loading runs from the database
// ---------------------------------------------------------------------------

// Every finished run on the answer-key claims, scored.
//   runIds: score only these runs (scripts/eval.mjs scores its own batch).
//   since:  only runs started after this time, e.g. after you changed the
//           prompt, so older runs don't blur the comparison.
export async function loadScoredRuns({ runIds, since }: { runIds?: string[]; since?: string } = {}): Promise<
  ScoredRun[]
> {
  let query = db
    .from("agent_runs")
    .select("*, recommendations(*)")
    .in(
      "claim_id",
      ANSWER_KEY.map((k) => k.claimId)
    )
    .neq("status", "running") // still going: nothing to score yet
    .order("started_at");
  if (runIds) query = query.in("id", runIds);
  if (since) query = query.gte("started_at", since);

  const { data, error } = await query;
  if (error) throw new Error(error.message);

  type Row = AgentRun & { recommendations: Recommendation[] };
  return (data as Row[]).map(({ recommendations, ...run }) => scoreRun(run, recommendations[0] ?? null));
}
