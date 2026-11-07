// A bare-bones test page for build step 3: pick a claim and a model, run the
// agent, and see its recommendation and every tool call it made.
// (Step 4 replaces this with the real employee form and admin queue.)
// "use client" means this component runs in the browser.
"use client";

import { useState } from "react";
import type { ReviewResult } from "@/lib/agent";

type ToolEvent = { seq: number; tool_name: string; input: unknown; output: unknown; is_error: boolean };
type Response = ReviewResult & { toolEvents: ToolEvent[] };

const CLAIM_IDS = Array.from({ length: 20 }, (_, i) => `C${String(i + 1).padStart(2, "0")}`);

export default function TestPage() {
  const [claimId, setClaimId] = useState("C01");
  const [model, setModel] = useState("haiku");
  const [running, setRunning] = useState(false);
  const [result, setResult] = useState<Response | null>(null);
  const [error, setError] = useState<string | null>(null);

  async function run() {
    setRunning(true);
    setResult(null);
    setError(null);
    const response = await fetch("/api/review", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ claimId, model }),
    });
    const data = await response.json();
    if (response.ok) setResult(data);
    else setError(data.error);
    setRunning(false);
  }

  const rec = result?.recommendation;

  return (
    <main>
      <h1>Expense Review Agent: Step 3 test</h1>

      <p>
        <label>
          Claim:{" "}
          <select value={claimId} onChange={(e) => setClaimId(e.target.value)}>
            {CLAIM_IDS.map((id) => (
              <option key={id}>{id}</option>
            ))}
          </select>
        </label>{" "}
        <label>
          Model:{" "}
          <select value={model} onChange={(e) => setModel(e.target.value)}>
            <option value="haiku">Haiku 5.5</option>
            <option value="sonnet">Sonnet 5.5</option>
          </select>
        </label>{" "}
        <button disabled={running} onClick={run}>
          Review claim
        </button>
      </p>

      {running && <p>The agent is reviewing {claimId}…</p>}
      {error && <p style={{ color: "crimson" }}>Error: {error}</p>}

      {result && (
        <section>
          <h2>Recommendation: {rec ? rec.outcome.toUpperCase() : "none"}</h2>
          {result.error && <p style={{ color: "crimson" }}>{result.error}</p>}
          {rec && (
            <>
              <p>{rec.summary}</p>
              <ul>
                {rec.reasons.map((reason, i) => (
                  <li key={i}>{reason}</li>
                ))}
              </ul>
              <p>Rules: {rec.policy_rule_ids.join(", ") || "(none)"}</p>
              {rec.employee_question && <p>Draft question for the employee: “{rec.employee_question}”</p>}
            </>
          )}

          <h2>Trace: every tool call</h2>
          <ol>
            {result.toolEvents.map((event) => (
              <li key={event.seq}>
                <details>
                  <summary>
                    <code>{event.tool_name}</code> {JSON.stringify(event.input)}
                    {event.is_error && " (error)"}
                  </summary>
                  <pre style={{ whiteSpace: "pre-wrap", background: "#f4f4f4", padding: 8, fontSize: 12 }}>
                    {JSON.stringify(event.output, null, 2)}
                  </pre>
                </details>
              </li>
            ))}
          </ol>

          <p>
            {result.model}: {result.turns} turns, {(result.durationMs / 1000).toFixed(1)} s, {result.inputTokens} tokens
            in, {result.outputTokens} out, about ${result.costUsd.toFixed(4)}
          </p>
        </section>
      )}
    </main>
  );
}
