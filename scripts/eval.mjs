// Runs the agent on all 20 demo claims and reports how often it was right.
//
//   npm run dev                                   (in another terminal first)
//   npm run eval                                  Haiku, each claim once
//   npm run eval -- --models haiku,sonnet --repeats 3
//
// This script is only a driver. It asks the running app to review each claim
// (POST /api/review, the same route the admin's button uses), then asks it to
// score the batch against the answer key (GET /api/eval, see lib/eval.ts).
// Every run is saved like any other, so you can open its trace in the admin
// view, and the full history appears at /admin/eval.
//
// Cost: in our tests a Haiku review cost about $0.002 and a Sonnet review
// about 10 to 20 times more. The script prints the real total at the end.
//
// Note: each review also becomes the claim's latest recommendation in the
// admin queue.

import { parseArgs } from "node:util";

const { values } = parseArgs({
  options: {
    models: { type: "string", default: "haiku" },
    repeats: { type: "string", default: "1" },
    claims: { type: "string" }, // e.g. --claims C11,C12 to rerun a few
    url: { type: "string", default: "http://localhost:3000" },
  },
});
const models = values.models.split(",");
const repeats = Number(values.repeats);
const AT_ONCE = 3; // reviews running at the same time

// The answer-key claims are C01 to C20.
const claimIds = values.claims
  ? values.claims.split(",")
  : Array.from({ length: 20 }, (_, i) => `C${String(i + 1).padStart(2, "0")}`);

// Make sure the app is running before spending anything.
try {
  await fetch(`${values.url}/api/eval?runs=none`);
} catch {
  console.error(`Could not reach the app at ${values.url}. Start it with: npm run dev`);
  process.exit(1);
}

// One job per (model, claim, repeat).
const jobs = models.flatMap((model) =>
  Array.from({ length: repeats }, () => claimIds.map((claimId) => ({ model, claimId }))).flat()
);
const startedAt = new Date().toISOString();
console.log(`Running ${jobs.length} reviews (${models.join(", ")}, ${repeats}x each claim) ...\n`);

const runIds = [];
let done = 0;
async function worker() {
  for (let job = jobs.shift(); job; job = jobs.shift()) {
    const response = await fetch(`${values.url}/api/review`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(job),
    });
    const data = await response.json();
    done += 1;
    if (data.runId) runIds.push(data.runId);
    const outcome = data.recommendation?.outcome ?? `FAILED (${data.error})`;
    console.log(`  [${done}] ${job.claimId} ${job.model.padEnd(6)} -> ${outcome}`);
  }
}
await Promise.all(Array.from({ length: AT_ONCE }, worker));

// Score this batch.
const response = await fetch(`${values.url}/api/eval?runs=${runIds.join(",")}`);
const { scores, runs, error } = await response.json();
if (error) {
  console.error(error);
  process.exit(1);
}

console.log("\nMistakes:");
const mistakes = runs.filter((r) => !r.correct);
if (mistakes.length === 0) console.log("  none");
for (const r of mistakes) {
  const flag = r.unsafeApproval ? "  <-- UNSAFE: approved a claim that should not be" : "";
  console.log(`  ${r.claimId} ${r.model}: expected ${r.expected}, got ${r.got ?? "failed run"}${flag}`);
}

const pct = (n, d) => `${n}/${d} (${Math.round((100 * n) / d)}%)`;
console.log("\nScores:");
console.table(
  Object.fromEntries(
    scores.map((s) => [
      s.model,
      {
        accuracy: pct(s.correct, s.runs),
        "unsafe approvals": s.unsafeApprovals,
        "failed runs": s.failedRuns,
        "receipt read right": pct(s.receiptsReadCorrectly, s.runs),
        "avg cost": `$${s.avgCostUsd.toFixed(4)}`,
        "total cost": `$${s.totalCostUsd.toFixed(2)}`,
        "avg turns": s.avgTurns.toFixed(1),
        "avg seconds": s.avgSeconds.toFixed(0),
      },
    ])
  )
);
console.log(`See this batch, with every trace, at ${values.url}/admin/eval?since=${startedAt}`);
