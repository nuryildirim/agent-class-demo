// A bare-bones test page. Pick a receipt and a model, run the agent, and see
// what it did. ("use client" means this component runs in the browser.)
"use client";

import { useState } from "react";
import type { AgentRunReport } from "@/lib/agent";

export default function TestPage() {
  const [receiptId, setReceiptId] = useState("meal-clear");
  const [model, setModel] = useState("haiku");
  const [running, setRunning] = useState(false);
  const [report, setReport] = useState<AgentRunReport | null>(null);
  const [error, setError] = useState<string | null>(null);

  async function run(kind: "read-receipt" | "restriction-check") {
    setRunning(true);
    setReport(null);
    setError(null);
    const response = await fetch("/api/test-agent", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ kind, receiptId, model }),
    });
    const data = await response.json();
    if (response.ok) setReport(data);
    else setError(data.error);
    setRunning(false);
  }

  return (
    <main>
      <h1>Expense Review Agent: Step 1 test</h1>
      <p>One agent, one custom tool (<code>get_receipt</code>), one receipt image.</p>

      <p>
        <label>
          Receipt:{" "}
          <select value={receiptId} onChange={(e) => setReceiptId(e.target.value)}>
            <option value="meal-clear">meal-clear</option>
            <option value="meal-blurry">meal-blurry</option>
          </select>
        </label>{" "}
        <label>
          Model:{" "}
          <select value={model} onChange={(e) => setModel(e.target.value)}>
            <option value="haiku">Haiku 5.5</option>
            <option value="sonnet">Sonnet 5.5</option>
          </select>
        </label>
      </p>

      <p>
        <button disabled={running} onClick={() => run("read-receipt")}>
          Read the receipt
        </button>{" "}
        <button disabled={running} onClick={() => run("restriction-check")}>
          Try to break the rules
        </button>
      </p>

      {running && <p>Running the agent…</p>}
      {error && <p style={{ color: "crimson" }}>Error: {error}</p>}

      {report && (
        <section>
          <h2>Answer</h2>
          <pre style={{ whiteSpace: "pre-wrap", background: "#f4f4f4", padding: 12 }}>{report.finalAnswer}</pre>

          <h2>What the agent did</h2>
          <ul>
            {report.toolCalls.map((call, i) => (
              <li key={i}>
                <code>{call.name}</code> {JSON.stringify(call.input)}
              </li>
            ))}
          </ul>
          {report.permissionDenials.length > 0 && (
            <p>Blocked calls: {report.permissionDenials.map((d) => d.tool_name).join(", ")}</p>
          )}

          <h2>Run details</h2>
          <ul>
            <li>Model: {report.model}</li>
            <li>Tools the agent can see: {report.toolsTheAgentCanSee.join(", ") || "(none)"}</li>
            <li>Outcome: {report.outcome}, {report.turns} turns, {(report.durationMs / 1000).toFixed(1)} s</li>
            <li>
              Tokens: {report.inputTokens} in, {report.outputTokens} out. Estimated cost: $
              {report.costUsd.toFixed(4)}
            </li>
            <li>API key source: {report.apiKeySource}</li>
          </ul>
        </section>
      )}
    </main>
  );
}
