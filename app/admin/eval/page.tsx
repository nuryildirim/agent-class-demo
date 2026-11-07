// Evaluation results: how often each model's recommendation matched the
// answer key on the 20 demo claims.
//
// This page only reads. To add runs, use `npm run eval` (scripts/eval.mjs)
// or the review buttons in the admin view. Every run on a demo claim counts,
// so more runs give a steadier score. The scoring is in lib/eval.ts.
//
// /admin/eval?since=2026-11-07T18:00:00Z shows only runs started after that
// time, for example only the runs since the last prompt change.

import Link from "next/link";
import { connection } from "next/server";
import { Badge, modelLabel } from "@/app/components/badges";
import type { Outcome } from "@/lib/db";
import { ANSWER_KEY, loadScoredRuns, summarize, type ModelScore } from "@/lib/eval";

const OUTCOMES: Outcome[] = ["approve", "reject", "review"];

export default async function EvalPage({ searchParams }: { searchParams: Promise<{ since?: string }> }) {
  await connection(); // always load fresh data
  const { since } = await searchParams;
  const sinceDate = since && !Number.isNaN(Date.parse(since)) ? new Date(since) : null;
  const runs = await loadScoredRuns({ since: sinceDate?.toISOString() });
  const scores = summarize(runs);

  return (
    <>
      <p className="small">
        <Link href="/admin">← Review queue</Link>
      </p>
      <h1>Evaluation</h1>
      <p>
        Each of the 20 demo claims has a known correct answer. This page compares every agent run on those claims
        with that answer key. The agent never sees the answer key: it lives in <code>data/demo-claims.json</code>, not
        in the database.
      </p>
      <p className="muted small">
        Add runs with <code>npm run eval -- --models haiku,sonnet --repeats 3</code>. A failed run (no recommendation
        saved) counts as wrong.
      </p>
      {sinceDate && (
        <p className="callout small">
          Showing only runs started after {sinceDate.toLocaleString()}. <Link href="/admin/eval">Show all runs</Link>
        </p>
      )}

      {scores.length === 0 ? (
        <p className="muted">No runs on the demo claims yet.</p>
      ) : (
        <>
          <h2>Scores</h2>
          <Scorecard scores={scores} />

          <h2>Where the mistakes are</h2>
          <p className="small muted">
            Rows are the correct answer; columns are what the agent recommended. The diagonal is correct. The worst cell
            is &quot;approve&quot; when the answer was reject or review, because an admin could bulk-approve it without
            reading.
          </p>
          <div className="grid-2">
            {scores.map((s) => (
              <Confusion key={s.model} score={s} />
            ))}
          </div>

          <h2>Every claim, every run</h2>
          <p className="small muted">Click a result to open that run&apos;s trace.</p>
          <ClaimGrid runs={runs} models={scores.map((s) => s.model)} />
        </>
      )}
    </>
  );
}

function Scorecard({ scores }: { scores: ModelScore[] }) {
  const pct = (n: number, d: number) => `${n}/${d} (${d ? Math.round((100 * n) / d) : 0}%)`;
  const rows: [string, (s: ModelScore) => string][] = [
    ["Runs", (s) => String(s.runs)],
    ["Accuracy (outcome matches the answer key)", (s) => pct(s.correct, s.runs)],
    ["Unsafe approvals (approved a claim that should not be)", (s) => String(s.unsafeApprovals)],
    ["Failed runs", (s) => String(s.failedRuns)],
    ["Receipt read correctly (the Extract step)", (s) => pct(s.receiptsReadCorrectly, s.runs)],
    ["Cited the expected policy rule", (s) => pct(s.citedExpectedRule, s.runs)],
    ["Average cost per claim", (s) => `$${s.avgCostUsd.toFixed(4)}`],
    ["Total cost of these runs", (s) => `$${s.totalCostUsd.toFixed(2)}`],
    ["Average turns", (s) => s.avgTurns.toFixed(1)],
    ["Average seconds", (s) => s.avgSeconds.toFixed(0)],
  ];
  return (
    <div className="table-wrap">
      <table>
        <thead>
          <tr>
            <th />
            {scores.map((s) => (
              <th key={s.model} className="num">
                {modelLabel(s.model)}
              </th>
            ))}
          </tr>
        </thead>
        <tbody>
          {rows.map(([label, value]) => (
            <tr key={label}>
              <td>{label}</td>
              {scores.map((s) => (
                <td key={s.model} className="num">
                  {value(s)}
                </td>
              ))}
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}

function Confusion({ score }: { score: ModelScore }) {
  const columns = [...OUTCOMES, "failed"] as const;
  return (
    <div className="panel">
      <strong>{modelLabel(score.model)}</strong>
      <table>
        <thead>
          <tr>
            <th>Correct answer ↓ / agent said →</th>
            {columns.map((c) => (
              <th key={c} className="num">
                {c}
              </th>
            ))}
          </tr>
        </thead>
        <tbody>
          {OUTCOMES.map((expected) => (
            <tr key={expected}>
              <td>
                <Badge value={expected} />
              </td>
              {columns.map((got) => {
                const n = score.confusion[expected][got];
                const style =
                  n === 0 ? { color: "var(--muted)" } : got === expected ? { fontWeight: 700 } : { color: "var(--reject)", fontWeight: 700 };
                return (
                  <td key={got} className="num" style={style}>
                    {n}
                  </td>
                );
              })}
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}

function ClaimGrid({ runs, models }: { runs: Awaited<ReturnType<typeof loadScoredRuns>>; models: string[] }) {
  return (
    <div className="table-wrap">
      <table>
        <thead>
          <tr>
            <th>Claim</th>
            <th>Correct answer</th>
            {models.map((m) => (
              <th key={m}>{modelLabel(m)}</th>
            ))}
          </tr>
        </thead>
        <tbody>
          {ANSWER_KEY.map((key) => (
            <tr key={key.claimId}>
              <td>
                <Link href={`/admin/claims/${key.claimId}`}>{key.claimId}</Link>
              </td>
              <td>
                <Badge value={key.outcome} />
                <div className="small muted">{key.reason}</div>
              </td>
              {models.map((model) => (
                <td key={model}>
                  {runs
                    .filter((r) => r.claimId === key.claimId && r.model === model)
                    .map((r) => (
                      <Link
                        key={r.runId}
                        href={`/admin/claims/${r.claimId}?run=${r.runId}`}
                        title={r.correct ? "correct" : `expected ${r.expected}`}
                        style={{ marginRight: 4, textDecoration: "none" }}
                      >
                        {r.correct ? "✓" : "✗"} <Badge value={r.got ?? "failed"} />
                      </Link>
                    ))}
                </td>
              ))}
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}
