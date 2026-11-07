// Admin view: the review queue.
//
// Three groups of claims:
//   1. Waiting for the agent: submitted, no recommendation yet.
//   2. Ready for a decision: the agent has recommended something.
//   3. Decided: a person approved, rejected, or asked for more information.
//
// Claims the agent says to approve can be approved in bulk. Everything else
// is opened one at a time, so the admin can read the agent's reasoning.

import Link from "next/link";
import { connection } from "next/server";
import { approveClean } from "@/app/actions";
import { AutoRefresh } from "@/app/components/auto-refresh";
import { Badge, isActive, modelLabel, money } from "@/app/components/badges";
import { RunAgentButton } from "@/app/components/run-agent-button";
import { listQueue, type QueueRow } from "@/lib/claims";

export default async function AdminPage() {
  await connection(); // always load fresh data; never serve a saved copy of this page
  const queue = await listQueue();

  const waiting = queue.filter((c) => c.status === "submitted");
  const ready = queue.filter((c) => c.status === "recommended" || c.status === "needs_info");
  const decided = queue.filter((c) => c.status === "approved" || c.status === "rejected");
  const clean = ready.filter((c) => c.status === "recommended" && c.recommendation?.outcome === "approve");
  const anyRunning = queue.some((c) => isActive(c.latestRun));

  return (
    <>
      {anyRunning && <AutoRefresh />}
      <h1>Review queue</h1>
      <p className="muted">
        The agent recommends. You decide. Nothing is approved, rejected, or paid until you click a button.
      </p>

      <h2>1. Waiting for the agent ({waiting.length})</h2>
      {waiting.length > 0 && (
        <RunAgentButton
          claimIds={waiting.filter((c) => !isActive(c.latestRun)).map((c) => c.id)}
          label="Review all waiting claims"
        />
      )}
      <ClaimTable rows={waiting} />

      <h2>2. Ready for your decision ({ready.length})</h2>
      {clean.length > 0 && (
        <form action={approveClean} className="panel" style={{ marginBottom: 16 }}>
          <strong>Bulk approve clean claims</strong>
          <p className="small muted" style={{ margin: "4px 0 8px" }}>
            The agent found no problems with these. Uncheck any you want to look at first.
          </p>
          {clean.map((c) => (
            <label key={c.id} className="small" style={{ display: "flex", gap: 8, fontWeight: 400 }}>
              <input type="checkbox" name="claimId" value={c.id} defaultChecked />
              {c.id} · {c.employee_name} · {c.merchant} · {money(c.amount)}
            </label>
          ))}
          <button className="approve" style={{ marginTop: 8 }}>
            Approve selected
          </button>
        </form>
      )}
      <ClaimTable rows={ready} />

      <h2>3. Decided ({decided.length})</h2>
      <ClaimTable rows={decided} />
    </>
  );
}

function ClaimTable({ rows }: { rows: QueueRow[] }) {
  if (rows.length === 0) return <p className="muted">None.</p>;
  return (
    <div className="table-wrap">
      <table>
        <thead>
          <tr>
            <th>Claim</th>
            <th>Employee</th>
            <th>Category</th>
            <th>Merchant</th>
            <th className="num">Amount</th>
            <th>Status</th>
            <th>Agent recommends</th>
          </tr>
        </thead>
        <tbody>
          {rows.map((c) => (
            <tr key={c.id}>
              <td>
                <Link href={`/admin/claims/${c.id}`}>{c.id}</Link>
              </td>
              <td>{c.employee_name}</td>
              <td>{c.category}</td>
              <td>{c.merchant}</td>
              <td className="num">{money(c.amount)}</td>
              <td>
                <Badge value={c.status} />
              </td>
              <td>
                <AgentCell row={c} />
              </td>
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}

function AgentCell({ row }: { row: QueueRow }) {
  if (isActive(row.latestRun)) return <Badge value="running" />;
  if (row.latestRun?.status === "failed") return <Badge value="failed" />;
  if (!row.recommendation) return <span className="muted">—</span>;
  return (
    <>
      <Badge value={row.recommendation.outcome} />{" "}
      <span className="small muted">({modelLabel(row.recommendation.model)})</span>
      <div className="small">{row.recommendation.summary}</div>
    </>
  );
}
