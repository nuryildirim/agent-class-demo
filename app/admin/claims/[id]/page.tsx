// Admin view of one claim: everything needed to make a decision.
//
//   - the claim and its receipt image
//   - the agent's recommendation, reasons, and evidence
//   - the decision buttons (the only way a claim gets approved or rejected)
//   - the trace: every tool call the agent made, in order
//
// The folder name [id] makes this a dynamic route: /admin/claims/C13 opens
// this page with params.id = "C13". Adding ?run=<id> shows an older agent run
// instead of the latest one (the evaluation page links to these).

import Link from "next/link";
import { notFound } from "next/navigation";
import { decideClaim } from "@/app/actions";
import { AutoRefresh } from "@/app/components/auto-refresh";
import { Badge, isActive, modelLabel, money } from "@/app/components/badges";
import { RunAgentButton } from "@/app/components/run-agent-button";
import { getClaimDetail } from "@/lib/claims";
import type { ToolEvent } from "@/lib/db";

export default async function ClaimPage({
  params,
  searchParams,
}: {
  params: Promise<{ id: string }>;
  searchParams: Promise<{ run?: string }>;
}) {
  const { id } = await params;
  const { run } = await searchParams;
  const detail = await getClaimDetail(id, run);
  if (!detail) notFound();
  const { claim, receiptUrl, runs, latestRun, shownRun, recommendation: rec, toolEvents, decisions } = detail;
  const showingOldRun = shownRun !== null && shownRun.id !== latestRun?.id;

  const isOpen = ["submitted", "recommended", "needs_info"].includes(claim.status);
  const running = isActive(latestRun);

  return (
    <>
      {running && <AutoRefresh />}
      <p className="small">
        <Link href="/admin">← Review queue</Link>
      </p>
      <h1>
        Claim {claim.id} <Badge value={claim.status} />
      </h1>

      {/* ---- The claim and the receipt, side by side ---- */}
      <div className="grid-2">
        <div className="panel">
          <h2 style={{ marginTop: 0 }}>What the employee submitted</h2>
          <table>
            <tbody>
              <Fact label="Employee" value={`${claim.employee_name} (${claim.department})`} />
              <Fact label="Category" value={claim.category} />
              <Fact label="Merchant" value={claim.merchant} />
              <Fact label="Amount" value={money(claim.amount)} />
              <Fact label="Date of expense" value={claim.expense_date} />
              {claim.category === "meal" && <Fact label="People" value={String(claim.attendees)} />}
              {claim.nights !== null && <Fact label="Nights" value={String(claim.nights)} />}
              <Fact label="Submitted" value={new Date(claim.submitted_at).toLocaleString()} />
              <Fact label="Purpose" value={claim.purpose} />
            </tbody>
          </table>
        </div>
        <div className="panel">
          <h2 style={{ marginTop: 0 }}>Receipt</h2>
          {/* A plain <img>: the signed URL is temporary, so there's nothing for Next.js to optimize. */}
          {receiptUrl ? (
            <img src={receiptUrl} alt={`Receipt for claim ${claim.id}`} className="receipt-img" />
          ) : (
            <p className="muted">No receipt.</p>
          )}
        </div>
      </div>

      {/* ---- The agent's recommendation ---- */}
      <h2>Agent recommendation</h2>
      {running && <p className="callout">The agent is reviewing this claim now…</p>}
      {showingOldRun && (
        <p className="callout">
          You are looking at an older run ({modelLabel(shownRun.model)}, {new Date(shownRun.started_at).toLocaleString()}
          ). <Link href={`/admin/claims/${claim.id}`}>Show the latest run</Link>
        </p>
      )}
      {!running && shownRun?.status === "failed" && (
        <p className="error">This agent run failed: {shownRun.error}</p>
      )}
      {!running && !latestRun && <p className="muted">The agent has not reviewed this claim yet.</p>}

      {rec && (
        <div className="panel">
          <p style={{ marginTop: 0 }}>
            <Badge value={rec.outcome} /> <strong>{rec.summary}</strong>
          </p>
          <h3>Reasons</h3>
          <ul>
            {rec.reasons.map((reason, i) => (
              <li key={i}>{reason}</li>
            ))}
          </ul>
          <h3>Evidence</h3>
          <ul>
            {rec.evidence.map((e, i) => (
              <li key={i}>
                <strong>{e.source}:</strong> {e.detail}
              </li>
            ))}
          </ul>
          <p className="small">Policy rules cited: {rec.policy_rule_ids.join(", ") || "none"}</p>

          {rec.receipt_reading && (
            <>
              <h3>What the agent read on the receipt</h3>
              <p className="small muted">Compare with the image above. Did it read the receipt correctly?</p>
              <table>
                <tbody>
                  <Fact label="Legibility" value={rec.receipt_reading.legibility.replace("_", " ")} />
                  <Fact label="Merchant" value={rec.receipt_reading.merchant ?? "unreadable"} />
                  <Fact label="Date" value={rec.receipt_reading.date ?? "unreadable"} />
                  <Fact
                    label="Items"
                    value={
                      rec.receipt_reading.items.map((item) => `${item.description} ${money(item.amount)}`).join("; ") ||
                      "none read"
                    }
                  />
                  <Fact
                    label="Total"
                    value={rec.receipt_reading.total === null ? "unreadable" : money(rec.receipt_reading.total)}
                  />
                </tbody>
              </table>
            </>
          )}
        </div>
      )}

      {/* ---- The human decision ---- */}
      <h2>Your decision</h2>
      {isOpen ? (
        <form action={decideClaim} className="stack panel">
          <input type="hidden" name="claimId" value={claim.id} />
          <label>
            Note to the employee (optional)
            <textarea
              name="message"
              defaultValue={rec?.employee_question ?? ""}
              placeholder="Added to the email the employee receives."
            />
          </label>
          {rec?.employee_question && (
            <p className="small muted" style={{ margin: 0 }}>
              The agent drafted this note. Edit it or clear it. Nothing is sent until you click a button.
            </p>
          )}
          <div className="row">
            <button name="decision" value="approved" className="approve">
              Approve
            </button>
            <button name="decision" value="rejected" className="reject">
              Reject
            </button>
            <button name="decision" value="needs_info" className="needs_info">
              Ask for more information
            </button>
          </div>
        </form>
      ) : (
        <p>This claim has been decided.</p>
      )}

      {decisions.length > 0 && (
        <>
          <h3>Decision history</h3>
          {decisions.map((d) => (
            <div key={d.id} className="panel">
              <Badge value={d.decision} /> by {d.decided_by}, {new Date(d.decided_at).toLocaleString()}
              {d.employee_message && (
                <>
                  <div className="small muted" style={{ marginTop: 8 }}>
                    Email sent to {claim.employee_email} (mock):
                  </div>
                  <div className="email small">{d.employee_message}</div>
                </>
              )}
            </div>
          ))}
        </>
      )}

      {/* ---- The audit trail ---- */}
      <h2>Trace: how the agent got there</h2>
      {shownRun && (
        <p className="small muted">
          {modelLabel(shownRun.model)}, {new Date(shownRun.started_at).toLocaleString()}
          {shownRun.turns !== null &&
            ` · ${shownRun.turns} turns · ${shownRun.input_tokens} tokens in, ${shownRun.output_tokens} out · about $${Number(shownRun.cost_usd).toFixed(4)}`}
        </p>
      )}
      {toolEvents.length === 0 ? (
        <p className="muted">No tool calls recorded.</p>
      ) : (
        <ol className="trace">
          {toolEvents.map((event) => (
            <TraceStep key={event.id} event={event} />
          ))}
        </ol>
      )}

      <div style={{ marginTop: 16 }}>
        {!running && (
          <RunAgentButton
            claimIds={[claim.id]}
            label={latestRun ? "Run the agent again" : "Run the agent"}
          />
        )}
        {runs.length > 1 && (
          <details className="small">
            <summary>All {runs.length} agent runs on this claim</summary>
            <ul>
              {runs.map((r) => (
                <li key={r.id}>
                  <Link href={`/admin/claims/${claim.id}?run=${r.id}`}>
                    {modelLabel(r.model)}, {new Date(r.started_at).toLocaleString()}
                  </Link>{" "}
                  <Badge value={r.status} />
                  {r.id === shownRun?.id && " (shown above)"}
                </li>
              ))}
            </ul>
          </details>
        )}
      </div>
    </>
  );
}

function Fact({ label, value }: { label: string; value: string }) {
  return (
    <tr>
      <th style={{ width: "35%" }}>{label}</th>
      <td>{value}</td>
    </tr>
  );
}

// What kind of tool each one is. The point to notice: none of them decides.
const TOOL_KINDS: Record<string, string> = {
  get_claim: "read-only",
  get_receipt: "read-only",
  search_policy: "read-only",
  check_policy: "read-only, regular code",
  find_similar_claims: "read-only",
  draft_employee_question: "draft only, sends nothing",
  save_recommendation: "saves advice only",
};

function TraceStep({ event }: { event: ToolEvent }) {
  const hasInput = Boolean(event.input && Object.keys(event.input as object).length > 0);
  return (
    <li>
      <details>
        <summary>
          <span className="seq">{event.seq}.</span>
          <span className="tool">{event.tool_name}</span>
          <span className="why">({TOOL_KINDS[event.tool_name] ?? "tool"})</span>
          {hasInput && event.tool_name !== "save_recommendation" && (
            <code className="small">{JSON.stringify(event.input)}</code>
          )}
          {event.is_error && <Badge value="failed" />}
        </summary>
        <div className="body">
          {hasInput && (
            <>
              <div className="small muted">The agent sent:</div>
              <pre>{JSON.stringify(event.input, null, 2)}</pre>
            </>
          )}
          <div className="small muted" style={{ marginTop: 8 }}>
            The tool returned:
          </div>
          <pre>{readableOutput(event.output)}</pre>
        </div>
      </details>
    </li>
  );
}

// Tool results are stored as a list of content blocks, usually one text block
// holding JSON. Unwrap that so it reads nicely.
function readableOutput(output: unknown): string {
  if (!Array.isArray(output)) return JSON.stringify(output, null, 2);
  return output
    .map((block) => {
      if (block?.type === "image") return "[receipt image]";
      if (block?.type !== "text") return JSON.stringify(block, null, 2);
      try {
        return JSON.stringify(JSON.parse(block.text), null, 2);
      } catch {
        return block.text;
      }
    })
    .join("\n");
}
